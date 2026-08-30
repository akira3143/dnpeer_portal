import assert from 'node:assert/strict';
import { createServer } from '../../server/index.js';
import { SessionService } from '../../server/services/sessionService.js';

async function main() {
  console.log('=== 1. Starting Test Server on Port 4248 ===');
  const server = createServer();
  await new Promise(r => server.listen(4248, '127.0.0.1', r));

  // Get Admin token
  const loginRes = await fetch('http://127.0.0.1:4248/api/auth/login-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: '4242423143', password: 'test12345' })
  });
  const loginBody = await loginRes.json();
  const token = loginBody.data.token;
  console.log('[Auth] Logged in AS4242423143 with role:', loginBody.data.role);

  // Clear any existing session for clean test
  await SessionService.deleteSession('sess_4242423143_jp_tyo_1', 4242423143, true);
  await SessionService.deleteSession('peer_akira_jp_tyo_1', 4242423143, true);

  // 1. Submit Peering -> Verify U2 Session ID format (peer_akira_jp_tyo_1)
  console.log('\n=== 2. Testing U2: Session ID with Maintainer Handle ===');
  const submitRes = await fetch('http://127.0.0.1:4248/api/peering/submit', {
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
      endpoint: 'myhost.dn42',
      listenPort: 'auto',
      clientPort: 'auto'
    })
  });
  const submitBody = await submitRes.json();
  assert.equal(submitBody.success, true);
  console.log('[U2 Session ID]:', submitBody.data.sessionId);
  assert.equal(submitBody.data.sessionId, 'peer_akira_jp_tyo_1');

  // Verify U5 Config Finished Products present
  console.log('\n=== 3. Testing U5: Config Finished Products in Submit Response ===');
  console.log('[U5 WG Config Length]:', submitBody.data.clientWireguard?.length);
  console.log('[U5 BIRD Config Length]:', submitBody.data.clientBird?.length);
  assert.ok(submitBody.data.clientWireguard?.includes('[Interface]'));
  assert.ok(submitBody.data.clientBird?.includes('protocol bgp'));

  // 2. Test U1: POST /api/sessions/remove
  console.log('\n=== 4. Testing U1: POST /api/sessions/remove ===');
  const removeRes = await fetch('http://127.0.0.1:4248/api/sessions/remove', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({ sessionId: submitBody.data.sessionId })
  });
  const removeBody = await removeRes.json();
  console.log('[U1 Remove Status]:', removeBody.success, removeBody.data?.message);
  assert.equal(removeBody.success, true);

  // Test Non-existent Session Revoke
  const removeNonExistent = await fetch('http://127.0.0.1:4248/api/sessions/remove', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({ sessionId: 'peer_nonexistent_node' })
  });
  const nonExistentBody = await removeNonExistent.json();
  console.log('[U1 Non-existent error]:', nonExistentBody.error?.message);
  assert.equal(nonExistentBody.success, false);
  assert.equal(nonExistentBody.error?.message, 'Session not found');

  await server.closeAll();
  console.log('\nALL ROUND 6 VERIFICATIONS PASSED SUCCESSFULLY!');
}

main().catch(err => {
  console.error('Verification failed:', err);
  process.exit(1);
});
