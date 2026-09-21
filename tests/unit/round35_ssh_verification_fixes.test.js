import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AuthController } from '../../server/controllers/authController.js';
import { readRequestBodyAsBytes } from '../../cli/public/fetch-network.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');

test('Round 35: SSH Signature Verification Login & Terminal Paste Fixes', async (t) => {
  await t.test('1. sanitizePasteText strips terminating newline and trailing whitespace across all scenarios', () => {
    const indexPath = path.resolve(ROOT_DIR, 'cli/public/index.html');
    const indexContent = fs.readFileSync(indexPath, 'utf8');

    // Extract sanitizePasteText function code
    const funcMatch = indexContent.match(/function sanitizePasteText\(text\)\s*\{([\s\S]*?)\n    \}/);
    assert.ok(funcMatch, 'sanitizePasteText function must exist in index.html');
    const sanitizePasteText = new Function('text', funcMatch[1]);

    // Test A: Normal single-line command must strip trailing newline
    const singleCmd = 'whois AS4242423143\n';
    assert.equal(sanitizePasteText(singleCmd), 'whois AS4242423143');

    // Test B: Normal multi-line text without signature block strips trailing newline
    const multiCmd = 'ls -la\npwd\n';
    assert.equal(sanitizePasteText(multiCmd), 'ls -la\npwd');

    // Test C: OpenSSH Armored Signature Block with trailing newline strips trailing newline
    const sigWithNewline = '-----BEGIN SSH SIGNATURE-----\nU1NIU01HAAAA...\n-----END SSH SIGNATURE-----\n';
    assert.equal(
      sanitizePasteText(sigWithNewline),
      '-----BEGIN SSH SIGNATURE-----\nU1NIU01HAAAA...\n-----END SSH SIGNATURE-----'
    );

    // Test D: OpenSSH Armored Signature Block with trailing CRLF and spaces strips trailing whitespace
    const sigWithWhitespace = '-----BEGIN SSH SIGNATURE-----\nU1NIU01HAAAA...\n-----END SSH SIGNATURE-----\r\n   ';
    assert.equal(
      sanitizePasteText(sigWithWhitespace),
      '-----BEGIN SSH SIGNATURE-----\nU1NIU01HAAAA...\n-----END SSH SIGNATURE-----'
    );

    // Test E: index.html must not use navigator.clipboard.readText (avoids permission prompts and delayed second paste)
    assert.doesNotMatch(
      indexContent,
      /navigator\.clipboard\.readText/,
      'index.html must not call navigator.clipboard.readText to avoid browser permission modals and duplicate pastes'
    );
  });

  await t.test('2. readRequestBodyAsBytes extracts Uint8Array across ArrayBuffer, ReadableStream and wrappers', async () => {
    // Case A: Null or empty request
    const emptyRes = await readRequestBodyAsBytes(null);
    assert.equal(emptyRes, null);

    const noBodyReq = new Request('http://localhost/', { method: 'GET' });
    const noBodyRes = await readRequestBodyAsBytes(noBodyReq);
    assert.equal(noBodyRes, null);

    // Case B: POST request with plain string/ArrayBuffer
    const payloadStr = JSON.stringify({ asn: 4242421888, challengeText: 'test' });
    const req1 = new Request('http://localhost/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payloadStr
    });
    const bytes1 = await readRequestBodyAsBytes(req1);
    assert.ok(bytes1 instanceof Uint8Array);
    assert.equal(new TextDecoder().decode(bytes1), payloadStr);

    // Case C: POST request with ReadableStream body (duplex half)
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('streamed-body-data'));
        controller.close();
      }
    });
    const reqStream = new Request('http://localhost/', {
      method: 'POST',
      body: stream,
      duplex: 'half'
    });
    const bytesStream = await readRequestBodyAsBytes(reqStream);
    assert.ok(bytesStream instanceof Uint8Array);
    assert.equal(new TextDecoder().decode(bytesStream), 'streamed-body-data');
  });

  await t.test('3. dn42-login and passwd capture trailing non-newline signature lines and flush input', () => {
    const loginScript = fs.readFileSync(path.resolve(ROOT_DIR, 'cli/cli-src/sbin/dn42-login'), 'utf8');
    const passwdScript = fs.readFileSync(path.resolve(ROOT_DIR, 'cli/cli-src/bin/passwd'), 'utf8');

    // Both scripts must inspect $line when read -r -t 3 returns non-zero
    assert.ok(loginScript.includes('if [ -n "$line" ]'), 'dn42-login must check $line upon read non-zero exit');
    assert.ok(passwdScript.includes('if [ -n "$line" ]'), 'passwd must check $line upon read non-zero exit');

    // Both scripts must call flush_after_input after signature reading loop
    assert.ok(loginScript.includes('flush_after_input'), 'dn42-login must call flush_after_input');
    assert.ok(passwdScript.includes('flush_after_input'), 'passwd must call flush_after_input');
  });

  await t.test('4. AuthController.verifySignature disambiguates missing parameters', async () => {
    // Case A: Completely empty body
    const r1 = await AuthController.verifySignature({});
    assert.equal(r1.success, false);
    assert.match(r1.error.message, /Missing required parameter\(s\): asn, challengeText, signature/);

    // Case B: Only signature is missing
    const r2 = await AuthController.verifySignature({
      asn: 4242421888,
      challengeText: 'akilab:4242421888:1726930000:abcde'
    });
    assert.equal(r2.success, false);
    assert.equal(r2.error.message, 'Missing required parameter(s): signature');

    // Case C: Only challengeText is missing
    const r3 = await AuthController.verifySignature({
      asn: 4242421888,
      signature: '-----BEGIN SSH SIGNATURE-----'
    });
    assert.equal(r3.success, false);
    assert.equal(r3.error.message, 'Missing required parameter(s): challengeText');

    // Case D: Only ASN is missing
    const r4 = await AuthController.verifySignature({
      challengeText: 'akilab:4242421888:1726930000:abcde',
      signature: '-----BEGIN SSH SIGNATURE-----'
    });
    assert.equal(r4.success, false);
    assert.equal(r4.error.message, 'Missing required parameter(s): asn');
  });

  await t.test('5. rootfs.dat is newly compiled and non-empty', () => {
    const rootfsPath = path.resolve(ROOT_DIR, 'cli/public/rootfs.dat');
    assert.ok(fs.existsSync(rootfsPath), 'rootfs.dat must exist');
    const stats = fs.statSync(rootfsPath);
    assert.ok(stats.size > 200000, `rootfs.dat size should be > 200KB, got ${stats.size}`);
  });
});
