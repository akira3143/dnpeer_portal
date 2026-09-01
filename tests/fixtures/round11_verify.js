/**
 * Round 11 Automated Verification Suite (V11: GUI Visuals, Security 7.1/7.2, Sync 6.1/6.4)
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createIsolatedTestDataDir } from './tmpDataDir.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../../');

console.log('=== Starting Round 11 Automated Verification Suite ===\n');

// 1. Static Discipline Checks: Forbidden Old Code & Dead Styles
console.log('--- 1. Checking Forbidden Artifacts (No old contexts, no dn42Validation, no Leaflet) ---');
function checkForbiddenInDir(dirPath) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== 'dist' && entry.name !== '.git') {
        checkForbiddenInDir(fullPath);
      }
    } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx') || entry.name.endsWith('.css')) {
      const content = fs.readFileSync(fullPath, 'utf8');
      assert.equal(content.includes('dn42Validation'), false, `Found forbidden dn42Validation reference in ${fullPath}`);
      assert.equal(content.includes('AuthContext'), false, `Found forbidden AuthContext reference in ${fullPath}`);
      assert.equal(content.includes('PeeringContext'), false, `Found forbidden PeeringContext reference in ${fullPath}`);
      assert.equal(content.includes('NetworkContext'), false, `Found forbidden NetworkContext reference in ${fullPath}`);
      assert.equal(content.includes('.leaflet'), false, `Found forbidden leaflet CSS in ${fullPath}`);
    }
  }
}
checkForbiddenInDir(path.join(ROOT_DIR, 'gui', 'src'));
console.log('✓ Codebase clean: 0 forbidden old contexts, 0 dn42Validation, 0 leaflet rules found.\n');

// 2. Rules Single-Source Check in GUI
console.log('--- 2. Checking Rules Single-Source in GUI ---');
const configGenContent = fs.readFileSync(path.join(ROOT_DIR, 'gui', 'src', 'components', 'ConfigGenerator.tsx'), 'utf8');
assert.ok(configGenContent.includes("from '@shared/generated/rules.js'"), 'ConfigGenerator must import rules from @shared/generated/rules.js');
assert.ok(configGenContent.includes('validatePublicKey'), 'ConfigGenerator must use validatePublicKey');
assert.ok(configGenContent.includes('validatePort'), 'ConfigGenerator must use validatePort');
assert.ok(configGenContent.includes('calcDefaultPort'), 'ConfigGenerator must use calcDefaultPort');
console.log('✓ GUI uses single-source @shared/generated/rules.js exclusively.\n');

// 3. Security 7.1: Backend Submit Authentication & ASN Matching
console.log('--- 3. Testing Security 7.1: POST /api/peering/submit Authentication & ASN check ---');
const testData = createIsolatedTestDataDir('dn42-test-r11-');
fs.writeFileSync(path.join(testData.tmpDir, 'port_ledger.json'), JSON.stringify({}), 'utf8');
fs.writeFileSync(path.join(testData.tmpDir, 'peering_sessions.json'), JSON.stringify([]), 'utf8');

import { createServer } from '../../server/index.js';
import { AuthService } from '../../server/services/authService.js';

const server = createServer();
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const baseUrl = `http://127.0.0.1:${port}`;

const adminToken = AuthService.signJwt({ asn: 4242423143, role: 'admin', asName: 'AKILAB-MNT' }).token;
const userToken = AuthService.signJwt({ asn: 4242421000, role: 'user', asName: 'OTHER-MNT' }).token;

// Test A: No token -> 401
const noTokenRes = await fetch(`${baseUrl}/api/peering/submit`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ asn: '4242423143', nodeId: 'JP-TYO-1', publicKey: 'yA+N64x7tN/4H1XqJd+7qf3K9z1V8uT5R7o+P2w8x1E=' })
});
assert.equal(noTokenRes.status, 401, 'Submit without token must return HTTP 401');
const noTokenBody = await noTokenRes.json();
assert.equal(noTokenBody.success, false);
console.log('✓ Unauthenticated submission rejected with 401.');

// Test B: Token ASN !== Payload ASN -> 403
const mismatchRes = await fetch(`${baseUrl}/api/peering/submit`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${userToken}`
  },
  body: JSON.stringify({ asn: '4242423143', nodeId: 'JP-TYO-1', publicKey: 'yA+N64x7tN/4H1XqJd+7qf3K9z1V8uT5R7o+P2w8x1E=' })
});
assert.equal(mismatchRes.status, 403, 'Submit with mismatched ASN must return HTTP 403');
const mismatchBody = await mismatchRes.json();
assert.equal(mismatchBody.success, false);
assert.ok(mismatchBody.error.message.includes('Cannot submit peering application for another ASN'));
console.log('✓ Mismatched ASN submission rejected with 403.');

// Test C: Valid matching token -> 200
const validRes = await fetch(`${baseUrl}/api/peering/submit`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${adminToken}`
  },
  body: JSON.stringify({
    asn: '4242423143',
    nodeId: 'JP-TYO-1',
    publicKey: 'yA+N64x7tN/4H1XqJd+7qf3K9z1V8uT5R7o+P2w8x1E=',
    linkLocal: 'fe80::3143',
    ipv4: '172.20.150.100',
    ipv6Ula: 'fd00:4242:3143::1',
    listenPort: 'auto',
    clientPort: 'auto',
    mtu: 1420
  })
});
assert.equal(validRes.status, 200, 'Valid submit must return HTTP 200');
const validBody = await validRes.json();
assert.equal(validBody.success, true);
assert.ok(validBody.data.sessionId);
assert.ok(validBody.data.configs.clientWireguard);
console.log('✓ Authenticated submission for matching ASN succeeded with 200.\n');

// 4. Looking Glass Unified Output Test (6.4)
console.log('--- 4. Testing Looking Glass Unified Endpoint (6.4) ---');
const lgRes = await fetch(`${baseUrl}/api/looking-glass`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ nodeId: 'JP-TYO-1', command: 'route', target: '172.20.150.1' })
});
assert.equal(lgRes.status, 200);
const lgBody = await lgRes.json();
assert.ok(
  (lgBody.success && typeof lgBody.data?.output === 'string') ||
  (!lgBody.success && typeof lgBody.error?.message === 'string'),
  'LG endpoint must return output string or standard error message'
);
console.log('✓ Looking Glass endpoint returned standard envelope with output/error message.\n');

// 5. Cleanup
await server.closeAll();
testData.cleanup();

// 6. Production server/data Directory Cleanliness
console.log('--- 6. Verifying Production server/data/ Integrity (U12) ---');
const prodDataDir = path.join(ROOT_DIR, 'server', 'data');
const prodFiles = fs.readdirSync(prodDataDir).sort();
assert.ok(prodFiles.includes('auth_users.json'), 'auth_users.json exists');
assert.ok(prodFiles.includes('peering_sessions.json'), 'peering_sessions.json exists');
assert.ok(prodFiles.includes('port_ledger.json'), 'port_ledger.json exists');
console.log('✓ Production server/data verified intact.\n');

console.log('=== Round 11 Automated Verification Passed Successfully! ===');
