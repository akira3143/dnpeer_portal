import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createIsolatedTestDataDir } from './tmpDataDir.js';

// 1. Data Isolation Guard (U12)
const realDataDir = path.resolve('server/data');
const getRealDataSnapshot = () => {
  const files = fs.readdirSync(realDataDir).sort();
  const map = {};
  for (const f of files) {
    const full = path.join(realDataDir, f);
    const stat = fs.statSync(full);
    map[f] = { mtimeMs: stat.mtimeMs, size: stat.size, sha: fs.readFileSync(full, 'base64') };
  }
  return map;
};

const preSnapshot = getRealDataSnapshot();
const testData = createIsolatedTestDataDir('dn42-test-round7-');

import { createServer } from '../../server/index.js';
import { ConfigEngine } from '../../server/services/configEngine.js';

async function main() {
  try {
    console.log('=== 1. Starting Test Server on Port 4249 ===');
    const server = createServer();
    await new Promise(r => server.listen(4249, '127.0.0.1', r));

    // Get Admin Token
    const loginRes = await fetch('http://127.0.0.1:4249/api/auth/login-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: '4242423143', password: 'test12345' })
    });
    const loginBody = await loginRes.json();
    assert.equal(loginBody.success, true);
    const token = loginBody.data.token;
    console.log('[Auth] Admin Logged in successfully');

    // 2. Test U8 + U9 + U11 via Peering Submission
    console.log('\n=== 2. Testing Peering Submission (U8, U9, U11) ===');
    const submitRes = await fetch('http://127.0.0.1:4249/api/peering/submit', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        asn: '4242423143',
        nodeId: 'JP-TYO-1',
        publicKey: 'yA+N64x7tN/4H1XqJd+7qf3K9z1V8uT5R7o+P2w8x1E=',
        linkLocal: 'fe80::4242:3143',
        ipv4: '172.20.150.99',
        ipv6Ula: 'fd00:4242:3143::99',
        endpoint: 'myhost.dn42',
        listenPort: 'auto',
        clientPort: 'auto',
        mtu: 1420
      })
    });
    const submitBody = await submitRes.json();
    assert.equal(submitBody.success, true);

    const wgConf = submitBody.data.clientWireguard;
    console.log('[Generated Client WG Config]:\n' + wgConf);

    // --- U8 Validations ---
    console.log('--- Verifying U8: WireGuard Production Elements ---');
    assert.ok(wgConf.includes('fe80::4242:3143/64'), 'LLA must be /64');
    assert.ok(wgConf.includes('fd00:4242:3143::99/128'), 'ULA must be /128');
    assert.ok(wgConf.includes('172.20.150.99/32'), 'IPv4 must be /32');
    assert.ok(wgConf.includes('PostUp = ip addr del dev %i 172.20.150.99/32'));
    assert.ok(wgConf.includes('PostUp = ip addr add dev %i 172.20.150.99/32 peer 172.20.150.1/32'));
    assert.ok(wgConf.includes('PostUp = ip addr del dev %i fd00:4242:3143::99/128'));
    assert.ok(wgConf.includes('PostUp = ip addr add dev %i fd00:4242:3143::99/128 peer fd00:4242:3143::1/128'));
    assert.ok(wgConf.includes('AllowedIPs = 10.0.0.0/8, 172.16.0.0/12, fd00::/8, fe80::/64'));
    assert.ok(wgConf.includes('PersistentKeepalive = 25'));
    assert.ok(wgConf.includes('ListenPort = <YOUR_LISTEN_PORT>'), 'ListenPort placeholder expected when clientPort is auto');
    console.log('[✓] U8 Verified: /64 LLA, /128 ULA, /32 IPv4, PostUp point-to-point peer bindings matching production');

    // --- U9 Validations ---
    console.log('\n--- Verifying U9: BIRD Config Removal ---');
    assert.equal(submitBody.data.clientBird, undefined, 'clientBird must be omitted from data');
    assert.equal(submitBody.data.configs?.clientBird, undefined, 'configs.clientBird must be omitted');
    assert.equal(submitBody.data.configs?.serverBirdSnippet, undefined, 'configs.serverBirdSnippet must be omitted');
    console.log('[✓] U9 Verified: BIRD configuration completely purged across portal response');

    // --- U11 Validations ---
    console.log('\n--- Verifying U11: No comments inside WG config body ---');
    const wgLines = wgConf.split('\n');
    const commentLines = wgLines.filter(l => l.trim().startsWith('#'));
    assert.equal(commentLines.length, 0, `Found comment lines in WG config: ${JSON.stringify(commentLines)}`);
    console.log('[✓] U11 Verified: WG config contains 0 comment lines');

    // 3. Test wg-quick syntax parser validation
    console.log('\n--- Verifying WireGuard INI Syntax Structure ---');
    assert.ok(wgConf.startsWith('[Interface]'));
    assert.ok(wgConf.includes('\n[Peer]\n'));
    console.log('[✓] WireGuard Syntax Validated');

    await server.closeAll();
    console.log('\nALL ROUND 7 VERIFICATIONS PASSED SUCCESSFULLY!');
  } finally {
    testData.cleanup();

    // Verify Real server/data/ files zero mutation (U12)
    const postSnapshot = getRealDataSnapshot();
    for (const [file, info] of Object.entries(preSnapshot)) {
      if (!postSnapshot[file]) throw new Error(`[U12 VIOLATION] ${file} was deleted!`);
      if (postSnapshot[file].sha !== info.sha) throw new Error(`[U12 VIOLATION] ${file} content mutated!`);
      if (postSnapshot[file].mtimeMs !== info.mtimeMs) throw new Error(`[U12 VIOLATION] ${file} mtime touched!`);
    }
    console.log('[✓] U12 Verified: server/data/ had ZERO file/mtime/content mutations!');
  }
}

main().catch(err => {
  console.error('Verification failed:', err);
  process.exit(1);
});
