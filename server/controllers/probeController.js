import { getActiveConfig } from '../storage/configLoader.js';
import { NodeTokenStorage } from '../storage/nodeTokenStorage.js';
import { ScannerService } from '../services/scannerService.js';
import { StatusTracker } from '../services/statusTracker.js';
import { successEnvelope, errorEnvelope } from '../utils/envelope.js';

export class ProbeController {
  static async handleRegister(authHeader, body) {
    const token = (authHeader || '').replace(/^Bearer\s+/i, '').trim() || (body?.token ? String(body.token).trim() : '');
    if (!token) {
      return errorEnvelope('Probe authentication token is required', null, 401);
    }

    const nodeId = body?.nodeId ? String(body.nodeId).trim() : '';
    if (!nodeId) {
      return errorEnvelope('nodeId is required in registration payload', null, 400);
    }

    const config = getActiveConfig();
    const nodes = config.nodes || [];
    const targetNode = nodes.find(
      n => n.id.toLowerCase() === nodeId.toLowerCase() || (n.code && n.code.toLowerCase() === nodeId.toLowerCase())
    );

    if (!targetNode) {
      return errorEnvelope(`Node "${nodeId}" not found in portal configuration`, null, 404);
    }

    // 1. Verify dedicated token for this node
    const isTokenValid = NodeTokenStorage.verifyToken(targetNode.id, token);
    if (!isTokenValid) {
      return errorEnvelope(`Invalid dedicated probe token for node "${targetNode.id}"`, null, 403);
    }

    // 2. Verify candidate WireGuard public keys (dark secret matching)
    const candidateKeys = Array.isArray(body?.publicKeys)
      ? body.publicKeys
      : Array.isArray(body?.candidateKeys)
      ? body.candidateKeys
      : [];

    if (!candidateKeys || candidateKeys.length === 0) {
      return errorEnvelope('publicKeys array is required in registration payload', null, 400);
    }

    const normalizedCandidateKeys = candidateKeys.map(k => String(k).trim());
    const expectedKey = targetNode.wgPublicKey ? targetNode.wgPublicKey.trim() : '';

    if (!expectedKey || !normalizedCandidateKeys.includes(expectedKey)) {
      return errorEnvelope(
        `WireGuard public key did not match node "${targetNode.id}". Please verify that your local private key derives to ${expectedKey || 'configured key'}.`,
        { candidateKeys },
        403
      );
    }

    // Double condition satisfied -> Claim success -> update lastSeen immediately ("对上暗号即在线")
    StatusTracker.recordHeartbeat(targetNode.id);

    return successEnvelope({
      nodeId: targetNode.id,
      matchedPublicKey: targetNode.wgPublicKey
    }, 200);
  }

  static async handleReport(authHeader, body) {
    const nodeId = body?.nodeId ? String(body.nodeId).trim() : '';
    if (!nodeId) {
      return errorEnvelope('nodeId is required in probe snapshot', { nodeId: 'nodeId required' }, 400);
    }

    const token = (authHeader || '').replace(/^Bearer\s+/i, '').trim() || (body?.token ? String(body.token).trim() : '');
    if (!token) {
      return errorEnvelope('Probe authentication token is required', null, 401);
    }

    // Verify dedicated token for this node
    const isTokenValid = NodeTokenStorage.verifyToken(nodeId, token);
    if (!isTokenValid) {
      return errorEnvelope(`Unauthorized: Invalid dedicated probe token for node "${nodeId}"`, null, 403);
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
    const nodes = (config.nodes || []).map(n => {
      const statusInfo = StatusTracker.getNodeStatus(n.id);
      return {
        nodeId: n.id,
        code: n.code,
        name: n.name,
        status: statusInfo.status,
        online: statusInfo.online,
        lastSeen: statusInfo.lastSeen,
        endpoint: n.endpointDomain
      };
    });

    const probes = StatusTracker.getProbesMap(config.nodes || []);

    const resp = successEnvelope({
      nodes,
      probes,
      timestamp: new Date().toISOString()
    }, 200);

    // Provide top-level convenience properties
    resp.probes = probes;
    resp.nodes = nodes;
    return resp;
  }
}
