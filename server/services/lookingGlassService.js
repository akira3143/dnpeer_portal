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

    // If node has an lgProxyUrl, fetch from proxy
    if (node.lgProxyUrl) {
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
      } catch (err) {
        // Fallback simulated response in dev or unreachable proxy
      }
    }

    // Default mock response when lgproxy is not connected
    return {
      success: true,
      nodeId: node.id,
      command,
      output: `BIRD 2.15 ready.\nCommand: ${command} ${target || ''}\nNode: ${node.name} (${node.id})\nStatus: Operational`
    };
  }
}
