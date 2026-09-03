import { test, describe, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dn42-test-r18-'));
process.env.PORTAL_DATA_DIR = testDataDir;

import { SessionService } from '../../server/services/sessionService.js';
import { ConfigEngine } from '../../server/services/configEngine.js';
import { getActiveConfig } from '../../server/storage/configLoader.js';

describe('Round 18 Fixes & Enhancements Unit Tests', () => {
  const sessionsFile = path.join(testDataDir, 'peering_sessions.json');
  const ledgerFile = path.join(testDataDir, 'port_ledger.json');
  const config = getActiveConfig();
  const node1 = config.nodes[0];
  const node2 = config.nodes[1] || { id: 'US-LA1' };

  after(() => {
    try {
      fs.rmSync(testDataDir, { recursive: true, force: true });
    } catch {}
  });

  beforeEach(() => {
    fs.writeFileSync(sessionsFile, '[]', 'utf8');
    fs.writeFileSync(ledgerFile, '{}', 'utf8');
  });

  test('P1: auto ListenPort calculates 23143 from AkiLab ASN and shifts on same-pubkey collision', async () => {
    const keyA = 'yA+N64x7tN/4H1XqJd+7qf3K9z1V8uT5R7o+P2w8x1E=';
    const keyB = 'bB+N64x7tN/4H1XqJd+7qf3K9z1V8uT5R7o+P2w8x1E=';

    // 1. Session 1 with Key A on Node 1 -> should get base 23143
    const res1 = await SessionService.submitPeering({
      asn: 4242423143,
      nodeId: node1.id,
      publicKey: keyA,
      linkLocal: 'fe80::3143',
      endpoint: 'client.dn42',
      listenPort: 'auto',
      clientPort: 'auto',
      mtu: 1420
    });

    assert.equal(res1.success, true);
    assert.equal(res1.data.clientPort, 23143);
    assert.equal(res1.data.isClientPortShifted, false);
    assert.equal(res1.data.session.assigned.clientPort, 23143);
    assert.ok(res1.data.clientWireguard.includes('ListenPort = 23143'));
    assert.ok(!res1.data.clientWireguard.includes('<YOUR_LISTEN_PORT>'));

    // 2. Session 2 with SAME Key A on Node 2 -> should shift to 33143
    const res2 = await SessionService.submitPeering({
      asn: 4242423143,
      nodeId: node2.id,
      publicKey: keyA,
      linkLocal: 'fe80::3143',
      endpoint: 'client.dn42',
      listenPort: 'auto',
      clientPort: 'auto',
      mtu: 1420
    });

    assert.equal(res2.success, true);
    assert.equal(res2.data.clientPort, 33143, 'Same pubkey on second node must shift clientPort +10000');
    assert.equal(res2.data.isClientPortShifted, true);
    assert.equal(res2.data.expectedClientPort, 23143);
    assert.ok(res2.data.clientConflictMessage.includes('23143 was in use on this key'));
    assert.ok(res2.data.clientWireguard.includes('ListenPort = 33143'));

    // 3. Session 3 with DIFFERENT Key B on Node 1 (another user or device) -> should NOT shift, gets 23143
    const res3 = await SessionService.submitPeering({
      asn: 4242429999,
      nodeId: node1.id,
      publicKey: keyB,
      linkLocal: 'fe80::9999',
      endpoint: 'other.dn42',
      listenPort: 'auto',
      clientPort: 'auto',
      mtu: 1420
    });

    assert.equal(res3.success, true);
    assert.equal(res3.data.clientPort, 23143, 'Different pubkey must get base 23143 without shifting');
    assert.equal(res3.data.isClientPortShifted, false);
  });

  test('P2: Re-submitting on the same node updates existing session without duplicate collision', async () => {
    const key = 'yA+N64x7tN/4H1XqJd+7qf3K9z1V8uT5R7o+P2w8x1E=';

    const sub1 = await SessionService.submitPeering({
      asn: 4242423143,
      nodeId: node1.id,
      publicKey: key,
      linkLocal: 'fe80::3143',
      endpoint: 'old.dn42',
      listenPort: 'auto',
      clientPort: 'auto',
      mtu: 1420
    });

    const sessionId = sub1.data.sessionId;

    // Re-submit with updated endpoint
    const sub2 = await SessionService.submitPeering({
      asn: 4242423143,
      nodeId: node1.id,
      publicKey: key,
      linkLocal: 'fe80::3143',
      endpoint: 'new.dn42',
      listenPort: 'auto',
      clientPort: 'auto',
      mtu: 1420
    });

    assert.equal(sub2.data.sessionId, sessionId, 'Must keep same sessionId on update');
    assert.equal(sub2.data.session.peering.endpoint, 'new.dn42');
    // Updating own session should NOT conflict with self:
    assert.equal(sub2.data.clientPort, 23143, 'Updating same session should not conflict with own previous port');
  });

  test('P4: serverWireguardSnippet is persisted in session.assigned and formatted with clientPort', async () => {
    const res = await SessionService.submitPeering({
      asn: 4242423143,
      nodeId: node1.id,
      publicKey: 'yA+N64x7tN/4H1XqJd+7qf3K9z1V8uT5R7o+P2w8x1E=',
      linkLocal: 'fe80::3143',
      endpoint: 'servertest.dn42',
      listenPort: 'auto',
      clientPort: 'auto',
      mtu: 1420
    });

    const snippet = res.data.session.assigned.serverWireguardSnippet;
    assert.ok(snippet, 'serverWireguardSnippet must be persisted in assigned');
    assert.ok(snippet.includes('[Peer]'));
    assert.ok(snippet.includes('PublicKey = yA+N64x7tN/4H1XqJd+7qf3K9z1V8uT5R7o+P2w8x1E='));
    assert.ok(snippet.includes('Endpoint = servertest.dn42:23143'));
    assert.ok(snippet.includes('AllowedIPs ='));
  });

  test('P3: cli-src/bin/nodes uses dynamic width format in data rows', () => {
    const script = fs.readFileSync('cli/cli-src/bin/nodes', 'utf8');
    assert.ok(!script.includes('%-24s %-28s'), 'cli/cli-src/bin/nodes must not contain hardcoded %-24s %-28s');
    assert.ok(script.includes('%-*s %-*s'), 'cli/cli-src/bin/nodes must use dynamic format %-*s %-*s');
  });
});
