import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { SessionService } from '../../server/services/sessionService.js';
import { SessionTelemetryManager } from '../../server/services/sessionTelemetryManager.js';
import { FileStore } from '../../server/storage/fileStore.js';

describe('Peering Sessions Storage Decoupling & Telemetry Migration', () => {
  const prodFilePath = 'C:\\Users\\Akira\\Desktop\\peering_sessions.json';
  const hasProdFile = fs.existsSync(prodFilePath);

  let tempDir;
  let prevPortalDataDir;

  before(() => {
    prevPortalDataDir = process.env.PORTAL_DATA_DIR;
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dn42-migration-test-'));
    process.env.PORTAL_DATA_DIR = tempDir;
    SessionTelemetryManager.resetForTesting();
  });

  after(() => {
    SessionTelemetryManager.resetForTesting();
    if (prevPortalDataDir !== undefined) {
      process.env.PORTAL_DATA_DIR = prevPortalDataDir;
    } else {
      delete process.env.PORTAL_DATA_DIR;
    }
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  test('1. First-time migration on legacy peering_sessions.json', async () => {
    const targetSessionsFile = path.join(tempDir, 'peering_sessions.json');
    const targetTelemetryFile = path.join(tempDir, 'session_telemetry.json');

    let originalData;
    if (hasProdFile) {
      fs.copyFileSync(prodFilePath, targetSessionsFile);
      originalData = JSON.parse(fs.readFileSync(prodFilePath, 'utf8'));
    } else {
      // Synthetic legacy data
      originalData = [
        {
          id: 'peer_node1_us',
          source: 'discovered',
          asn: 4242420001,
          asName: 'AS4242420001',
          nodeId: 'node1',
          status: 'active',
          peering: { publicKey: 'ABC1=', endpoint: '1.2.3.4:20001' },
          runtime: {
            stage: 3,
            stageText: 'BGP Established',
            rxBytes: 500000,
            txBytes: 300000,
            trafficSeries: [
              { t: 1700000000, rx: 100000, tx: 50000 },
              { t: 1700001800, rx: 500000, tx: 300000 }
            ],
            bgpState: 'Established'
          }
        },
        {
          id: 'peer_node2_eu',
          source: 'form',
          asn: 4242420002,
          asName: 'AS4242420002',
          nodeId: 'node2',
          status: 'idle',
          peering: { publicKey: 'ABC2=', endpoint: '' },
          runtime: {
            stage: 1,
            stageText: 'BGP Idle',
            rxBytes: 0,
            txBytes: 0,
            trafficSeries: [],
            bgpState: 'Idle'
          }
        }
      ];
      fs.writeFileSync(targetSessionsFile, JSON.stringify(originalData, null, 2), 'utf8');
    }

    const unmigratedRaw = fs.readFileSync(targetSessionsFile, 'utf8');
    const unmigratedSize = fs.statSync(targetSessionsFile).size;

    // Trigger migration via SessionService.ensureMigrated()
    await SessionService.ensureMigrated();

    // Verification A: Backup created and identical to original
    const files = fs.readdirSync(tempDir);
    const backupFiles = files.filter(f => f.startsWith('peering_sessions.json.bak.'));
    assert.equal(backupFiles.length, 1, 'Exactly one backup file should be created');
    const backupContent = fs.readFileSync(path.join(tempDir, backupFiles[0]), 'utf8');
    assert.equal(backupContent, unmigratedRaw, 'Backup content must match original unmigrated file exactly');

    // Verification B: peering_sessions.json is slimmed and contains 0 runtime fields
    const migratedSessions = JSON.parse(fs.readFileSync(targetSessionsFile, 'utf8'));
    assert.equal(migratedSessions.length, originalData.length, 'Session count must remain unchanged');
    for (const session of migratedSessions) {
      assert.equal(session.runtime, undefined, `Session ${session.id} must not have runtime in peering_sessions.json`);
    }
    const migratedSize = fs.statSync(targetSessionsFile).size;
    assert.ok(migratedSize < unmigratedSize, `Migrated size (${migratedSize}) must be significantly smaller than unmigrated (${unmigratedSize})`);

    // Verification C: session_telemetry.json is created and populated
    assert.ok(fs.existsSync(targetTelemetryFile), 'session_telemetry.json must exist');
    const telemetryJson = JSON.parse(fs.readFileSync(targetTelemetryFile, 'utf8'));
    assert.equal(telemetryJson.version, 1);
    assert.ok(telemetryJson.sessions);

    // Count data points
    let originalTotalPoints = 0;
    for (const s of originalData) {
      if (s.runtime && Array.isArray(s.runtime.trafficSeries)) {
        originalTotalPoints += s.runtime.trafficSeries.length;
      }
    }

    let telemetryTotalPoints = 0;
    for (const [, rec] of Object.entries(telemetryJson.sessions)) {
      if (rec.trafficSeries) {
        telemetryTotalPoints += rec.trafficSeries.length;
      }
    }
    assert.equal(telemetryTotalPoints, originalTotalPoints, `Total traffic points (${telemetryTotalPoints}) must match original (${originalTotalPoints})`);

    // Verification D: Consumer contract - SessionService.getSessions() returns joined data
    const rehydratedSessions = await SessionService.getSessions();
    assert.equal(rehydratedSessions.length, originalData.length);

    for (let i = 0; i < originalData.length; i++) {
      const orig = originalData[i];
      const rehydrated = rehydratedSessions.find(s => s.id === orig.id);
      assert.ok(rehydrated, `Rehydrated session ${orig.id} must exist`);

      // Verify static attributes intact
      assert.equal(rehydrated.asn, orig.asn);
      assert.equal(rehydrated.nodeId, orig.nodeId);
      assert.equal(rehydrated.peering?.publicKey, orig.peering?.publicKey);

      // Verify runtime rehydrated
      assert.ok(rehydrated.runtime, 'Runtime must be rehydrated');
      if (orig.runtime) {
        assert.equal(rehydrated.runtime.stage, orig.runtime.stage);
        assert.equal(rehydrated.runtime.rxBytes, orig.runtime.rxBytes || 0);
        assert.equal(rehydrated.runtime.txBytes, orig.runtime.txBytes || 0);
        assert.equal(rehydrated.runtime.bgpState, orig.runtime.bgpState || 'Pending');

        if (Array.isArray(orig.runtime.trafficSeries)) {
          assert.equal(rehydrated.runtime.trafficSeries.length, orig.runtime.trafficSeries.length);
          for (let pIdx = 0; pIdx < orig.runtime.trafficSeries.length; pIdx++) {
            const origPt = orig.runtime.trafficSeries[pIdx];
            const rehydratedPt = rehydrated.runtime.trafficSeries[pIdx];
            // Must have object shape { t, rx, tx }
            assert.equal(typeof rehydratedPt.t, 'number');
            assert.equal(typeof rehydratedPt.rx, 'number');
            assert.equal(typeof rehydratedPt.tx, 'number');
            assert.equal(rehydratedPt.t, origPt.t);
            assert.equal(rehydratedPt.rx, origPt.rx);
            assert.equal(rehydratedPt.tx, origPt.tx);
          }
        }
      }
    }

    // Verification E: Idempotency - Calling ensureMigrated() again should not create new backups
    await SessionService.ensureMigrated();
    const backupFilesAfter = fs.readdirSync(tempDir).filter(f => f.startsWith('peering_sessions.json.bak.'));
    assert.equal(backupFilesAfter.length, 1, 'No additional backups should be created when already migrated');
  });

  test('2. saveSessions() strips runtime and leaves peering_sessions.json clean', async () => {
    const targetSessionsFile = path.join(tempDir, 'peering_sessions.json');
    const currentSessions = await SessionService.getSessions();
    assert.ok(currentSessions.length > 0);

    // Call saveSessions with rehydrated objects (which have .runtime)
    await SessionService.saveSessions(currentSessions);

    // Direct read from disk must NOT contain runtime
    const diskSessions = JSON.parse(fs.readFileSync(targetSessionsFile, 'utf8'));
    for (const session of diskSessions) {
      assert.equal(session.runtime, undefined, `Disk session ${session.id} must not have runtime`);
    }
  });

  test('3. SessionTelemetryManager rename and delete operations', async () => {
    const testId = 'test_telemetry_rename_id';
    const newId = 'test_telemetry_new_id';

    SessionTelemetryManager.setTelemetry(testId, {
      stage: 3,
      stageText: 'BGP Established',
      rxBytes: 12345,
      txBytes: 67890,
      trafficSeries: [{ t: 1700000000, rx: 12345, tx: 67890 }]
    }, 'active');

    let rec = SessionTelemetryManager.getTelemetry(testId);
    assert.ok(rec);
    assert.equal(rec.rxBytes, 12345);

    // Rename
    SessionTelemetryManager.renameSession(testId, newId);
    assert.equal(SessionTelemetryManager.getTelemetry(testId), null);
    rec = SessionTelemetryManager.getTelemetry(newId);
    assert.ok(rec);
    assert.equal(rec.rxBytes, 12345);

    // Delete
    SessionTelemetryManager.deleteTelemetry(newId);
    assert.equal(SessionTelemetryManager.getTelemetry(newId), null);
  });
});
