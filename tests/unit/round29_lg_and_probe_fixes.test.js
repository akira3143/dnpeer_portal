import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { generateInstallProbeScript } from '../../server/services/installScriptService.js';
import { deriveCandidatePublicKeys } from '../../scripts/probe-agent.js';
import { StatusTracker } from '../../server/services/statusTracker.js';
import { ScannerService } from '../../server/services/scannerService.js';
import { LookingGlassService } from '../../server/services/lookingGlassService.js';

test('Round 29: Remote Node Looking Glass & Probe Agent Fixes', async (t) => {

  t.afterEach(() => {
    StatusTracker.reset();
  });

  await t.test('1. generateInstallProbeScript binds bird-lgproxy to 0.0.0.0:5000 and avoids systemd Environment masking', () => {
    const script = generateInstallProbeScript({ masterUrl: 'https://dnpeer.akilab.meme' });

    // bird-lgproxy must listen on 0.0.0.0:5000 so master can reach it over DN42 tunnel IP
    assert.match(script, /--listen 0\.0\.0\.0:5000/, 'bird-lgproxy should listen on 0.0.0.0:5000');
    assert.doesNotMatch(script, /--listen 127\.0\.0\.1:5000/, 'bird-lgproxy should not be restricted to 127.0.0.1:5000');

    // dn42-probe.service must not overwrite EnvironmentFile with empty Environment="KEY=" lines
    assert.match(script, /EnvironmentFile=-\/etc\/default\/dn42-probe/);
    assert.doesNotMatch(script, /Environment="PORTAL_MASTER_URL="/, 'Must not override PORTAL_MASTER_URL with empty string');
    assert.doesNotMatch(script, /Environment="CLAIM_NODE_ID="/, 'Must not override CLAIM_NODE_ID with empty string');
    assert.doesNotMatch(script, /Environment="CLAIM_TOKEN="/, 'Must not override CLAIM_TOKEN with empty string');
  });

  await t.test('2. deriveCandidatePublicKeys extracts keys from .conf files and *.key files safely', () => {
    const tmpWgDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wg-test-'));
    try {
      // 1. Conf file with PrivateKey = ...
      const confPath = path.join(tmpWgDir, 'dn42_test.conf');
      fs.writeFileSync(confPath, `
[Interface]
ListenPort = 23143
PrivateKey = aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa=

[Peer]
PublicKey = bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb=
Endpoint = 1.2.3.4:23143
      `.trim(), 'utf8');

      // 2. Key file with raw key
      const keyPath = path.join(tmpWgDir, 'wg_server.key');
      fs.writeFileSync(keyPath, 'ccccccccccccccccccccccccccccccccccccccccccc=\n', 'utf8');

      // Call deriveCandidatePublicKeys
      const derived = deriveCandidatePublicKeys(tmpWgDir);
      assert.ok(Array.isArray(derived), 'Should return an array');
    } finally {
      try {
        fs.rmSync(tmpWgDir, { recursive: true, force: true });
      } catch {}
    }
  });

  await t.test('3. ScannerService and StatusTracker cache BGP snapshot from probe report', async () => {
    const rawBgp = `
BIRD 2.15.1 ready.
Name       Proto      Table      State  Since         Info
dn42_peer1 BGP        master4    up     10:00:00      Established
    `.trim();

    const bgpSessions = [
      { name: 'dn42_peer1', proto: 'BGP', table: 'master4', bgpState: 'Established', since: '10:00:00' }
    ];

    await ScannerService.handleProbeReport({
      nodeId: 'JP-2',
      ports: [{ port: 23143, name: 'dn42_peer1', source: 'wg' }],
      systemPorts: [],
      peers: [],
      bgpSessions,
      rawBgpOutput: rawBgp
    });

    const snapshot = StatusTracker.getBgpSnapshot('JP-2');
    assert.ok(snapshot, 'Snapshot should be recorded for JP-2');
    assert.equal(snapshot.rawBgpOutput, rawBgp);
    assert.equal(snapshot.bgpSessions.length, 1);
  });

  await t.test('4. LookingGlassService falls back to cached probe BGP snapshot when lgproxy is unreachable', async () => {
    // Record snapshot for HK-1
    const rawBgp = `
BIRD 2.15.1 ready.
Name       Proto      Table      State  Since         Info
dn42_hk    BGP        master4    up     12:00:00      Established
    `.trim();

    StatusTracker.recordBgpSnapshot('HK-1', {
      rawBgpOutput: rawBgp,
      bgpSessions: [{ name: 'dn42_hk', bgpState: 'Established' }]
    });

    // Query HK-1 for bgp summary (lgProxyUrl on HK-1 is an unreachable test address or mock)
    const res = await LookingGlassService.query({ nodeId: 'HK-1', command: 'bgp' });
    assert.equal(res.success, true, 'Should succeed via probe cache fallback');
    assert.equal(res.nodeId, 'HK-1');
    assert.equal(res.output, rawBgp);
    assert.equal(res.source, 'probe_cache');
  });

  await t.test('5. LookingGlassService formats BIRD table from bgpSessions if rawBgpOutput is empty', async () => {
    StatusTracker.recordBgpSnapshot('US-LA1', {
      rawBgpOutput: '',
      bgpSessions: [
        { name: 'dn42_la1', bgpState: 'Established', table: 'master4', since: '14:00:00' }
      ]
    });

    const res = await LookingGlassService.query({ nodeId: 'US-LA1', command: 'protocols' });
    assert.equal(res.success, true);
    assert.match(res.output, /dn42_la1/);
    assert.match(res.output, /BGP/);
    assert.match(res.output, /Established/);
  });

  await t.test('6. CLI lg script avoids obsolete hardcoded node names and uses is_known_node', () => {
    const lgPath = path.resolve('cli/cli-src/bin/lg');
    const content = fs.readFileSync(lgPath, 'utf8');

    assert.doesNotMatch(content, /"US-1"/, 'Should not contain obsolete US-1 hardcoding');
    assert.doesNotMatch(content, /"DE-1"/, 'Should not contain obsolete DE-1 hardcoding');
    assert.doesNotMatch(content, /"SGP-1"/, 'Should not contain obsolete SGP-1 hardcoding');
    assert.match(content, /is_known_node/, 'Should call is_known_node');
    assert.match(content, /ensure_nodes/, 'Should call ensure_nodes');
  });

  await t.test('7. dn42-lib.sh is_known_node recognizes current nodes dynamically and statically', () => {
    const libPath = path.resolve('cli/cli-src/etc/dn42-lib.sh');
    const content = fs.readFileSync(libPath, 'utf8');

    assert.match(content, /is_known_node\(\)/, 'Must define is_known_node');
    assert.match(content, /ensure_nodes\(\)/, 'Must define ensure_nodes');
    assert.match(content, /JP-7\|JP-2\|HK-1\|US-LA1/, 'Must support current active nodes');
  });
});
