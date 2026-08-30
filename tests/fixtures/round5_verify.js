import assert from 'node:assert/strict';
import { createServer } from '../../server/index.js';
import { AuthService } from '../../server/services/authService.js';
import { LookingGlassService } from '../../server/services/lookingGlassService.js';
import { ScannerService } from '../../server/services/scannerService.js';

async function main() {
  console.log('=== 1. Starting Test Server on Port 4247 ===');
  const server = createServer();
  await new Promise(r => server.listen(4247, '127.0.0.1', r));

  // --- Test R1: Dual Port Submission & Config Output ---
  console.log('\n=== 2. Testing R1: Dual Port Submission & Config Engine Outputs ===');
  
  // (A) auto + auto
  const resAuto = await fetch('http://127.0.0.1:4247/api/peering/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      asn: '4242423143',
      nodeId: 'JP-TYO-1',
      publicKey: 'yA+N64x7tN/4H1XqJd+7qf3K9z1V8uT5R7o+P2w8x1E=',
      linkLocal: 'fe80::4242:3143',
      listenPort: 'auto',
      clientPort: 'auto'
    })
  });
  const bodyAuto = await resAuto.json();
  assert.equal(bodyAuto.success, true);
  console.log('[R1-A auto+auto] Client WG Config ListenPort present:', bodyAuto.data.configs.clientWireguard.includes('ListenPort ='));
  assert.equal(bodyAuto.data.configs.clientWireguard.includes('ListenPort ='), false);

  // (B) custom clientPort = 51820
  const resCustomClient = await fetch('http://127.0.0.1:4247/api/peering/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      asn: '4242423143',
      nodeId: 'JP-TYO-1',
      publicKey: 'yA+N64x7tN/4H1XqJd+7qf3K9z1V8uT5R7o+P2w8x1E=',
      linkLocal: 'fe80::4242:3143',
      listenPort: 'auto',
      clientPort: 51820
    })
  });
  const bodyCustomClient = await resCustomClient.json();
  assert.equal(bodyCustomClient.success, true);
  console.log('[R1-B custom clientPort 51820] Client WG Config has ListenPort = 51820:', bodyCustomClient.data.configs.clientWireguard.includes('ListenPort = 51820'));
  assert.ok(bodyCustomClient.data.configs.clientWireguard.includes('ListenPort = 51820'));

  // (C) custom server listenPort = 24500
  const resCustomServer = await fetch('http://127.0.0.1:4247/api/peering/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      asn: '4242423143',
      nodeId: 'JP-TYO-1',
      publicKey: 'yA+N64x7tN/4H1XqJd+7qf3K9z1V8uT5R7o+P2w8x1E=',
      linkLocal: 'fe80::4242:3143',
      listenPort: 24500,
      clientPort: 'auto'
    })
  });
  const bodyCustomServer = await resCustomServer.json();
  assert.equal(bodyCustomServer.success, true);
  console.log('[R1-C custom listenPort 24500] Server allocated port:', bodyCustomServer.data.port);
  assert.equal(bodyCustomServer.data.port, 24500);

  // --- Test R4: Looking Glass error when unreachable ---
  console.log('\n=== 3. Testing R4: Looking Glass Unreachable Error (No fake BIRD) ===');
  const lgRes = await fetch('http://127.0.0.1:4247/api/looking-glass', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nodeId: 'JP-TYO-1', command: 'status' })
  });
  const lgBody = await lgRes.json();
  console.log('[R4 LG Response] success:', lgBody.success);
  console.log('[R4 LG Error Message]:', lgBody.error?.message);
  assert.equal(lgBody.success, false);
  assert.ok(lgBody.error?.message?.includes('lgproxy'));

  // --- Test M6: 301 Redirect /gui -> /gui/ ---
  console.log('\n=== 4. Testing M6: 301 Redirect for /gui (no trailing slash) ===');
  const guiRes = await fetch('http://127.0.0.1:4247/gui', { redirect: 'manual' });
  console.log('[M6 Status]:', guiRes.status);
  console.log('[M6 Location]:', guiRes.headers.get('location'));
  assert.equal(guiRes.status, 301);
  assert.equal(guiRes.headers.get('location'), '/gui/');

  // Access /gui/ (with trailing slash) returns 200 index.html
  const guiSlashRes = await fetch('http://127.0.0.1:4247/gui/');
  console.log('[M6 /gui/ Status]:', guiSlashRes.status);
  assert.equal(guiSlashRes.status, 200);

  // Clean up
  await server.closeAll();
  console.log('\nALL ROUND 5 VERIFICATIONS PASSED SUCCESSFULLY!');
}

main().catch(err => {
  console.error('Verification failed:', err);
  process.exit(1);
});
