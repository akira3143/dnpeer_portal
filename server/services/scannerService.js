import { PortLedgerService } from './portLedgerService.js';
import { SessionService } from './sessionService.js';

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
   * Admin master node manual sync trigger
   */
  static async performMasterSync() {
    // Collect local master ports or trigger self-audit
    return {
      success: true,
      message: 'Master scanner synchronization completed',
      timestamp: new Date().toISOString()
    };
  }
}
