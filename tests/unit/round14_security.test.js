import { test, describe, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dn42-test-r14-'));
process.env.PORTAL_DATA_DIR = testDataDir;

import { PortLedgerService } from '../../server/services/portLedgerService.js';
import { ConfigEngine } from '../../server/services/configEngine.js';
import { getActiveConfig } from '../../server/storage/configLoader.js';
import { createServer } from '../../server/index.js';

describe('Round 14 Security and Contract Fixes Unit Tests', () => {
  const ledgerFile = path.join(testDataDir, 'port_ledger.json');
  const node = getActiveConfig().nodes[0];

  after(() => {
    try {
      fs.rmSync(testDataDir, { recursive: true, force: true });
    } catch {}
  });

  beforeEach(() => {
    fs.writeFileSync(ledgerFile, JSON.stringify({}), 'utf8');
  });

  afterEach(() => {
    fs.writeFileSync(ledgerFile, JSON.stringify({}), 'utf8');
  });

  test('Target 10: concurrent allocateAndLockPort requests are serialized via async mutex with zero port collision', async () => {
    // 5 concurrent requests with collision-prone ASNs all ending in 3143
    const asns = [4242423143, 4141413143, 4343433143, 4444443143, 4545453143];
    const promises = asns.map((asn, idx) =>
      PortLedgerService.allocateAndLockPort({
        nodeId: node.id,
        asn,
        requestedPort: 'auto',
        sessionId: `sess_concurrent_${idx}`
      })
    );

    const results = await Promise.all(promises);
    const allocatedPorts = results.map(r => r.port);

    // Verify all 5 ports are distinct
    const uniquePorts = new Set(allocatedPorts);
    assert.equal(uniquePorts.size, 5, 'All concurrent port allocations must be distinct');
    assert.deepEqual(allocatedPorts.sort(), [23143, 33143, 43143, 53143, 63143]);
  });

  test('Target 2: serverWireguardSnippet formats Endpoint with clientPort when specified, omits port when auto', () => {
    // 1. With numeric clientPort
    const configWithPort = ConfigEngine.generateFullConfig({
      asn: '4242423143',
      nodeId: node.id,
      clientPublicKey: 'yA+N64x7tN/4H1XqJd+7qf3K9z1V8uT5R7o+P2w8y1E=',
      clientEndpoint: 'myhost.dn42',
      clientLinkLocal: 'fe80::3143',
      hostPort: 23143,
      clientPort: 25000,
      mtu: 1420
    });
    assert.ok(configWithPort.serverWireguardSnippet.includes('Endpoint = myhost.dn42:25000\n'), 'Must include :port in server snippet when clientPort is numeric');

    // 2. With auto clientPort (Round 18 resolves auto clientPort to default 23143)
    const configAuto = ConfigEngine.generateFullConfig({
      asn: '4242423143',
      nodeId: node.id,
      clientPublicKey: 'yA+N64x7tN/4H1XqJd+7qf3K9z1V8uT5R7o+P2w8x1E=',
      clientEndpoint: 'myhost.dn42',
      clientLinkLocal: 'fe80::3143',
      hostPort: 23143,
      clientPort: 'auto',
      mtu: 1420
    });
    assert.ok(configAuto.serverWireguardSnippet.includes('Endpoint = myhost.dn42:23143\n'), 'Must format server snippet with resolved default clientPort');
    assert.ok(!configAuto.serverWireguardSnippet.includes('myhost.dn42:auto'));
  });

  test('Target 8: Static file serving enforces path.resolve boundary checks and rejects traversal', async () => {
    const server = createServer();
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
      // Normal resource request
      const normalRes = await fetch(`${baseUrl}/index.html`);
      assert.equal(normalRes.status, 200);

      // Traversal request on root CLI
      const traversalRes1 = await fetch(`${baseUrl}/..%2f..%2fpackage.json`);
      assert.equal(traversalRes1.status, 403);
      const json1 = await traversalRes1.json();
      assert.equal(json1.success, false);
      assert.equal(json1.error.message, 'Forbidden: Access Denied');

      // Traversal request on GUI
      const guiRoute = getActiveConfig().guiPath || '/gui';
      const traversalRes2 = await fetch(`${baseUrl}${guiRoute}/..%2f..%2fpackage.json`);
      assert.equal(traversalRes2.status, 403);
      const json2 = await traversalRes2.json();
      assert.equal(json2.success, false);
    } finally {
      if (server && server.closeAll) {
        await server.closeAll();
      }
    }
  });
});
