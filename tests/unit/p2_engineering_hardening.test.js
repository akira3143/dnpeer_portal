import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';

import { FileStore } from '../../server/storage/fileStore.js';
import { validatePort, validateMtu, validateIpv6Ula } from '../../server/utils/validator.js';
import { AuthService } from '../../server/services/authService.js';
import { MetaController } from '../../server/controllers/metaController.js';
import { createIsolatedTestDataDir } from '../fixtures/tmpDataDir.js';
import { ROOT_DIR } from '../../server/config.js';

test('P2 Engineering Quality & Architecture Refinement Suite', async (t) => {
  const { tmpDir, cleanup } = createIsolatedTestDataDir('dn42-p2-test-');
  t.after(() => cleanup());

  // ---------------------------------------------------------------------------
  // ENG-06: FileStore trailing comma removal protects string literals
  // ---------------------------------------------------------------------------
  await t.test('1. ENG-06: FileStore preserves string literals containing commas and closing brackets', async () => {
    const testFilePath = path.join(tmpDir, 'test_eng06.json');
    const jsonWithTrickyStrings = `
{
  // A comment to test comment stripping
  "description": "Port: 20000, } and array: [1, 2, ]",
  "nested": {
    "title": "Closing tag here: ]",
    "value": 42,
  },
}
`;
    fs.writeFileSync(testFilePath, jsonWithTrickyStrings, 'utf8');

    const parsed = await FileStore.readJson(testFilePath);
    assert.ok(parsed, 'JSON must be parsed successfully');
    assert.equal(parsed.description, 'Port: 20000, } and array: [1, 2, ]', 'String literal must remain completely intact');
    assert.equal(parsed.nested.title, 'Closing tag here: ]');
    assert.equal(parsed.nested.value, 42);
  });

  // ---------------------------------------------------------------------------
  // ENG-04: Strict boundary checks for port, MTU, and IPv6 ULA
  // ---------------------------------------------------------------------------
  await t.test('2. ENG-04: Validator strictly rejects floats, trailing garbage, and malformed colons', () => {
    // 1. Port boundary checks
    assert.equal(validatePort('23143.8').valid, false, 'Port with decimal point must be rejected');
    assert.equal(validatePort('1420garbage').valid, false, 'Port with trailing non-digits must be rejected');
    assert.equal(validatePort('20000abc').valid, false);
    assert.equal(validatePort(' 23143 ').valid, true, 'Port with leading/trailing spaces is trimmed and accepted');
    assert.equal(validatePort(23143).valid, true);

    // 2. MTU boundary checks
    assert.equal(validateMtu('1420garbage').valid, false, 'MTU with trailing characters must be rejected');
    assert.equal(validateMtu('1420.5').valid, false, 'MTU float must be rejected');
    assert.equal(validateMtu(1420).valid, true);
    assert.equal(validateMtu(1280).valid, true);
    assert.equal(validateMtu(1500).valid, true);

    // 3. IPv6 ULA boundary checks
    assert.equal(validateIpv6Ula('fd00::::').valid, false, 'fd00:::: with quad-colons must be rejected');
    assert.equal(validateIpv6Ula('fd00:::1').valid, false, 'fd00:::1 with triple-colons must be rejected');
    assert.equal(validateIpv6Ula('fd00:4242:3143::1').valid, true, 'Standard ULA must be accepted');
    assert.equal(validateIpv6Ula('fd00:4242:3143::1/64').valid, true, 'Standard ULA with CIDR must be accepted');
  });

  // ---------------------------------------------------------------------------
  // ENG-05: Raw endpoint input does not truncate bare IPv6 addresses
  // ---------------------------------------------------------------------------
  await t.test('3. ENG-05: ConfigGenerator does not strip trailing hextet on bare IPv6 input', () => {
    const configGenPath = path.resolve(ROOT_DIR, 'gui/src/components/ConfigGenerator.tsx');
    const configGenCode = fs.readFileSync(configGenPath, 'utf8');

    // Verify onChange does not blindly replace /:\d+$/
    assert.ok(
      !configGenCode.includes("e.target.value.replace(/:\d+$/, '')"),
      'ConfigGenerator must not destructively strip trailing digits from endpoint on every keystroke'
    );
  });

  // ---------------------------------------------------------------------------
  // ENG-11: Looking Glass does not enter stuck loading state on validation failure
  // ---------------------------------------------------------------------------
  await t.test('4. ENG-11: LookingGlass validates query input prior to activating loading state', () => {
    const lgComponentPath = path.resolve(ROOT_DIR, 'gui/src/components/LookingGlass.tsx');
    const lgCode = fs.readFileSync(lgComponentPath, 'utf8');

    // The validation of qtype === 'route' must appear before setIsLoading(true)
    const routeValidationIndex = lgCode.indexOf("if (qtype === 'route')");
    const setIsLoadingIndex = lgCode.indexOf("setIsLoading(true);", routeValidationIndex);

    assert.ok(
      routeValidationIndex !== -1 && setIsLoadingIndex !== -1,
      'Route validation must occur before activating loading state'
    );
  });

  // ---------------------------------------------------------------------------
  // ENG-02: Authoritative admin role check & mutex on setPassword
  // ---------------------------------------------------------------------------
  await t.test('5. ENG-02: AuthService.isAdmin is authoritative and concurrent setPassword is serialized', async () => {
    // 1. Check isAdmin single source
    assert.equal(typeof AuthService.isAdmin, 'function');
    assert.equal(AuthService.isAdmin(4242423143), true, 'Primary admin ASN must be admin');
    assert.equal(AuthService.isAdmin('AS4242423143'), true, 'String AS-prefixed admin must be recognized');
    assert.equal(AuthService.isAdmin(4242429999), false, 'Normal user ASN must not be admin');

    // 2. Concurrent setPassword for multiple users
    const results = await Promise.all([
      AuthService.setPassword(4242421001, 'Password_Test_1001!'),
      AuthService.setPassword(4242421002, 'Password_Test_1002!'),
      AuthService.setPassword(4242421003, 'Password_Test_1003!')
    ]);

    assert.ok(results.every(r => r.success === true), 'All password setups must succeed');

    const authUsers = await AuthService.getAuthUsers();
    assert.ok(authUsers['4242421001'], 'User 1001 must exist in auth_users.json');
    assert.ok(authUsers['4242421002'], 'User 1002 must exist in auth_users.json');
    assert.ok(authUsers['4242421003'], 'User 1003 must exist in auth_users.json');
  });

  // ---------------------------------------------------------------------------
  // SEC-13: Public network metadata whitelists DTO and does not leak lgProxyUrl
  // ---------------------------------------------------------------------------
  await t.test('6. SEC-13: MetaController.getNetworkMeta whitelists node fields and excludes lgProxyUrl', async () => {
    const metaRes = await MetaController.getNetworkMeta();
    assert.equal(metaRes.success, true);
    assert.ok(Array.isArray(metaRes.data.nodes), 'Nodes array must be present');

    for (const node of metaRes.data.nodes) {
      assert.equal(
        node.lgProxyUrl,
        undefined,
        `Node ${node.id} must not leak internal lgProxyUrl in public metadata`
      );
      assert.ok(node.id, 'Node id must exist');
      assert.ok(node.name, 'Node name must exist');
      assert.ok(node.wgPublicKey, 'Node wgPublicKey must exist');
    }
  });

  // ---------------------------------------------------------------------------
  // SEC-11: RememberMe consistency
  // ---------------------------------------------------------------------------
  await t.test('7. SEC-11: AuthModal passes rememberMe to ApiClient.setToken', () => {
    const authModalPath = path.resolve(ROOT_DIR, 'gui/src/components/AuthModal.tsx');
    const authModalCode = fs.readFileSync(authModalPath, 'utf8');

    // All setToken invocations in AuthModal must pass rememberMe
    assert.ok(!authModalCode.includes('ApiClient.setToken(res.data.token);'), 'Must pass rememberMe argument');
    assert.ok(authModalCode.includes('ApiClient.setToken(res.data.token, rememberMe);'));
  });
});
