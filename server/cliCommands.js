/**
 * CLI Commands Handler (server/cliCommands.js)
 *
 * Implements server-side administrative CLI commands (dnp probe).
 */

import { getActiveConfig } from './storage/configLoader.js';
import { NodeTokenStorage } from './storage/nodeTokenStorage.js';
import { StatusTracker } from './services/statusTracker.js';

/**
 * Handle `dnp probe [nodeId]`
 * @param {string[]} args
 * @param {{ portalDomain?: string, logger?: typeof console }} options
 */
export function handleCliProbe(args = [], options = {}) {
  const logger = options.logger || console;
  const rawId = args[0] ? String(args[0]).trim() : '';
  const config = getActiveConfig();
  const nodes = config.nodes || [];

  if (!rawId) {
    logger.log('\nAkiLab DN42 Global PoP Nodes & Live Probe Status:');
    logger.log('-------------------------------------------------------------------------------');
    logger.log(`  ${'#'.padEnd(3)} ${'NODE'.padEnd(8)} ${'NODE NAME'.padEnd(28)} ${'STATUS'.padEnd(10)} ${'LAST SEEN'}`);
    logger.log('-------------------------------------------------------------------------------');

    nodes.forEach((node, idx) => {
      const status = StatusTracker.getNodeStatus(node.id);
      const statusStr = status.online ? '\x1b[32monline\x1b[0m' : '\x1b[90moffline\x1b[0m';
      const lastSeenStr = status.lastSeen || 'never';
      const numStr = String(idx + 1).padEnd(3);
      const idStr = node.id.padEnd(8);
      const nameStr = (node.name || '').slice(0, 26).padEnd(28);
      const padStatus = status.online ? statusStr + '  ' : statusStr + ' ';
      logger.log(`  ${numStr} ${idStr} ${nameStr} ${padStatus} ${lastSeenStr}`);
    });

    logger.log('-------------------------------------------------------------------------------');
    logger.log('To generate an automated installer command for a node, run:');
    logger.log('  dnp probe <NODE_ID>\n');

    return { success: true, count: nodes.length };
  }

  const targetNode = nodes.find(
    n => n.id.toLowerCase() === rawId.toLowerCase() || (n.code && n.code.toLowerCase() === rawId.toLowerCase())
  );

  if (!targetNode) {
    logger.error(`\x1b[31mError: Node "${rawId}" not found in portal configuration.\x1b[0m`);
    return null;
  }

  const token = NodeTokenStorage.getOrCreateToken(targetNode.id);
  const portalDomain =
    options.portalDomain ||
    process.env.PORTAL_DOMAIN ||
    process.env.PORTAL_MASTER_URL ||
    'dnpeer.akilab.meme';

  const baseUrl = portalDomain.startsWith('http://') || portalDomain.startsWith('https://')
    ? portalDomain.replace(/\/+$/, '')
    : `https://${portalDomain}`;

  const installCmd = `curl -sSL ${baseUrl}/install-probe.sh | sudo bash -s -- ${targetNode.id} ${token}`;

  logger.log(`\nDedicated installation command for node ${targetNode.id} (${targetNode.name}):\n`);
  logger.log(`  ${installCmd}\n`);

  return {
    nodeId: targetNode.id,
    token,
    installCmd,
    targetNode
  };
}

/**
 * CLI Command Router for `dnp <command> [args...]`
 * @param {string[]} argv
 */
export async function handleCliCommand(argv = []) {
  const [cmd, ...args] = argv;

  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
    console.log('\nAkiLab DN42 Master Management CLI (dnp)');
    console.log('Usage:');
    console.log('  dnp probe             List all edge nodes and real-time status');
    console.log('  dnp probe <NODE_ID>   Output unified installer command with node-specific token');
    console.log('');
    return;
  }

  if (cmd === 'probe') {
    return handleCliProbe(args);
  }

  console.error(`Unknown command: ${cmd}. Run "dnp help" for usage.`);
  process.exit(1);
}

