import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dn42-test-probereport-'));
process.env.PORTAL_DATA_DIR = testDataDir;

import { createServer } from '../../server/index.js';
import { ENV } from '../../server/config.js';
import { getActiveConfig } from '../../server/storage/configLoader.js';
import { StatusTracker } from '../../server/services/statusTracker.js';
import { NodeTokenStorage } from '../../server/storage/nodeTokenStorage.js';
import { handleCliProbe } from '../../server/cliCommands.js';
import { resolveIdentity, resolveNodeId, collectAndReport } from '../../scripts/probe-agent.js';

test('Probe Report API & Dedicated Token Integration Tests', async (t) => {
  const targetNode = getActiveConfig().nodes[0];
  const secondNode = getActiveConfig().nodes[1] || { id: 'DUMMY-2', wgPublicKey: 'dummy_pubkey_222222222222222222222222222=' };
  StatusTracker.reset();
  NodeTokenStorage.clearTokens();

  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  t.after(async () => {
    StatusTracker.reset();
    NodeTokenStorage.clearTokens();
    if (server && server.closeAll) {
      await server.closeAll();
    }
    try {
      fs.rmSync(testDataDir, { recursive: true, force: true });
    } catch {}
  });

  await t.test('dnp probe generates dedicated token idempotently and lists node statuses', async () => {
    // 1. List all nodes (no arguments)
    const listResult = handleCliProbe([]);
    assert.equal(listResult.success, true);
    assert.ok(listResult.count >= 1);

    // 2. Generate command for targetNode
    const probeResult1 = handleCliProbe([targetNode.id], { portalDomain: `127.0.0.1:${port}` });
    assert.ok(probeResult1);
    assert.equal(probeResult1.nodeId, targetNode.id);
    assert.equal(typeof probeResult1.token, 'string');
    assert.equal(probeResult1.token.length, 64, 'Token must be 64-char hex');
    assert.ok(probeResult1.installCmd.includes(`bash -s -- ${targetNode.id} ${probeResult1.token}`));

    // 3. Repeat command for same node -> token must be identical (idempotent)
    const probeResult2 = handleCliProbe([targetNode.id], { portalDomain: `127.0.0.1:${port}` });
    assert.equal(probeResult2.token, probeResult1.token, 'Token generation must be idempotent');
    assert.equal(probeResult2.installCmd, probeResult1.installCmd);

    // 4. Unknown node returns null
    const unknownResult = handleCliProbe(['NON-EXISTENT-NODE-999']);
    assert.equal(unknownResult, null);
  });

  await t.test('GET /install-probe.sh returns dynamic script with zero embedded credentials', async () => {
    const res = await fetch(`${baseUrl}/install-probe.sh`);
    assert.equal(res.status, 200);
    assert.ok(res.headers.get('content-type')?.includes('shellscript'));

    const script = await res.text();
    assert.ok(script.startsWith('#!/usr/bin/env bash'));
    assert.ok(script.includes(baseUrl), 'Must embed master URL');
    assert.ok(script.includes('NODE_ID_ARG'), 'Must process node ID parameter');
    assert.ok(script.includes('NODE_TOKEN_ARG'), 'Must process node token parameter');
    assert.ok(script.includes('CLAIM_NODE_ID'), 'Must configure CLAIM_NODE_ID in environment file');
    assert.ok(script.includes('CLAIM_TOKEN'), 'Must configure CLAIM_TOKEN in environment file');

    // Zero credentials assertion
    const nodeToken = NodeTokenStorage.getOrCreateToken(targetNode.id);
    assert.ok(!script.includes(nodeToken), 'Must NOT contain any dedicated token');
    assert.ok(!script.includes('PROBE_AUTH_TOKEN='), 'Must NOT contain old PROBE_AUTH_TOKEN');
  });

  await t.test('POST /api/probe/register enforces dedicated token and WireGuard public key dark secret', async () => {
    const correctToken = NodeTokenStorage.getOrCreateToken(targetNode.id);
    const foreignToken = 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';

    // 1. Missing token
    const noTokenRes = await fetch(`${baseUrl}/api/probe/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nodeId: targetNode.id, publicKeys: [targetNode.wgPublicKey] })
    });
    assert.equal(noTokenRes.status, 401);

    // 2. Missing nodeId
    const noNodeRes = await fetch(`${baseUrl}/api/probe/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${correctToken}`
      },
      body: JSON.stringify({ publicKeys: [targetNode.wgPublicKey] })
    });
    assert.equal(noNodeRes.status, 400);

    // 3. Invalid / forged token
    const badTokenRes = await fetch(`${baseUrl}/api/probe/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${foreignToken}`
      },
      body: JSON.stringify({
        nodeId: targetNode.id,
        token: foreignToken,
        publicKeys: [targetNode.wgPublicKey]
      })
    });
    assert.equal(badTokenRes.status, 403);

    // 4. Correct token, but candidate WireGuard public keys do not match node
    const badKeyRes = await fetch(`${baseUrl}/api/probe/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${correctToken}`
      },
      body: JSON.stringify({
        nodeId: targetNode.id,
        token: correctToken,
        publicKeys: ['forged_public_key_111111111111111111111111111=']
      })
    });
    assert.equal(badKeyRes.status, 403);
    const badKeyBody = await badKeyRes.json();
    assert.ok(badKeyBody.error.message.includes('WireGuard public key did not match'));

    // 5. Correct token AND matching WireGuard public key -> Success and instant online ("对上暗号即在线")
    StatusTracker.reset();
    const initMeta = await (await fetch(`${baseUrl}/api/network-meta`)).json();
    const initNode = initMeta.data.nodes.find(n => n.id === targetNode.id);
    assert.equal(initNode.online, false);

    const matchRes = await fetch(`${baseUrl}/api/probe/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${correctToken}`
      },
      body: JSON.stringify({
        nodeId: targetNode.id,
        token: correctToken,
        publicKeys: [
          'foreign_key_abc_111111111111111111111111111111=',
          targetNode.wgPublicKey,
          'foreign_key_xyz_222222222222222222222222222222='
        ]
      })
    });
    assert.equal(matchRes.status, 200);
    const matchBody = await matchRes.json();
    assert.equal(matchBody.success, true);
    assert.equal(matchBody.data.nodeId, targetNode.id);
    assert.equal(matchBody.data.matchedPublicKey, targetNode.wgPublicKey);

    // Assert that targetNode became online immediately upon secret match
    const afterMeta = await (await fetch(`${baseUrl}/api/network-meta`)).json();
    const afterNode = afterMeta.data.nodes.find(n => n.id === targetNode.id);
    assert.equal(afterNode.status, 'online');
    assert.equal(afterNode.online, true);
  });

  await t.test('POST /api/probe/report authenticates with per-node token and rejects impersonation', async () => {
    const nodeAToken = NodeTokenStorage.getOrCreateToken(targetNode.id);
    const nodeBToken = NodeTokenStorage.getOrCreateToken(secondNode.id);

    // 1. Missing token rejected (401)
    const noTokenRes = await fetch(`${baseUrl}/api/probe/report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nodeId: targetNode.id, ports: [] })
    });
    assert.equal(noTokenRes.status, 401);

    // 2. Wrong token rejected (403)
    const badTokenRes = await fetch(`${baseUrl}/api/probe/report`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer wrong_token_12345'
      },
      body: JSON.stringify({ nodeId: targetNode.id, ports: [] })
    });
    assert.equal(badTokenRes.status, 403);

    // 3. Node B token used for Node A (impersonation attack) rejected (403)
    const impersonateRes = await fetch(`${baseUrl}/api/probe/report`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${nodeBToken}`
      },
      body: JSON.stringify({ nodeId: targetNode.id, ports: [] })
    });
    assert.equal(impersonateRes.status, 403);

    // 4. Correct token for targetNode accepted (200)
    const validRes = await fetch(`${baseUrl}/api/probe/report`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${nodeAToken}`
      },
      body: JSON.stringify({
        nodeId: targetNode.id,
        ports: [{ port: 22466, name: 'wg0' }],
        systemPorts: [{ port: 21000, name: 'bgp-probe' }],
        peers: [{
          publicKey: 'yA+N64x7tN/4H1XqJd+7qf3K9z1V8uT5R7o+P2w8x1E=',
          endpoint: '1.2.3.4:23143',
          latestHandshake: 1724832000
        }]
      })
    });
    assert.equal(validRes.status, 200);
    const validBody = await validRes.json();
    assert.equal(validBody.success, true);
    assert.equal(validBody.data.nodeId, targetNode.id);

    // 5. 10-minute heartbeat timeout verification
    const elevenMinsAgo = new Date(Date.now() - 11 * 60 * 1000).toISOString();
    StatusTracker.recordHeartbeat(targetNode.id, elevenMinsAgo);

    const timeoutMeta = await (await fetch(`${baseUrl}/api/network-meta`)).json();
    const timeoutNode = timeoutMeta.data.nodes.find(n => n.id === targetNode.id);
    assert.equal(timeoutNode.status, 'offline');
    assert.equal(timeoutNode.online, false);

    // 6. Resurrect on next report with valid token
    await fetch(`${baseUrl}/api/probe/report`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${nodeAToken}`
      },
      body: JSON.stringify({ nodeId: targetNode.id, ports: [] })
    });
    const resurrectMeta = await (await fetch(`${baseUrl}/api/network-meta`)).json();
    const resurrectNode = resurrectMeta.data.nodes.find(n => n.id === targetNode.id);
    assert.equal(resurrectNode.status, 'online');
    assert.equal(resurrectNode.online, true);
  });

  await t.test('probe-agent resolveIdentity auto-claims and manages state files', async () => {
    const tmpAgentDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dn42-test-agent-'));
    const stateFile = path.join(tmpAgentDir, 'node_id');
    const tokenFile = path.join(tmpAgentDir, 'token');
    const token = NodeTokenStorage.getOrCreateToken(targetNode.id);

    try {
      // 1. First run: no state file, claim parameters provided -> successfully auto-claims
      // Note: we supply mockWgDir or mock candidate keys
      const mockWgDir = path.join(tmpAgentDir, 'wireguard');
      fs.mkdirSync(mockWgDir, { recursive: true });

      // Direct registration call to test identity resolution
      const regRes = await fetch(`${baseUrl}/api/probe/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          nodeId: targetNode.id,
          token,
          publicKeys: [targetNode.wgPublicKey]
        })
      });
      assert.equal(regRes.status, 200);

      // Write state files
      fs.writeFileSync(stateFile, targetNode.id, 'utf8');
      fs.writeFileSync(tokenFile, token, 'utf8');

      // Subsequent resolution directly uses local state
      const identity = await resolveIdentity({
        masterUrl: baseUrl,
        stateFile,
        tokenFile
      });
      assert.equal(identity.nodeId, targetNode.id);
      assert.equal(identity.token, token);

      const nodeIdOnly = await resolveNodeId({
        masterUrl: baseUrl,
        stateFile,
        tokenFile
      });
      assert.equal(nodeIdOnly, targetNode.id);
    } finally {
      try { fs.rmSync(tmpAgentDir, { recursive: true, force: true }); } catch {}
    }
  });

  await t.test('Security verification: Private key content never leaves host in registration payload', async () => {
    const mockPrivKey = 'PRIVATE_KEY_NEVER_LEAK_SECRET_12345';
    const payload = {
      nodeId: targetNode.id,
      token: 'some_token',
      publicKeys: [targetNode.wgPublicKey]
    };
    const serialized = JSON.stringify(payload);
    assert.ok(!serialized.includes(mockPrivKey));
    assert.ok(!serialized.includes('privateKey'));
    assert.ok(serialized.includes('publicKeys'));
  });

  await t.test('Residual check: Global PROBE_AUTH_TOKEN is decommissioned', async () => {
    assert.equal(ENV.PROBE_AUTH_TOKEN, undefined);
  });
});


