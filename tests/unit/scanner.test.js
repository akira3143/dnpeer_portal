import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dn42-test-scanner-'));
process.env.PORTAL_DATA_DIR = testDataDir;

import { ScannerService, parseWgDump, parseSsOutput } from '../../server/services/scannerService.js';
import { PortLedgerService } from '../../server/services/portLedgerService.js';
import { SessionService } from '../../server/services/sessionService.js';

test('ScannerService and WireGuard Dump Parser Unit Tests', async (t) => {
  // Initialize isolated test ledger and sessions
  fs.writeFileSync(path.join(testDataDir, 'port_ledger.json'), JSON.stringify({}), 'utf8');
  fs.writeFileSync(path.join(testDataDir, 'peering_sessions.json'), JSON.stringify([]), 'utf8');

  t.after(() => {
    try {
      fs.rmSync(testDataDir, { recursive: true, force: true });
    } catch {}
  });

  await t.test('parseWgDump extracts interface ports and peer metrics with real epoch timestamps', () => {
    const mockDump = [
      'wg0\t(privkey)\tyA+N64x7tN/4H1XqJd+7qf3K9z1V8uT5R7o+P2w8x1E=\t23143\toff',
      'wg0\tpeerPubkey11111111111111111111111111111111111=\t(none)\t1.2.3.4:23143\t172.20.150.1/32,fd00:4242:3143::1/128\t1724832000\t524288\t1048576\t25',
      'wg1\t(privkey)\tanotherPubkey2222222222222222222222222222222=\t20555\toff'
    ].join('\n');

    const { ports, peers } = parseWgDump(mockDump);
    assert.equal(ports.length, 2);
    assert.equal(ports[0].port, 23143);
    assert.equal(ports[0].name, 'wg0');
    assert.equal(ports[1].port, 20555);

    assert.equal(peers.length, 1);
    assert.equal(peers[0].publicKey, 'peerPubkey11111111111111111111111111111111111=');
    assert.equal(peers[0].endpoint, '1.2.3.4:23143');
    assert.equal(peers[0].latestHandshake, 1724832000);
    assert.equal(peers[0].rxBytes, 524288);
    assert.equal(peers[0].txBytes, 1048576);
  });

  await t.test('parseSsOutput extracts system ports without duplicating wg ports', () => {
    const mockSs = [
      'udp   UNCONN 0      0            0.0.0.0:23143      0.0.0.0:*    users:(("wireguard",pid=123,fd=3))',
      'udp   UNCONN 0      0            0.0.0.0:5353       0.0.0.0:*    users:(("avahi-daemon",pid=456,fd=12))',
      'tcp   LISTEN 0      128          0.0.0.0:179        0.0.0.0:*    users:(("bird",pid=789,fd=6))'
    ].join('\n');

    const existingPorts = [{ port: 23143, name: 'wg0' }];
    const systemPorts = parseSsOutput(mockSs, existingPorts);

    assert.equal(systemPorts.length, 1);
    assert.equal(systemPorts[0].port, 5353);
    assert.equal(systemPorts[0].name, 'avahi-daemon');
  });

  await t.test('performMasterSync handles empty environment gracefully', async () => {
    const res = await ScannerService.performMasterSync({
      mockWgOutput: '',
      mockSsOutput: ''
    });

    assert.equal(res.success, true);
    assert.equal(res.portsCount, 0);
    assert.equal(res.peersUpdated, 0);
    assert.ok(res.message.includes('No local WireGuard interfaces'));
  });

  await t.test('performMasterSync merges actual ports into ledger and updates session peers', async () => {
    const mockWgDump = [
      'wg_jp1\t(privkey)\tyA+N64x7tN/4H1XqJd+7qf3K9z1V8uT5R7o+P2w8x1E=\t22466\toff',
      'wg_jp1\tPEER_KEY_TEST_42423143=====================\t(none)\t1.2.3.4:22466\t172.20.150.2/32\t1724900000\t1024\t2048\t25'
    ].join('\n');
    const mockSs = 'udp UNCONN 0 0 0.0.0.0:21000 0.0.0.0:* users:(("bgp-probe",pid=999,fd=4))';

    const res = await ScannerService.performMasterSync({
      nodeId: 'JP-TYO-1',
      mockWgOutput: mockWgDump,
      mockSsOutput: mockSs
    });

    assert.equal(res.success, true);
    assert.equal(res.nodeId, 'JP-TYO-1');
    assert.equal(res.portsCount, 2);
    assert.equal(res.peersUpdated, 1);

    // Verify ledger state
    const nodePorts = await PortLedgerService.getNodePorts('JP-TYO-1');
    assert.ok(nodePorts.some(p => p.port === 22466));
    assert.ok(nodePorts.some(p => p.port === 21000));
  });
});
