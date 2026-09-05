import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dn42-test-round25-'));
process.env.PORTAL_DATA_DIR = testDataDir;

import { parseWireguardConfigs, parseWgDump } from '../../scripts/probe-agent.js';
import { SessionService, parseAllowedIps } from '../../server/services/sessionService.js';
import { ScannerService } from '../../server/services/scannerService.js';
import { getActiveConfig } from '../../server/storage/configLoader.js';

test('Round 25: Stock Peer Auto-Discovery & Real-Time Refresh Tests', async (t) => {
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

  await t.test('1. parseAllowedIps extracts IPv4, IPv6 ULA, and Link-Local from AllowedIPs string', () => {
    const mixed = '172.20.150.99/32, fd00:4242:3143::99/128, fe80::3143:99/64';
    const parsed = parseAllowedIps(mixed);
    assert.equal(parsed.ipv4, '172.20.150.99');
    assert.equal(parsed.ipv6Ula, 'fd00:4242:3143::99');
    assert.equal(parsed.linkLocal, 'fe80::3143:99');

    const empty = parseAllowedIps('');
    assert.equal(empty.ipv4, '');
    assert.equal(empty.ipv6Ula, '');
    assert.equal(empty.linkLocal, '');

    const none = parseAllowedIps(null);
    assert.equal(none.ipv4, '');
  });

  await t.test('2. parseWireguardConfigs extracts peers and handles missing directory safely', () => {
    // Missing directory returns empty object without error
    const nonExistent = parseWireguardConfigs(path.join(testDataDir, 'does-not-exist'));
    assert.deepEqual(nonExistent, {});

    // Valid mock wireguard config directory
    const mockWgDir = path.join(testDataDir, 'mock_wireguard');
    fs.mkdirSync(mockWgDir, { recursive: true });
    fs.writeFileSync(path.join(mockWgDir, 'dn42_test.conf'), `
[Interface]
PrivateKey = aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
ListenPort = 23143

[Peer]
# Test pre-existing peer
PublicKey = DiscKey111111111111111111111111111111111111=
AllowedIPs = 172.20.150.50/32, fd00:4242:3143::50/128, fe80::50/64
Endpoint = 198.51.100.1:23143

[Peer]
PublicKey = DiscKey222222222222222222222222222222222222=
AllowedIPs = 10.0.0.2/32
`, 'utf8');

    const parsed = parseWireguardConfigs(mockWgDir);
    assert.ok(parsed['DiscKey111111111111111111111111111111111111=']);
    assert.equal(parsed['DiscKey111111111111111111111111111111111111='].endpoint, '198.51.100.1:23143');
    assert.ok(parsed['DiscKey111111111111111111111111111111111111='].allowedIps.includes('172.20.150.50'));
    assert.ok(parsed['DiscKey222222222222222222222222222222222222='].allowedIps.includes('10.0.0.2'));
  });

  await t.test('3. updateRuntimePeers auto-discovers peer with BGP ASN correlation', async () => {
    const pubKey = 'DiscKey333333333333333333333333333333333333=';
    const report = {
      peers: [{
        interface: 'dn42_4242423143',
        publicKey: pubKey,
        endpoint: '203.0.113.10:23143',
        allowedIps: '172.20.150.60/32, fd00:4242:3143::60/128, fe80::60/64',
        latestHandshake: 1725500000,
        rxBytes: 1024,
        txBytes: 2048
      }],
      bgpSessions: [{
        name: 'dn42_4242423143',
        asn: 4242423143,
        cleanAsn: 4242423143,
        proto: 'BGP',
        state: 'start',
        bgpState: 'Connect',
        info: 'Connect'
      }]
    };

    await SessionService.updateRuntimePeers(testNodeId, report);

    const sessions = await SessionService.getSessions();
    const discovered = sessions.find(s => s.peering?.publicKey === pubKey);

    assert.ok(discovered, 'Discovered session MUST be created');
    assert.equal(discovered.source, 'discovered');
    assert.equal(discovered.asn, 4242423143, 'ASN should be correlated from BGP');
    assert.equal(discovered.asName, 'AS4242423143');
    assert.equal(discovered.status, 'connect', 'Status follows BGP state');
    assert.equal(discovered.peering.ipv4, '172.20.150.60');
    assert.equal(discovered.peering.ipv6Ula, 'fd00:4242:3143::60');
    assert.equal(discovered.peering.linkLocal, 'fe80::60');
    assert.equal(discovered.assigned.hostPort, null, 'Discovered peer has no portal-allocated hostPort');
  });

  await t.test('4. BGP Established drives discovered session status to active', async () => {
    const pubKey = 'DiscKey333333333333333333333333333333333333=';
    const report = {
      peers: [{
        interface: 'dn42_4242423143',
        publicKey: pubKey,
        endpoint: '203.0.113.10:23143',
        latestHandshake: 1725500100
      }],
      bgpSessions: [{
        name: 'dn42_4242423143',
        asn: 4242423143,
        cleanAsn: 4242423143,
        proto: 'BGP',
        state: 'up',
        bgpState: 'Established',
        info: 'Established'
      }]
    };

    await SessionService.updateRuntimePeers(testNodeId, report);

    const sessions = await SessionService.getSessions();
    const discovered = sessions.find(s => s.peering?.publicKey === pubKey);
    assert.equal(discovered.status, 'active');
    assert.equal(discovered.runtime.bgpState, 'Established');
    assert.equal(discovered.runtime.stage, 3);
    assert.equal(discovered.runtime.stageText, 'BGP Established');
  });

  await t.test('5. updateRuntimePeers creates discovered session with unknown ASN when BGP is absent', async () => {
    const unknownPubKey = 'DiscKey444444444444444444444444444444444444=';
    const report = {
      peers: [{
        interface: 'wg_custom',
        publicKey: unknownPubKey,
        endpoint: '198.51.100.20:51820',
        allowedIps: '172.20.150.70/32',
        latestHandshake: 1725500200
      }],
      bgpSessions: [] // No BGP session available
    };

    await SessionService.updateRuntimePeers(testNodeId, report);

    const sessions = await SessionService.getSessions();
    const discovered = sessions.find(s => s.peering?.publicKey === unknownPubKey);

    assert.ok(discovered, 'Discovered session should be created even without BGP');
    assert.equal(discovered.source, 'discovered');
    assert.equal(discovered.asn, null, 'ASN must be null when uncorrelatable');
    assert.equal(discovered.asName, 'Unknown Peer');
    assert.equal(discovered.status, 'pending', 'Initial status is pending');
    assert.equal(discovered.runtime.stageText, 'pending', 'StageText must be pending when unassociated');
  });

  await t.test('6. Deleting discovered session creates tombstone and prevents resurrection', async () => {
    const pubKey = 'DiscKey333333333333333333333333333333333333=';
    const sessions = await SessionService.getSessions();
    const discovered = sessions.find(s => s.peering?.publicKey === pubKey);
    assert.ok(discovered);

    // Delete session
    const delRes = await SessionService.deleteSession(discovered.id, discovered.asn, true);
    assert.equal(delRes.success, true);

    // Verify removed from sessions
    const afterDeleteSessions = await SessionService.getSessions();
    assert.equal(afterDeleteSessions.some(s => s.id === discovered.id), false);

    // Verify recorded in ignored_peers.json tombstone
    const isIgnored = await SessionService.isPeerIgnored(testNodeId, pubKey);
    assert.equal(isIgnored, true, 'Deleted pubkey must be in tombstone');

    // Simulate subsequent probe report with the same peer
    await SessionService.updateRuntimePeers(testNodeId, {
      peers: [{
        interface: 'dn42_4242423143',
        publicKey: pubKey,
        endpoint: '203.0.113.10:23143',
        latestHandshake: 1725500900
      }],
      bgpSessions: [{
        name: 'dn42_4242423143',
        asn: 4242423143,
        cleanAsn: 4242423143,
        bgpState: 'Established'
      }]
    });

    // Verify session was NOT resurrected
    const reloadedSessions = await SessionService.getSessions();
    assert.equal(
      reloadedSessions.some(s => s.peering?.publicKey === pubKey),
      false,
      'Tombstone MUST prevent resurrected discovered peer'
    );
  });

  await t.test('7. Portal submission with tombstoned pubkey clears tombstone and upgrades to portal session', async () => {
    const pubKey = 'DiscKey333333333333333333333333333333333333=';
    assert.equal(await SessionService.isPeerIgnored(testNodeId, pubKey), true);

    const submitRes = await SessionService.submitPeering({
      asn: 4242423143,
      nodeId: testNodeId,
      publicKey: pubKey,
      linkLocal: 'fe80::4242:3143',
      listenPort: 'auto'
    });

    assert.equal(submitRes.success, true);
    assert.equal(await SessionService.isPeerIgnored(testNodeId, pubKey), false, 'Tombstone should be cleared on explicit portal submission');

    const sessions = await SessionService.getSessions();
    const portalSession = sessions.find(s => s.peering?.publicKey === pubKey);
    assert.ok(portalSession);
    assert.equal(portalSession.source, 'portal');
  });

  await t.test('8. Systemd timer interval is 1min and path unit watches both wireguard and bird', () => {
    const timerPath = path.resolve('deploy/dn42-probe.timer');
    const timerContent = fs.readFileSync(timerPath, 'utf8');
    assert.ok(timerContent.includes('OnUnitActiveSec=1min'), 'Timer must be set to 1min');

    const pathPath = path.resolve('deploy/dn42-probe.path');
    const pathContent = fs.readFileSync(pathPath, 'utf8');
    assert.ok(pathContent.includes('PathModified=/etc/wireguard'), 'Must watch /etc/wireguard');
    assert.ok(pathContent.includes('PathModified=/etc/bird'), 'Must watch /etc/bird');
  });
});
