import { SessionService } from '../services/sessionService.js';
import { successEnvelope, errorEnvelope } from '../utils/envelope.js';
import { normalizeAsn } from '../utils/validator.js';

export class PeeringController {
  static async submitPeering(body, user) {
    if (!user || !user.asn) {
      return errorEnvelope('Unauthorized', null, 401);
    }

    if (!body || typeof body !== 'object') {
      return errorEnvelope('Invalid request body. Expected JSON object.', null, 200);
    }

    const payloadAsn = normalizeAsn(body.asn);
    const userAsn = normalizeAsn(user.asn);

    if (!payloadAsn || !userAsn || payloadAsn !== userAsn) {
      return errorEnvelope('Cannot submit peering application for another ASN', null, 403);
    }

    const result = await SessionService.submitPeering(body);

    if (!result.success) {
      return errorEnvelope(result.message || 'Submission validation failed', result.fieldErrors || null, 200);
    }

    return successEnvelope(result.data, 200);
  }
}
