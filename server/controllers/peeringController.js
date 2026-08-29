import { SessionService } from '../services/sessionService.js';
import { successEnvelope, errorEnvelope } from '../utils/envelope.js';

export class PeeringController {
  static async submitPeering(body) {
    if (!body || typeof body !== 'object') {
      return errorEnvelope('Invalid request body. Expected JSON object.', null, 200);
    }

    const result = await SessionService.submitPeering(body);

    if (!result.success) {
      return errorEnvelope(result.message || 'Submission validation failed', result.fieldErrors || null, 200);
    }

    return successEnvelope(result.data, 200);
  }
}
