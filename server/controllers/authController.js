import { AuthService } from '../services/authService.js';
import { validateAsn, normalizeAsn } from '../utils/validator.js';
import { successEnvelope, errorEnvelope } from '../utils/envelope.js';

export class AuthController {
  static async getChallenge(params) {
    const asn = params?.asn || params?.asnNumber;
    const cleanAsn = parseInt(normalizeAsn(asn), 10);
    
    // V2: Check if ASN exists in auth_users.json for test account exemption
    const authUsers = await AuthService.getAuthUsers();
    const isKnownUser = cleanAsn && (authUsers[String(cleanAsn)] || authUsers[`AS${cleanAsn}`] || authUsers[String(asn)]);

    const valRes = validateAsn(asn);
    if (!valRes.valid && !isKnownUser) {
      return errorEnvelope(valRes.error || 'Valid ASN is required', { asn: valRes.error }, 200);
    }

    const challenge = await AuthService.createChallenge(cleanAsn || valRes.value);
    return successEnvelope(challenge, 200);
  }

  static async verifySignature(body) {
    const asn = body?.asn || body?.asnNumber;
    const challengeText = body?.challengeText || body?.challenge;
    const signature = body?.signature || body?.sshSignature || body?.sig;

    if (!asn || !challengeText || !signature) {
      return errorEnvelope(
        'Missing required parameters: asn, challengeText, signature',
        {
          asn: !asn ? 'ASN is required' : undefined,
          challengeText: !challengeText ? 'challengeText is required' : undefined,
          signature: !signature ? 'signature is required' : undefined
        },
        200
      );
    }

    const result = await AuthService.verifySignature({
      asn,
      challengeText,
      signature,
      rememberMe: !!body?.rememberMe
    });

    if (!result.success) {
      return errorEnvelope(result.error || 'Signature verification failed', null, 200);
    }

    return successEnvelope(result.data, 200);
  }

  static async loginPassword(body) {
    const username = body?.username || body?.asn;
    const password = body?.password;
    const rememberMe = !!body?.rememberMe;

    if (!username || !password) {
      return errorEnvelope(
        'Username/ASN and password are required',
        {
          username: !username ? 'Username or ASN is required' : undefined,
          password: !password ? 'Password is required' : undefined
        },
        200
      );
    }

    const result = await AuthService.loginWithPassword({
      username,
      password,
      rememberMe
    });

    if (!result.success) {
      return errorEnvelope(result.error || 'Invalid credentials', null, 200);
    }

    return successEnvelope(result.data, 200);
  }

  static async setPassword(user, body) {
    if (!user) {
      return errorEnvelope('Unauthorized', null, 401);
    }

    const newPassword = body?.newPassword || body?.password;
    if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 8) {
      return errorEnvelope('Password must be at least 8 characters long', { password: 'Password min length is 8' }, 200);
    }

    const result = await AuthService.setPassword(user.asn, newPassword);
    if (!result.success) {
      return errorEnvelope(result.error || 'Failed to update password', null, 200);
    }

    return successEnvelope({ message: 'Password updated successfully' }, 200);
  }

  static async getStatus(user) {
    if (!user) {
      return successEnvelope({
        authenticated: false,
        user: null
      }, 200);
    }

    return successEnvelope({
      authenticated: true,
      user: {
        asn: user.asn,
        asName: user.asName,
        role: user.role,
        isAdmin: user.role === 'admin'
      }
    }, 200);
  }

  static async getMe(user) {
    if (!user) {
      return errorEnvelope('Unauthorized', null, 401);
    }
    return successEnvelope({
      asn: user.asn,
      asName: user.asName,
      role: user.role,
      isAdmin: user.role === 'admin'
    }, 200);
  }
}
