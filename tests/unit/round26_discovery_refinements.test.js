import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';

const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dn42-test-round26-'));
process.env.PORTAL_DATA_DIR = testDataDir;

import { parseBgpProtocols, queryLocalLgProxy } from '../../scripts/probe-agent.js';
import { SessionService, parseAllowedIps } from '../../server/services/sessionService.js';
import { getActiveConfig } from '../../server/storage/configLoader.js';

test('Round 26: Discovery Refinements, BGP Bridge & LGProxy Integration Tests', async (t) => {
  const sessionsFile = path.join(testDataDir, 'peering_sessions.json');
  const ignoredFile = path.join(testDataDir, 'ignored_peers.json');
  const ledgerFile = path.join(testDataDir, 'port_ledger.json');
  const testNodeId = getActiveConfig().nodes[0].id;

  fs.writeFileSync(sessionsFile, JSON.stringify([]), 'utf8');
  fs.writeFileSync(ignoredFile, JSON.stringify([]), 'utf8');
  fs.writeFileSync(ledgerFile, JSON.stringify({}), 'utf8');

  t.after(() => {
    try {
      fs.rmSync(testDataDir, { recursive: true, force: true });
    } catch {}
  });

  await t.test('1. parseBgpProtocols parses BIRD "show protocols all" with Neighbor address and ASN', () => {
    const birdOutput = `
BIRD 2.0.12 ready.
dn42_as4242423143 BGP      ---        up     10:14:00.123  Established
  Description:    DN42 peer AS4242423143
  BGP state:          Established
    Neighbor address: fe80::3143:1%dn42_as4242423143
    Neighbor AS:      4242423143
    Local AS:         4242423999
    Neighbor ID:      172.20.150.1
    Source address:   fe80::3999:1

dn42_as4242421234 BGP      ---        start  09:00:00.000  Connect       Socket: Connection refused
  Description:    DN42 peer AS4242421234
  BGP state:          Connect
    Neighbor address: 172.20.150.2
    Neighbor AS:      4242421234
    Local AS:         4242423999
    Source address:   172.20.150.1

static4    Static   ---        up     08:00:00.000
    `;

    const parsed = parseBgpProtocols(birdOutput);
    assert.equal(parsed.length, 2, 'Should only include BGP protocols');

    const p1 = parsed.find(p => p.name === 'dn42_as4242423143');
    assert.ok(p1);
    assert.equal(p1.asn, 4242423143);
    assert.equal(p1.cleanAsn, 4242423143);
    assert.equal(p1.bgpState, 'Established');
    assert.equal(p1.neighborAddress, 'fe80::3143:1', 'Neighbor address should strip interface suffix');

    const p2 = parsed.find(p => p.name === 'dn42_as4242421234');
    assert.ok(p2);
    assert.equal(p2.asn, 4242421234);
    assert.equal(p2.cleanAsn, 4242421234);
    assert.equal(p2.bgpState, 'Connect');
    assert.equal(p2.neighborAddress, '172.20.150.2');
  });

  await t.test('2. queryLocalLgProxy communicates with lgproxy and handles failure gracefully', async () => {
    // Start temporary mock lgproxy server
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (url.pathname === '/bird' && url.searchParams.get('q') === 'show protocols all') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end(`
test_peer  BGP      ---        up     12:00:00  Established
  BGP state:          Established
    Neighbor address: 172.20.150.99
    Neighbor AS:      4242423143
        `);
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;

    try {
      // Successful query
      const rawOutput = await queryLocalLgProxy(`http://127.0.0.1:${port}`);
      assert.ok(rawOutput.includes('test_peer'));
      const results = parseBgpProtocols(rawOutput);
      assert.equal(results.length, 1);
      assert.equal(results[0].name, 'test_peer');
      assert.equal(results[0].neighborAddress, '172.20.150.99');
      assert.equal(results[0].asn, 4242423143);

      // Unreachable port returns empty string without throwing
      const unreachableResults = await queryLocalLgProxy('http://127.0.0.1:1');
      assert.equal(unreachableResults, '');
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  await t.test('3. BGP Neighbor IP <-> WG AllowedIPs Bridge associates multi-peer accurately', async () => {
    fs.writeFileSync(sessionsFile, JSON.stringify([]), 'utf8');

    // Scenario: Two peers on the same node with non-matching interface names (e.g. wg_peer_a, wg_peer_b)
    const report = {
      peers: [
        {
          interface: 'wg_peer_a',
          publicKey: 'PeerAKeyAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
          endpoint: '198.51.100.10:20001',
          allowedIps: '172.20.10.1/32, fe80::10:1/64',
          latestHandshake: 1725501000
        },
        {
          interface: 'wg_peer_b',
          publicKey: 'PeerBKeyBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=',
          endpoint: '198.51.100.20:20002',
          allowedIps: '172.20.20.1/32, fe80::20:1/64',
          latestHandshake: 1725502000
        }
      ],
      bgpSessions: [
        {
          name: 'bgp_session_b',
          neighborAddress: '172.20.20.1',
          asn: 4242422222,
          cleanAsn: 4242422222,
          bgpState: 'Established'
        },
        {
          name: 'bgp_session_a',
          neighborAddress: 'fe80::10:1',
          asn: 4242421111,
          cleanAsn: 4242421111,
          bgpState: 'Established'
        }
      ]
    };

    await SessionService.updateRuntimePeers(testNodeId, report);

    const sessions = await SessionService.getSessions();
    const sessionA = sessions.find(s => s.peering?.publicKey.startsWith('PeerAKey'));
    const sessionB = sessions.find(s => s.peering?.publicKey.startsWith('PeerBKey'));

    assert.ok(sessionA, 'Session A must be discovered');
    assert.ok(sessionB, 'Session B must be discovered');

    // Associated accurately via IP bridge, NOT confused
    const nodeTag = testNodeId.toLowerCase().replace(/[^a-z0-9]/g, '_');
    assert.equal(sessionA.asn, 4242421111, 'Peer A matched fe80::10:1 -> AS4242421111');
    assert.equal(sessionA.id, `peer_peer_a_${nodeTag}`, 'Session ID uses canonical peer_<name>_<node>');
    assert.equal(sessionA.peering.interface, 'wg_peer_a', 'WireGuard interface name preserved');
    assert.equal(sessionA.status, 'active', 'BGP Established sets status to active');

    assert.equal(sessionB.asn, 4242422222, 'Peer B matched 172.20.20.1 -> AS4242422222');
    assert.equal(sessionB.id, `peer_peer_b_${nodeTag}`, 'Session ID uses canonical peer_<name>_<node>');
    assert.equal(sessionB.peering.interface, 'wg_peer_b', 'WireGuard interface name preserved');
    assert.equal(sessionB.status, 'active');
  });

  await t.test('4. Priority 3 removal: No greedy match on multi-peer node when IP and name do not match', async () => {
    fs.writeFileSync(sessionsFile, JSON.stringify([]), 'utf8');

    // Scenario: Node has 1 BGP session, but 2 WG peers neither of whose IP matches
    const report = {
      peers: [
        {
          interface: 'wg_mystery_1',
          publicKey: 'MysteryKey111111111111111111111111111111111=',
          endpoint: '198.51.100.30:23143',
          allowedIps: '172.20.99.1/32',
          latestHandshake: 1725503000
        },
        {
          interface: 'wg_mystery_2',
          publicKey: 'MysteryKey222222222222222222222222222222222=',
          endpoint: '(none)',
          allowedIps: '172.20.99.2/32',
          latestHandshake: 0
        }
      ],
      bgpSessions: [
        {
          name: 'bgp_other',
          neighborAddress: '172.20.88.88', // does NOT match mystery 1 or 2
          asn: 4242428888,
          cleanAsn: 4242428888,
          bgpState: 'Established'
        }
      ]
    };

    await SessionService.updateRuntimePeers(testNodeId, report);

    const sessions = await SessionService.getSessions();
    const m1 = sessions.find(s => s.peering?.publicKey.startsWith('MysteryKey1'));
    const m2 = sessions.find(s => s.peering?.publicKey.startsWith('MysteryKey2'));

    assert.ok(m1);
    assert.ok(m2);

    const nodeTag = testNodeId.toLowerCase().replace(/[^a-z0-9]/g, '_');

    // With Priority 3 deleted, neither peer should falsely take AS4242428888!
    assert.equal(m1.asn, null, 'Must NOT greedily match unmatched BGP session');
    assert.equal(m1.status, 'pending', 'Must remain pending');
    assert.equal(m1.runtime.stageText, 'pending', 'StageText must be pending');
    assert.equal(m1.id, `peer_mystery_1_${nodeTag}`, 'ID must be canonical peer_<name>_<node>');
    assert.equal(m1.peering.interface, 'wg_mystery_1');

    assert.equal(m2.asn, null, 'Must NOT greedily match unmatched BGP session');
    assert.equal(m2.status, 'pending');
    assert.equal(m2.runtime.stageText, 'pending');
    assert.equal(m2.id, `peer_mystery_2_${nodeTag}`);
    assert.equal(m2.peering.interface, 'wg_mystery_2');
  });

  await t.test('5. Non-WG peer uses readable BGP protocol name fallback without pubkey hash', async () => {
    fs.writeFileSync(sessionsFile, JSON.stringify([]), 'utf8');

    // Simulate non-WG peer reported without interface
    const report = {
      peers: [
        {
          interface: '',
          publicKey: 'NonWgKey99999999999999999999999999999999999=',
          endpoint: '(none)',
          allowedIps: '172.20.77.1/32'
        }
      ],
      bgpSessions: [
        {
          name: 'dn42_as4242427777',
          neighborAddress: '172.20.77.1',
          asn: 4242427777,
          cleanAsn: 4242427777,
          bgpState: 'Established'
        }
      ]
    };

    await SessionService.updateRuntimePeers(testNodeId, report);

    const sessions = await SessionService.getSessions();
    const nonWg = sessions.find(s => s.peering?.publicKey.startsWith('NonWgKey9'));
    assert.ok(nonWg);
    const nodeTag = testNodeId.toLowerCase().replace(/[^a-z0-9]/g, '_');
    assert.equal(nonWg.id, `peer_as4242427777_${nodeTag}`, 'Should use canonical ID peer_<name>_<nodeTag>');
    assert.equal(nonWg.peering.interface, 'dn42_as4242427777');
    assert.equal(nonWg.asn, 4242427777);
  });

  await t.test('6. CLI peer ls displays dual ports (PEERPORT and LISTENPORT), INTERFACE column, port 0 fallback, and no [auto] prefix', () => {
    const peerScript = fs.readFileSync(path.resolve('cli/cli-src/bin/peer'), 'utf8');

    // 1. Header has INTERFACE and dual ports (user perspective: PEERPORT then LISTENPORT)
    assert.ok(
      peerScript.includes('"NODE" "SESSION ID" "INTERFACE" "ASN" "PEERPORT" "LISTENPORT" "STATUS"'),
      'CLI must have dual ports: NODE, SESSION ID, INTERFACE, ASN, PEERPORT, LISTENPORT, STATUS'
    );

    // 2. Port fallback logic: if port missing, displays 0
    assert.ok(peerScript.includes('disp_lport="0"'), 'Unreadable listenport must fallback to 0');
    assert.ok(peerScript.includes('disp_pport="0"'), 'Unreadable peerport must fallback to 0');

    // 3. No [auto] prefix in session ID
    assert.ok(!peerScript.includes('disp_id="[auto]'), 'Session ID must not have [auto] prefix');
  });

  await t.test('7. Submitting/editing discovered session upgrades source to portal in-place without duplicates', async () => {
    fs.writeFileSync(sessionsFile, JSON.stringify([]), 'utf8');

    const pubKey = 'UpgradeKeyAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
    // 1. Peer discovered via probe
    await SessionService.updateRuntimePeers(testNodeId, {
      peers: [{
        interface: 'dn42_upgrade',
        publicKey: pubKey,
        endpoint: '198.51.100.50:23143',
        allowedIps: '172.20.150.80/32, fe80::80/64',
        latestHandshake: 1725505000
      }],
      bgpSessions: [{
        name: 'dn42_upgrade',
        neighborAddress: 'fe80::80',
        asn: 4242429999,
        cleanAsn: 4242429999,
        bgpState: 'Established'
      }]
    });

    const nodeTag = testNodeId.toLowerCase().replace(/[^a-z0-9]/g, '_');
    let sessions = await SessionService.getSessions();
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].source, 'discovered');
    assert.equal(sessions[0].id, `peer_upgrade_${nodeTag}`);
    assert.equal(sessions[0].peering.interface, 'dn42_upgrade');

    // 2. User submits/edits this session through portal / CLI
    const submitResult = await SessionService.submitPeering({
      asn: 4242429999,
      nodeId: testNodeId,
      publicKey: pubKey,
      ipv4: '172.20.150.80',
      linkLocal: 'fe80::80',
      listenPort: 'auto'
    });

    assert.equal(submitResult.success, true);

    // 3. Verify session was upgraded in-place (no duplicate sessions)
    sessions = await SessionService.getSessions();
    assert.equal(sessions.length, 1, 'Upgrading discovered session must not create duplicate');
    const upgraded = sessions[0];
    assert.equal(upgraded.source, 'portal', 'Source must be upgraded to portal');
    assert.equal(upgraded.peering.publicKey, pubKey);
    assert.equal(upgraded.peering.interface, 'dn42_upgrade');
    assert.ok(upgraded.assigned.hostPort >= 20000, 'Host port must be allocated by portal');
    assert.equal(upgraded.status, 'pending', 'Newly submitted portal session enters pending or active');
  });

  await t.test('8. Port ledger correctly records WireGuard listenport for both portal and discovered peers', async () => {
    fs.writeFileSync(sessionsFile, JSON.stringify([]), 'utf8');
    fs.writeFileSync(ledgerFile, JSON.stringify({}), 'utf8');

    const pubKey = 'LedgerKeyAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
    const discReport = {
      ports: [{ port: 23143, name: 'dn42_afn_hk', source: 'wg' }],
      peers: [{
        interface: 'dn42_afn_hk',
        publicKey: pubKey,
        endpoint: '', // roaming peer with 0 endpoint port
        allowedIps: '172.20.150.99/32, fe80::99/64',
        latestHandshake: 1725509999
      }],
      bgpSessions: [{
        name: 'dn42_afn_hk',
        neighborAddress: 'fe80::99',
        asn: 4242422213,
        cleanAsn: 4242422213,
        bgpState: 'Connect'
      }]
    };

    await SessionService.updateRuntimePeers(testNodeId, discReport);

    const nodeTag = testNodeId.toLowerCase().replace(/[^a-z0-9]/g, '_');
    // Verify session received hostPort and listenPort
    const sessions = await SessionService.getSessions();
    const afnSession = sessions.find(s => s.id === `peer_afn_hk_${nodeTag}`);
    assert.ok(afnSession);
    assert.equal(afnSession.peering.interface, 'dn42_afn_hk');
    assert.equal(afnSession.assigned.hostPort, 23143, 'Discovered session must receive listenport from wg ports');
    assert.equal(afnSession.peering.listenPort, 23143);

    // Verify port ledger recorded the listenport
    const { PortLedgerService } = await import('../../server/services/portLedgerService.js');
    const nodePorts = await PortLedgerService.getNodePorts(testNodeId);
    const ledgerEntry = nodePorts.find(p => p.port === 23143);
    assert.ok(ledgerEntry, 'Port ledger MUST record listenport 23143');
    assert.equal(ledgerEntry.interfaceName, 'dn42_afn_hk');
    assert.equal(ledgerEntry.sessionId, `peer_afn_hk_${nodeTag}`);
    assert.equal(ledgerEntry.asn, 4242422213);
  });

  await t.test('9. Portal session AllowedIPs and LinkLocal/IPv4 are included in Bridge A matching', async () => {
    fs.writeFileSync(sessionsFile, JSON.stringify([]), 'utf8');

    // Create a portal session without upfront allowedIps
    const portalPubkey = 'PortalSessionKeyAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
    const portalSession = {
      id: 'portal_test_session',
      nodeId: testNodeId,
      asn: 4242427777,
      source: 'portal',
      status: 'pending',
      peering: {
        publicKey: portalPubkey,
        linkLocal: 'fe80::7777',
        ipv4: '172.20.77.1',
        listenPort: 27777,
        peerPort: 27778
      }
    };
    fs.writeFileSync(sessionsFile, JSON.stringify([portalSession]), 'utf8');

    // Probe report has WG peer with allowedIps and BGP session with matching neighborAddress
    const report = {
      peers: [{
        interface: 'dn42_portal_test',
        publicKey: portalPubkey,
        allowedIps: '172.20.77.1/32, fe80::7777/64',
        latestHandshake: 1725509999,
        listenPort: 27777
      }],
      bgpSessions: [{
        name: 'bgp_portal_test',
        neighborAddress: 'fe80::7777%dn42_portal_test',
        asn: 4242427777,
        bgpState: 'Established'
      }]
    };

    await SessionService.updateRuntimePeers(testNodeId, report);

    const sessions = await SessionService.getSessions();
    const updated = sessions.find(s => s.id === 'portal_test_session');
    assert.ok(updated);
    // Verified: session.peering.allowedIps is backfilled from WireGuard peer
    assert.equal(updated.peering.allowedIps, '172.20.77.1/32, fe80::7777/64');
    // Verified: Bridge A successfully matched by linkLocal IP address
    assert.equal(updated.runtime.bgpState, 'Established');
    assert.equal(updated.status, 'active');
  });

  await t.test('10. Pure BGP (non-WireGuard, e.g. TYIX) session auto-discovery and tombstoning', async () => {
    fs.writeFileSync(sessionsFile, JSON.stringify([]), 'utf8');

    // Report with 0 WireGuard peers, but 2 pure BGP sessions (e.g. TYIX exchange peers)
    const pureBgpReport = {
      peers: [], // No WireGuard interfaces
      bgpSessions: [
        {
          name: 'ibgp_tyix_jp7',
          neighborAddress: '172.20.10.2',
          asn: 4242423143,
          cleanAsn: 4242423143,
          bgpState: 'Established'
        },
        {
          name: 'tyix_peer2289',
          neighborAddress: 'fe80::2289%tyix',
          asn: 4242422289,
          cleanAsn: 4242422289,
          bgpState: 'Established'
        }
      ]
    };

    await SessionService.updateRuntimePeers(testNodeId, pureBgpReport);

    const nodeTag = testNodeId.toLowerCase().replace(/[^a-z0-9]/g, '_');
    const sessions = await SessionService.getSessions();
    assert.equal(sessions.length, 2, 'Must discover 2 pure BGP sessions');

    const ibgp = sessions.find(s => s.peering?.interface === 'ibgp_tyix_jp7' || s.id === `peer_tyix_jp7_${nodeTag}`);
    assert.ok(ibgp, 'ibgp_tyix_jp7 must be discovered');
    assert.equal(ibgp.id, `peer_tyix_jp7_${nodeTag}`);
    assert.equal(ibgp.peering.interface, 'ibgp_tyix_jp7');
    assert.equal(ibgp.asn, 4242423143);
    assert.equal(ibgp.status, 'active');
    assert.equal(ibgp.runtime.bgpState, 'Established');
    assert.equal(ibgp.peering.listenPort, 0, 'Non-WG port must be 0');
    assert.equal(ibgp.assigned.hostPort, 0);

    const tyix2289 = sessions.find(s => s.peering?.interface === 'tyix_peer2289' || s.id === `peer_tyix_peer2289_${nodeTag}`);
    assert.ok(tyix2289, 'tyix_peer2289 must be discovered');
    assert.equal(tyix2289.asn, 4242422289);
    assert.equal(tyix2289.status, 'active');

    // Test deletion and tombstoning using interface name
    const delRes = await SessionService.deleteSession('ibgp_tyix_jp7', 4242423143, true);
    assert.equal(delRes.success, true, 'Deleting by interface name must succeed');

    // Re-running updateRuntimePeers must NOT resurrect the deleted session
    await SessionService.updateRuntimePeers(testNodeId, pureBgpReport);
    const afterSessions = await SessionService.getSessions();
    assert.equal(afterSessions.length, 1, 'Tombstoned pure BGP session must not be resurrected');
    assert.ok(!afterSessions.some(s => s.id === ibgp.id || s.peering?.interface === 'ibgp_tyix_jp7'));
  });

  await t.test('11. CLI peer ls includes node divider logic between different nodes', () => {
    const peerScript = fs.readFileSync(path.resolve('cli/cli-src/bin/peer'), 'utf8');
    assert.ok(
      peerScript.includes('if [ -n "$last_node" ] && [ "$node_name" != "$last_node" ]; then'),
      'peer ls must contain node boundary divider logic'
    );
  });
});



