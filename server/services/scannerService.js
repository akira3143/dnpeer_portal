import { execSync } from 'node:child_process';
import { getActiveConfig } from '../storage/configLoader.js';
import { PortLedgerService } from './portLedgerService.js';
import { SessionService } from './sessionService.js';

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
      const latestHandshake = parseInt(parts[5], 10) || 0;
      const rxBytes = parseInt(parts[6], 10) || 0;
      const txBytes = parseInt(parts[7], 10) || 0;
      if (pubkey) {
        peers.push({
          interface: iface,
          publicKey: pubkey,
          endpoint,
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
  static async handleProbeReport({ nodeId, ports = [], systemPorts = [], peers = [] }) {
    if (!nodeId) {
      throw new Error('nodeId is required in probe report');
    }

    // 1. Merge ports into ledger
    const mergedPorts = await PortLedgerService.mergeProbeReport(nodeId, { ports, systemPorts });

    // 2. Update session runtime peers (latest handshake, etc.)
    await SessionService.updateRuntimePeers(nodeId, peers);

    return {
      nodeId,
      portsCount: mergedPorts.length,
      peersUpdated: peers.length
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

    const { ports, peers } = parseWgDump(wgOutput);
    const systemPorts = parseSsOutput(ssOutput, ports);

    if (ports.length === 0 && systemPorts.length === 0 && peers.length === 0) {
      return {
        success: true,
        nodeId: masterNodeId,
        portsCount: 0,
        peersUpdated: 0,
        message: `No local WireGuard interfaces or listening services found on master host (${masterNodeId})`,
        timestamp: new Date().toISOString()
      };
    }

    // Merge ports and update sessions
    const mergedPorts = await PortLedgerService.mergeProbeReport(masterNodeId, { ports, systemPorts });
    await SessionService.updateRuntimePeers(masterNodeId, peers);

    return {
      success: true,
      nodeId: masterNodeId,
      portsCount: mergedPorts.length,
      peersUpdated: peers.length,
      message: `Master synchronization completed: ${ports.length} WG ports, ${systemPorts.length} system ports, ${peers.length} peers updated`,
      timestamp: new Date().toISOString()
    };
  }
}
