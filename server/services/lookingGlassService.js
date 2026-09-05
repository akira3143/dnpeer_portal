import { getActiveConfig } from '../storage/configLoader.js';

export class LookingGlassService {
  /**
   * Query Looking Glass route/protocol info across nodes
   */
  static async query({ nodeId, command = 'summary', target = '' }) {
    const config = getActiveConfig();
    const cleanId = String(nodeId || '').trim().toLowerCase();
    const node = cleanId
      ? config.nodes.find(n => n.id.toLowerCase() === cleanId || (n.code && n.code.toLowerCase() === cleanId))
      : config.nodes[0];

    if (!node) {
      return {
        success: false,
        error: `Node ${nodeId} not found`
      };
    }

    let cleanCmd = String(command || 'summary').trim();
    let cleanTarget = String(target || '').trim();

    // Support "show protocols [target]", "show status", "show route [target]"
    if (cleanCmd.toLowerCase().startsWith('show ')) {
      const parts = cleanCmd.split(/\s+/);
      cleanCmd = (parts[1] || 'summary').toLowerCase();
      if (parts.length > 2 && !cleanTarget) {
        cleanTarget = parts.slice(2).join(' ');
      }
    } else {
      cleanCmd = cleanCmd.toLowerCase();
    }

    if (cleanCmd === 'bgp') cleanCmd = 'protocols';
    if (cleanCmd === 'trace') cleanCmd = 'traceroute';

    if (process.env.MOCK_LG_OUTPUT) {
      return {
        success: true,
        nodeId: node.id,
        command: cleanCmd,
        target: cleanTarget,
        output: process.env.MOCK_LG_OUTPUT
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
      url.searchParams.set('cmd', cleanCmd);
      if (cleanTarget) url.searchParams.set('target', cleanTarget);

      const response = await fetch(url.toString(), {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(4000)
      });

      if (response.ok) {
        const data = await response.json();
        return {
          success: true,
          nodeId: node.id,
          command: cleanCmd,
          target: cleanTarget,
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
