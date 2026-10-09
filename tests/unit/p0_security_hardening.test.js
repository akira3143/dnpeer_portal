import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';

import { safeResolveStaticPath } from '../../server/utils/pathSafety.js';
import { PeeringController } from '../../server/controllers/peeringController.js';
import { SessionService } from '../../server/services/sessionService.js';
import { createServer } from '../../server/index.js';
import { createIsolatedTestDataDir } from '../fixtures/tmpDataDir.js';
import { ROOT_DIR } from '../../server/config.js';

test('P0 Security Hardening: SEC-01 Path Traversal & SEC-02 Session BOLA/IDOR', async (t) => {
  const { tmpDir, cleanup } = createIsolatedTestDataDir('dn42-p0-test-');
  t.after(() => cleanup());

  // ---------------------------------------------------------------------------
  // SEC-01 & SEC-10: Path Traversal & Directory Boundary Tests
  // ---------------------------------------------------------------------------
  await t.test('1. safeResolveStaticPath: blocks directory traversal, null bytes, UNC and drive letters', () => {
    const baseDir = path.resolve(ROOT_DIR, 'gui/public/logos');

    // Test traversal attempts
    assert.equal(safeResolveStaticPath(baseDir, '../../.env'), null, 'Must block relative .. traversal');
    assert.equal(safeResolveStaticPath(baseDir, '..%2f..%2f.env'), null, 'Must block URL-encoded ..%2f traversal');
    assert.equal(safeResolveStaticPath(baseDir, '%2e%2e%2f%2e%2e%2f.env'), null, 'Must block encoded dots traversal');
    assert.equal(safeResolveStaticPath(baseDir, '/etc/passwd'), null, 'Must block leading slash absolute path');
    assert.equal(safeResolveStaticPath(baseDir, '//etc/passwd'), null, 'Must block double leading slash');
    assert.equal(safeResolveStaticPath(baseDir, '\\\\server\\share\\file'), null, 'Must block Windows UNC paths');
    assert.equal(safeResolveStaticPath(baseDir, 'C:/Windows/win.ini'), null, 'Must block Windows drive letters');
    assert.equal(safeResolveStaticPath(baseDir, 'D:\\sensitive\\file.txt'), null, 'Must block backslash drive letters');
    assert.equal(safeResolveStaticPath(baseDir, 'akilab.png\0.php'), null, 'Must block null byte injection');
    assert.equal(safeResolveStaticPath(baseDir, 'akilab.png%00.jpg'), null, 'Must block encoded null byte');

    // Test extension whitelist
    assert.equal(
      safeResolveStaticPath(baseDir, 'config.json', { allowedExtensions: ['.png', '.svg'] }),
      null,
      'Must reject extensions not in whitelist'
    );

    // Test safe valid file within baseDir
    const validResolved = safeResolveStaticPath(baseDir, 'logo_1.png', {
      allowedExtensions: ['.png', '.svg']
    });
    assert.ok(validResolved, 'Should resolve valid relative path');
    assert.equal(validResolved, path.resolve(baseDir, 'logo_1.png'));
  });

  await t.test('2. safeResolveStaticPath: blocks sibling directory prefix traversal (SEC-10)', () => {
    const guiDist = path.resolve(ROOT_DIR, 'gui/dist');
    // Attempt to access gui/dist-backup/secret.txt
    assert.equal(
      safeResolveStaticPath(guiDist, '../dist-backup/secret.txt'),
      null,
      'Must block sibling directory breakout even if sharing prefix'
    );
  });

  await t.test('3. HTTP Server /logos/* endpoint blocks unauthenticated directory traversal (SEC-01)', async () => {
    const server = createServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;

    const requestGet = (reqPath) => {
      return new Promise((resolve, reject) => {
        const req = http.get(`http://127.0.0.1:${port}${reqPath}`, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => resolve({ statusCode: res.statusCode, data }));
        });
        req.on('error', reject);
      });
    };

    try {
      // 1. Traversal to /etc/passwd via double slash
      const resPasswd = await requestGet('/logos//etc/passwd');
      assert.equal(resPasswd.statusCode, 404, 'Must return 404 on absolute /etc/passwd');

      // 2. Encoded traversal
      const resEncoded = await requestGet('/logos/%2e%2e%2f%2e%2e%2fserver/config.js');
      assert.equal(resEncoded.statusCode, 404, 'Must return 404 on encoded traversal');

      // 3. Windows drive path
      const resDrive = await requestGet('/logos/C:/Windows/win.ini');
      assert.equal(resDrive.statusCode, 404, 'Must return 404 on Windows drive path');

      // 4. Non-whitelisted extension (e.g. secret.env)
      const resEnv = await requestGet('/logos/secret.env');
      assert.equal(resEnv.statusCode, 404, 'Must return 404 on non-image extension');

      // 5. Valid existing logo returns 200
      const resValid = await requestGet('/logos/logo_1.png');
      assert.equal(resValid.statusCode, 200, 'Must return 200 on valid logo');
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
  });

  // ---------------------------------------------------------------------------
  // SEC-02: Session Update BOLA / IDOR Authorization Tests
  // ---------------------------------------------------------------------------
  await t.test('4. SEC-02: User Alice creates a session, User Bob cannot overwrite Alice session ID (IDOR)', async () => {
    const aliceUser = { asn: 4242421111, role: 'user' };
    const bobUser = { asn: 4242422222, role: 'user' };
    const adminUser = { asn: 4242423143, role: 'admin' };

    // Valid 44-character Base64 keys
    const keyAlice = 'yA+N64x7tN/4H1XqJd+7qf3K9z1V8uT5R7o+P2w8x1E=';
    const keyBob = 'bB+N64x7tN/4H1XqJd+7qf3K9z1V8uT5R7o+P2w8x1E=';
    const keyAliceUpdated = 'dD+N64x7tN/4H1XqJd+7qf3K9z1V8uT5R7o+P2w8x1E=';
    const keyAdminUpdated = 'cC+N64x7tN/4H1XqJd+7qf3K9z1V8uT5R7o+P2w8x1E=';

    // 1. Alice creates her session on node 'default'
    const alicePayload = {
      asn: 4242421111,
      nodeId: 'JP-7',
      publicKey: keyAlice,
      linkLocal: 'fe80::1111',
      ipv4: '172.20.14.11',
      listenPort: 'auto'
    };

    const aliceCreateRes = await PeeringController.submitPeering(alicePayload, aliceUser);
    assert.equal(aliceCreateRes.success, true, 'Alice session creation must succeed');
    const aliceSessionId = aliceCreateRes.data.sessionId;
    assert.ok(aliceSessionId, 'Alice must receive a valid sessionId');

    // 2. Bob attempts to overwrite Alice session using his own ASN (4242422222) with Alice's sessionId
    const bobHijackPayload = {
      id: aliceSessionId,
      asn: 4242422222,
      nodeId: 'JP-7',
      publicKey: keyBob,
      linkLocal: 'fe80::2222',
      ipv4: '172.20.14.22',
      listenPort: 'auto'
    };

    const bobAttackRes = await PeeringController.submitPeering(bobHijackPayload, bobUser);
    assert.equal(bobAttackRes.success, false, 'Bob IDOR hijack attempt must be rejected');
    assert.equal(bobAttackRes.code, 403, 'Must return HTTP 403 Forbidden on IDOR');
    assert.match(bobAttackRes.error.message, /Cannot modify peering session owned by another ASN/i);

    // 3. Verify Alice session is 100% intact and unchanged in storage
    const sessions = await SessionService.getSessions();
    const storedAliceSession = sessions.find(s => s.id === aliceSessionId);
    assert.ok(storedAliceSession, 'Alice session must still exist');
    assert.equal(storedAliceSession.asn, 4242421111, 'Alice session ASN must remain 4242421111');
    assert.equal(storedAliceSession.peering.publicKey, keyAlice, 'PublicKey must not be overwritten');

    // 4. Alice updating her OWN session with her sessionId succeeds
    const aliceUpdatePayload = {
      id: aliceSessionId,
      asn: 4242421111,
      nodeId: 'JP-7',
      publicKey: keyAliceUpdated,
      linkLocal: 'fe80::1111',
      ipv4: '172.20.14.11',
      listenPort: 'auto'
    };
    const aliceUpdateRes = await PeeringController.submitPeering(aliceUpdatePayload, aliceUser);
    assert.equal(aliceUpdateRes.success, true, 'Alice updating her own session must succeed');

    const updatedSessions = await SessionService.getSessions();
    const verifiedAliceSession = updatedSessions.find(s => s.id === aliceSessionId);
    assert.equal(verifiedAliceSession.peering.publicKey, keyAliceUpdated, 'Alice updated key should be saved');

    // 5. Admin updating Alice session succeeds with audit logging
    const adminUpdatePayload = {
      id: aliceSessionId,
      asn: 4242421111,
      nodeId: 'JP-7',
      publicKey: keyAdminUpdated,
      linkLocal: 'fe80::1111',
      ipv4: '172.20.14.11',
      listenPort: 'auto'
    };
    const adminUpdateRes = await PeeringController.submitPeering(adminUpdatePayload, adminUser);
    assert.equal(adminUpdateRes.success, true, 'Admin updating existing session must succeed');
  });
});
