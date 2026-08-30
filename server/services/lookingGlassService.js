import { getActiveConfig } from '../storage/configLoader.js';

export class LookingGlassService {
  /**
   * Query Looking Glass route/protocol info across nodes
   */
  static async query({ nodeId, command = 'summary', target = '' }) {
    const config = getActiveConfig();
    const node = nodeId ? config.nodes.find(n => n.id === nodeId) : config.nodes[0];

    if (!node) {
      return {
        success: false,
        error: `Node ${nodeId} not found`
      };
    }

    if (!node.lgProxyUrl) {
      return {
        success: false,
        error: `lgproxy is not configured for node ${node.id}`
      };
    }

    try {
      const url = new URL('/api/bird', node.lgProxyUrl);
      url.searchParams.set('cmd', command);
      if (target) url.searchParams.set('target', target);

      const response = await fetch(url.toString(), {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(4000)
      });

      if (response.ok) {
        const data = await response.json();
        return {
          success: true,
          nodeId: node.id,
          command,
          output: data.output || data.result || JSON.stringify(data)
        };
      }

      return {
        success: false,
        error: `lgproxy returned HTTP ${response.status} for node ${node.id}`
      };
    } catch (err) {
      return {
        success: false,
        error: `lgproxy unreachable for node ${node.id}: ${err.message || 'connection failed'}`
      };
    }
  }
}
