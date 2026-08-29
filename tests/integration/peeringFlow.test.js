import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../../server/index.js';

describe('Peering Flow API Integration Tests', () => {
  let server;
  let baseUrl;

  before(async () => {
    server = createServer();
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    await new Promise(resolve => server.close(resolve));
  });

  test('GET /api/network-meta returns active metadata and nodes', async () => {
    const res = await fetch(`${baseUrl}/api/network-meta`);
    assert.equal(res.status, 200);
    const body = await res.json();

    assert.equal(body.success, true);
    assert.ok(body.data.nodes.length > 0);
    assert.equal(body.data.network.asn, 'AS4242423143');
    assert.equal(body.data.guiPath, '/gui');
  });

  test('POST /api/peering/submit with invalid payload returns HTTP 200 with fieldErrors', async () => {
    const res = await fetch(`${baseUrl}/api/peering/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        asn: 'not_an_asn',
        publicKey: 'short_key'
      })
    });

    // Busybox compatibility: HTTP 200 returned
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.ok(body.error.fieldErrors);
    assert.ok(body.error.fieldErrors.asn);
    assert.ok(body.error.fieldErrors.publicKey);
  });

  test('POST /api/peering/submit with valid payload creates session and returns configs', async () => {
    const res = await fetch(`${baseUrl}/api/peering/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        asn: '4242423143',
        nodeId: 'JP-TYO-1',
        publicKey: 'yA+N64x7tN/4H1XqJd+7qf3K9z1V8uT5R7o+P2w8x1E=',
        linkLocal: 'fe80::4242:3143',
        ipv4: '172.20.150.100',
        ipv6Ula: 'fd00:4242:3143::1',
        listenPort: 'auto',
        mtu: 1420
      })
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.ok(body.data.sessionId);
    assert.equal(body.data.port, 23143);
    assert.ok(body.data.configs.clientWireguard);
    assert.ok(body.data.configs.clientBird);
    assert.ok(body.data.acknowledgement.includes("We'll establish the peer with you within 24 hours!"));
  });
});
