import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dn42-test-authflow-'));
process.env.PORTAL_DATA_DIR = testDataDir;

import { createServer } from '../../server/index.js';
import { AuthService } from '../../server/services/authService.js';
import { createTestUsers } from '../fixtures/testUsers.js';

describe('Auth Flow API Integration Tests', () => {
  let server;
  let baseUrl;

  before(async () => {
    // Seed test users fixture into isolated testDataDir
    const testUsers = createTestUsers();
    await AuthService.saveAuthUsers(testUsers);

    server = createServer();
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    if (server && server.closeAll) {
      await server.closeAll();
    }
    try {
      fs.rmSync(testDataDir, { recursive: true, force: true });
    } catch {}
  });

  test('GET /api/auth/challenge returns challenge with flat and nested commands', async () => {
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

  test('POST /api/auth/login-password and verify /api/auth/me', async () => {
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
});
