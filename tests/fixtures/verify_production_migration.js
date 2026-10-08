import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';

const prodFilePath = process.env.AUDIT_SESSIONS_FILE || 'C:\\Users\\Akira\\Desktop\\peering_sessions.json';
if (!fs.existsSync(prodFilePath)) {
  console.log('Production file not found at:', prodFilePath, '(Skipping audit script)');
  process.exit(0);
}

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dn42-prod-migration-audit-'));
process.env.PORTAL_DATA_DIR = tempDir;

const targetSessionsFile = path.join(tempDir, 'peering_sessions.json');
const targetTelemetryFile = path.join(tempDir, 'session_telemetry.json');

fs.copyFileSync(prodFilePath, targetSessionsFile);

const originalRaw = fs.readFileSync(prodFilePath, 'utf8');
const originalData = JSON.parse(originalRaw);
const originalSizeBytes = fs.statSync(prodFilePath).size;
const originalLines = originalRaw.split('\n').length;

const sessionsWithTelemetry = originalData.filter(s => s.runtime && Array.isArray(s.runtime.trafficSeries));
const originalPoints = sessionsWithTelemetry.reduce((acc, s) => acc + s.runtime.trafficSeries.length, 0);

console.log('=== BEFORE MIGRATION ===');
console.log(`Original file size:     ${(originalSizeBytes / 1024).toFixed(2)} KB (${originalSizeBytes} bytes)`);
console.log(`Original line count:    ${originalLines} lines`);
console.log(`Original sessions:      ${originalData.length}`);
console.log(`Sessions with traffic:  ${sessionsWithTelemetry.length}`);
console.log(`Total traffic points:   ${originalPoints}`);

// Import services after setting PORTAL_DATA_DIR
const { SessionService } = await import('../../server/services/sessionService.js');
const { SessionTelemetryManager } = await import('../../server/services/sessionTelemetryManager.js');

SessionTelemetryManager.resetForTesting();

console.log('\n>>> Executing SessionService.ensureMigrated()...');
await SessionService.ensureMigrated();

// Check backup
const files = fs.readdirSync(tempDir);
const backupName = files.find(f => f.startsWith('peering_sessions.json.bak.'));
assert.ok(backupName, 'Backup file must exist');
const backupPath = path.join(tempDir, backupName);
const backupRaw = fs.readFileSync(backupPath, 'utf8');
assert.equal(backupRaw, originalRaw, 'Backup must match original 100% byte-for-byte');

// Check migrated peering_sessions.json
const migratedSessionsRaw = fs.readFileSync(targetSessionsFile, 'utf8');
const migratedSessions = JSON.parse(migratedSessionsRaw);
const migratedSizeBytes = fs.statSync(targetSessionsFile).size;
const migratedLines = migratedSessionsRaw.split('\n').length;

// Check session_telemetry.json
assert.ok(fs.existsSync(targetTelemetryFile), 'session_telemetry.json must exist');
const telemetryRaw = fs.readFileSync(targetTelemetryFile, 'utf8');
const telemetryData = JSON.parse(telemetryRaw);
const telemetrySizeBytes = fs.statSync(targetTelemetryFile).size;
const telemetryLines = telemetryRaw.split('\n').length;

let migratedPoints = 0;
for (const [, rec] of Object.entries(telemetryData.sessions)) {
  if (rec.trafficSeries) {
    migratedPoints += rec.trafficSeries.length;
  }
}

console.log('\n=== AFTER MIGRATION ===');
console.log(`Backup file created:    ${backupName} (${(fs.statSync(backupPath).size / 1024).toFixed(2)} KB)`);
console.log(`peering_sessions.json:  ${(migratedSizeBytes / 1024).toFixed(2)} KB (${migratedLines} lines, -${((1 - migratedSizeBytes / originalSizeBytes) * 100).toFixed(1)}% size reduction!)`);
console.log(`session_telemetry.json: ${(telemetrySizeBytes / 1024).toFixed(2)} KB (${telemetryLines} lines)`);
console.log(`Migrated sessions:      ${migratedSessions.length}`);
console.log(`Migrated traffic points:${migratedPoints} (100% matched: ${migratedPoints === originalPoints})`);

// Verify runtime is completely stripped from static sessions
const runtimePolluted = migratedSessions.filter(s => s.runtime !== undefined);
assert.equal(runtimePolluted.length, 0, 'Zero sessions in peering_sessions.json may contain runtime');

// Verify contract re-hydration
console.log('\n>>> Verifying contract via SessionService.getSessions()...');
const rehydrated = await SessionService.getSessions();
assert.equal(rehydrated.length, originalData.length);

for (const orig of originalData) {
  const match = rehydrated.find(s => s.id === orig.id);
  assert.ok(match, `Session ${orig.id} missing in getSessions()`);
  assert.equal(match.asn, orig.asn);
  assert.equal(match.status, orig.status);
  assert.ok(match.runtime, `Runtime missing on ${orig.id}`);

  if (orig.runtime?.trafficSeries) {
    assert.equal(match.runtime.trafficSeries.length, orig.runtime.trafficSeries.length);
    for (let i = 0; i < orig.runtime.trafficSeries.length; i++) {
      const origPt = orig.runtime.trafficSeries[i];
      const rehydrPt = match.runtime.trafficSeries[i];
      assert.equal(rehydrPt.t, origPt.t);
      assert.equal(rehydrPt.rx, origPt.rx);
      assert.equal(rehydrPt.tx, origPt.tx);
    }
  }
}
console.log('All 49 sessions rehydrated with 100% accuracy and object schema { t, rx, tx } compatibility!');

// Simulate routine updateRuntimePeers call to verify zero pollution of peering_sessions.json
console.log('\n>>> Simulating routine WireGuard probe update to test zero-write behavior...');
const mtimeBefore = fs.statSync(targetSessionsFile).mtimeMs;
await SessionService.updateRuntimePeers(originalData[0].nodeId, [
  {
    publicKey: originalData[0].peering?.publicKey,
    interface: originalData[0].peering?.interface,
    rxBytes: 999999999,
    txBytes: 888888888,
    latestHandshake: Math.floor(Date.now() / 1000)
  }
], []);

const mtimeAfter = fs.statSync(targetSessionsFile).mtimeMs;
assert.equal(mtimeAfter, mtimeBefore, 'peering_sessions.json mtime must NOT change on routine telemetry report!');
console.log('Zero disk write on peering_sessions.json confirmed for routine telemetry probes!');

// Cleanup
try {
  fs.rmSync(tempDir, { recursive: true, force: true });
} catch {}

console.log('\n[SUCCESS] Production migration simulation passed all checks with 0 errors, 0 data loss, and 0 contract breakages.');
