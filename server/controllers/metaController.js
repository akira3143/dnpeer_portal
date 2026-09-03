import { getActiveConfig } from '../storage/configLoader.js';
import { StatusTracker } from '../services/statusTracker.js';
import { successEnvelope } from '../utils/envelope.js';

export class MetaController {
  static async getNetworkMeta(req, res) {
    const config = getActiveConfig();
    const nodes = (config.nodes || []).map(node => {
      const statusInfo = StatusTracker.getNodeStatus(node.id);
      return {
        ...node,
        status: statusInfo.status, // 'online' | 'offline'
        online: statusInfo.online,
        lastSeen: statusInfo.lastSeen
      };
    });

    const data = {
      network: config.network,
      nodes,
      contacts: config.contacts,
      guiPath: config.guiPath || '/gui'
    };
    return successEnvelope(data);
  }
}
