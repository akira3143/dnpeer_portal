import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dn42-test-auth-'));
process.env.PORTAL_DATA_DIR = testDataDir;

import { AuthService, hashPassword, verifyPassword } from '../../server/services/authService.js';
import { createTestUsers } from '../fixtures/testUsers.js';

test('AuthService Unit Tests', async (t) => {
  // Setup test users & registry cache in isolated testDataDir
  const testUsers = createTestUsers();
  await AuthService.saveAuthUsers(testUsers);

  // Generate temporary real ed25519 keypair for test
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ssh-auth-test-'));
  const testKeyPath = path.join(tempDir, 'id_ed25519');
  execFileSync('ssh-keygen', ['-t', 'ed25519', '-f', testKeyPath, '-N', '']);
  const testPubKey = fs.readFileSync(testKeyPath + '.pub', 'utf8').trim();

  // Setup mock registry repository structure in testDataDir/registry
  const mockRegistryDir = path.join(testDataDir, 'registry');
  fs.mkdirSync(path.join(mockRegistryDir, '.git'), { recursive: true });
  fs.mkdirSync(path.join(mockRegistryDir, 'data', 'aut-num'), { recursive: true });
  fs.mkdirSync(path.join(mockRegistryDir, 'data', 'auth'), { recursive: true });

  fs.writeFileSync(path.join(mockRegistryDir, 'data', 'aut-num', 'AS4242423143'), `
aut-num:    AS4242423143
as-name:    AKILAB-MNT
mnt-by:     AKILAB-MNT
admin-c:    AKIRA-DN42
`);
  fs.writeFileSync(path.join(mockRegistryDir, 'data', 'auth', 'AKILAB-MNT'), `
mntner:     AKILAB-MNT
auth:       ${testPubKey}
`);

  fs.writeFileSync(path.join(mockRegistryDir, 'data', 'aut-num', 'AS4141410001'), `
aut-num:    AS4141410001
as-name:    TEST-AS1
mnt-by:     TEST-AS1-MNT
`);
  fs.writeFileSync(path.join(mockRegistryDir, 'data', 'auth', 'TEST-AS1-MNT'), `
mntner:     TEST-AS1-MNT
auth:       ${testPubKey}
`);

  fs.writeFileSync(path.join(mockRegistryDir, 'data', 'aut-num', 'AS4141410002'), `
aut-num:    AS4141410002
as-name:    TEST-AS2-NOKEYS
mnt-by:     TEST-AS2-MNT
`);
  fs.writeFileSync(path.join(mockRegistryDir, 'data', 'auth', 'TEST-AS2-MNT'), `
mntner:     TEST-AS2-MNT
descr:      No keys registered
`);

  t.after(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
    try {
      fs.rmSync(testDataDir, { recursive: true, force: true });
    } catch {}
  });

  await t.test('creates challenge with 5min TTL and flat/nested zero-trace commands', async () => {
    const challenge = await AuthService.createChallenge(4242423143);
    assert.equal(challenge.asn, 4242423143);
    assert.ok(challenge.challengeText.startsWith('akilab:4242423143:'));
    assert.equal(challenge.expiresInSeconds, 300);
    // Flat command fields (N2)
    assert.ok(challenge.commandLinux);
    assert.ok(challenge.commandPowershell);
    assert.equal(challenge.commandLinux, challenge.commands.ssh_linux);
    assert.equal(challenge.commandPowershell, challenge.commands.ssh_powershell);
    assert.ok(challenge.commandLinux.includes('ssh-keygen'));
    assert.ok(challenge.commandPowershell.includes('ssh-keygen'));
  });

  await t.test('signs and verifies JWT with correct claims', () => {
    const payload = { asn: 4242423143, role: 'admin' };
    const { token, expiresIn } = AuthService.signJwt(payload, false);
    assert.equal(expiresIn, 86400);

    const verified = AuthService.verifyJwt(token);
    assert.equal(verified.asn, 4242423143);
    assert.equal(verified.role, 'admin');
  });

  await t.test('signs JWT with 30-day expiry when rememberMe is true', () => {
    const payload = { asn: 4242423143, role: 'admin' };
    const { expiresIn } = AuthService.signJwt(payload, true);
    assert.equal(expiresIn, 30 * 24 * 3600);
  });

  await t.test('scrypt password verification and setPassword update', async () => {
    // Authenticates test user
    const loginRes = await AuthService.loginWithPassword({
      username: '4242423143',
      password: 'test12345'
    });
    assert.equal(loginRes.success, true);
    assert.equal(loginRes.data.role, 'admin');

    // Rejects wrong password
    const wrongRes = await AuthService.loginWithPassword({
      username: '4242423143',
      password: 'wrongpassword'
    });
    assert.equal(wrongRes.success, false);

    // Updates password via setPassword
    const setRes = await AuthService.setPassword(4242423143, 'newsecretpassword123');
    assert.equal(setRes.success, true);

    const reLogin = await AuthService.loginWithPassword({
      username: '4242423143',
      password: 'newsecretpassword123'
    });
    assert.equal(reLogin.success, true);
  });

  await t.test('P0-1: SSH verification with real ed25519 signing and verification', async () => {
    // 1. Create Challenge
    const challenge = await AuthService.createChallenge(4242423143);

    // 2. Sign challenge message using OpenSSH ssh-keygen -Y sign
    const msgFile = path.join(tempDir, 'msg_to_sign.txt');
    fs.writeFileSync(msgFile, challenge.challengeText, 'utf8');
    execFileSync('ssh-keygen', ['-Y', 'sign', '-n', 'akilab', '-f', testKeyPath, msgFile]);
    const validSignature = fs.readFileSync(msgFile + '.sig', 'utf8');

    // 3. Verify real signature passes
    const verifyRes = await AuthService.verifySignature({
      asn: 4242423143,
      challengeText: challenge.challengeText,
      signature: validSignature
    });
    assert.equal(verifyRes.success, true, 'Valid signature must pass');
    assert.ok(verifyRes.data.token, 'Must issue JWT token');
    assert.equal(verifyRes.data.role, 'admin');

    // 4. Anti-replay test: Challenge is deleted after verification attempt
    const replayRes = await AuthService.verifySignature({
      asn: 4242423143,
      challengeText: challenge.challengeText,
      signature: validSignature
    });
    assert.equal(replayRes.success, false, 'Replayed challenge must be rejected');
  });

  await t.test('P0-1: SSH verification rejects missing or forged signature', async () => {
    const challenge = await AuthService.createChallenge(4242423143);

    // Reject empty signature
    const emptyRes = await AuthService.verifySignature({
      asn: 4242423143,
      challengeText: challenge.challengeText,
      signature: ''
    });
    assert.equal(emptyRes.success, false);

    // Create fresh challenge for forged test
    const freshChallenge = await AuthService.createChallenge(4242423143);
    const forgedSig = '-----BEGIN SSH SIGNATURE-----\nU1NIU0lHAAAAAQAAADMAAAALc3NoLWVkMjU1MTkAAAAg...forged...\n-----END SSH SIGNATURE-----';

    const forgedRes = await AuthService.verifySignature({
      asn: 4242423143,
      challengeText: freshChallenge.challengeText,
      signature: forgedSig
    });
    assert.equal(forgedRes.success, false, 'Forged signature must be rejected');
  });

  await t.test('P0-1: SSH verification rejects ASN with no registered keys in DN42 Registry', async () => {
    const challenge = await AuthService.createChallenge(4141410002); // AS4141410002 has empty authKeys
    const msgFile = path.join(tempDir, 'msg_no_keys.txt');
    fs.writeFileSync(msgFile, challenge.challengeText, 'utf8');
    execFileSync('ssh-keygen', ['-Y', 'sign', '-n', 'akilab', '-f', testKeyPath, msgFile]);
    const sig = fs.readFileSync(msgFile + '.sig', 'utf8');

    const res = await AuthService.verifySignature({
      asn: 4141410002,
      challengeText: challenge.challengeText,
      signature: sig
    });
    assert.equal(res.success, false);
    assert.match(res.error, /No SSH public keys registered in DN42 registry/);
  });
});
