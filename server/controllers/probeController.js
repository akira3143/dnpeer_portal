import { ENV } from '../config.js';
import { getActiveConfig } from '../storage/configLoader.js';
import { ScannerService } from '../services/scannerService.js';
import { successEnvelope, errorEnvelope } from '../utils/envelope.js';

export class ProbeController {
  static async handleReport(authHeader, body) {
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

  static async getStatus() {
    const config = getActiveConfig();
    const nodes = (config.nodes || []).map(n => ({
      nodeId: n.id,
      code: n.code,
      name: n.name,
      status: n.status || 'active',
      endpoint: n.endpointDomain
    }));

    return successEnvelope({
      nodes,
      timestamp: new Date().toISOString()
    }, 200);
  }
}
