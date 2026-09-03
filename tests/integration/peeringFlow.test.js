import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dn42-test-peeringflow-'));
process.env.PORTAL_DATA_DIR = testDataDir;

import { createServer } from '../../server/index.js';
import { AuthService } from '../../server/services/authService.js';
import { getActiveConfig } from '../../server/storage/configLoader.js';

test('Peering Flow API Integration Tests', async (t) => {
  fs.writeFileSync(path.join(testDataDir, 'port_ledger.json'), JSON.stringify({}), 'utf8');
  fs.writeFileSync(path.join(testDataDir, 'peering_sessions.json'), JSON.stringify([]), 'utf8');

  const testConfig = getActiveConfig();
  const testNodeId = testConfig.nodes[0].id;

  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const validToken = AuthService.signJwt({ asn: 4242423143, role: 'admin', asName: 'AKILAB-MNT' }).token;

  t.after(async () => {
    if (server && server.closeAll) {
      await server.closeAll();
    }
    try {
      fs.rmSync(testDataDir, { recursive: true, force: true });
    } catch {}
  });

  await t.test('GET /api/network-meta returns active metadata and nodes', async () => {
    const res = await fetch(`${baseUrl}/api/network-meta`);
    assert.equal(res.status, 200);
    const body = await res.json();

    assert.equal(body.success, true);
    assert.ok(body.data.nodes.length > 0);
    assert.equal(body.data.network.asn, 'AS4242423143');
    assert.equal(body.data.guiPath, testConfig.guiPath);
  });

  await t.test('POST /api/peering/submit without token returns HTTP 401 Unauthorized (7.1)', async () => {
    const res = await fetch(`${baseUrl}/api/peering/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        asn: '4242423143',
        nodeId: testNodeId,
        publicKey: 'yA+N64x7tN/4H1XqJd+7qf3K9z1V8uT5R7o+P2w8x1E='
      })
    });

    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.equal(body.error.message, 'Unauthorized');
  });

  await t.test('POST /api/peering/submit with mismatched ASN returns HTTP 403 Forbidden (7.1)', async () => {
    const res = await fetch(`${baseUrl}/api/peering/submit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${validToken}`
      },
      body: JSON.stringify({
        asn: '4242421111',
        nodeId: testNodeId,
        publicKey: 'yA+N64x7tN/4H1XqJd+7qf3K9z1V8uT5R7o+P2w8x1E='
      })
    });

    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.ok(body.error.message.includes('Cannot submit peering application for another ASN'));
  });

  await t.test('POST /api/peering/submit with invalid payload returns HTTP 200 with fieldErrors', async () => {
    const res = await fetch(`${baseUrl}/api/peering/submit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${validToken}`
      },
      body: JSON.stringify({
        asn: '4242423143',
        publicKey: 'short_key'
      })
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.ok(body.error.fieldErrors);
    assert.ok(body.error.fieldErrors.publicKey);
  });

  await t.test('POST /api/peering/submit with valid payload creates session and returns configs', async () => {
    const res = await fetch(`${baseUrl}/api/peering/submit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${validToken}`
      },
      body: JSON.stringify({
        asn: '4242423143',
        nodeId: testNodeId,
        publicKey: 'yA+N64x7tN/4H1XqJd+7qf3K9z1V8uT5R7o+P2w8x1E=',
        linkLocal: 'fe80::4242:3143',
        ipv4: '172.20.150.100',
        ipv6Ula: 'fd00:4242:3143::1',
        listenPort: 'auto',
        clientPort: 'auto',
        mtu: 1420
      })
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.ok(body.data.configs.clientWireguard);
    assert.equal(body.data.configs.clientBird, undefined);
    assert.ok(body.data.clientWireguard);
    assert.ok(body.data.acknowledgement.includes("We'll establish the peer with you within 24 hours!"));
  });
});
