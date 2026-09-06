import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dn42-test-authflow-'));
process.env.PORTAL_DATA_DIR = testDataDir;

import { createServer } from '../../server/index.js';
import { AuthService } from '../../server/services/authService.js';
import { createTestUsers } from '../fixtures/testUsers.js';

test('Auth Flow API Integration Tests', async (t) => {
  // Seed test users fixture into isolated testDataDir
  const testUsers = createTestUsers();
  await AuthService.saveAuthUsers(testUsers);

  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  t.after(async () => {
    if (server) {
      if (server.closeAllConnections) server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
    try {
      fs.rmSync(testDataDir, { recursive: true, force: true });
    } catch {}
  });

  await t.test('GET /api/auth/challenge returns challenge with flat and nested commands', async () => {
    const res = await fetch(`${baseUrl}/api/auth/challenge?asn=4242423143`);
    assert.equal(res.status, 200);
    const body = await res.json();

    assert.equal(body.success, true);
    assert.equal(body.data.asn, 4242423143);
    assert.ok(body.data.challengeText);
    assert.ok(body.data.commandPowershell);
    assert.ok(body.data.commandLinux);
    assert.ok(body.data.commands.ssh_powershell);
    assert.ok(body.data.commands.ssh_linux);
  });

  await t.test('POST /api/auth/login-password and verify /api/auth/me', async () => {
    const loginRes = await fetch(`${baseUrl}/api/auth/login-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: '4242423143',
        password: 'test12345',
        rememberMe: true
      })
    });

    assert.equal(loginRes.status, 200);
    const loginBody = await loginRes.json();
    assert.equal(loginBody.success, true);
    const token = loginBody.data.token;
    assert.ok(token);

    // Verify /api/auth/me
    const meRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    assert.equal(meRes.status, 200);
    const meBody = await meRes.json();
    assert.equal(meBody.success, true);
    assert.equal(meBody.data.asn, 4242423143);
    assert.equal(meBody.data.role, 'admin');

    // List sessions
    const sessRes = await fetch(`${baseUrl}/api/sessions`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    assert.equal(sessRes.status, 200);
    const sessBody = await sessRes.json();
    assert.equal(sessBody.success, true);
    assert.ok(Array.isArray(sessBody.data));
  });

  await t.test('POST /api/auth/login-password rejects invalid non-ASN username', async () => {
    const loginRes = await fetch(`${baseUrl}/api/auth/login-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'startx',
        password: 'anyPassword123'
      })
    });

    assert.equal(loginRes.status, 200);
    const body = await loginRes.json();
    assert.equal(body.success, false);
    assert.match(body.error.message, /Invalid ASN format/);
  });

  await t.test('POST /api/auth/login-password accepts public ASN format', async () => {
    const loginRes = await fetch(`${baseUrl}/api/auth/login-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: '209403',
        password: 'wrongPassword'
      })
    });

    assert.equal(loginRes.status, 200);
    const body = await loginRes.json();
    assert.equal(body.success, false);
    // Should fail with credentials error, NOT format error
    assert.match(body.error.message, /Invalid credentials|Invalid username or password/);
  });

  await t.test('GET /api/auth/check returns hasPassword true for existing user and false for new user', async () => {
    // 1. User with password
    const check1 = await fetch(`${baseUrl}/api/auth/check?asn=4242423143`);
    assert.equal(check1.status, 200);
    const body1 = await check1.json();
    assert.equal(body1.success, true);
    assert.equal(body1.data.asn, 4242423143);
    assert.equal(body1.data.hasPassword, true);

    // 2. User without password
    const check2 = await fetch(`${baseUrl}/api/auth/check?asn=4242422466`);
    assert.equal(check2.status, 200);
    const body2 = await check2.json();
    assert.equal(body2.success, true);
    assert.equal(body2.data.asn, 4242422466);
    assert.equal(body2.data.hasPassword, false);

    // 3. Invalid ASN
    const check3 = await fetch(`${baseUrl}/api/auth/check?asn=invalid`);
    assert.equal(check3.status, 200);
    const body3 = await check3.json();
    assert.equal(body3.success, false);
    assert.match(body3.error.message, /Invalid ASN format/);
  });

  await t.test('CLI dn42-login checks /api/auth/check and defaults to SSH login when hasPassword is false', () => {
    const loginScript = fs.readFileSync(path.resolve('cli/cli-src/sbin/dn42-login'), 'utf8');

    // 1. Must query /api/auth/check
    assert.ok(loginScript.includes('/api/auth/check?asn=$clean'), 'Must query /api/auth/check?asn=$clean');

    // 2. Must conditionally trigger password login only if has_pwd == true
    assert.ok(loginScript.includes('[ "$has_pwd" = "true" ]'), 'Must gate do_password_login on hasPassword == true');

    // 3. Must default to SSH login when no password is set
    assert.ok(loginScript.includes('No stored password for AS$clean. Defaulting to SSH signature verification'), 'Must announce defaulting to SSH');

    // 4. do_password_login must allow typing ssh to switch
    assert.ok(loginScript.includes('[ "$pwd" = "ssh" ]'), 'Must allow typing ssh to switch to SSH verification');
  });
});

