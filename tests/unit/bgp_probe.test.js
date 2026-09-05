import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dn42-test-bgpprobe-'));
process.env.PORTAL_DATA_DIR = testDataDir;

import { parseBgpProtocols } from '../../scripts/probe-agent.js';
import { ScannerService } from '../../server/services/scannerService.js';
import { SessionService } from '../../server/services/sessionService.js';
import { getActiveConfig } from '../../server/storage/configLoader.js';

test('BGP Probe Collection and Session Connectivity Ground Truth Unit Tests (Round 21)', async (t) => {
  const sessionsFile = path.join(testDataDir, 'peering_sessions.json');
  const ledgerFile = path.join(testDataDir, 'port_ledger.json');
  const testNodeId = getActiveConfig().nodes[0].id;

  fs.writeFileSync(sessionsFile, JSON.stringify([]), 'utf8');
  fs.writeFileSync(ledgerFile, JSON.stringify({}), 'utf8');

  t.after(() => {
    try {
      fs.rmSync(testDataDir, { recursive: true, force: true });
    } catch {}
  });

  await t.test('parseBgpProtocols parses BIRD 2.x output with various states and extra info', () => {
    const mockBird2Output = [
      'BIRD 2.0.8 ready.',
      'Name       Proto      Table      State  Since         Info',
      'device1    Device     ---        up     2026-08-25    ',
      'direct1    Direct     ---        up     2026-08-25    ',
      'dn42_as4242423143 BGP        ---        up     2026-08-25    Established   ',
      'peer_as4242421234 BGP        ---        start  12:34:56      Connect       Socket: Connection refused',
      'p_4242429999 BGP        ---        start  2026-08-25    Active        Socket: Connection reset',
      'as4242420001 BGP        ---        down   2026-08-25    Idle          ',
      'dn42_3143  BGP        ---        up     2026-08-25    Established   '
    ].join('\n');

    const sessions = parseBgpProtocols(mockBird2Output);
    assert.equal(sessions.length, 5, 'Should parse only 5 BGP protocols, skipping Device and Direct');

    // 1. dn42_as4242423143: Established
    assert.equal(sessions[0].name, 'dn42_as4242423143');
    assert.equal(sessions[0].asn, 4242423143);
    assert.equal(sessions[0].cleanAsn, 4242423143);
    assert.equal(sessions[0].bgpState, 'Established');
    assert.equal(sessions[0].state, 'up');

    // 2. peer_as4242421234: Connect
    assert.equal(sessions[1].name, 'peer_as4242421234');
    assert.equal(sessions[1].asn, 4242421234);
    assert.equal(sessions[1].bgpState, 'Connect');
    assert.ok(sessions[1].info.includes('Connection refused'));

    // 3. p_4242429999: Active
    assert.equal(sessions[2].name, 'p_4242429999');
    assert.equal(sessions[2].asn, 4242429999);
    assert.equal(sessions[2].bgpState, 'Active');

    // 4. as4242420001: Idle
    assert.equal(sessions[3].name, 'as4242420001');
    assert.equal(sessions[3].asn, 4242420001);
    assert.equal(sessions[3].bgpState, 'Idle');

    // 5. dn42_3143: Tail 4-digit ASN normalization
    assert.equal(sessions[4].name, 'dn42_3143');
    assert.equal(sessions[4].asn, 3143);
    assert.equal(sessions[4].cleanAsn, 4242423143);
    assert.equal(sessions[4].bgpState, 'Established');
  });

  await t.test('parseBgpProtocols parses BIRD 1.6 restricted (-r) output with 4-digit code prefixes', () => {
    const mockBird1Output = [
      '0001 BIRD 1.6.8 ready.',
      '2002-name     proto    table    state  since       info',
      '1002-device1  Device   master   up     2026-08-25  ',
      '1002-dn42_as4242423143 BGP      master   up     2026-08-25  Established   ',
      '1002-peer_as4242421234 BGP      master   start  12:34:56    Connect       Socket: Connection refused',
      '1002-as4242420001 BGP      master   down   2026-08-25  Idle          ',
      '0000 '
    ].join('\n');

    const sessions = parseBgpProtocols(mockBird1Output);
    assert.equal(sessions.length, 3);
    assert.equal(sessions[0].name, 'dn42_as4242423143');
    assert.equal(sessions[0].bgpState, 'Established');
    assert.equal(sessions[1].name, 'peer_as4242421234');
    assert.equal(sessions[1].bgpState, 'Connect');
    assert.equal(sessions[2].name, 'as4242420001');
    assert.equal(sessions[2].bgpState, 'Idle');
  });

  await t.test('BGP Established drives session status to active', async () => {
    // 1. Submit session for AS4242423143
    const pubKey = 'yA+N64x7tN/4H1XqJd+7qf3K9z1V8uT5R7o+P2w8x1E=';
    const subRes = await SessionService.submitPeering({
      asn: 4242423143,
      nodeId: testNodeId,
      publicKey: pubKey,
      linkLocal: 'fe80::4242:3143',
      listenPort: 'auto'
    });
    assert.equal(subRes.success, true);
    const sid = subRes.data.sessionId;

    // Initially status is pending
    let sess = (await SessionService.getSessions()).find(s => s.id === sid);
    assert.equal(sess.status, 'pending');

    // 2. Report BGP Established
    await SessionService.updateRuntimePeers(testNodeId, {
      peers: [{ publicKey: pubKey, latestHandshake: 1724800000, rxBytes: 100, txBytes: 200 }],
      bgpSessions: [{
        name: 'dn42_as4242423143',
        asn: 4242423143,
        cleanAsn: 4242423143,
        proto: 'BGP',
        state: 'up',
        bgpState: 'Established',
        info: 'Established'
      }]
    });

    sess = (await SessionService.getSessions()).find(s => s.id === sid);
    assert.equal(sess.status, 'active', 'BGP Established MUST set status = active');
    assert.equal(sess.runtime.bgpState, 'Established');
    assert.equal(sess.runtime.stage, 3);
    assert.equal(sess.runtime.stageText, 'BGP Established');
    assert.equal(sess.runtime.latestHandshake, 1724800000);
  });

  await t.test('BGP Connect drives session status to connect', async () => {
    const pubKey = 'yA+N64x7tN/4H1XqJd+7qf3K9z1V8uT5R7o+P2w8x1E=';
    await SessionService.updateRuntimePeers(testNodeId, {
      peers: [{ publicKey: pubKey, latestHandshake: 0 }],
      bgpSessions: [{
        name: 'dn42_as4242423143',
        asn: 4242423143,
        cleanAsn: 4242423143,
        proto: 'BGP',
        state: 'start',
        bgpState: 'Connect',
        info: 'Connect Socket: Connection refused'
      }]
    });

    const sess = (await SessionService.getSessions()).find(s => s.asn === 4242423143);
    assert.equal(sess.status, 'connect');
    assert.equal(sess.runtime.bgpState, 'Connect');
    assert.equal(sess.runtime.stage, 2);
    assert.equal(sess.runtime.stageText, 'BGP Connect');
    assert.equal(sess.runtime.bgpInfo, 'Connect Socket: Connection refused');
  });

  await t.test('Core Regression Test: WireGuard handshake OK but BGP Idle MUST keep status = idle (NOT active)', async () => {
    // Crucial decision assertion: wg handshake alone does NOT set active
    const pubKey = 'yA+N64x7tN/4H1XqJd+7qf3K9z1V8uT5R7o+P2w8x1E=';
    const recentEpoch = Math.floor(Date.now() / 1000) - 30; // 30s ago

    await SessionService.updateRuntimePeers(testNodeId, {
      peers: [{
        publicKey: pubKey,
        endpoint: '1.2.3.4:23143',
        latestHandshake: recentEpoch,
        rxBytes: 5242880,
        txBytes: 10485760
      }],
      bgpSessions: [{
        name: 'dn42_as4242423143',
        asn: 4242423143,
        cleanAsn: 4242423143,
        proto: 'BGP',
        state: 'down',
        bgpState: 'Idle',
        info: 'Idle'
      }]
    });

    const sess = (await SessionService.getSessions()).find(s => s.asn === 4242423143);
    assert.notEqual(sess.status, 'active', 'WireGuard handshake MUST NOT determine active status when BGP is Idle');
    assert.equal(sess.status, 'idle');
    assert.equal(sess.runtime.bgpState, 'Idle');
    assert.equal(sess.runtime.latestHandshake, recentEpoch, 'WG handshake telemetry is preserved');
    assert.ok(sess.runtime.stageText.includes('BGP Idle'));
    assert.ok(sess.runtime.stageText.includes('WG Handshake OK'));
  });

  await t.test('BGP correlation works via tail 4-digit ASN naming convention', async () => {
    const pubKey = 'yA+N64x7tN/4H1XqJd+7qf3K9z1V8uT5R7o+P2w8x1E=';

    // Protocol named dn42_3143 (tail ASN = 3143) for session ASN 4242423143
    await SessionService.updateRuntimePeers(testNodeId, {
      peers: [{ publicKey: pubKey, latestHandshake: 1724900000 }],
      bgpSessions: [{
        name: 'dn42_3143',
        asn: 3143,
        cleanAsn: 4242423143,
        proto: 'BGP',
        state: 'up',
        bgpState: 'Established',
        info: 'Established'
      }]
    });

    const sess = (await SessionService.getSessions()).find(s => s.asn === 4242423143);
    assert.equal(sess.status, 'active');
    assert.equal(sess.runtime.bgpState, 'Established');
    assert.equal(sess.runtime.bgpProtocolName, 'dn42_3143');
  });

  await t.test('ScannerService.handleProbeReport processes bgpSessions and returns bgpUpdated count', async () => {
    const reportPayload = {
      nodeId: testNodeId,
      ports: [{ port: 23143, name: 'wg0' }],
      systemPorts: [],
      peers: [{
        publicKey: 'yA+N64x7tN/4H1XqJd+7qf3K9z1V8uT5R7o+P2w8x1E=',
        latestHandshake: 1725000000
      }],
      bgpSessions: [{
        name: 'dn42_as4242423143',
        asn: 4242423143,
        cleanAsn: 4242423143,
        proto: 'BGP',
        state: 'up',
        bgpState: 'Established',
        info: 'Established'
      }]
    };

    const res = await ScannerService.handleProbeReport(reportPayload);
    assert.equal(res.nodeId, testNodeId);
    assert.equal(res.peersUpdated, 1);
    assert.equal(res.bgpUpdated, 1);

    const sess = (await SessionService.getSessions()).find(s => s.asn === 4242423143);
    assert.equal(sess.status, 'active');
    assert.equal(sess.runtime.bgpState, 'Established');
  });
});