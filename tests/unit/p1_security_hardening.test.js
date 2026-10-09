import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import crypto from 'node:crypto';

import { createServer } from '../../server/index.js';
import { generateInstallProbeScript } from '../../server/services/installScriptService.js';
import { AuthService } from '../../server/services/authService.js';
import { EmailService } from '../../server/services/emailService.js';
import { PortLedgerService } from '../../server/services/portLedgerService.js';
import { getActiveConfig, reloadConfig } from '../../server/storage/configLoader.js';
import { safeResolveStaticPath } from '../../server/utils/pathSafety.js';
import { PeeringController } from '../../server/controllers/peeringController.js';
import { SessionService } from '../../server/services/sessionService.js';
import { createIsolatedTestDataDir } from '../fixtures/tmpDataDir.js';
import { ROOT_DIR } from '../../server/config.js';

test('P1 Security Hardening & Concurrency Protection Suite', async (t) => {
  const { tmpDir, cleanup } = createIsolatedTestDataDir('dn42-p1-test-');
  t.after(() => cleanup());

  // ---------------------------------------------------------------------------
  // SEC-06: Host Header / URL Parsing Exception Handling & Server Stability
  // ---------------------------------------------------------------------------
  await t.test('1. SEC-06: Malformed URL / Host header does not crash server and returns 400 Bad Request', async () => {
    const server = createServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;

    const sendRawHttp = (raw) => {
      return new Promise((resolve, reject) => {
        const socket = net.createConnection(port, '127.0.0.1', () => {
          socket.write(raw);
        });
        let data = '';
        socket.on('data', chunk => { data += chunk.toString('utf8'); });
        socket.on('end', () => resolve(data));
        socket.on('error', reject);
      });
    };

    try {
      // 1. Raw absolute URL with invalid host syntax in request line
      const resMalformedUrl = await sendRawHttp(
        "GET http://[invalid-host:999/api/network-meta HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n"
      );
      assert.ok(
        resMalformedUrl.includes('400 Bad Request') || resMalformedUrl.includes('Malformed URL'),
        'Must handle malformed request-line URL gracefully with 400'
      );

      // 2. Normal request to verify server is still completely alive and healthy
      const resHealthy = await sendRawHttp(
        "GET /api/network-meta HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n"
      );
      assert.ok(resHealthy.includes('200 OK'), 'Server must remain alive and serve subsequent requests');
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  // ---------------------------------------------------------------------------
  // SEC-03: Host Header Injection Hardening in install-probe.sh
  // ---------------------------------------------------------------------------
  await t.test('2. SEC-03: install-probe.sh strictly sanitizes Host, enforces single-quotes, and prioritizes PORTAL_MASTER_URL', async () => {
    const server = createServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;

    const requestGet = (reqPath, headers = {}) => {
      return new Promise((resolve, reject) => {
        const req = http.request({
          hostname: '127.0.0.1',
          port,
          path: reqPath,
          method: 'GET',
          headers
        }, (res) => {
          let data = '';
          res.on('data', chunk => { data += chunk; });
          res.on('end', () => resolve({ statusCode: res.statusCode, data }));
        });
        req.on('error', reject);
        req.end();
      });
    };

    try {
      // 1. Request with malicious injection chars in Host header
      const resInjected = await requestGet('/install-probe.sh', {
        Host: 'evil.com; touch /tmp/pwned'
      });
      assert.equal(resInjected.statusCode, 200);
      assert.ok(!resInjected.data.includes('evil.com'), 'Must not reflect malicious host');
      assert.ok(!resInjected.data.includes('touch /tmp/pwned'), 'Must not reflect injected shell command');
      // Must fall back to safe default host
      assert.ok(
        resInjected.data.includes("MASTER_URL='http://127.0.0.1:"),
        'Must safely fall back and use single quotes for MASTER_URL variable'
      );

      // 2. Unit level: test generateInstallProbeScript direct escaping
      const scriptDirect = generateInstallProbeScript({ masterUrl: "http://malicious.host'; cat /etc/shadow; '" });
      assert.ok(!scriptDirect.includes("'; cat /etc/shadow"), 'Must escape and sanitize masterUrl');

      // 3. Prioritize PORTAL_MASTER_URL environment variable
      process.env.PORTAL_MASTER_URL = 'https://portal.secure.dn42';
      const resWithEnv = await requestGet('/install-probe.sh', {
        Host: 'attacker.host.com'
      });
      assert.equal(resWithEnv.statusCode, 200);
      assert.ok(resWithEnv.data.includes("MASTER_URL='https://portal.secure.dn42'"));
      delete process.env.PORTAL_MASTER_URL;
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  // ---------------------------------------------------------------------------
  // SEC-04: Concurrent Password Login Lockout Atomic Protection
  // ---------------------------------------------------------------------------
  await t.test('3. SEC-04: Concurrent failed password login attempts atomically increment counter and enforce lockout', async () => {
    const testAsn = 4242429876;
    const testUser = `AS${testAsn}`;

    // Execute 10 concurrent failed logins simultaneously
    const attempts = await Promise.all(
      Array.from({ length: 10 }).map((_, idx) =>
        AuthService.loginWithPassword({
          username: testUser,
          password: `invalid_pass_${idx}`
        })
      )
    );

    // All must fail
    assert.ok(attempts.every(r => r.success === false));

    // A subsequent attempt MUST be locked out with lock message
    const lockedAttempt = await AuthService.loginWithPassword({
      username: testUser,
      password: 'yet_another_invalid_password'
    });
    assert.equal(lockedAttempt.success, false);
    assert.ok(
      lockedAttempt.error.includes('Account temporarily locked'),
      `Expected lockout message, got: ${lockedAttempt.error}`
    );
  });

  // ---------------------------------------------------------------------------
  // SEC-05: OTP Burn vs. Rate Limit Cooldown Decoupling
  // ---------------------------------------------------------------------------
  await t.test('4. SEC-05: 5 failed OTP attempts invalidate code without resetting 30s rate-limit cooldown', async () => {
    const testAsn = 4242427777;
    const testEmail = 'peer7777@akilab.dn42';

    EmailService.clearCooldown(testAsn);

    // 1. Generate an OTP
    const code = EmailService.generateOtp(testAsn, testEmail);
    assert.equal(typeof code, 'string');
    assert.equal(code.length, 6);

    // 2. Perform 5 consecutive incorrect attempts
    for (let i = 1; i <= 4; i++) {
      const verifyRes = EmailService.verifyOtp(testAsn, '000000');
      assert.equal(verifyRes.valid, false);
      assert.ok(verifyRes.error.includes('remaining'));
    }

    // 5th attempt invalidates code
    const finalFail = EmailService.verifyOtp(testAsn, '000000');
    assert.equal(finalFail.valid, false);
    assert.ok(finalFail.error.includes('invalidated') || finalFail.error.includes('Too many incorrect attempts'));

    // 3. Verify OTP is burned (even correct code fails now)
    const burnedCheck = EmailService.verifyOtp(testAsn, code);
    assert.equal(burnedCheck.valid, false);
    assert.ok(burnedCheck.error.includes('No verification code found'));

    // 4. SEC-05 Core: cooldownStore must STILL be active!
    const remainingCooldown = EmailService.getCooldownRemaining(testAsn);
    assert.ok(
      remainingCooldown > 0,
      `Expected cooldown remaining > 0 after OTP burnout, got: ${remainingCooldown}`
    );

    // 5. Attempting to immediately request a new OTP must be blocked by rate limit (429)
    assert.throws(
      () => EmailService.generateOtp(testAsn, testEmail),
      (err) => err.code === 429 && err.message.includes('Please wait')
    );
  });

  // ---------------------------------------------------------------------------
  // SEC-07: Virtual Gateway Execution Channel Removal
  // ---------------------------------------------------------------------------
  await t.test('5. SEC-07: Virtual Gateway execution channels (evalJS, execHandler, execPort, execServer) removed', () => {
    const fetchNetworkPath = path.resolve(ROOT_DIR, 'cli/public/fetch-network.js');
    const indexPath = path.resolve(ROOT_DIR, 'cli/public/index.html');

    const fetchNetworkCode = fs.readFileSync(fetchNetworkPath, 'utf8');
    const indexHtmlCode = fs.readFileSync(indexPath, 'utf8');

    // fetch-network.js should NOT have evalJS
    assert.ok(!fetchNetworkCode.includes('function evalJS'), 'evalJS definition must be removed');
    assert.ok(!fetchNetworkCode.includes('evalJS('), 'evalJS calls must be removed');
    assert.ok(!fetchNetworkCode.includes('evalJS,'), 'evalJS must not be exported');

    // index.html should NOT have execHandler, execPort, execServer
    assert.ok(!indexHtmlCode.includes('execHandler'), 'execHandler must be removed');
    assert.ok(!indexHtmlCode.includes('execPort'), 'execPort must be removed');
    assert.ok(!indexHtmlCode.includes('execServer'), 'execServer must be removed');
  });

  // ---------------------------------------------------------------------------
  // SEC-08: Terminal OSC 1337 / 50 Handler Hardening & lg printf %s
  // ---------------------------------------------------------------------------
  await t.test('6. SEC-08: OSC 1337/50 handler only allows safe relative /gui/ paths and lg uses printf %s', () => {
    const indexPath = path.resolve(ROOT_DIR, 'cli/public/index.html');
    const lgPath = path.resolve(ROOT_DIR, 'cli/cli-src/bin/lg');

    const indexHtmlCode = fs.readFileSync(indexPath, 'utf8');
    const lgCode = fs.readFileSync(lgPath, 'utf8');

    // safeNavigate must restrict to starting with '/' and not '//'
    assert.ok(indexHtmlCode.includes('safeNavigate'), 'index.html must implement safeNavigate');
    assert.ok(indexHtmlCode.includes("!target.startsWith('//')"), 'safeNavigate must block protocol-relative URLs');
    assert.ok(indexHtmlCode.includes("!target.includes('\\\\')"), 'safeNavigate must block backslash traversal');

    // lg script must use printf '%s' instead of printf '%b'
    assert.ok(lgCode.includes("printf '%s\\n' \"$out\""), 'lg must format output safely with printf %s');
    assert.ok(!lgCode.includes("printf '%b' \"$out\""), 'lg must NOT use printf %b');
  });

  // ---------------------------------------------------------------------------
  // ENG-01: Port Ledger Concurrency Mutex Queue Protection
  // ---------------------------------------------------------------------------
  await t.test('7. ENG-01: PortLedgerService commit mutex serializes concurrent read-modify-write mutations', async () => {
    // 1. Test concurrent mergeProbeReport across multiple nodes
    const nodeA = 'TEST-NODE-CONCUR-A';
    const nodeB = 'TEST-NODE-CONCUR-B';
    const nodeC = 'TEST-NODE-CONCUR-C';

    await Promise.all([
      PortLedgerService.mergeProbeReport(nodeA, { ports: [{ port: 23001, name: 'wg-a1' }] }),
      PortLedgerService.mergeProbeReport(nodeB, { ports: [{ port: 23002, name: 'wg-b1' }] }),
      PortLedgerService.mergeProbeReport(nodeC, { ports: [{ port: 23003, name: 'wg-c1' }] }),
      PortLedgerService.mergeProbeReport(nodeA, { ports: [{ port: 23004, name: 'wg-a2' }] })
    ]);

    const ledger = await PortLedgerService.getLedger();
    assert.ok(Array.isArray(ledger[nodeA]), 'Node A entries must exist');
    assert.ok(Array.isArray(ledger[nodeB]), 'Node B entries must exist');
    assert.ok(Array.isArray(ledger[nodeC]), 'Node C entries must exist');

    assert.ok(ledger[nodeA].some(p => p.port === 23001 || p.port === 23004));
    assert.ok(ledger[nodeB].some(p => p.port === 23002));
    assert.ok(ledger[nodeC].some(p => p.port === 23003));

    // 2. Test concurrent allocateAndLockPort for identical requested base port
    const allocResults = await Promise.all([
      PortLedgerService.allocateAndLockPort({ nodeId: nodeA, asn: 4242421000, requestedPort: 25000 }),
      PortLedgerService.allocateAndLockPort({ nodeId: nodeA, asn: 4242421001, requestedPort: 25000 }),
      PortLedgerService.allocateAndLockPort({ nodeId: nodeA, asn: 4242421002, requestedPort: 25000 })
    ]);

    const allocatedPorts = allocResults.map(r => r.port);
    const uniquePorts = new Set(allocatedPorts);
    assert.equal(uniquePorts.size, 3, 'All 3 concurrent port allocations must be distinct without collision');
  });

  // ---------------------------------------------------------------------------
  // ENG-07: Config Parser Last-Known-Good Retention
  // ---------------------------------------------------------------------------
  await t.test('8. ENG-07: Config parser retains last-known-good cached configuration upon YAML parse error', () => {
    const tempConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dn42-eng07-'));
    const tempConfigFile = path.join(tempConfigDir, 'portal.config.yaml');
    process.env.PORTAL_CONFIG_PATH = tempConfigFile;

    try {
      // 1. Write valid custom configuration
      const validYaml = `
network:
  asn: AS4242429999
  networkName: "Custom Test Network"
nodes:
  - id: "NODE-LKG-1"
    name: "LKG Node 1"
`;
      fs.writeFileSync(tempConfigFile, validYaml, 'utf8');

      // Reload and assert valid custom config is cached
      const loaded = getActiveConfig({ reload: true });
      assert.equal(loaded.network.asn, 'AS4242429999');
      assert.equal(loaded.nodes[0].id, 'NODE-LKG-1');

      // 2. Corrupt file with syntax error
      fs.writeFileSync(tempConfigFile, '::: invalid yaml syntax [[[\n  broken:\n    - unclosed', 'utf8');

      // Reload config again
      const afterBroken = reloadConfig();

      // ENG-07 Requirement: Must retain last-known-good config, NOT revert to DEFAULT_CONFIG
      assert.equal(afterBroken.network.asn, 'AS4242429999', 'Must retain last known good network ASN');
      assert.equal(afterBroken.nodes[0].id, 'NODE-LKG-1', 'Must retain last known good node list');
    } finally {
      delete process.env.PORTAL_CONFIG_PATH;
      reloadConfig();
      try {
        fs.rmSync(tempConfigDir, { recursive: true, force: true });
      } catch {}
    }
  });

  // ---------------------------------------------------------------------------
  // P0 Cross-Verification (Guarantee Zero Regressions with P1 Applied)
  // ---------------------------------------------------------------------------
  await t.test('9. P0 Regression Check: SEC-01 path safety and SEC-02 IDOR authorization hold strong', async () => {
    // SEC-01 check
    const baseDir = path.resolve(ROOT_DIR, 'gui/public/logos');
    assert.equal(safeResolveStaticPath(baseDir, '../../.env'), null);
    assert.equal(safeResolveStaticPath(baseDir, '..%2f..%2f.env'), null);

    // SEC-02 check: non-owner modification rejected
    const keyAlice = crypto.randomBytes(32).toString('base64');
    const keyBob = crypto.randomBytes(32).toString('base64');

    const alicePayload = {
      asn: 4242421111,
      nodeId: 'JP-7',
      publicKey: keyAlice,
      linkLocal: 'fe80::1111',
      ipv4: '172.20.14.11',
      listenPort: 'auto'
    };
    const aliceUser = { asn: 4242421111, isAdmin: false };
    const bobUser = { asn: 4242422222, isAdmin: false };

    const aliceCreateRes = await PeeringController.submitPeering(alicePayload, aliceUser);
    if (!aliceCreateRes.success) console.error('aliceCreateRes failure:', aliceCreateRes);
    assert.equal(aliceCreateRes.success, true);
    const aliceSessionId = aliceCreateRes.data.sessionId;

    // Bob attempts to hijack Alice's session
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
    assert.equal(bobAttackRes.success, false);
    assert.equal(bobAttackRes.code, 403);
    assert.match(bobAttackRes.error.message, /Cannot modify peering session owned by another ASN/i);
  });
});
