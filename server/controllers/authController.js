import { AuthService } from '../services/authService.js';
import { validateAsn } from '../utils/validator.js';
import { successEnvelope, errorEnvelope } from '../utils/envelope.js';

export class AuthController {
  static async getChallenge(query) {
    const asn = query.asn;
    const valRes = validateAsn(asn);
    if (!valRes.valid) {
      return errorEnvelope(valRes.error || 'Valid ASN is required', { asn: valRes.error }, 200);
    }

    const challenge = await AuthService.createChallenge(valRes.value);
    return successEnvelope(challenge, 200);
  }

  static async verifySignature(body) {
    if (!body || !body.asn || !body.challengeText || !body.signature) {
      return errorEnvelope(
        'Missing required parameters: asn, challengeText, signature',
        {
          asn: !body?.asn ? 'ASN is required' : undefined,
          challengeText: !body?.challengeText ? 'challengeText is required' : undefined,
          signature: !body?.signature ? 'signature is required' : undefined
        },
        200
      );
    }

    const result = await AuthService.verifySignature(body);
    if (!result.success) {
      return errorEnvelope(result.error || 'Signature verification failed', null, 200);
    }

    return successEnvelope(result.data, 200);
  }

  static async loginPassword(body) {
    if (!body || !body.username || !body.password) {
      return errorEnvelope(
        'Username and password are required',
        {
          username: !body?.username ? 'Username is required' : undefined,
          password: !body?.password ? 'Password is required' : undefined
        },
        200
      );
    }

    const result = await AuthService.loginWithPassword(body);
    if (!result.success) {
      return errorEnvelope(result.error || 'Invalid credentials', null, 200);
    }

    return successEnvelope(result.data, 200);
  }

  static async getMe(user) {
    if (!user) {
      return errorEnvelope('Unauthorized', null, 401);
    }
    return successEnvelope({
      asn: user.asn,
      asName: user.asName,
      role: user.role
    }, 200);
  }
}
