import { ENV } from '../config.js';
import { ScannerService } from '../services/scannerService.js';
import { successEnvelope, errorEnvelope } from '../utils/envelope.js';

export class ProbeController {
  static async handleReport(authHeader, body) {
    // Probe authentication via Bearer token
    const token = (authHeader || '').replace(/^Bearer\s+/i, '').trim();
    if (!token || token !== ENV.PROBE_AUTH_TOKEN) {
      return errorEnvelope('Unauthorized probe token', null, 401);
    }

    if (!body || !body.nodeId) {
      return errorEnvelope('nodeId is required in probe snapshot', { nodeId: 'nodeId required' }, 200);
    }

    try {
      const result = await ScannerService.handleProbeReport(body);
      return successEnvelope(result, 200);
    } catch (err) {
      return errorEnvelope(err.message || 'Failed to process probe report', null, 200);
    }
  }
}
