import { ENV } from '../config.js';

const COOLDOWN_MS = 30 * 1000;       // 30 seconds cooldown
const EXPIRATION_MS = 10 * 60 * 1000; // 10 minutes validity
const MAX_ATTEMPTS = 5;

// In-memory OTP storage: cleanAsn -> { code, email, expiresAt, lastSentAt, attempts }
const otpStore = new Map();

export class EmailService {
  /**
   * Check cooldown for an ASN
   * @returns {number} Remaining seconds, or 0 if allowed
   */
  static getCooldownRemaining(asn) {
    const cleanAsn = parseInt(asn, 10);
    const existing = otpStore.get(cleanAsn);
    if (!existing || !existing.lastSentAt) return 0;
    const elapsed = Date.now() - existing.lastSentAt;
    if (elapsed < COOLDOWN_MS) {
      return Math.ceil((COOLDOWN_MS - elapsed) / 1000);
    }
    return 0;
  }

  /**
   * Generate 6-digit numeric OTP and record cooldown
   */
  static generateOtp(asn, email) {
    const cleanAsn = parseInt(asn, 10);
    const remaining = this.getCooldownRemaining(cleanAsn);
    if (remaining > 0) {
      const err = new Error(`Please wait ${remaining}s before requesting another verification code.`);
      err.code = 429;
      err.remainingSeconds = remaining;
      throw err;
    }

    // 6-digit numeric code
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const now = Date.now();

    otpStore.set(cleanAsn, {
      code,
      email: email.trim().toLowerCase(),
      expiresAt: now + EXPIRATION_MS,
      lastSentAt: now,
      attempts: 0
    });

    return code;
  }

  /**
   * Verify an OTP code for an ASN
   */
  static verifyOtp(asn, inputCode) {
    const cleanAsn = parseInt(asn, 10);
    const record = otpStore.get(cleanAsn);

    if (!record) {
      return { valid: false, error: 'No verification code found. Please request a new code.' };
    }

    if (Date.now() > record.expiresAt) {
      otpStore.delete(cleanAsn);
      return { valid: false, error: 'Verification code expired. Please request a new code.' };
    }

    if (record.attempts >= MAX_ATTEMPTS) {
      otpStore.delete(cleanAsn);
      return { valid: false, error: 'Too many incorrect attempts. Code invalidated, please request a new one.' };
    }

    const cleanInput = String(inputCode || '').trim().replace(/\s+/g, '');
    if (record.code !== cleanInput) {
      record.attempts += 1;
      const remaining = MAX_ATTEMPTS - record.attempts;
      return {
        valid: false,
        error: remaining > 0
          ? `Invalid verification code. (${remaining} attempt${remaining > 1 ? 's' : ''} remaining)`
          : 'Invalid verification code. Code invalidated, please request a new one.'
      };
    }

    // Single-use: burn on success
    otpStore.delete(cleanAsn);
    return { valid: true };
  }

  /**
   * Render HTML email template (Full English)
   */
  static renderEmailHtml({ asn, displayName, code }) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AkiLab DN42 Authentication Code</title>
</head>
<body style="margin: 0; padding: 24px 16px; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased; color: #1e293b;">
  <div style="max-width: 540px; margin: 0 auto; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 10px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
    <!-- Brand Header -->
    <div style="padding: 20px 24px; border-bottom: 1px solid #f1f5f9; display: flex; align-items: center; justify-content: space-between;">
      <span style="font-weight: 700; font-size: 15px; color: #0f172a; letter-spacing: -0.3px;">AkiLab Networks</span>
      <span style="font-size: 12px; color: #64748b; font-weight: 500;">DN42 Authentication</span>
    </div>

    <!-- Body -->
    <div style="padding: 28px 24px 20px;">
      <p style="margin: 0 0 14px; font-size: 15px; font-weight: 600; color: #0f172a;">
        Hello ${displayName || 'Peer'} (AS${asn}),
      </p>
      <p style="margin: 0 0 20px; font-size: 14px; line-height: 1.6; color: #475569;">
        We received a request to verify your identity on the AkiLab DN42 Portal. Please enter the one-time verification code (OTP) below to complete your sign-in:
      </p>

      <!-- Code Box -->
      <div style="background-color: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 18px 20px; text-align: center; margin: 24px 0;">
        <span style="font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 32px; font-weight: 700; color: #15803d; letter-spacing: 4px;">
          ${code}
        </span>
      </div>

      <ul style="margin: 20px 0 0; padding-left: 20px; font-size: 13px; line-height: 1.8; color: #64748b;">
        <li>This code is valid for <strong>10 minutes</strong> and will expire immediately after single use.</li>
        <li>Do not share this code with anyone. AkiLab administrators will never ask for it.</li>
      </ul>

      <p style="margin: 20px 0 0; font-size: 12px; line-height: 1.6; color: #94a3b8; border-top: 1px solid #f1f5f9; padding-top: 16px;">
        If you did not initiate this request, you can safely ignore this email. Your DN42 peering sessions and assets will not be affected.
      </p>
    </div>

    <!-- Footer -->
    <div style="padding: 16px 24px; background-color: #f8fafc; border-top: 1px solid #f1f5f9; text-align: center;">
      <p style="margin: 0; font-size: 12px; color: #94a3b8;">
        &copy; 2026 AkiLab Networks &middot; AS4242423143<br/>
        Automated system message, please do not reply directly.
      </p>
    </div>
  </div>
</body>
</html>`;
  }

  /**
   * Send verification email via Resend API
   */
  static async sendVerificationEmail({ asn, displayName, email, code }) {
    const apiKey = ENV.RESEND_API_KEY;
    if (!apiKey) {
      throw new Error('Resend API key is not configured on the server. Please check RESEND_API_KEY.');
    }

    const from = ENV.RESEND_FROM || 'AkiLab Networks <akira@akilab.meme>';
    const subject = `[AkiLab DN42] Verification Code: ${code}`;
    const html = this.renderEmailHtml({ asn, displayName, code });

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from,
        to: [email],
        subject,
        html
      })
    });

    const data = await response.json();
    if (!response.ok) {
      console.error('[EmailService] Resend API error:', response.status, data);
      const errMsg = (data && (data.message || data.error)) || `Resend error (${response.status})`;
      throw new Error(`Failed to send email: ${errMsg}`);
    }

    return {
      success: true,
      messageId: data.id,
      email
    };
  }

  /**
   * Get OTP record for testing/inspection
   */
  static getOtpRecord(asn) {
    return otpStore.get(parseInt(asn, 10));
  }

  /**
   * Set OTP record for testing
   */
  static setOtpRecord(asn, record) {
    otpStore.set(parseInt(asn, 10), record);
  }

  /**
   * Delete OTP record for testing
   */
  static deleteOtpRecord(asn) {
    otpStore.delete(parseInt(asn, 10));
  }

  /**
   * Reset store (used in tests)
   */
  static _resetStoreForTesting() {
    otpStore.clear();
  }
}
