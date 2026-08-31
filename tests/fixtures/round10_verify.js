import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createIsolatedTestDataDir } from './tmpDataDir.js';

// 1. Data Isolation Guard (U12 / V4)
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
const testData = createIsolatedTestDataDir('dn42-test-round10-');

// Seed test user AS4141410001 in isolated testData
const authUsersPath = path.join(testData.tmpDir, 'auth_users.json');
const authUsers = JSON.parse(fs.readFileSync(authUsersPath, 'utf8'));
authUsers['4141410001'] = {
  asn: 4141410001,
  asName: 'TEST-MNT',
  role: 'user',
  salt: '5584a850a891a1bc9a005a803df75e28',
  hash: '1107558c0fe7f3006eca67673933728113dc60be810fd9fc41a5caa94a5129b64f157204fc99a1462e945200dc709a7225e268d5d2bc3c6c452f36f84fbc7a10',
  createdAt: new Date().toISOString()
};
fs.writeFileSync(authUsersPath, JSON.stringify(authUsers, null, 2), 'utf8');

import { createServer } from '../../server/index.js';
import { RULES, validatePort } from '../../server/utils/validator.js';

async function main() {
  try {
    console.log('=== 1. Testing V1: Rules & Port Range Sync (RULES.port.min = 20000) ===');
    assert.equal(RULES.port.min, 20000, 'RULES.port.min must be 20000');
    assert.equal(validatePort(20000).valid, true);
    assert.equal(validatePort(65535).valid, true);
    assert.equal(validatePort(19999).valid, false, 'Port < 20000 must be rejected');
    console.log('[✓] V1: Port range sync verified (20000..65535)');

    console.log('\n=== 2. Testing V1: Template and Peer Script Integrity ===');
    const templateContent = fs.readFileSync(path.resolve('cli/cli-src/etc/peer_template'), 'utf8');
    assert.ok(templateContent.includes('Node=__NODE__'), 'Template must include Node=__NODE__');
    assert.ok(templateContent.includes('Link-Local IPv6 (LLA)=__LLA__'), 'Template must include Link-Local IPv6 (LLA)=__LLA__');
    assert.ok(templateContent.includes('WireGuard Public Key='), 'Template must include WireGuard Public Key=');
    assert.ok(templateContent.includes('PeerPort=auto'), 'Template must include PeerPort=auto');
    assert.ok(templateContent.includes('ListenPort=auto'), 'Template must include ListenPort=auto');
    assert.ok(templateContent.includes('custom: 20000-65535'), 'Template comments must specify custom: 20000-65535');
    console.log('[✓] V1: Template format verified');

    const peerBinContent = fs.readFileSync(path.resolve('cli/cli-src/bin/peer'), 'utf8');
    assert.ok(!peerBinContent.includes('while true; do\n      printf "Your IPv6 Link-Local'), 'No per-field while loops');
    assert.ok(peerBinContent.includes('nano "$draft_file"') || peerBinContent.includes('/bin/nano "$draft_file"'), 'Must auto-launch nano');
    assert.ok(peerBinContent.includes('payload='), 'Must construct payload');
    assert.ok(peerBinContent.includes('listenPort\\":\\"$parsed_peer_port'), 'Cross mapping: PeerPort -> listenPort');
    assert.ok(peerBinContent.includes('clientPort\\":\\"$parsed_listen_port'), 'Cross mapping: ListenPort -> clientPort');
    console.log('[✓] V1: Peer binary editor & cross-mapping verified');

    console.log('\n=== 3. Testing V3: ESC Timeout Optimization (0.05s) ===');
    const libContent = fs.readFileSync(path.resolve('cli/cli-src/etc/dn42-lib.sh'), 'utf8');
    assert.ok(libContent.includes('-t 0.05'), 'dn42-lib.sh must use 0.05s timeout for ESC sequence reading');
    console.log('[✓] V3: Standalone ESC 50ms timeout verified');

    console.log('\n=== 4. Testing V2: Test Account ASN Exemption on Server ===');
    const server = createServer();
    await new Promise(r => server.listen(4262, '127.0.0.1', r));

    // (A) Registered test account AS4141410001 must get challenge
    const testAccRes = await fetch('http://127.0.0.1:4262/api/auth/challenge?asn=4141410001');
    const testAccBody = await testAccRes.json();
    assert.equal(testAccBody.success, true, 'Registered test account AS4141410001 must get challenge');
    assert.equal(testAccBody.data.asn, 4141410001);
    console.log('[✓] V2: Registered test account AS4141410001 received challenge successfully');

    // (B) Unregistered public ASN (15169) must be rejected
    const unregRes = await fetch('http://127.0.0.1:4262/api/auth/challenge?asn=15169');
    const unregBody = await unregRes.json();
    assert.equal(unregBody.success, false, 'Unregistered public ASN 15169 must be rejected');
    console.log('[✓] V2: Unregistered public ASN 15169 was rejected as expected');

    // (C) Standard DN42 ASN (4242423143) must get challenge
    const dn42Res = await fetch('http://127.0.0.1:4262/api/auth/challenge?asn=4242423143');
    const dn42Body = await dn42Res.json();
    assert.equal(dn42Body.success, true, 'Standard DN42 ASN 4242423143 must get challenge');
    console.log('[✓] V2: Standard DN42 ASN 4242423143 received challenge successfully');

    await server.closeAll();
    console.log('\nALL ROUND 10 AUTOMATED VERIFICATIONS PASSED SUCCESSFULLY!');
  } finally {
    testData.cleanup();

    // Verify Real server/data/ files zero mutation (U12 / V4)
    const postSnapshot = getRealDataSnapshot();
    for (const [file, info] of Object.entries(preSnapshot)) {
      if (!postSnapshot[file]) throw new Error(`[V4 VIOLATION] ${file} was deleted!`);
      if (postSnapshot[file].sha !== info.sha) throw new Error(`[V4 VIOLATION] ${file} content mutated!`);
      if (postSnapshot[file].mtimeMs !== info.mtimeMs) throw new Error(`[V4 VIOLATION] ${file} mtime touched!`);
    }
    console.log('[✓] V4 Verified: server/data/ had ZERO file/mtime/content mutations!');
  }
}

main().catch(err => {
  console.error('Verification failed:', err);
  process.exit(1);
});
