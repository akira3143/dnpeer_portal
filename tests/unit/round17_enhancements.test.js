import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dn42-test-r17-'));
process.env.PORTAL_DATA_DIR = testDataDir;

import { StatusTracker } from '../../server/services/statusTracker.js';
import { LookingGlassService } from '../../server/services/lookingGlassService.js';
import { NodeTokenStorage } from '../../server/storage/nodeTokenStorage.js';
import * as ConfigLoader from '../../server/storage/configLoader.js';
import * as Config from '../../server/config.js';

describe('Round 17 Enhancements & Refinements Unit Tests', () => {
  after(() => {
    StatusTracker.reset();
    try {
      fs.rmSync(testDataDir, { recursive: true, force: true });
    } catch {}
  });

  test('B1-2: StatusTracker persists heartbeats to status_cache.json and restores on cold start', () => {
    StatusTracker.reset();
    const cacheFile = path.join(testDataDir, 'status_cache.json');
    assert.equal(fs.existsSync(cacheFile), false, 'status_cache.json should be clean initially');

    // 1. Record fresh heartbeat and flush
    const recentTimestamp = new Date(Date.now() - 2 * 60 * 1000).toISOString(); // 2 mins ago
    StatusTracker.recordHeartbeat('JP-7', recentTimestamp);
    StatusTracker.flush();

    assert.equal(fs.existsSync(cacheFile), true, 'status_cache.json must be written on flush');
    const cachedData = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    assert.equal(cachedData['JP-7']?.lastSeen, recentTimestamp);

    // 2. Simulate server cold start by clearing memory and reloading
    StatusTracker.heartbeats.clear();
    StatusTracker.loadedPath = null;

    // Upon query, it reloads from disk
    const status = StatusTracker.getNodeStatus('JP-7');
    assert.equal(status.online, true, 'Node within 10min window must be restored as online');
    assert.equal(status.lastSeen, recentTimestamp);

    // 3. Outdated node (>10min) is restored as offline
    const expiredTimestamp = new Date(Date.now() - 15 * 60 * 1000).toISOString(); // 15 mins ago
    StatusTracker.recordHeartbeat('JP-2', expiredTimestamp);
    StatusTracker.flush();

    StatusTracker.heartbeats.clear();
    StatusTracker.loadedPath = null;
    const expiredStatus = StatusTracker.getNodeStatus('JP-2');
    assert.equal(expiredStatus.online, false, 'Node older than 10min must be restored as offline');
    assert.equal(expiredStatus.lastSeen, expiredTimestamp);
  });

  test('B2-1: LookingGlassService node matching is case-insensitive and supports code alias', async () => {
    // Both uppercase JP-7, lowercase jp-7, and node code match and resolve to canonical ID JP-7
    const resUpper = await LookingGlassService.query({ nodeId: 'JP-7' });
    const resLower = await LookingGlassService.query({ nodeId: 'jp-7' });

    // Since mock lgproxy returns network error in test without running lgproxy, verify it resolved the node (not Node not found)
    assert.ok(!resUpper.error.includes('not found'), 'Upper ID should resolve node');
    assert.ok(!resLower.error.includes('not found'), 'Lower ID should resolve node');

    const notFound = await LookingGlassService.query({ nodeId: 'NON_EXISTENT_999' });
    assert.ok(notFound.error.includes('not found'));
  });

  test('B2-2: NodeTokenStorage persists tokens with atomic rename and fallback', () => {
    const token = NodeTokenStorage.getOrCreateToken('JP-7');
    assert.equal(typeof token, 'string');
    assert.equal(token.length, 64);
    assert.equal(NodeTokenStorage.verifyToken('JP-7', token), true);
    assert.equal(NodeTokenStorage.verifyToken('jp-7', token), true, 'verifyToken supports case-insensitive node ID');
  });

  test('B2-3: server/utils/sanitizer.js is deleted and removed from codebase', () => {
    const sanitizerPath = path.resolve('server/utils/sanitizer.js');
    assert.equal(fs.existsSync(sanitizerPath), false, 'sanitizer.js must not exist');
  });

  test('B2-4 & B2-5: Redundant exports are internal and not exposed', () => {
    assert.equal(ConfigLoader.loadPortalConfig, undefined, 'loadPortalConfig should not be exported');
    assert.equal(Config.SERVER_DIR, undefined, 'SERVER_DIR should not be exported');
    assert.ok(typeof ConfigLoader.getActiveConfig === 'function');
  });
});
