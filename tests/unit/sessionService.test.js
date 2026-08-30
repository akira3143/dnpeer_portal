import { test, describe, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dn42-test-sessions-'));
process.env.PORTAL_DATA_DIR = testDataDir;

import { SessionService } from '../../server/services/sessionService.js';

describe('SessionService Unit Tests', () => {
  const sessionsFile = path.join(testDataDir, 'peering_sessions.json');
  const ledgerFile = path.join(testDataDir, 'port_ledger.json');

  after(() => {
    try {
      fs.rmSync(testDataDir, { recursive: true, force: true });
    } catch {}
  });

  beforeEach(() => {
    fs.writeFileSync(sessionsFile, JSON.stringify([]), 'utf8');
    fs.writeFileSync(ledgerFile, JSON.stringify({}), 'utf8');
  });

  afterEach(() => {
    fs.writeFileSync(sessionsFile, JSON.stringify([]), 'utf8');
    fs.writeFileSync(ledgerFile, JSON.stringify({}), 'utf8');
  });

  test('submits valid peering and returns configs and acknowledgement', async () => {
    const res = await SessionService.submitPeering({
      asn: 4242423143,
      nodeId: 'JP-TYO-1',
      publicKey: 'yA+N64x7tN/4H1XqJd+7qf3K9z1V8uT5R7o+P2w8x1E=',
      linkLocal: 'fe80::4242:3143',
      ipv4: '172.20.150.100',
      ipv6Ula: 'fd00:4242:3143::1',
      listenPort: 'auto',
      mtu: 1420
    });

    assert.equal(res.success, true);
    assert.equal(res.data.port, 23143);
    assert.equal(res.data.isShifted, false);
    assert.ok(res.data.sessionId);
    assert.ok(res.data.acknowledgement.includes("We'll establish the peer with you within 24 hours!"));

    const list = await SessionService.getSessions();
    assert.equal(list.length, 1);
    assert.equal(list[0].id, res.data.sessionId);
  });

  test('deletes session and frees port in ledger', async () => {
    const submitRes = await SessionService.submitPeering({
      asn: 4242420002,
      nodeId: 'JP-TYO-1',
      publicKey: 'K8xN64x7tN/4H1XqJd+7qf3K9z1V8uT5R7o+P2w8x1E=',
      linkLocal: 'fe80::2',
      listenPort: 'auto'
    });

    const sessionId = submitRes.data.sessionId;
    const delRes = await SessionService.deleteSession(sessionId, 4242420002, false);
    assert.equal(delRes.success, true);

    const list = await SessionService.getSessions();
    assert.equal(list.length, 0);
  });
});
