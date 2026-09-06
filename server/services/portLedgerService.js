import path from 'node:path';
import { getDataDir } from '../config.js';
import { FileStore } from '../storage/fileStore.js';
import { RULES } from '../utils/validator.js';

// Node-level allocation transaction queue to prevent race conditions during concurrent requests
const nodeAllocationQueues = new Map();

export class PortLedgerService {
  static getLedgerPath() {
    return path.join(getDataDir(), 'port_ledger.json');
  }

  static async getLedger() {
    const filePath = this.getLedgerPath();
    const ledger = await FileStore.readJson(filePath, {});
    return ledger && typeof ledger === 'object' ? ledger : {};
  }

  static async saveLedger(ledger) {
    const filePath = this.getLedgerPath();
    return FileStore.writeJson(filePath, ledger);
  }

  static async getNodePorts(nodeId) {
    const ledger = await this.getLedger();
    return Array.isArray(ledger[nodeId]) ? ledger[nodeId] : [];
  }

  static async isPortOccupied(nodeId, port) {
    const ports = await this.getNodePorts(nodeId);
    const targetPort = parseInt(port, 10);
    return ports.some(p => p.port === targetPort);
  }

  /**
   * Atomic Port Verdict: Calculates port, resolves conflicts, and locks port in single transaction
   * Serialized per node via async promise mutex queue to prevent race conditions
   * @param {Object} params - { nodeId, asn, requestedPort, sessionId, description }
   * @returns {Promise<{ port: number, isShifted: boolean, expectedPort: number }>}
   */
  static async allocateAndLockPort({ nodeId, asn, requestedPort = 'auto', sessionId = '', description = '' }) {
    const queueKey = String(nodeId || 'global');
    const prevQueue = nodeAllocationQueues.get(queueKey) || Promise.resolve();

    const transaction = async () => {
      const cleanAsn = parseInt(String(asn).replace(/^AS/i, ''), 10);
      const expectedBasePort = (requestedPort && requestedPort !== 'auto')
        ? parseInt(requestedPort, 10)
        : (RULES.port.baseOffset + (cleanAsn % RULES.port.modulo));

      const ledger = await this.getLedger();
      if (!Array.isArray(ledger[nodeId])) {
        ledger[nodeId] = [];
      }

      const occupiedSet = new Set(ledger[nodeId].map(p => p.port));

      // Release any previous port held by the same sessionId on this node to allow idempotent updates
      if (sessionId) {
        ledger[nodeId] = ledger[nodeId].filter(p => {
          if (p.sessionId === sessionId) {
            occupiedSet.delete(p.port);
            return false;
          }
          return true;
        });
      }

      let finalPort = expectedBasePort;
      let isShifted = false;

      // Conflict avoidance loop
      if (occupiedSet.has(finalPort)) {
        isShifted = true;
        let candidate = finalPort;

        // Try +10000 shifts first (e.g. 23143 -> 33143 -> 43143 -> 53143 -> 63143)
        while (occupiedSet.has(candidate)) {
          if (candidate + RULES.port.conflictStep <= RULES.port.max) {
            candidate += RULES.port.conflictStep;
          } else {
            // P2-2 Fix: Search the full valid range 1024..65535 when shifted beyond max
            let found = false;
            for (let p = RULES.port.min; p <= RULES.port.max; p++) {
              if (!occupiedSet.has(p)) {
                candidate = p;
                found = true;
                break;
              }
            }
            if (!found) {
              throw new Error(`No available ports on node ${nodeId}`);
            }
            break;
          }
        }
        finalPort = candidate;
      }

      // Atomically lock the final port
      const entry = {
        port: finalPort,
        type: 'locked',
        source: 'peering_session',
        sessionId: sessionId || `sess_${cleanAsn}_${nodeId.toLowerCase().replace(/[^a-z0-9]/g, '_')}`,
        asn: cleanAsn,
        lockedAt: new Date().toISOString(),
        description: description || `Locked for ASN ${cleanAsn}`
      };

      ledger[nodeId].push(entry);
      await this.saveLedger(ledger);

      return {
        port: finalPort,
        isShifted,
        expectedPort: expectedBasePort
      };
    };

    const currentQueue = prevQueue.then(transaction, transaction);
    nodeAllocationQueues.set(queueKey, currentQueue.catch(() => {}));
    return currentQueue;
  }

  /**
   * Release port locked by sessionId
   */
  static async releaseSessionPort(nodeId, sessionId) {
    const ledger = await this.getLedger();
    if (Array.isArray(ledger[nodeId])) {
      ledger[nodeId] = ledger[nodeId].filter(p => p.sessionId !== sessionId);
      await this.saveLedger(ledger);
    }
  }

  /**
   * Merge snapshot reported by probe agent
   */
  static async mergeProbeReport(nodeId, { ports = [], systemPorts = [] }) {
    const ledger = await this.getLedger();
    const existing = Array.isArray(ledger[nodeId]) ? ledger[nodeId] : [];
    
    // Retain peering_session locks, replace probe-discovered ports
    const retainedSessions = existing.filter(p => p.source === 'peering_session');
    const existingPortNumbers = new Set(retainedSessions.map(p => p.port));

    const merged = [...retainedSessions];

    // Merge system ports (ss -tulnp)
    for (const sp of systemPorts) {
      const portNum = parseInt(sp.port, 10);
      if (!isNaN(portNum) && !existingPortNumbers.has(portNum)) {
        merged.push({
          port: portNum,
          type: 'reserved',
          source: 'system_service',
          serviceName: sp.name || 'unknown',
          lockedAt: new Date().toISOString(),
          description: `Occupied by system service (${sp.name || 'system'})`
        });
        existingPortNumbers.add(portNum);
      }
    }

    // Merge wg listen-ports
    for (const wp of ports) {
      const portNum = parseInt(wp.port, 10);
      if (!isNaN(portNum)) {
        const existingEntry = merged.find(p => p.port === portNum);
        if (existingEntry) {
          if (!existingEntry.interfaceName && wp.name) {
            existingEntry.interfaceName = wp.name;
          }
        } else {
          merged.push({
            port: portNum,
            type: 'in_use',
            source: 'wireguard_probe',
            interfaceName: wp.name || 'wg0',
            lockedAt: new Date().toISOString(),
            description: `Active WireGuard interface ${wp.name || ''}`
          });
          existingPortNumbers.add(portNum);
        }
      }
    }

    ledger[nodeId] = merged;
    await this.saveLedger(ledger);
    return merged;
  }

  /**
   * Ensure sessions on this node with hostPort/listenPort are properly tracked in port_ledger.json
   */
  static async syncDiscoveredPorts(nodeId, sessions = []) {
    const ledger = await this.getLedger();
    if (!Array.isArray(ledger[nodeId])) {
      ledger[nodeId] = [];
    }
    const nodeSessions = sessions.filter(s => s.nodeId === nodeId);
    let modified = false;

    for (const s of nodeSessions) {
      const portNum = parseInt(s.assigned?.hostPort || s.peering?.listenPort, 10);
      if (isNaN(portNum) || portNum <= 0) continue;

      const existingEntry = ledger[nodeId].find(p => p.port === portNum);
      const iface = s.assigned?.interface || s.peering?.interface || s.id;
      if (existingEntry) {
        if (!existingEntry.sessionId && s.id) {
          existingEntry.sessionId = s.id;
          modified = true;
        }
        if (!existingEntry.asn && s.asn) {
          existingEntry.asn = s.asn;
          modified = true;
        }
        if (!existingEntry.interfaceName && iface) {
          existingEntry.interfaceName = iface;
          modified = true;
        }
      } else {
        ledger[nodeId].push({
          port: portNum,
          type: 'in_use',
          source: s.source === 'discovered' ? 'wireguard_probe' : 'peering_session',
          sessionId: s.id,
          asn: s.asn || null,
          interfaceName: iface,
          lockedAt: s.createdAt || new Date().toISOString(),
          description: `WireGuard interface ${iface} (ASN ${s.asn || 'unknown'})`
        });
        modified = true;
      }
    }

    if (modified) {
      await this.saveLedger(ledger);
    }
    return ledger[nodeId];
  }
}
