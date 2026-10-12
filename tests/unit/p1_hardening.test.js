import { test, describe, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { FileStore, DataCorruptionError } from '../../server/storage/fileStore.js';
import { NodeTokenStorage } from '../../server/storage/nodeTokenStorage.js';
import { SessionService } from '../../server/services/sessionService.js';
import { NotificationService } from '../../server/services/notificationService.js';
import { getActiveConfig } from '../../server/storage/configLoader.js';

describe('Round 1 P1 Hardening: Data Integrity, Fail-Closed, Backups & Permissions', () => {
  let tmpDir;
  let oldPortalDataDir;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dn42-p1-test-'));
    oldPortalDataDir = process.env.PORTAL_DATA_DIR;
    process.env.PORTAL_DATA_DIR = tmpDir;
  });

  after(() => {
    process.env.PORTAL_DATA_DIR = oldPortalDataDir;
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  // ---------------------------------------------------------------------------
  // F-01: FileStore Fail-Closed on corrupted data & single-generation backup
  // ---------------------------------------------------------------------------
  test('1. F-01: readJson and readJsonSync return default when file does not exist', async () => {
    const nonExistent = path.join(tmpDir, 'does_not_exist.json');
    assert.deepEqual(FileStore.readJsonSync(nonExistent, []), []);
    assert.deepEqual(await FileStore.readJson(nonExistent, { foo: 'bar' }), { foo: 'bar' });
  });

  test('2. F-01: readJson and readJsonSync throw DataCorruptionError when file exists but contains invalid JSON', async () => {
    const corruptFile = path.join(tmpDir, 'corrupt.json');
    fs.writeFileSync(corruptFile, '{"incomplete": true, invalid syntax', 'utf8');

    // Sync read throws
    assert.throws(
      () => FileStore.readJsonSync(corruptFile, []),
      (err) => {
        assert.ok(err instanceof DataCorruptionError);
        assert.ok(err.message.includes('corrupt.json'));
        return true;
      }
    );

    // Async read throws
    await assert.rejects(
      async () => FileStore.readJson(corruptFile, []),
      (err) => {
        assert.ok(err instanceof DataCorruptionError);
        assert.ok(err.message.includes('corrupt.json'));
        return true;
      }
    );

    // Passing failClosed: false returns defaultValue without throwing
    assert.deepEqual(FileStore.readJsonSync(corruptFile, [1, 2, 3], { failClosed: false }), [1, 2, 3]);
    assert.deepEqual(await FileStore.readJson(corruptFile, { safe: true }, { failClosed: false }), { safe: true });
  });

  test('3. F-01: readJson throws DataCorruptionError when file exists but is 0 bytes', async () => {
    const emptyFile = path.join(tmpDir, 'empty.json');
    fs.writeFileSync(emptyFile, '', 'utf8');

    assert.throws(
      () => FileStore.readJsonSync(emptyFile, []),
      DataCorruptionError
    );

    await assert.rejects(
      async () => FileStore.readJson(emptyFile, []),
      DataCorruptionError
    );
  });

  test('4. F-01: writeJson and writeJsonSync create a single-generation .bak file on update', async () => {
    const target = path.join(tmpDir, 'authoritative_test.json');
    const bakFile = `${target}.bak`;

    // 1st write: creates target, no bak yet
    await FileStore.writeJson(target, { v: 1 });
    assert.deepEqual(await FileStore.readJson(target), { v: 1 });
    assert.equal(fs.existsSync(bakFile), false);

    // 2nd write: updates target, creates .bak with v: 1
    await FileStore.writeJson(target, { v: 2 });
    assert.deepEqual(await FileStore.readJson(target), { v: 2 });
    assert.equal(fs.existsSync(bakFile), true);
    assert.deepEqual(await FileStore.readJson(bakFile), { v: 1 });

    // Sync write update
    FileStore.writeJsonSync(target, { v: 3 });
    assert.deepEqual(FileStore.readJsonSync(target), { v: 3 });
    assert.deepEqual(FileStore.readJsonSync(bakFile), { v: 2 });
  });

  // ---------------------------------------------------------------------------
  // F-03: Local sensitive permissions & node tokens
  // ---------------------------------------------------------------------------
  test('5. F-03: NodeTokenStorage.saveTokens uses FileStore, writes safely and creates .bak', () => {
    const tokensFile = NodeTokenStorage.getFilePath();
    NodeTokenStorage.saveTokens({ 'JP-TYO-1': 'token_alpha_123' });

    assert.deepEqual(NodeTokenStorage.getAllTokens(), { 'JP-TYO-1': 'token_alpha_123' });

    // Update tokens: .bak must exist
    NodeTokenStorage.saveTokens({ 'JP-TYO-1': 'token_alpha_123', 'US-SJC-1': 'token_beta_456' });
    const bak = `${tokensFile}.bak`;
    assert.equal(fs.existsSync(bak), true);
    assert.deepEqual(FileStore.readJsonSync(bak), { 'JP-TYO-1': 'token_alpha_123' });
  });

  test('6. F-03: FileStore.secureSensitiveFiles checks directories and permissions', () => {
    // Should run gracefully without errors on all platforms
    FileStore.secureSensitiveFiles(tmpDir);
    assert.ok(true, 'secureSensitiveFiles completed successfully');
  });

  // ---------------------------------------------------------------------------
  // F-02: Telegram notification status tracking & retry mechanism
  // ---------------------------------------------------------------------------
  test('7. F-02: Peering submission initializes notification state and marks skipped when unconfigured', async () => {
    const testNodeId = getActiveConfig().nodes[0].id;
    const res = await SessionService.submitPeering({
      asn: 4242421111,
      nodeId: testNodeId,
      publicKey: '1111111111111111111111111111111111111111111=',
      linkLocal: 'fe80::4242:1111',
      listenPort: 'auto'
    });

    assert.equal(res.success, true);
    const session = res.data.session;
    assert.ok(session.notification, 'Session must include notification object');
    assert.equal(session.notification.status, 'skipped');
    assert.ok(session.notification.lastError.includes('not configured'));

    const updatedList = await SessionService.getSessions();
    const found = updatedList.find(s => s.id === session.id);
    assert.ok(found);
    assert.equal(found.notification.status, 'skipped');
    assert.ok(found.notification.lastError.includes('not configured'));
  });

  test('8. F-02: SessionService.retryPendingNotifications processes failed notifications', async () => {
    const testNodeId = getActiveConfig().nodes[0].id;
    const res = await SessionService.submitPeering({
      asn: 4242422222,
      nodeId: testNodeId,
      publicKey: '2222222222222222222222222222222222222222222=',
      linkLocal: 'fe80::4242:2222',
      listenPort: 'auto'
    });

    // Manually mark as failed to simulate network error
    await SessionService.updateNotificationStatus(res.data.sessionId, {
      status: 'failed',
      lastError: 'Mock connection reset'
    });

    const sessionsBefore = await SessionService.getSessions();
    const sessionFailed = sessionsBefore.find(s => s.id === res.data.sessionId);
    assert.equal(sessionFailed.notification.status, 'failed');

    // Run retry: without credentials it will resolve (attempts incremented)
    const count = await SessionService.retryPendingNotifications(3);
    assert.equal(count, 1, 'Should have processed 1 failed session');
  });
});
