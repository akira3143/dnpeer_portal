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
const testData = createIsolatedTestDataDir('dn42-test-round8-');

import { createServer } from '../../server/index.js';
import { validateLinkLocal, formatDefaultLinkLocal } from '../../server/utils/validator.js';

async function main() {
  try {
    console.log('=== 1. Starting Test Server on Port 4250 ===');
    const server = createServer();
    await new Promise(r => server.listen(4250, '127.0.0.1', r));

    // Get Admin Token
    const loginRes = await fetch('http://127.0.0.1:4250/api/auth/login-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: '4242423143', password: 'test12345' })
    });
    const loginBody = await loginRes.json();
    assert.equal(loginBody.success, true);
    const token = loginBody.data.token;
    console.log('[Auth] Admin logged in successfully');

    // --- U14 Validations ---
    console.log('\n=== 2. Testing U14: Link-Local Default & Tightened Validation ===');
    
    // (A) Default formatting rule
    const defLla = formatDefaultLinkLocal('4242423143');
    console.log('[U14 Default LLA for 4242423143]:', defLla);
    assert.equal(defLla, 'fe80::3143', 'Default LLA must format to last 4 digits (fe80::3143)');

    // (B) Tightened validator rules
    assert.equal(validateLinkLocal('fe80::3143').valid, true);
    assert.equal(validateLinkLocal('fe80::4242:3143').valid, true);
    assert.equal(validateLinkLocal('fe80::3143/64').valid, true);
    assert.equal(validateLinkLocal('fe80::4242423143').valid, false, 'fe80::4242423143 must be rejected');
    assert.equal(validateLinkLocal('fe80::12345').valid, false, 'Hextet with >4 hex digits must be rejected');
    console.log('[✓] U14 Validator tightened rules confirmed');

    // (C) Peering submission with invalid LLA is rejected
    const invalidLlaRes = await fetch('http://127.0.0.1:4250/api/peering/submit', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        asn: '4242423143',
        nodeId: 'JP-TYO-1',
        publicKey: 'yA+N64x7tN/4H1XqJd+7qf3K9z1V8uT5R7o+P2w8x1E=',
        linkLocal: 'fe80::4242423143',
        listenPort: 'auto',
        clientPort: 'auto'
      })
    });
    const invalidLlaBody = await invalidLlaRes.json();
    assert.equal(invalidLlaBody.success, false);
    assert.ok(invalidLlaBody.error?.fieldErrors?.linkLocal, 'Invalid LLA fe80::4242423143 must trigger fieldError');
    console.log('[✓] U14 Server rejected invalid LLA fe80::4242423143 with:', invalidLlaBody.error.fieldErrors.linkLocal);

    // (D) Peering submission with valid default LLA fe80::3143 succeeds
    const validLlaRes = await fetch('http://127.0.0.1:4250/api/peering/submit', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        asn: '4242423143',
        nodeId: 'JP-TYO-1',
        publicKey: 'yA+N64x7tN/4H1XqJd+7qf3K9z1V8uT5R7o+P2w8x1E=',
        linkLocal: 'fe80::3143',
        listenPort: 'auto',
        clientPort: 'auto'
      })
    });
    const validLlaBody = await validLlaRes.json();
    assert.equal(validLlaBody.success, true);
    assert.ok(validLlaBody.data.clientWireguard.includes('fe80::3143/64'), 'Config must contain fe80::3143/64');
    console.log('[✓] U14 Valid LLA peering submitted successfully with fe80::3143/64 in wg0.conf');

    await server.closeAll();
    console.log('\nALL ROUND 8 AUTOMATED VERIFICATIONS PASSED SUCCESSFULLY!');
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
