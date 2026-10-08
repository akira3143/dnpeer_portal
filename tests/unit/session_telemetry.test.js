import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { SessionService } from '../../server/services/sessionService.js';
import { SessionTelemetryManager } from '../../server/services/sessionTelemetryManager.js';
import { FileStore } from '../../server/storage/fileStore.js';

describe('Peering Sessions Storage Decoupling & Telemetry Architecture', () => {
  let tempDir;
  let prevPortalDataDir;

  before(() => {
    prevPortalDataDir = process.env.PORTAL_DATA_DIR;
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dn42-telemetry-test-'));
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

  test('1. Fresh installation & decoupled storage re-hydration', async () => {
    const sessionsFile = path.join(tempDir, 'peering_sessions.json');
    const telemetryFile = path.join(tempDir, 'session_telemetry.json');

    // Setup pure decoupled state (pure static sessions + separate telemetry file)
    const staticSessions = [
      {
        id: 'peer_node1_node1',
        source: 'discovered',
        asn: 4242420001,
        asName: 'AS4242420001',
        nodeId: 'node1',
        status: 'active',
        peering: { publicKey: 'ABC1=', endpoint: '1.2.3.4:20001', interface: 'dn42_node1' },
        assigned: { hostPort: 20001, interface: 'dn42_node1' }
      },
      {
        id: 'peer_node2_eu',
        source: 'form',
        asn: 4242420002,
        asName: 'AS4242420002',
        nodeId: 'node2',
        status: 'idle',
        peering: { publicKey: 'ABC2=', endpoint: '', interface: 'dn42_node2' },
        assigned: { hostPort: 20002, interface: 'dn42_node2' }
      }
    ];

    const telemetryData = {
      version: 1,
      updatedAt: new Date().toISOString(),
      sessions: {
        peer_node1_node1: {
          stage: 3,
          stageText: 'BGP Established',
          status: 'active',
          latestHandshake: 1700001800,
          endpoint: '1.2.3.4:20001',
          rxBytes: 500000,
          txBytes: 300000,
          rx24h: 400000,
          tx24h: 250000,
          bgpState: 'Established',
          trafficSeries: [
            [1700000000, 100000, 50000],
            [1700001800, 500000, 300000]
          ]
        },
        peer_node2_eu: {
          stage: 1,
          stageText: 'BGP Idle',
          status: 'idle',
          latestHandshake: 0,
          endpoint: '',
          rxBytes: 0,
          txBytes: 0,
          rx24h: 0,
          tx24h: 0,
          bgpState: 'Idle',
          trafficSeries: []
        }
      }
    };

    fs.writeFileSync(sessionsFile, JSON.stringify(staticSessions, null, 2), 'utf8');
    fs.writeFileSync(telemetryFile, JSON.stringify(telemetryData, null, 2), 'utf8');

    // Read sessions via getSessions()
    const sessions = await SessionService.getSessions();
    assert.equal(sessions.length, 2);

    const s1 = sessions.find(s => s.id === 'peer_node1_node1');
    assert.ok(s1);
    assert.equal(s1.asn, 4242420001);
    assert.equal(s1.status, 'active');
    assert.ok(s1.runtime);
    assert.equal(s1.runtime.stage, 3);
    assert.equal(s1.runtime.rxBytes, 500000);
    assert.equal(s1.runtime.trafficSeries.length, 2);
    // Consumer format must be objects { t, rx, tx }
    assert.deepEqual(s1.runtime.trafficSeries[0], { t: 1700000000, rx: 100000, tx: 50000 });
    assert.deepEqual(s1.runtime.trafficSeries[1], { t: 1700001800, rx: 500000, tx: 300000 });
  });

  test('2. saveSessions() sanitizes runtime and never pollutes peering_sessions.json', async () => {
    const sessionsFile = path.join(tempDir, 'peering_sessions.json');
    const sessions = await SessionService.getSessions();
    assert.ok(sessions.length > 0);
    assert.ok(sessions[0].runtime, 'Session should have runtime object attached in-memory');

    await SessionService.saveSessions(sessions);

    // Verify disk content has 0 runtime fields
    const rawDisk = JSON.parse(fs.readFileSync(sessionsFile, 'utf8'));
    for (const item of rawDisk) {
      assert.equal(item.runtime, undefined, `Item ${item.id} on disk must NOT have runtime`);
    }
  });

  test('3. updateRuntimePeers debounces telemetry without writing peering_sessions.json', async () => {
    const sessionsFile = path.join(tempDir, 'peering_sessions.json');
    const mtimeBefore = fs.statSync(sessionsFile).mtimeMs;

    // Routine probe update for peer_node1_node1
    await SessionService.updateRuntimePeers('node1', [
      {
        publicKey: 'ABC1=',
        interface: 'dn42_node1',
        rxBytes: 900000,
        txBytes: 700000,
        latestHandshake: 1700005000
      }
    ], []);

    const mtimeAfter = fs.statSync(sessionsFile).mtimeMs;
    assert.equal(mtimeAfter, mtimeBefore, 'peering_sessions.json mtime must NOT change on routine telemetry report');

    // Verify in-memory telemetry updated
    const telem = SessionTelemetryManager.getTelemetry('peer_node1_node1');
    assert.equal(telem.rxBytes, 900000);
    assert.equal(telem.txBytes, 700000);
    assert.equal(telem.latestHandshake, 1700005000);

    const rehydrated = await SessionService.getSessions();
    const s1 = rehydrated.find(s => s.id === 'peer_node1_node1');
    assert.equal(s1.runtime.rxBytes, 900000);
  });

  test('4. SessionTelemetryManager rename and delete operations', async () => {
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
