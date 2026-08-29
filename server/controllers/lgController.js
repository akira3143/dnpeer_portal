import { LookingGlassService } from '../services/lookingGlassService.js';
import { successEnvelope, errorEnvelope } from '../utils/envelope.js';

export class LookingGlassController {
  static async query(params) {
    const nodeId = params?.nodeId;
    const command = params?.command || params?.commandType || 'summary';
    const target = params?.target || '';

    const result = await LookingGlassService.query({ nodeId, command, target });
    if (!result.success) {
      return errorEnvelope(result.error || 'Looking Glass query failed', null, 200);
    }
    return successEnvelope(result, 200);
  }
}
