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
<body style="margin: 0; padding: 32px 16px; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; -webkit-font-smoothing: antialiased; color: #1e293b;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width: 520px; margin: 0 auto; background-color: #ffffff; border-radius: 14px; overflow: hidden; border: 1px solid #e2e8f0; box-shadow: 0 4px 20px -2px rgba(0, 0, 0, 0.05);">
    <!-- Top Accent Gradient Stripe -->
    <tr>
      <td height="4" style="background: linear-gradient(90deg, #06b6d4 0%, #3b82f6 50%, #8b5cf6 100%); line-height: 4px; font-size: 4px;">&nbsp;</td>
    </tr>

    <!-- Header (Table-based layout for 100% email client compatibility) -->
    <tr>
      <td style="padding: 22px 26px 18px; border-bottom: 1px solid #f1f5f9;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
          <tr>
            <td align="left" valign="middle">
              <span style="font-weight: 700; font-size: 16px; color: #0f172a; letter-spacing: -0.3px;">AkiLab Networks</span>
            </td>
            <td align="right" valign="middle">
              <span style="display: inline-block; padding: 4px 10px; background-color: #f1f5f9; border: 1px solid #e2e8f0; border-radius: 9999px; font-size: 11px; font-weight: 600; color: #64748b; letter-spacing: 0.5px; text-transform: uppercase;">
                DN42 Authentication
              </span>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- Body -->
    <tr>
      <td style="padding: 28px 26px 20px;">
        <p style="margin: 0 0 14px; font-size: 16px; font-weight: 700; color: #0f172a;">
          Hello ${displayName || 'Peer'} <span style="font-weight: 500; color: #64748b; font-size: 14px;">(AS${asn})</span>,
        </p>
        <p style="margin: 0 0 22px; font-size: 14px; line-height: 1.6; color: #475569;">
          We received a sign-in request for your ASN on the <strong>AkiLab DN42 Peering Portal</strong>. Please enter the one-time verification code (OTP) below to authenticate:
        </p>

        <!-- OTP Code Box -->
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; margin: 24px 0;">
          <tr>
            <td align="center" style="padding: 22px 16px 10px;">
              <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.5px; color: #64748b; margin-bottom: 8px;">
                VERIFICATION CODE
              </div>
              <div style="font-family: ui-monospace, 'SF Mono', SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 38px; font-weight: 800; color: #0284c7; letter-spacing: 8px; text-indent: 8px; line-height: 1.1;">
                ${code}
              </div>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding: 0 16px 18px;">
              <div style="font-size: 12px; color: #94a3b8; font-weight: 500;">
                Expires in <strong>10 minutes</strong> &middot; Single use only
              </div>
            </td>
          </tr>
        </table>

        <!-- Security Notice Box -->
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: #f1f5f9; border-radius: 8px; margin: 20px 0 0;">
          <tr>
            <td style="padding: 14px 16px; font-size: 12px; line-height: 1.6; color: #64748b;">
              <strong style="color: #334155;">Security Notice:</strong> AkiLab administrators will never ask for this code. If you did not initiate this request, you can safely ignore this email.
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- Footer -->
    <tr>
      <td style="padding: 18px 26px; background-color: #fafafa; border-top: 1px solid #f1f5f9; text-align: center;">
        <p style="margin: 0 0 5px; font-size: 12px; font-weight: 600; color: #64748b;">
          AkiLab Networks &middot; AS4242423143
        </p>
        <p style="margin: 0; font-size: 11px; color: #94a3b8;">
          Automated security message from AkiLab DN42 Portal. Please do not reply directly.
        </p>
      </td>
    </tr>
  </table>
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
