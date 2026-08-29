import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { SessionService } from '../../server/services/sessionService.js';
import { DATA_DIR } from '../../server/config.js';

describe('SessionService Unit Tests', () => {
  const sessionsFile = path.join(DATA_DIR, 'peering_sessions.json');
  const ledgerFile = path.join(DATA_DIR, 'port_ledger.json');
  let originalSessions = null;
  let originalLedger = null;

  beforeEach(() => {
    if (fs.existsSync(sessionsFile)) originalSessions = fs.readFileSync(sessionsFile, 'utf8');
    if (fs.existsSync(ledgerFile)) originalLedger = fs.readFileSync(ledgerFile, 'utf8');
    fs.writeFileSync(sessionsFile, JSON.stringify([]), 'utf8');
    fs.writeFileSync(ledgerFile, JSON.stringify({}), 'utf8');
  });

  afterEach(() => {
    if (originalSessions !== null) fs.writeFileSync(sessionsFile, originalSessions, 'utf8');
    else if (fs.existsSync(sessionsFile)) fs.unlinkSync(sessionsFile);

    if (originalLedger !== null) fs.writeFileSync(ledgerFile, originalLedger, 'utf8');
    else if (fs.existsSync(ledgerFile)) fs.unlinkSync(ledgerFile);
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
      asn: 4141410001,
      nodeId: 'JP-TYO-1',
      publicKey: 'K8xN64x7tN/4H1XqJd+7qf3K9z1V8uT5R7o+P2w8x1E=',
      linkLocal: 'fe80::4141:1',
      listenPort: 'auto'
    });

    const sessionId = submitRes.data.sessionId;
    const delRes = await SessionService.deleteSession(sessionId, 4141410001, false);
    assert.equal(delRes.success, true);

    const list = await SessionService.getSessions();
    assert.equal(list.length, 0);
  });
});
