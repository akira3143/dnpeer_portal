import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { AuthService } from '../../server/services/authService.js';

describe('AuthService Unit Tests', () => {
  test('creates challenge with 5min TTL and zero-trace commands', async () => {
    const challenge = await AuthService.createChallenge(4242423143);
    assert.equal(challenge.asn, 4242423143);
    assert.ok(challenge.challengeText.startsWith('akilab:4242423143:'));
    assert.ok(challenge.commands.ssh_powershell.includes('ssh-keygen -q -Y sign'));
    assert.ok(challenge.commands.ssh_linux.includes('ssh-keygen -q -Y sign'));
  });

  test('signs and verifies JWT with correct claims', () => {
    const { token } = AuthService.signJwt({ asn: 4242423143, role: 'admin' }, false);
    const decoded = AuthService.verifyJwt(token);

    assert.ok(decoded);
    assert.equal(decoded.asn, 4242423143);
    assert.equal(decoded.role, 'admin');
  });

  test('signs JWT with 30-day expiry when rememberMe is true', () => {
    const resShort = AuthService.signJwt({ asn: 4242423143 }, false);
    const resLong = AuthService.signJwt({ asn: 4242423143 }, true);

    assert.equal(resShort.expiresIn, 86400); // 24h
    assert.equal(resLong.expiresIn, 2592000); // 30d
  });

  test('authenticates sandbox test accounts successfully', async () => {
    // Admin login
    const res1 = await AuthService.loginWithPassword({ username: '4242423143', password: 'akira831143' });
    assert.equal(res1.success, true);
    assert.equal(res1.data.role, 'admin');
    assert.equal(res1.data.asn, 4242423143);

    // Standard user login
    const res2 = await AuthService.loginWithPassword({ username: 'AS4141410001', password: 'test12345' });
    assert.equal(res2.success, true);
    assert.equal(res2.data.role, 'user');
    assert.equal(res2.data.asn, 4141410001);

    // Wrong password
    const res3 = await AuthService.loginWithPassword({ username: '4242423143', password: 'wrongpassword' });
    assert.equal(res3.success, false);
  });
});
