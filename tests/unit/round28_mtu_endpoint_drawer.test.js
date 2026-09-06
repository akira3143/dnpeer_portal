import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseWireguardConfigs, parseWgDump } from '../../scripts/probe-agent.js';
import { SessionService } from '../../server/services/sessionService.js';
import { ScannerService } from '../../server/services/scannerService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const testDataDir = path.join(__dirname, '../../tests_data_round28');

test('Round 28: MTU Accuracy, Domain Endpoint & Drawer Telemetry Tests', async (t) => {
  // Clean test dir
  if (fs.existsSync(testDataDir)) {
    fs.rmSync(testDataDir, { recursive: true, force: true });
  }
  fs.mkdirSync(testDataDir, { recursive: true });

  t.after(() => {
    if (fs.existsSync(testDataDir)) {
      fs.rmSync(testDataDir, { recursive: true, force: true });
    }
  });

  await t.test('1. parseWireguardConfigs extracts custom MTU (< 1420) from [Interface] and attaches to peers', () => {
    const mockWgDir = path.join(testDataDir, 'wg_mtu_test');
    fs.mkdirSync(mockWgDir, { recursive: true });

    fs.writeFileSync(path.join(mockWgDir, 'dn42_custom_mtu.conf'), `
[Interface]
PrivateKey = aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
ListenPort = 23143
MTU = 1380

[Peer]
PublicKey = KeyMtuTest11111111111111111111111111111111=
Endpoint = peer.domain.com:23143
AllowedIPs = 172.20.100.1/32, fe80::100/64
`, 'utf8');

    const configs = parseWireguardConfigs(mockWgDir);
    const peer = configs['KeyMtuTest11111111111111111111111111111111='];
    assert.ok(peer, 'Peer should be extracted');
    assert.equal(peer.mtu, 1380, 'MTU should be parsed from [Interface] as 1380');
    assert.equal(peer.endpoint, 'peer.domain.com:23143', 'Endpoint domain should be preserved');
    assert.equal(peer.interface, 'dn42_custom_mtu', 'Interface name should match filename');
  });

  await t.test('2. ScannerService & Probe prefer config domain endpoint over kernel resolved IP', async () => {
    const mockWgDump = [
      'dn42_test\t(privkey)\tPubServerKeyAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=\t23143\toff',
      'dn42_test\tKeyDomainTest1111111111111111111111111111111=\t(none)\t167.104.97.179:23143\t172.20.100.2/32\t1725500000\t1024\t2048\t25'
    ].join('\n');

    const mockConfigPeers = {
      'KeyDomainTest1111111111111111111111111111111=': {
        publicKey: 'KeyDomainTest1111111111111111111111111111111=',
        endpoint: 'asher.example.com:23143',
        allowedIps: '172.20.100.2/32, fe80::306/64',
        listenPort: 23143,
        mtu: 1380
      }
    };

    const res = await ScannerService.performMasterSync({
      nodeId: 'HK-1',
      mockWgOutput: mockWgDump,
      mockSsOutput: '',
      mockBgpOutput: '',
      mockConfigPeers
    });

    assert.equal(res.success, true);

    const sessions = await SessionService.getSessions();
    const session = sessions.find(s => s.peering?.publicKey === 'KeyDomainTest1111111111111111111111111111111=');
    assert.ok(session, 'Discovered session must be created');
    assert.equal(session.peering.endpoint, 'asher.example.com:23143', 'peering.endpoint must be domain, not resolved IP');
    assert.equal(session.peering.mtu, 1380, 'peering.mtu must be 1380, not default 1420');
  });

  await t.test('3. updateRuntimePeers updates MTU and replaces old resolved IP with domain on existing session', async () => {
    const pubKey = 'KeyUpdateExisting11111111111111111111111111=';

    await SessionService.saveSessions([
      {
        id: 'peer_test_hk1',
        source: 'discovered',
        asn: 4242420306,
        asName: 'AS4242420306',
        nodeId: 'HK-1',
        status: 'active',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        peering: {
          publicKey: pubKey,
          endpoint: '167.104.97.179:23143',
          ipv4: '172.20.14.88',
          linkLocal: 'fe80::306',
          interface: 'dn42_asher_hk',
          mtu: 1420
        },
        runtime: {
          endpoint: '167.104.97.179:23143',
          latestHandshake: 1725500000,
          rxBytes: 0,
          txBytes: 0
        }
      }
    ]);

    await SessionService.updateRuntimePeers('HK-1', {
      peers: [{
        interface: 'dn42_asher_hk',
        publicKey: pubKey,
        endpoint: 'asher.example.com:23143',
        allowedIps: '172.20.14.88/32, fe80::306/64',
        latestHandshake: 1725500500,
        rxBytes: 12500000,
        txBytes: 8100000,
        mtu: 1380
      }],
      bgpSessions: [{
        name: 'dn42_asher_hk',
        proto: 'BGP',
        state: 'up',
        bgpState: 'Established',
        asn: 4242420306,
        cleanAsn: 4242420306,
        neighborAddress: 'fe80::306'
      }],
      ports: []
    });

    const updatedSessions = await SessionService.getSessions();
    const updated = updatedSessions.find(s => s.peering?.publicKey === pubKey);
    assert.ok(updated, 'Session matching publicKey must exist');
    assert.equal(updated.id, 'peer_asher_hk1', 'Canonical ID should be peer_asher_hk1');
    assert.ok(updated);
    assert.equal(updated.peering.endpoint, 'asher.example.com:23143', 'peering.endpoint should be updated to domain');
    assert.equal(updated.peering.mtu, 1380, 'peering.mtu should be updated to 1380');
    assert.equal(updated.runtime.rxBytes, 12500000, 'rxBytes should be updated');
    assert.equal(updated.runtime.txBytes, 8100000, 'txBytes should be updated');
  });

  await t.test('4. Roaming peer without endpoint in config does not leak kernel resolved IP', async () => {
    const pubKey = 'KeyRoamingPeer11111111111111111111111111111=';

    const mockWgDump = [
      'dn42_roam\t(privkey)\tPubServerKeyAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=\t23143\toff',
      'dn42_roam\t' + pubKey + '\t(none)\t192.0.2.100:54321\t172.20.100.9/32\t1725500000\t1024\t2048\t25'
    ].join('\n');

    const mockConfigPeers = {
      [pubKey]: {
        publicKey: pubKey,
        allowedIps: '172.20.100.9/32',
        listenPort: 23143,
        mtu: 1400
      }
    };

    const res = await ScannerService.performMasterSync({
      nodeId: 'HK-1',
      mockWgOutput: mockWgDump,
      mockSsOutput: '',
      mockBgpOutput: '',
      mockConfigPeers
    });

    assert.equal(res.success, true);

    const sessions = await SessionService.getSessions();
    const session = sessions.find(s => s.peering?.publicKey === pubKey);
    assert.ok(session);
    assert.equal(session.peering.endpoint, '', 'peering.endpoint should be empty for roaming peer');
    assert.equal(session.peering.mtu, 1400, 'peering.mtu should be 1400');
  });
});
