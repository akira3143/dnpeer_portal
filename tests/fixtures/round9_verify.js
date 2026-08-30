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
const testData = createIsolatedTestDataDir('dn42-test-round9-');

import { createServer } from '../../server/index.js';
import { validateAsn, validateIpv4, validateEndpoint } from '../../server/utils/validator.js';

async function main() {
  try {
    console.log('=== 1. Testing U16: Zero-fork read_line_edit in dn42-lib.sh ===');
    const libContent = fs.readFileSync(path.resolve('cli/cli-src/etc/dn42-lib.sh'), 'utf8');
    const readLineEditBody = libContent.slice(libContent.indexOf('read_line_edit()'));
    
    assert.ok(!readLineEditBody.includes('dd bs=1'), 'read_line_edit must not contain dd');
    assert.ok(!readLineEditBody.includes('head -c'), 'read_line_edit must not contain head');
    assert.ok(readLineEditBody.includes('read -r -n 1'), 'read_line_edit must use built-in read -r -n 1');
    console.log('[✓] U16 Confirmed: read_line_edit uses zero-fork built-in read -r -n 1');

    console.log('\n=== 2. Testing U17: DN42 Business Legitimacy Rules ===');
    
    // (A) ASN Validation
    assert.equal(validateAsn('4242423143').valid, true);
    assert.equal(validateAsn('AS4242420001').valid, true);
    assert.equal(validateAsn('64512').valid, true);
    assert.equal(validateAsn('15169').valid, false, 'Public ASN 15169 must be rejected');
    assert.equal(validateAsn('12345').valid, false, 'Public ASN 12345 must be rejected');
    assert.equal(validateAsn('4242430000').valid, false, 'Non-DN42 424243xxxx must be rejected');
    console.log('[✓] U17 ASN Rules verified');

    // (B) IPv4 DN42 Subnet Validation
    assert.equal(validateIpv4('172.20.150.1').valid, true);
    assert.equal(validateIpv4('172.23.10.1/32').valid, true);
    assert.equal(validateIpv4('10.0.0.1').valid, true);
    assert.equal(validateIpv4('1.1.1.1').valid, false, 'Public IPv4 1.1.1.1 must be rejected');
    assert.equal(validateIpv4('8.8.8.8').valid, false, 'Public IPv4 8.8.8.8 must be rejected');
    assert.equal(validateIpv4('192.168.1.1').valid, false, 'LAN 192.168.x.x must be rejected');
    console.log('[✓] U17 IPv4 Subnet Rules verified');

    // (C) Endpoint Validation
    assert.equal(validateEndpoint('myhost.dn42').valid, true);
    assert.equal(validateEndpoint('jp1.akilab.dn42').valid, true);
    assert.equal(validateEndpoint('http://myhost.dn42').valid, false, 'http:// prefix must be rejected');
    assert.equal(validateEndpoint('https://myhost.dn42').valid, false, 'https:// prefix must be rejected');
    assert.equal(validateEndpoint('myhost.dn42:23143').valid, false, 'Port suffix must be rejected');
    console.log('[✓] U17 Endpoint Syntax Rules verified');

    console.log('\n=== 3. Starting Test Server on Port 4252 for End-to-End API Interception ===');
    const server = createServer();
    await new Promise(r => server.listen(4252, '127.0.0.1', r));

    const { AuthService } = await import('../../server/services/authService.js');
    const token = AuthService.signJwt({ asn: 4242423143, asName: 'AKILAB-MNT', role: 'admin' }).token;

    // Reject Public ASN
    const badAsnRes = await fetch('http://127.0.0.1:4252/api/peering/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({
        asn: '15169',
        nodeId: 'JP-TYO-1',
        publicKey: 'yA+N64x7tN/4H1XqJd+7qf3K9z1V8uT5R7o+P2w8x1E=',
        linkLocal: 'fe80::3143'
      })
    });
    const badAsnBody = await badAsnRes.json();
    assert.equal(badAsnBody.success, false);
    assert.ok(badAsnBody.error?.fieldErrors?.asn, 'Server must reject public ASN 15169');
    console.log('[✓] Server rejected public ASN submission');

    // Reject Public IPv4
    const badIpRes = await fetch('http://127.0.0.1:4252/api/peering/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({
        asn: '4242423143',
        nodeId: 'JP-TYO-1',
        publicKey: 'yA+N64x7tN/4H1XqJd+7qf3K9z1V8uT5R7o+P2w8x1E=',
        linkLocal: 'fe80::3143',
        ipv4: '1.1.1.1'
      })
    });
    const badIpBody = await badIpRes.json();
    assert.equal(badIpBody.success, false);
    assert.ok(badIpBody.error?.fieldErrors?.ipv4, 'Server must reject public IPv4 1.1.1.1');
    console.log('[✓] Server rejected public IPv4 submission');

    // Reject Bad Endpoint
    const badEpRes = await fetch('http://127.0.0.1:4252/api/peering/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({
        asn: '4242423143',
        nodeId: 'JP-TYO-1',
        publicKey: 'yA+N64x7tN/4H1XqJd+7qf3K9z1V8uT5R7o+P2w8x1E=',
        linkLocal: 'fe80::3143',
        endpoint: 'http://myhost.dn42'
      })
    });
    const badEpBody = await badEpRes.json();
    assert.equal(badEpBody.success, false);
    assert.ok(badEpBody.error?.fieldErrors?.endpoint, 'Server must reject endpoint with http://');
    console.log('[✓] Server rejected invalid endpoint submission');

    await server.closeAll();
    console.log('\nALL ROUND 9 AUTOMATED VERIFICATIONS PASSED SUCCESSFULLY!');
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
