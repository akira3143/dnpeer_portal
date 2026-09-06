import { getActiveConfig } from '../storage/configLoader.js';
import { StatusTracker } from './statusTracker.js';

export class LookingGlassService {
  /**
   * Helper to retrieve cached BGP snapshot reported by probe agent
   */
  static getProbeBgpFallback(nodeId, cmd, target) {
    const snapshot = StatusTracker.getBgpSnapshot(nodeId);
    if (snapshot) {
      if (snapshot.rawBgpOutput && snapshot.rawBgpOutput.trim()) {
        return {
          success: true,
          nodeId,
          command: cmd,
          target,
          output: snapshot.rawBgpOutput.trim(),
          source: 'probe_cache'
        };
      }
      if (Array.isArray(snapshot.bgpSessions) && snapshot.bgpSessions.length > 0) {
        const lines = [
          'BIRD 2.15.1 ready (Cached snapshot via Node Probe Agent)',
          'Name       Proto      Table      State  Since         Info'
        ];
        for (const s of snapshot.bgpSessions) {
          const name = String(s.name || 'bgp').padEnd(10);
          const proto = 'BGP       ';
          const table = String(s.table || 'master4').padEnd(10);
          const state = String(s.bgpState === 'Established' ? 'up' : 'start').padEnd(6);
          const since = String(s.since || 'recently').padEnd(13);
          const info = s.info || s.bgpState || 'Established';
          lines.push(`${name} ${proto} ${table} ${state} ${since} ${info}`);
        }
        return {
          success: true,
          nodeId,
          command: cmd,
          target,
          output: lines.join('\n'),
          source: 'probe_cache'
        };
      }
    }
    return null;
  }

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

    // Determine target lgProxyUrl with intelligent fallbacks
    let targetLgUrl = (node.lgProxyUrl || '').trim();
    if (!targetLgUrl) {
      const isLocalMaster = Boolean(config.nodes && config.nodes[0] && config.nodes[0].id.toLowerCase() === node.id.toLowerCase());
      if (isLocalMaster) {
        targetLgUrl = 'http://127.0.0.1:5000';
      } else if (node.tunnelIpv4) {
        targetLgUrl = `http://${node.tunnelIpv4}:5000`;
      } else if (node.endpointDomain) {
        targetLgUrl = `http://${node.endpointDomain}:5000`;
      }
    }

    const isBgpQuery = (cleanCmd === 'protocols' || cleanCmd === 'summary' || cleanCmd === 'status');

    if (!targetLgUrl) {
      if (isBgpQuery) {
        const fallback = this.getProbeBgpFallback(node.id, cleanCmd, cleanTarget);
        if (fallback) return fallback;
      }
      return {
        success: false,
        error: `lgproxy is not configured for node ${node.id}`
      };
    }

    try {
      // bird-lgproxy (Go/Python) API: /bird?q=<full birdc command>, /traceroute?q=<target>
      let lgPath = '/bird';
      let qValue = `show ${cleanCmd}${cleanTarget ? ' ' + cleanTarget : ''}`;
      if (cleanCmd === 'traceroute') {
        lgPath = '/traceroute';
        qValue = cleanTarget || '';
      }
      const url = new URL(lgPath, targetLgUrl);
      url.searchParams.set('q', qValue);

      const response = await fetch(url.toString(), {
        headers: { 'Accept': 'text/plain, application/json' },
        signal: AbortSignal.timeout(4000)
      });

      if (response.ok) {
        const raw = await response.text();
        let data = raw;
        try {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === 'object') {
            data = parsed.output || parsed.result || JSON.stringify(parsed);
          }
        } catch {
          // plain text output, use as-is
        }
        return {
          success: true,
          nodeId: node.id,
          command: cleanCmd,
          target: cleanTarget,
          output: data
        };
      }

      if (isBgpQuery) {
        const fallback = this.getProbeBgpFallback(node.id, cleanCmd, cleanTarget);
        if (fallback) return fallback;
      }

      return {
        success: false,
        error: `lgproxy returned HTTP ${response.status} for node ${node.id}`
      };
    } catch (err) {
      if (isBgpQuery) {
        const fallback = this.getProbeBgpFallback(node.id, cleanCmd, cleanTarget);
        if (fallback) return fallback;
      }

      return {
        success: false,
        error: `lgproxy unreachable at ${targetLgUrl} for node ${node.id}: ${err.message || 'connection failed'}`
      };
    }
  }
}
