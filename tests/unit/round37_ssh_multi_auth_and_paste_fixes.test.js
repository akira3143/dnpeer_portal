import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RegistryService, parseRpslLines } from '../../server/services/registryService.js';
import { AuthService } from '../../server/services/authService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');

test('Round 37: Multi-auth SSH keys, FIDO2, continuation line handling, and shell paste empty-line skipping', async (t) => {
  await t.test('1. parseAuthKeys parses single-line, folded multi-line RSA, and FIDO2 keys while ignoring PGP', () => {
    const tmpDir = fs.mkdtempSync(path.join(ROOT_DIR, 'tmp-reg-test-'));
    try {
      const dataMntnerDir = path.join(tmpDir, 'data', 'mntner');
      fs.mkdirSync(dataMntnerDir, { recursive: true });

      const mntContent = [
        'mntner:          IMLONGHAO-MNT',
        'admin-c:         IMLONGHAO-DN42',
        'tech-c:          IMLONGHAO-DN42',
        'mnt-by:          IMLONGHAO-MNT',
        'auth:            ssh-rsa',
        '    AAAAB3NzaC1yc2EAAAADAQABAAACAQDOG2Z8LyT58mU618bP+yw2d1tvLqdhfVkDiDvQrbuDVAh3',
        'auth:            ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIKv5fgCyrSdHw1z4Yvdi28fLs413vLFYk5sYyfC1YHJz imlonghao@imlonghao',
        'auth:            sk-ssh-ed25519@openssh.com AAAAGnNrLXNzaC1lZDI1NTE5QG9wZW5zc2guY29tAAAAI key@fido',
        'auth:            pgp-fingerprint 57957BAD5D038807C28EF49A15B26377262268C1',
        'auth:            pgp-fingerprint 869629718E75940C8819297D29B0388368839CB5',
        'source:          DN42'
      ].join('\n');

      fs.writeFileSync(path.join(dataMntnerDir, 'IMLONGHAO-MNT'), mntContent, 'utf8');

      const keys = RegistryService.parseAuthKeys('IMLONGHAO-MNT', tmpDir);
      assert.equal(keys.length, 3, 'Should parse exactly 3 SSH keys (RSA, Ed25519, FIDO2)');

      // Key 1: folded RSA
      assert.ok(keys.some(k => k.startsWith('ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAACAQDOG2Z8LyT58mU618bP+yw2d1tvLqdhfVkDiDvQrbuDVAh3')));
      // Key 2: Ed25519
      assert.ok(keys.some(k => k.startsWith('ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIKv5fgCyrSdHw1z4Yvdi28fLs413vLFYk5sYyfC1YHJz')));
      // Key 3: FIDO2 with @openssh.com
      assert.ok(keys.some(k => k.startsWith('sk-ssh-ed25519@openssh.com AAAAGnNrLXNzaC1lZDI1NTE5QG9wZW5zc2guY29tAAAAI')));

      // PGP fingerprints must NOT be included
      assert.ok(!keys.some(k => k.includes('57957BAD')));
      assert.ok(!keys.some(k => k.includes('86962971')));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  await t.test('2. dn42-login and passwd skip empty lines without premature break', () => {
    const loginScript = fs.readFileSync(path.resolve(ROOT_DIR, 'cli/cli-src/sbin/dn42-login'), 'utf8');
    const passwdScript = fs.readFileSync(path.resolve(ROOT_DIR, 'cli/cli-src/bin/passwd'), 'utf8');

    // Both scripts must continue on empty line: [ -z "$line" ] && continue
    assert.ok(
      loginScript.includes('[ -z "$line" ] && continue'),
      'dn42-login must skip empty lines with continue instead of breaking early'
    );
    assert.ok(
      !loginScript.includes('[ -z "$line" ] && { [ -n "$sig" ] && break'),
      'dn42-login must not break early on empty line when sig is set'
    );

    assert.ok(
      passwdScript.includes('[ -z "$line" ] && continue'),
      'passwd must skip empty lines with continue instead of breaking early'
    );
    assert.ok(
      !passwdScript.includes('[ -z "$line" ] && { [ -n "$sig" ] && break'),
      'passwd must not break early on empty line when sig is set'
    );
  });

  await t.test('3. sanitizePasteText still strips trailing newlines and whitespace (no auto-execution)', () => {
    const indexPath = path.resolve(ROOT_DIR, 'cli/public/index.html');
    const indexContent = fs.readFileSync(indexPath, 'utf8');

    const funcMatch = indexContent.match(/function sanitizePasteText\(text\)\s*\{([\s\S]*?)\n    \}/);
    assert.ok(funcMatch, 'sanitizePasteText function must exist in index.html');
    const sanitizePasteText = new Function('text', funcMatch[1]);

    const sig = '-----BEGIN SSH SIGNATURE-----\nU1NI...\n-----END SSH SIGNATURE-----\r\n\n  ';
    assert.equal(sanitizePasteText(sig), '-----BEGIN SSH SIGNATURE-----\nU1NI...\n-----END SSH SIGNATURE-----');

    const cmd = 'peer new\n';
    assert.equal(sanitizePasteText(cmd), 'peer new');
  });

  await t.test('4. verifySshSignatureOffline cleans line trailing spaces and verifies successfully', async () => {
    const { spawnSync } = await import('child_process');
    const os = await import('os');

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-unit-'));
    try {
      const keyFile = path.join(tmp, 'id_ed25519');
      spawnSync('ssh-keygen', ['-t', 'ed25519', '-f', keyFile, '-N', '']);
      const pubKey = fs.readFileSync(keyFile + '.pub', 'utf8').trim();

      const chal = 'akilab:4242421888:test12345';
      const res = spawnSync('ssh-keygen', ['-q', '-Y', 'sign', '-n', 'akilab', '-f', keyFile], {
        input: chal,
        encoding: 'utf8'
      });
      assert.equal(res.status, 0);

      // Intentionally pollute each line with trailing spaces and trailing newline
      const pollutedSig = res.stdout.split('\n').map(l => l + '   ').join('\n') + '\n\n';

      const verifyResult = await AuthService.verifySshSignatureOffline(chal, pollutedSig, [pubKey]);
      assert.equal(verifyResult.success, true, `Verification should succeed despite trailing spaces: ${verifyResult.error}`);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
