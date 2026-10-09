import { getActiveConfig } from '../storage/configLoader.js';
import { StatusTracker } from '../services/statusTracker.js';
import { successEnvelope } from '../utils/envelope.js';

export class MetaController {
  static async getNetworkMeta(req, res) {
    const config = getActiveConfig();
    const nodes = (config.nodes || []).map(node => {
      const statusInfo = StatusTracker.getNodeStatus(node.id);
      return {
        id: node.id,
        code: node.code,
        name: node.name,
        flag: node.flag,
        city: node.city,
        country: node.country,
        region: node.region,
        isp: node.isp,
        endpointDomain: node.endpointDomain,
        wgPublicKey: node.wgPublicKey,
        tunnelIpv4: node.tunnelIpv4,
        tunnelIpv6ULA: node.tunnelIpv6ULA,
        tunnelIpv6LLA: node.tunnelIpv6LLA,
        mtu: node.mtu || 1420,
        features: Array.isArray(node.features) ? node.features : [],
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
