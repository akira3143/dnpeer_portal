import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AuthService,
  hashPassword,
  verifyPassword,
  hashPasswordAsync,
  verifyPasswordAsync
} from '../../server/services/authService.js';
import { getAuthJwtSecret, ENV } from '../../server/config.js';
import { ScannerService } from '../../server/services/scannerService.js';
import { createIsolatedTestDataDir } from '../fixtures/tmpDataDir.js';

test('Security Hardening & Secondary Issues: Async Scrypt, Rate Limiting & JWT Secret', async (t) => {
  const { tmpDir, cleanup } = createIsolatedTestDataDir('dn42-sec-secondary-');
  t.after(() => cleanup());

  await t.test('1. hashPasswordAsync and verifyPasswordAsync function properly non-blocking', async () => {
    const pass = 'superSecretPassword123!';
    const { salt, hash } = await hashPasswordAsync(pass);

    assert.ok(salt && typeof salt === 'string');
    assert.ok(hash && typeof hash === 'string');

    // Matching password verifies successfully
    const isMatch = await verifyPasswordAsync(pass, salt, hash);
    assert.equal(isMatch, true);

    // Wrong password fails
    const isWrong = await verifyPasswordAsync('wrongPassword', salt, hash);
    assert.equal(isWrong, false);

    // Empty/missing parameters fail gracefully
    assert.equal(await verifyPasswordAsync('', salt, hash), false);
    assert.equal(await verifyPasswordAsync(pass, '', hash), false);
    assert.equal(await verifyPasswordAsync(pass, salt, ''), false);
  });

  await t.test('2. Synchronous hashPassword and verifyPassword remain backward compatible', () => {
    const pass = 'syncCompatPassword123!';
    const { salt, hash } = hashPassword(pass);

    assert.ok(salt && hash);
    assert.equal(verifyPassword(pass, salt, hash), true);
    assert.equal(verifyPassword('wrong', salt, hash), false);
  });

  await t.test('3. Password login enforces 5-attempt rate limit and 60s temporary lockout', async () => {
    const testAsn = 4242429999;
    AuthService.resetPasswordAttempts(testAsn);

    // Setup temporary user in authUsers
    const authUsers = await AuthService.getAuthUsers();
    const { salt, hash } = await hashPasswordAsync('correctPassword123');
    authUsers[String(testAsn)] = {
      asn: testAsn,
      asName: `AS${testAsn}`,
      role: 'user',
      salt,
      hash
    };
    await AuthService.saveAuthUsers(authUsers);

    try {
      // 4 consecutive failed attempts should return 'Invalid username or password'
      for (let i = 1; i <= 4; i++) {
        const res = await AuthService.loginWithPassword({
          username: testAsn,
          password: 'wrongPassword'
        });
        assert.equal(res.success, false);
        assert.equal(res.error, 'Invalid username or password');
      }

      // 5th failed attempt should trigger lockout
      const res5 = await AuthService.loginWithPassword({
        username: testAsn,
        password: 'wrongPassword'
      });
      assert.equal(res5.success, false);
      assert.match(res5.error, /temporarily locked/i);

      // 6th attempt (even with correct password) is blocked by lockout
      const res6 = await AuthService.loginWithPassword({
        username: testAsn,
        password: 'correctPassword123'
      });
      assert.equal(res6.success, false);
      assert.match(res6.error, /temporarily locked/i);

      // Reset lockout and verify correct password succeeds
      AuthService.resetPasswordAttempts(testAsn);
      const resSuccess = await AuthService.loginWithPassword({
        username: testAsn,
        password: 'correctPassword123'
      });
      assert.equal(resSuccess.success, true);
      assert.equal(resSuccess.data.asn, testAsn);
    } finally {
      // Cleanup test user
      const users = await AuthService.getAuthUsers();
      delete users[String(testAsn)];
      await AuthService.saveAuthUsers(users);
      AuthService.resetPasswordAttempts(testAsn);
    }
  });

  await t.test('4. Production mode generates ephemeral random JWT secret when unconfigured', () => {
    const origEnv = process.env.NODE_ENV;
    const origSecret = process.env.AUTH_JWT_SECRET;

    try {
      delete process.env.AUTH_JWT_SECRET;
      process.env.NODE_ENV = 'production';

      const secret = getAuthJwtSecret();
      assert.ok(secret);
      assert.notEqual(secret, 'dev-insecure-secret-placeholder-please-set-auth-jwt-secret');
      assert.equal(secret.length, 64, 'Should be 32-byte hex (64 chars)');

      // In dev/test mode with no secret, falls back to dev placeholder
      process.env.NODE_ENV = 'development';
      const devSecret = getAuthJwtSecret();
      assert.equal(devSecret, 'dev-insecure-secret-placeholder-please-set-auth-jwt-secret');
    } finally {
      if (origEnv !== undefined) process.env.NODE_ENV = origEnv;
      else delete process.env.NODE_ENV;
      if (origSecret !== undefined) process.env.AUTH_JWT_SECRET = origSecret;
      else delete process.env.AUTH_JWT_SECRET;
    }
  });

  await t.test('5. ScannerService.performMasterSync operates non-blocking with mock or empty env', async () => {
    // Should complete cleanly without hanging
    const res = await ScannerService.performMasterSync({
      mockWgOutput: '',
      mockSsOutput: '',
      mockBgpOutput: '',
      mockConfigPeers: {}
    });
    assert.ok(res);
    assert.equal(res.peersUpdated, 0);
  });
});
