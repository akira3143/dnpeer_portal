import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dn42-test-probereport-'));
process.env.PORTAL_DATA_DIR = testDataDir;

import { createServer } from '../../server/index.js';
import { ENV } from '../../server/config.js';

test('Probe Report API Integration Tests', async (t) => {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  t.after(async () => {
    if (server && server.closeAll) {
      await server.closeAll();
    }
    try {
      fs.rmSync(testDataDir, { recursive: true, force: true });
    } catch {}
  });

  await t.test('POST /api/probe/report rejects unauthorized request', async () => {
    const res = await fetch(`${baseUrl}/api/probe/report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nodeId: 'JP-TYO-1' })
    });
    assert.equal(res.status, 401);
  });

  await t.test('POST /api/probe/report accepts valid authorized snapshot', async () => {
    const res = await fetch(`${baseUrl}/api/probe/report`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ENV.PROBE_AUTH_TOKEN}`
      },
      body: JSON.stringify({
        nodeId: 'JP-TYO-1',
        ports: [{ port: 22466, name: 'wg0' }],
        systemPorts: [{ port: 21000, name: 'bgp-probe' }],
        peers: [{
          publicKey: 'yA+N64x7tN/4H1XqJd+7qf3K9z1V8uT5R7o+P2w8x1E=',
          endpoint: '1.2.3.4:23143',
          latestHandshake: 1724832000
        }]
      })
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.data.nodeId, 'JP-TYO-1');
  });
});
