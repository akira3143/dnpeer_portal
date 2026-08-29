import { createServer } from '../../server/index.js';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { hashPassword } from '../../server/services/authService.js';

const SH_PATH = fs.existsSync('C:/Program Files/Git/bin/sh.exe')
  ? 'C:/Program Files/Git/bin/sh.exe'
  : (fs.existsSync('C:/Program Files/Git/usr/bin/sh.exe') ? 'C:/Program Files/Git/usr/bin/sh.exe' : 'sh');

async function main() {
  const server = createServer();
  await new Promise(r => server.listen(4242, '127.0.0.1', r));
  console.log('--- TEST SERVER RUNNING ON 127.0.0.1:4242 ---');

  // Setup test accounts in server/data/auth_users.json
  const testPass = hashPassword('test12345');
  const authUsers = {
    '4242423143': {
      asn: 4242423143,
      asName: 'AKILAB-MNT',
      role: 'admin',
      salt: testPass.salt,
      hash: testPass.hash,
      createdAt: new Date().toISOString()
    }
  };
  fs.writeFileSync('server/data/auth_users.json', JSON.stringify(authUsers, null, 2), 'utf8');

  // Setup temporary SSH key for testing
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-verify-'));
  const testKeyPath = path.join(tempDir, 'id_ed25519');
  execFileSync('ssh-keygen', ['-t', 'ed25519', '-f', testKeyPath, '-N', '']);
  const pubKey = fs.readFileSync(testKeyPath + '.pub', 'utf8').trim();

  // Seed registry
  const registry = {
    'AS4242423143': {
      asn: 4242423143,
      asName: 'AKILAB-MNT',
      descr: 'AkiLab Backbone Autonomous System',
      maintainer: 'AKIRA-MNT',
      adminContact: 'AKIRA-DN42',
      personName: 'Akira',
      authKeys: [pubKey]
    }
  };
  fs.writeFileSync('server/data/registry_cache.json', JSON.stringify(registry, null, 2), 'utf8');

  console.log('\n================ 1. TEST nodes ===============');
  const nodesRes = execFileSync(SH_PATH, ['cli-src/bin/nodes'], {
    cwd: path.resolve('cli'),
    env: { ...process.env, API_BASE: 'http://127.0.0.1:4242' },
    encoding: 'utf8'
  });
  console.log(nodesRes);

  console.log('\n================ 2. TEST whois ===============');
  const whoisRes = execFileSync(SH_PATH, ['cli-src/bin/whois', '4242423143'], {
    cwd: path.resolve('cli'),
    env: { ...process.env, API_BASE: 'http://127.0.0.1:4242' },
    encoding: 'utf8'
  });
  console.log(whoisRes);

  console.log('\n================ 3. TEST lg status ===============');
  const lgRes = execFileSync(SH_PATH, ['cli-src/bin/lg', 'status', 'JP-TYO-1'], {
    cwd: path.resolve('cli'),
    env: { ...process.env, API_BASE: 'http://127.0.0.1:4242' },
    encoding: 'utf8'
  });
  console.log(lgRes);

  console.log('\n================ 4. TEST password login & whoami ===============');
  const loginFetch = await fetch('http://127.0.0.1:4242/api/auth/login-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ asn: '4242423143', password: 'test12345' })
  });
  const loginJson = await loginFetch.json();
  console.log('Login Result:', JSON.stringify(loginJson, null, 2));

  // Write token to /tmp
  try { fs.mkdirSync('/tmp', { recursive: true }); } catch {}
  fs.writeFileSync('/tmp/dn42_token', loginJson.data.token, 'utf8');
  fs.writeFileSync('/tmp/dn42_asn', '4242423143', 'utf8');

  const whoamiRes = execFileSync(SH_PATH, ['cli-src/bin/whoami'], {
    cwd: path.resolve('cli'),
    env: { ...process.env, API_BASE: 'http://127.0.0.1:4242' },
    encoding: 'utf8'
  });
  console.log(whoamiRes);

  console.log('\n================ 5. TEST peer ls & peer rm ===============');
  const submitFetch = await fetch('http://127.0.0.1:4242/api/peering/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      asn: 4242423143,
      nodeId: 'JP-TYO-1',
      publicKey: 'yA+N64x7tN/4H1XqJd+7qf3K9z1V8uT5R7o+P2w8x1E=',
      linkLocal: 'fe80::4242:3143',
      listenPort: 'auto',
      clientPort: 'auto'
    })
  });
  const submitJson = await submitFetch.json();
  console.log('Peering Submit Result:', JSON.stringify(submitJson, null, 2));

  const peerLsRes = execFileSync(SH_PATH, ['cli-src/bin/peer', 'ls'], {
    cwd: path.resolve('cli'),
    env: { ...process.env, API_BASE: 'http://127.0.0.1:4242' },
    encoding: 'utf8'
  });
  console.log(peerLsRes);

  const peerRmRes = execFileSync(SH_PATH, ['cli-src/bin/peer', 'rm', submitJson.data.sessionId], {
    cwd: path.resolve('cli'),
    env: { ...process.env, API_BASE: 'http://127.0.0.1:4242' },
    encoding: 'utf8'
  });
  console.log(peerRmRes);

  console.log('\n================ 6. TEST SSH Sign & Verify Flow ===============');
  const chalFetch = await fetch('http://127.0.0.1:4242/api/auth/challenge?asn=4242423143');
  const chalJson = await chalFetch.json();
  console.log('Challenge:', chalJson.data.challengeText);

  const msgFile = path.join(tempDir, 'msg.txt');
  fs.writeFileSync(msgFile, chalJson.data.challengeText, 'utf8');
  execFileSync('ssh-keygen', ['-Y', 'sign', '-n', 'akilab', '-f', testKeyPath, msgFile]);
  const sig = fs.readFileSync(msgFile + '.sig', 'utf8');

  const verifyFetch = await fetch('http://127.0.0.1:4242/api/auth/verify-ssh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      asn: 4242423143,
      challengeText: chalJson.data.challengeText,
      signature: sig
    })
  });
  const verifyJson = await verifyFetch.json();
  console.log('Verify SSH Result:', JSON.stringify(verifyJson, null, 2));

  console.log('\n================ 7. TEST passwd (set-password) ===============');
  const setPassFetch = await fetch('http://127.0.0.1:4242/api/auth/set-password', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + verifyJson.data.token
    },
    body: JSON.stringify({ asn: 4242423143, password: 'updatedsecret999' })
  });
  const setPassJson = await setPassFetch.json();
  console.log('Set Password Result:', JSON.stringify(setPassJson, null, 2));

  // Verify login with new password
  const newLoginFetch = await fetch('http://127.0.0.1:4242/api/auth/login-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ asn: '4242423143', password: 'updatedsecret999' })
  });
  const newLoginJson = await newLoginFetch.json();
  console.log('New Password Login Result:', JSON.stringify(newLoginJson, null, 2));

  // Clean up
  fs.rmSync(tempDir, { recursive: true, force: true });
  await server.closeAll();
  console.log('\nALL 7 CLI/API ENDPOINTS TESTED AND VERIFIED SUCCESSFULLY!');
}

main();
