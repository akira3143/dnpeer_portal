import { getActiveConfig } from '../storage/configLoader.js';
import { successEnvelope } from '../utils/envelope.js';

export class MetaController {
  static async getNetworkMeta(req, res) {
    const config = getActiveConfig();
    const data = {
      network: config.network,
      nodes: config.nodes,
      contacts: config.contacts,
      guiPath: config.guiPath || '/gui'
    };
    return successEnvelope(data);
  }
}
