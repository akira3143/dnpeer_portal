import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dn42-test-round27-'));
process.env.PORTAL_DATA_DIR = testDataDir;

import { parseAllowedIps, SessionService } from '../../server/services/sessionService.js';
import { PeeringController } from '../../server/controllers/peeringController.js';
import { getActiveConfig } from '../../server/storage/configLoader.js';

test('Round 27: Tunnel IP Sanitization, BGP Neighbor Backfill & Admin Edit Tests', async (t) => {
  const sessionsFile = path.join(testDataDir, 'peering_sessions.json');
  const ledgerFile = path.join(testDataDir, 'port_ledger.json');
  const testNodeId = getActiveConfig().nodes[0].id;

  t.after(() => {
    try {
      fs.rmSync(testDataDir, { recursive: true, force: true });
    } catch {}
  });

  await t.test('1. parseAllowedIps filters out route summaries and extracts true host IPs', () => {
    const allowedIps1 = '172.16.0.0/12, fd00::/8, fe80::/64';
    const res1 = parseAllowedIps(allowedIps1);
    assert.equal(res1.ipv4, '', 'Route summary 172.16.0.0/12 must not be treated as peer IP');
    assert.equal(res1.ipv6Ula, '', 'Prefix fd00::/8 must not be treated as peer IP');
    assert.equal(res1.linkLocal, '', 'fe80::/64 must not be treated as peer linkLocal');

    const allowedIps2 = 'fe80::306/64, 172.20.14.88/32, fd42:d42:d42:54::1/128, 172.16.0.0/12';
    const res2 = parseAllowedIps(allowedIps2);
    assert.equal(res2.linkLocal, 'fe80::306', 'True host link-local address must be preserved');
    assert.equal(res2.ipv4, '172.20.14.88', 'True host IPv4 address must be preserved');
    assert.equal(res2.ipv6Ula, 'fd42:d42:d42:54::1', 'True host IPv6 ULA address must be preserved');
  });

  await t.test('2. updateRuntimePeers cleans placeholder route summaries and backfills bgp.neighborAddress', async () => {
    fs.writeFileSync(sessionsFile, JSON.stringify([
      {
        id: `peer_hexp_${testNodeId.toLowerCase().replace(/[^a-z0-9]/g, '')}`,
        nodeId: testNodeId,
        asn: 4242420306,
        source: 'discovered',
        status: 'active',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        peering: {
          interface: 'dn42_hexp',
          publicKey: 'TestPubKeyCleanBackfillAAAAAAAAAAAAAAAAAAAA=',
          endpoint: '167.104.97.179:23143',
          linkLocal: 'fe80::',
          ipv4: '172.16.0.0',
          ipv6Ula: 'fd00::'
        },
        assigned: {
          hostPort: 20306
        },
        runtime: {}
      }
    ]), 'utf8');

    await SessionService.updateRuntimePeers(testNodeId, {
      peers: [{
        interface: 'dn42_hexp',
        publicKey: 'TestPubKeyCleanBackfillAAAAAAAAAAAAAAAAAAAA=',
        endpoint: '167.104.97.179:23143',
        allowedIps: '172.16.0.0/12, fe80::/64',
        latestHandshake: 1725500000
      }],
      bgpSessions: [{
        name: 'dn42_hexp',
        neighborAddress: 'fe80::306%dn42_hexp',
        cleanAsn: 4242420306,
        bgpState: 'Established'
      }]
    });

    const sessions = await SessionService.getSessions();
    assert.equal(sessions.length, 1);
    const s = sessions[0];
    assert.equal(s.peering.linkLocal, 'fe80::306', 'fe80:: placeholder must be replaced with real neighborAddress');
    assert.equal(s.peering.ipv4, '', '172.16.0.0 placeholder must be cleaned to empty string');
    assert.equal(s.peering.ipv6Ula, '', 'fd00:: placeholder must be cleaned to empty string');
    assert.equal(s.status, 'active');
  });

  await t.test('3. PeeringController allows admin editing existing session with body.id', async () => {
    const sessId = `peer_hexp_${testNodeId.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
    fs.writeFileSync(sessionsFile, JSON.stringify([
      {
        id: sessId,
        nodeId: testNodeId,
        asn: 4242420306,
        source: 'discovered',
        status: 'active',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        peering: {
          publicKey: 'TestPubKeyAdminEditAAAAAAAAAAAAAAAAAAAAAAAA=',
          linkLocal: 'fe80::306',
          ipv4: '172.20.14.88',
          listenPort: 20306
        },
        assigned: { hostPort: 20306 },
        runtime: {}
      }
    ]), 'utf8');
    fs.writeFileSync(ledgerFile, JSON.stringify({}), 'utf8');

    const adminUser = { asn: 4242423143, role: 'admin' };
    const editPayload = {
      id: sessId,
      asn: 4242420306,
      nodeId: testNodeId,
      publicKey: 'TestPubKeyAdminEditAAAAAAAAAAAAAAAAAAAAAAAA=',
      linkLocal: 'fe80::306',
      ipv4: '172.20.14.88',
      listenPort: 'auto'
    };

    const res = await PeeringController.submitPeering(editPayload, adminUser);
    assert.equal(res.success, true, 'Admin edit of existing session with body.id must succeed');

    const sessions = await SessionService.getSessions();
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].id, sessId);
    assert.equal(sessions[0].asn, 4242420306);
  });

  await t.test('4. Non-admin attempting to submit for another ASN is rejected with 403', async () => {
    const regularUser = { asn: 4242429999, role: 'user' };
    const payload = {
      asn: 4242420306,
      nodeId: testNodeId,
      publicKey: 'TestPubKeyNonAdminAAAAAAAAAAAAAAAAAAAAAAAA=',
      linkLocal: 'fe80::306'
    };

    const res = await PeeringController.submitPeering(payload, regularUser);
    assert.equal(res.success, false);
    assert.equal(res.code, 403);
    assert.ok(res.error.message.includes('Cannot submit peering application for another ASN'));
  });
});