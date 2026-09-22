import { test, describe, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dn42-test-r36-'));
process.env.PORTAL_DATA_DIR = testDataDir;

import { SessionService } from '../../server/services/sessionService.js';
import { getActiveConfig } from '../../server/storage/configLoader.js';

describe('Round 36: Multi-Peer on Same Node & Conflict Validation Tests', () => {
  const sessionsFile = path.join(testDataDir, 'session_master.json');
  const legacySessionsFile = path.join(testDataDir, 'peering_sessions.json');
  const ledgerFile = path.join(testDataDir, 'port_ledger.json');
  const config = getActiveConfig();
  const targetNode = config.nodes[0] || { id: 'JP-7' };

  after(() => {
    try {
      fs.rmSync(testDataDir, { recursive: true, force: true });
    } catch {}
  });

  beforeEach(() => {
    fs.writeFileSync(sessionsFile, '[]', 'utf8');
    fs.writeFileSync(legacySessionsFile, '[]', 'utf8');
    fs.writeFileSync(ledgerFile, '{}', 'utf8');
  });

  test('Support creating multiple peers for the same ASN on the same node with different public keys', async () => {
    const key1 = 'uA+N64x7tN/4H1XqJd+7qf3K9z1V8uT5R7o+P2w8x1E=';
    const key2 = 'vB+N64x7tN/4H1XqJd+7qf3K9z1V8uT5R7o+P2w8x1E=';
    const key3 = 'wC+N64x7tN/4H1XqJd+7qf3K9z1V8uT5R7o+P2w8x1E=';

    // 1. Submit first peer on targetNode
    const res1 = await SessionService.submitPeering({
      asn: 4242421234,
      nodeId: targetNode.id,
      publicKey: key1,
      linkLocal: 'fe80::1234',
      listenPort: 'auto',
      clientPort: 'auto',
      mtu: 1420
    });

    assert.equal(res1.success, true);
    assert.ok(res1.data.sessionId.startsWith('peer_'));
    const firstId = res1.data.sessionId;

    // 2. Submit second peer on SAME targetNode with DIFFERENT public key
    const res2 = await SessionService.submitPeering({
      asn: 4242421234,
      nodeId: targetNode.id,
      publicKey: key2,
      linkLocal: 'fe80::1234',
      listenPort: 'auto',
      clientPort: 'auto',
      mtu: 1420
    });

    assert.equal(res2.success, true);
    const secondId = res2.data.sessionId;
    assert.notEqual(firstId, secondId);
    assert.equal(secondId, `${firstId}_2`);

    // 3. Submit third peer on SAME targetNode with another DIFFERENT public key
    const res3 = await SessionService.submitPeering({
      asn: 4242421234,
      nodeId: targetNode.id,
      publicKey: key3,
      linkLocal: 'fe80::1234',
      listenPort: 'auto',
      clientPort: 'auto',
      mtu: 1420
    });

    assert.equal(res3.success, true);
    const thirdId = res3.data.sessionId;
    assert.equal(thirdId, `${firstId}_3`);

    // Verify all 3 sessions exist in session service
    const sessions = await SessionService.getSessionsByAsn(4242421234);
    assert.equal(sessions.length, 3);
    assert.deepEqual(sessions.map(s => s.id).sort(), [firstId, secondId, thirdId].sort());
  });

  test('Strictly reject new peer with duplicate public key on same node and write ZERO data', async () => {
    const key1 = 'uA+N64x7tN/4H1XqJd+7qf3K9z1V8uT5R7o+P2w8x1E=';

    // 1. Create first peer
    const res1 = await SessionService.submitPeering({
      asn: 4242421234,
      nodeId: targetNode.id,
      publicKey: key1,
      linkLocal: 'fe80::1234',
      listenPort: 'auto',
      clientPort: 'auto',
      mtu: 1420
    });
    assert.equal(res1.success, true);
    const firstId = res1.data.sessionId;

    // Snapshot state before collision attempt
    const sessionsBefore = fs.readFileSync(sessionsFile, 'utf8');
    const ledgerBefore = fs.readFileSync(ledgerFile, 'utf8');

    // 2. Attempt to create another peer on same node with DUPLICATE public key
    const resDup = await SessionService.submitPeering({
      asn: 4242421234,
      nodeId: targetNode.id,
      publicKey: key1, // duplicate key
      linkLocal: 'fe80::1234',
      listenPort: 'auto',
      clientPort: 'auto',
      mtu: 1420
    });

    assert.equal(resDup.success, false);
    assert.ok(resDup.message.includes('WireGuard public key conflicts'));
    assert.ok(resDup.message.includes(firstId));
    assert.ok(resDup.message.includes("use 'peer edit'"));
    assert.ok(resDup.fieldErrors?.publicKey);

    // Verify zero data written: snapshots must be identical
    const sessionsAfter = fs.readFileSync(sessionsFile, 'utf8');
    const ledgerAfter = fs.readFileSync(ledgerFile, 'utf8');
    assert.equal(sessionsAfter, sessionsBefore);
    assert.equal(ledgerAfter, ledgerBefore);

    // Verify session count is still 1
    const sessions = await SessionService.getSessionsByAsn(4242421234);
    assert.equal(sessions.length, 1);
  });

  test('Updating session with explicit ID succeeds and does not create duplicate entries', async () => {
    const key1 = 'uA+N64x7tN/4H1XqJd+7qf3K9z1V8uT5R7o+P2w8x1E=';
    const key2 = 'vB+N64x7tN/4H1XqJd+7qf3K9z1V8uT5R7o+P2w8x1E=';

    // 1. Create first session
    const res1 = await SessionService.submitPeering({
      asn: 4242421234,
      nodeId: targetNode.id,
      publicKey: key1,
      linkLocal: 'fe80::1234',
      listenPort: 'auto',
      clientPort: 'auto',
      mtu: 1420
    });
    assert.equal(res1.success, true);
    const sessionId = res1.data.sessionId;

    // 2. Update session with explicit ID and updated MTU + new key
    const resUpdate = await SessionService.submitPeering({
      id: sessionId,
      asn: 4242421234,
      nodeId: targetNode.id,
      publicKey: key2,
      linkLocal: 'fe80::1234',
      listenPort: res1.data.session.peering.listenPort,
      clientPort: 'auto',
      mtu: 1400
    });

    assert.equal(resUpdate.success, true);
    assert.equal(resUpdate.data.sessionId, sessionId);
    assert.equal(resUpdate.data.session.peering.mtu, 1400);
    assert.equal(resUpdate.data.session.peering.publicKey, key2);

    // Verify session list still contains exactly 1 session
    const sessions = await SessionService.getSessionsByAsn(4242421234);
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].id, sessionId);
  });

  test('CLI peer script contains multi-session listing, guidance tips, and confirmation prompt', () => {
    const cliPeerScript = fs.readFileSync(path.resolve('cli/cli-src/bin/peer'), 'utf8');

    // Must check for existing sessions and loop through all matches
    assert.ok(cliPeerScript.includes('/tmp/dn42_node_existing_sessions'));
    assert.ok(cliPeerScript.includes('existing peering session(s) on node'));
    assert.ok(cliPeerScript.includes("Tip: To modify an existing session, exit and run 'peer edit'."));
    assert.ok(cliPeerScript.includes('Create an additional new peer on node'));
    assert.ok(cliPeerScript.includes('DIFFERENT WireGuard public key'));

    // Must pass edit_session_id in do_edit
    assert.ok(cliPeerScript.includes('run_edit_flow "$sel_nid" "$sel_nname" "update" "$sel_id"'));

    // Must include id in payload when action_mode is update
    assert.ok(cliPeerScript.includes('\\"id\\":\\"$edit_session_id\\"'));
  });
});
