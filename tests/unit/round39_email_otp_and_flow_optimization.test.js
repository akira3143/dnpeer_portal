import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EmailService } from '../../server/services/emailService.js';
import { RegistryService } from '../../server/services/registryService.js';
import { AuthController } from '../../server/controllers/authController.js';
import { ENV } from '../../server/config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');

describe('Round 39: Email OTP Authentication & Two-Stage Login Flow', () => {
  const testAsn = 4242429991;
  const testEmail = 'test-round39@akilab.meme';

  it('1. EmailService generates 6-digit numeric OTP and enforces 30s cooldown', async () => {
    // Clean any prior state for testAsn
    EmailService.deleteOtpRecord(testAsn);

    try {
      // 1A. First OTP generation succeeds
      const code = EmailService.generateOtp(testAsn, testEmail);
      assert.match(code, /^\d{6}$/, 'OTP must be 6 digits');

      const otpRecord = EmailService.getOtpRecord(testAsn);
      assert.ok(otpRecord);
      assert.equal(otpRecord.code, code);
      assert.equal(otpRecord.email, testEmail);
      assert.equal(otpRecord.attempts, 0);

      // Check cooldown remaining is active (between 1 and 30 seconds)
      const remaining = EmailService.getCooldownRemaining(testAsn);
      assert.ok(remaining > 0 && remaining <= 30, 'Cooldown remaining must be between 1 and 30s');

      // 1B. Immediate second generation triggers 30s cooldown rejection
      assert.throws(
        () => {
          EmailService.generateOtp(testAsn, testEmail);
        },
        (err) => {
          assert.equal(err.code, 429);
          assert.ok(err.remainingSeconds > 0 && err.remainingSeconds <= 30);
          assert.match(err.message, /Please wait/);
          return true;
        },
        'Must throw 429 when cooldown is active'
      );

      // 1C. HTML email template check (Full English, no spam notice per user request, contiguous code without space)
      const html = EmailService.renderEmailHtml({
        asn: testAsn,
        displayName: 'Akira Tester',
        code
      });
      assert.ok(html.includes('DN42 Authentication'), 'Email HTML must be in English');
      assert.ok(!html.includes('垃圾邮件'), 'Email HTML must not include spam reminder per request');
      assert.ok(html.includes('AS4242429991'), 'Email HTML must include ASN');
      assert.ok(html.includes(code), 'Email HTML must include contiguous OTP code without space');
      assert.ok(!html.includes(`${code.slice(0, 3)} ${code.slice(3)}`), 'Email HTML must not have space in OTP code string');
    } finally {
      EmailService.deleteOtpRecord(testAsn);
    }
  });

  it('2. EmailService verifies valid OTP, burns single-use code, and rejects wrong/exceeded attempts', () => {
    EmailService.deleteOtpRecord(testAsn);
    const mockCode = '654321';
    EmailService.setOtpRecord(testAsn, {
      code: mockCode,
      email: testEmail,
      createdAt: Date.now(),
      expiresAt: Date.now() + 10 * 60 * 1000,
      attempts: 0
    });

    // 2A. Wrong code increments attempts and fails
    const failRes = EmailService.verifyOtp(testAsn, '000000');
    assert.equal(failRes.valid, false);
    assert.match(failRes.error, /Invalid verification code/);
    assert.equal(EmailService.getOtpRecord(testAsn).attempts, 1);

    // 2B. Correct code succeeds and burns the OTP record
    const okRes = EmailService.verifyOtp(testAsn, mockCode);
    assert.equal(okRes.valid, true);
    assert.equal(EmailService.getOtpRecord(testAsn), undefined, 'OTP must be burned upon successful verification');

    // 2C. Replay fails because OTP was deleted
    const replayRes = EmailService.verifyOtp(testAsn, mockCode);
    assert.equal(replayRes.valid, false);
    assert.match(replayRes.error, /No verification code found/);
  });

  it('3. EmailService rejects expired OTP', () => {
    EmailService.deleteOtpRecord(testAsn);
    EmailService.setOtpRecord(testAsn, {
      code: '123456',
      email: testEmail,
      createdAt: Date.now() - 15 * 60 * 1000,
      expiresAt: Date.now() - 5 * 60 * 1000, // expired 5 mins ago
      attempts: 0
    });

    const res = EmailService.verifyOtp(testAsn, '123456');
    assert.equal(res.valid, false);
    assert.match(res.error, /expired/i);
    assert.equal(EmailService.getOtpRecord(testAsn), undefined);
  });

  it('4. RegistryService parseContactInfoFromText extracts emails and handles', () => {
    const mockPersonRaw = `person:      Akira Test
e-mail:      akira876305639@gmail.com
nic-hdl:     AKIRA-MNT
source:      DN42`;

    const info = RegistryService.parseContactInfoFromText(mockPersonRaw, 'AKIRA-MNT');
    assert.equal(info.personName, 'Akira Test');
    assert.ok(info.emails.includes('akira876305639@gmail.com'));
    assert.equal(info.primaryEmail, 'akira876305639@gmail.com');
    assert.equal(info.emailSource, 'AKIRA-MNT');
  });

  it('5. AuthController checkAuth and email OTP endpoints', async () => {
    // 5A. checkAuth invalid ASN format
    const checkInvalid = await AuthController.checkAuth({ asn: 'invalid-asn' });
    assert.equal(checkInvalid.code, 200);
    assert.equal(checkInvalid.success, false);
    assert.match(checkInvalid.error.message, /Invalid ASN format/i);

    // 5B. sendEmailOtp invalid ASN format
    const sendInvalid = await AuthController.sendEmailOtp({ asn: 'invalid' });
    assert.equal(sendInvalid.code, 200);
    assert.equal(sendInvalid.success, false);
    assert.match(sendInvalid.error.message, /Invalid ASN format/i);

    // 5C. verifyEmailOtp invalid parameters
    const verifyMissing = await AuthController.verifyEmailOtp({ asn: 4242429991 });
    assert.equal(verifyMissing.code, 200);
    assert.equal(verifyMissing.success, false);
    assert.match(verifyMissing.error.message, /code is required/i);
  });

  it('6. Security & Credential Isolation: Resend API Key is not tracked in git', () => {
    const gitignoreContent = fs.readFileSync(path.resolve(ROOT_DIR, '.gitignore'), 'utf8');
    assert.ok(gitignoreContent.includes('*.key'), '.gitignore must ignore *.key files');
    assert.ok(gitignoreContent.includes('server/data/*.key'), '.gitignore must ignore server/data/*.key');
    assert.ok(gitignoreContent.includes('server/.env'), '.gitignore must ignore server/.env');

    // Confirm ENV.RESEND_FROM contains the verified sender
    assert.ok(ENV.RESEND_FROM.includes('akira@akilab.meme'), 'Sender address must be akira@akilab.meme');
  });

  it('7. GUI AuthModal contains Figure 2 layout elements, 30s cooldown, and spam notice', () => {
    const guiModal = fs.readFileSync(
      path.resolve(ROOT_DIR, 'gui/src/components/AuthModal.tsx'),
      'utf8'
    );
    assert.ok(guiModal.includes('你好，'), 'Must include Figure 2 greeting');
    assert.ok(guiModal.includes('邮箱验证'), 'Must include Email OTP verification card');
    assert.ok(guiModal.includes('SSH 签名'), 'Must include SSH Signature verification card');
    assert.ok(guiModal.includes('发起挑战'), 'Must include Initiate Challenge action button');
    assert.ok(guiModal.includes('显示完整密钥'), 'Must include toggle for full SSH key display');
    assert.ok(guiModal.includes('emailCooldown'), 'Must maintain emailCooldown state');
    assert.ok(guiModal.includes('垃圾邮件箱 (Spam / Junk)'), 'Must include spam folder warning');
    assert.ok(guiModal.includes('setEmailCooldown(30)'), 'Must set cooldown to 30 seconds');
    assert.ok(guiModal.includes('onPaste'), 'Must include onPaste handler for OTP clipboard input');
  });

  it('8. CLI dn42-login contains two-stage choice, silent sending, 30s cooldown, and spam warning', () => {
    const cliScript = fs.readFileSync(
      path.resolve(ROOT_DIR, 'cli/cli-src/sbin/dn42-login'),
      'utf8'
    );
    assert.ok(cliScript.includes('First-time login detected'), 'Must notify user of first-time login');
    assert.ok(cliScript.includes('Email OTP Verification'), 'Must offer Email OTP as option 1');
    assert.ok(cliScript.includes('SSH Key Signature'), 'Must offer SSH Signature as option 2');
    assert.ok(cliScript.includes('/api/auth/email/send'), 'Must invoke email send endpoint');
    assert.ok(cliScript.includes('/api/auth/email/verify'), 'Must invoke email verify endpoint');
    assert.ok(cliScript.includes('Notice: If not received, please check your Spam / Junk folder.'), 'Must display exact spam folder warning in English');
    assert.ok(cliScript.includes('30s cooldown'), 'Must display 30s cooldown reminder');
    assert.ok(cliScript.includes('[ "$pwd" = "mail" ]'), 'Must allow typing mail to switch from password login');

    // Check compiled rootfs.dat exists and is non-empty
    const rootfsStat = fs.statSync(path.resolve(ROOT_DIR, 'cli/public/rootfs.dat'));
    assert.ok(rootfsStat.size > 500000, 'Compiled rootfs.dat must be valid and non-empty');
  });

  it('9. dn42-lib.sh read_line_edit safely handles Enter detection without subshell newline stripping', () => {
    const libScript = fs.readFileSync(
      path.resolve(ROOT_DIR, 'cli/cli-src/etc/dn42-lib.sh'),
      'utf8'
    );
    // Must NOT contain unquoted $(printf '\n') in enter check (which evaluates to empty string and matches any char)
    assert.ok(!libScript.includes("[ \"$_c\" = \"$(printf '\\n')\" ]"), 'Must not have empty string check');
    assert.ok(libScript.includes('"$_c" = "$_cr"') || libScript.includes('"$_c" = "$_nl"'), 'Must check explicit _cr or _nl variables');
    assert.ok(libScript.includes('local _cr='), 'Must define _cr variable');
    assert.ok(libScript.includes('local _nl='), 'Must define _nl variable');
  });
});
