import { execSync } from 'node:child_process';
import { getActiveConfig } from '../storage/configLoader.js';
import { PortLedgerService } from './portLedgerService.js';
import { SessionService } from './sessionService.js';
import { StatusTracker } from './statusTracker.js';
import { parseBgpProtocols, parseWireguardConfigs } from '../../scripts/probe-agent.js';

export { parseBgpProtocols, parseWireguardConfigs };

export function parseWgDump(dumpOutput) {
  const ports = [];
  const peers = [];
  if (!dumpOutput || typeof dumpOutput !== 'string') return { ports, peers };

  for (const line of dumpOutput.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split(/\t+|\s+/);
    if (parts.length === 5) {
      // Interface line: <iface> <privkey> <pubkey> <listenport> <fwmark>
      const iface = parts[0];
      const port = parseInt(parts[3], 10);
      if (!isNaN(port) && port > 0) {
        ports.push({ port, name: iface, source: 'wg' });
      }
    } else if (parts.length >= 8) {
      // Peer line: <iface> <pubkey> <preshared> <endpoint> <allowedips> <handshake> <rx> <tx> [keepalive]
      const iface = parts[0];
      const pubkey = parts[1];
      const endpoint = parts[3] === '(none)' ? '' : parts[3];
      const allowedIps = (parts[4] && parts[4] !== '(none)') ? parts[4] : '';
      const latestHandshake = parseInt(parts[5], 10) || 0;
      const rxBytes = parseInt(parts[6], 10) || 0;
      const txBytes = parseInt(parts[7], 10) || 0;
      if (pubkey) {
        peers.push({
          interface: iface,
          publicKey: pubkey,
          endpoint,
          allowedIps,
          latestHandshake,
          rxBytes,
          txBytes
        });
      }
    }
  }
  return { ports, peers };
}

export function parseSsOutput(ssOutput, existingPorts = []) {
  const systemPorts = [];
  if (!ssOutput || typeof ssOutput !== 'string') return systemPorts;

  for (const line of ssOutput.split('\n')) {
    const match = line.match(/:(\d{4,5})\s/);
    if (match) {
      const portNum = parseInt(match[1], 10);
      if (portNum >= 1024 && portNum <= 65535) {
        if (!existingPorts.some(p => p.port === portNum) && !systemPorts.some(p => p.port === portNum)) {
          let procName = 'service';
          const procMatch = line.match(/users:\(\("([^"]+)"/);
          if (procMatch) procName = procMatch[1];
          systemPorts.push({ port: portNum, name: procName, source: 'system_service' });
        }
      }
    }
  }
  return systemPorts;
}

export class ScannerService {
  /**
   * Process report submitted by node probe-agent
   */
  static async handleProbeReport({ nodeId, ports = [], systemPorts = [], peers = [], bgpSessions = [] }) {
    if (!nodeId) {
      throw new Error('nodeId is required in probe report');
    }

    // 1. Record live heartbeat in StatusTracker
    StatusTracker.recordHeartbeat(nodeId);

    // 2. Merge ports into ledger
    const mergedPorts = await PortLedgerService.mergeProbeReport(nodeId, { ports, systemPorts });

    // 3. Update session runtime peers and BGP states
    await SessionService.updateRuntimePeers(nodeId, { peers, bgpSessions });

    return {
      nodeId,
      portsCount: mergedPorts.length,
      peersUpdated: peers.length,
      bgpUpdated: bgpSessions.length
    };
  }

  /**
   * Admin master node manual sync trigger: scans local host interfaces and system ports
   */
  static async performMasterSync(options = {}) {
    const config = getActiveConfig();
    const masterNodeId = options.nodeId || config.nodes?.[0]?.id || 'JP-TYO-1';

    let wgOutput = options.mockWgOutput;
    let ssOutput = options.mockSsOutput;

    if (wgOutput === undefined) {
      try {
        wgOutput = execSync('wg show all dump', { encoding: 'utf8', timeout: 5000 }).trim();
      } catch {
        wgOutput = '';
      }
    }

    if (ssOutput === undefined) {
      try {
        ssOutput = execSync('ss -tulnp', { encoding: 'utf8', timeout: 5000 }).trim();
      } catch {
        ssOutput = '';
      }
    }

    let bgpOutput = options.mockBgpOutput;
    if (bgpOutput === undefined) {
      try {
        let rawBgp = execSync('birdc -r show protocols', { encoding: 'utf8', timeout: 5000 }).trim();
        try {
          const rawBgp6 = execSync('birdc6 -r show protocols', { encoding: 'utf8', timeout: 5000 }).trim();
          if (rawBgp6) rawBgp += '\n' + rawBgp6;
        } catch {}
        bgpOutput = rawBgp;
      } catch {
        try {
          bgpOutput = execSync('birdc show protocols', { encoding: 'utf8', timeout: 5000 }).trim();
        } catch {
          bgpOutput = '';
        }
      }
    }

    const { ports, peers } = parseWgDump(wgOutput);
    const systemPorts = parseSsOutput(ssOutput, ports);
    const bgpSessions = parseBgpProtocols(bgpOutput || '');

    const configPeers = options.mockConfigPeers !== undefined ? options.mockConfigPeers : parseWireguardConfigs();
    for (const peer of peers) {
      if (!peer.allowedIps && configPeers[peer.publicKey]?.allowedIps) {
        peer.allowedIps = configPeers[peer.publicKey].allowedIps;
      }
      if (!peer.endpoint && configPeers[peer.publicKey]?.endpoint) {
        peer.endpoint = configPeers[peer.publicKey].endpoint;
      }
    }

    if (ports.length === 0 && systemPorts.length === 0 && peers.length === 0 && bgpSessions.length === 0) {
      return {
        success: true,
        nodeId: masterNodeId,
        portsCount: 0,
        peersUpdated: 0,
        bgpUpdated: 0,
        message: `No local WireGuard interfaces or listening services found on master host (${masterNodeId})`,
        timestamp: new Date().toISOString()
      };
    }

    // Merge ports and update sessions
    const mergedPorts = await PortLedgerService.mergeProbeReport(masterNodeId, { ports, systemPorts });
    await SessionService.updateRuntimePeers(masterNodeId, { peers, bgpSessions });

    return {
      success: true,
      nodeId: masterNodeId,
      portsCount: mergedPorts.length,
      peersUpdated: peers.length,
      bgpUpdated: bgpSessions.length,
      message: `Master synchronization completed: ${ports.length} WG ports, ${systemPorts.length} system ports, ${peers.length} peers, ${bgpSessions.length} BGP sessions updated`,
      timestamp: new Date().toISOString()
    };
  }
}
