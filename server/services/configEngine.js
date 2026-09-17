import { getActiveConfig } from '../storage/configLoader.js';

/**
 * Cleanly format WireGuard Endpoint with bracketed IPv6 and port deduplication
 */
export function formatWireguardEndpoint(host, defaultPort) {
  if (!host || typeof host !== 'string') return '';
  const trimmed = host.trim();
  if (!trimmed) return '';

  let cleanHost = trimmed;
  let cleanPort = defaultPort;

  const v6BracketPort = trimmed.match(/^\[([^\]]+)\](?::(\d+))?$/);
  if (v6BracketPort) {
    cleanHost = `[${v6BracketPort[1]}]`;
    if (v6BracketPort[2]) cleanPort = parseInt(v6BracketPort[2], 10);
  } else if (trimmed.includes(':') && trimmed.indexOf(':') === trimmed.lastIndexOf(':')) {
    const parts = trimmed.split(':');
    cleanHost = parts[0];
    cleanPort = parseInt(parts[1], 10);
  } else if (trimmed.includes(':')) {
    cleanHost = `[${trimmed.replace(/[\[\]]/g, '')}]`;
  }

  return cleanPort ? `${cleanHost}:${cleanPort}` : cleanHost;
}

export class ConfigEngine {
  /**
   * Assemble WireGuard configuration products (client wireguard, server wireguard snippet)
   */
  static generateFullConfig({
    asn,
    nodeId,
    clientPublicKey,
    clientEndpoint = '',
    clientIpv4 = '',
    clientIpv6Ula = '',
    clientLinkLocal = '',
    hostPort,
    clientPort = 'auto',
    mtu = 1420,
    bgpMode = 'mpbgp_enh'
  }) {
    const config = getActiveConfig();
    const node = config.nodes.find(n => n.id === nodeId) || config.nodes[0] || {};
    const cleanAsn = parseInt(String(asn).replace(/^AS/i, ''), 10);

    // 1. Client WireGuard Address Lines: LLA /64 prioritized first, then IPv4 /32, ULA /128
    const clientAddresses = [];
    if (clientLinkLocal) {
      const cleanLla = clientLinkLocal.replace(/\/.*$/, '');
      if (cleanLla) clientAddresses.push(`${cleanLla}/64`);
    }
    if (clientIpv4) {
      const cleanV4 = clientIpv4.replace(/\/.*$/, '');
      if (cleanV4) clientAddresses.push(`${cleanV4}/32`);
    }
    if (clientIpv6Ula) {
      const cleanUla = clientIpv6Ula.replace(/\/.*$/, '');
      if (cleanUla) clientAddresses.push(`${cleanUla}/128`);
    }
    const clientAddressLine = clientAddresses.join(', ') || 'fe80::.../64';

    // 2. PostUp Point-to-Point Binding Lines
    const postUpLines = [];
    if (clientIpv4 && node.tunnelIpv4) {
      const cleanV4 = clientIpv4.replace(/\/.*$/, '');
      const nodeV4 = node.tunnelIpv4.replace(/\/.*$/, '');
      if (cleanV4 && nodeV4) {
        postUpLines.push(`PostUp = ip addr del dev %i ${cleanV4}/32`);
        postUpLines.push(`PostUp = ip addr add dev %i ${cleanV4}/32 peer ${nodeV4}/32`);
      }
    }
    if (clientIpv6Ula && node.tunnelIpv6ULA) {
      const cleanUla = clientIpv6Ula.replace(/\/.*$/, '');
      const nodeUla = node.tunnelIpv6ULA.replace(/\/.*$/, '');
      if (cleanUla && nodeUla) {
        postUpLines.push(`PostUp = ip addr del dev %i ${cleanUla}/128`);
        postUpLines.push(`PostUp = ip addr add dev %i ${cleanUla}/128 peer ${nodeUla}/128`);
      }
    }
    const postUpBlock = postUpLines.length > 0 ? postUpLines.join('\n') + '\n' : '';

    // 3. Client ListenPort line (concrete assigned/custom port, defaults to 20000 + (ourAsn % 10000))
    let clientPortNum = parseInt(clientPort, 10);
    if (isNaN(clientPortNum) || clientPort === 'auto') {
      const ourAsn = config.network?.asnNumber || 4242423143;
      clientPortNum = 20000 + (ourAsn % 10000);
    }
    const clientListenPortLine = `ListenPort = ${clientPortNum}\n`;

    // 4. Server WG AllowedIPs for Client WireGuard
    const serverAllowedIps = [
      '172.20.0.0/14',
      '172.31.0.0/16',
      '10.0.0.0/8',
      'fd00::/8',
      'fe80::/64'
    ];

    const serverEndpointFormatted = formatWireguardEndpoint(node.endpointDomain || 'jp1.akilab.dn42', hostPort);

    // 5. Client WireGuard Configuration (no '#' comments inside body)
    const clientWireguard = `[Interface]
Address = ${clientAddressLine}
PrivateKey = <YOUR_PRIVATE_KEY>
${clientListenPortLine}${postUpBlock}Table = off
MTU = ${mtu}

[Peer]
PublicKey = ${node.wgPublicKey || '<SERVER_WG_PUBLIC_KEY>'}
Endpoint = ${serverEndpointFormatted}
AllowedIPs = ${serverAllowedIps.join(', ')}
PersistentKeepalive = 25
`;

    // 6. Server-side WireGuard snippet for Administrator (no '#' comments inside body)
    const serverPostUpLines = [];
    if (clientIpv4 && node.tunnelIpv4) {
      const cleanV4 = clientIpv4.replace(/\/.*$/, '');
      const nodeV4 = node.tunnelIpv4.replace(/\/.*$/, '');
      if (cleanV4 && nodeV4) {
        serverPostUpLines.push(`PostUp = ip addr del dev %i ${nodeV4}/32`);
        serverPostUpLines.push(`PostUp = ip addr add dev %i ${nodeV4}/32 peer ${cleanV4}/32`);
      }
    }
    if (clientIpv6Ula && node.tunnelIpv6ULA) {
      const cleanUla = clientIpv6Ula.replace(/\/.*$/, '');
      const nodeUla = node.tunnelIpv6ULA.replace(/\/.*$/, '');
      if (cleanUla && nodeUla) {
        serverPostUpLines.push(`PostUp = ip addr del dev %i ${nodeUla}/128`);
        serverPostUpLines.push(`PostUp = ip addr add dev %i ${nodeUla}/128 peer ${cleanUla}/128`);
      }
    }
    const serverPostUpBlock = serverPostUpLines.length > 0 ? serverPostUpLines.join('\n') + '\n' : '';

    const serverAllowedIpsList = [
      '172.20.0.0/14',
      '172.31.0.0/16',
      '10.0.0.0/8',
      'fd00::/8',
      'fe80::/64'
    ];

    let serverEndpointLine = '';
    if (clientEndpoint && typeof clientEndpoint === 'string' && clientEndpoint.trim()) {
      serverEndpointLine = `Endpoint = ${formatWireguardEndpoint(clientEndpoint, clientPortNum)}\n`;
    } else {
      serverEndpointLine = '# Endpoint: not provided by peer (roaming) - fill in when they expose one\n';
    }

    // Prioritize LLA first. Only include IPv4/ULA if peer actually configured them
    const serverAddresses = [];
    if (node.tunnelIpv6LLA) {
      serverAddresses.push(`${node.tunnelIpv6LLA.replace(/\/.*$/, '')}/64`);
    }
    if (clientIpv4 && node.tunnelIpv4) {
      serverAddresses.push(`${node.tunnelIpv4.replace(/\/.*$/, '')}/32`);
    }
    if (clientIpv6Ula && node.tunnelIpv6ULA) {
      serverAddresses.push(`${node.tunnelIpv6ULA.replace(/\/.*$/, '')}/128`);
    }
    const serverAddressLine = serverAddresses.join(', ') || (node.tunnelIpv6LLA ? `${node.tunnelIpv6LLA.replace(/\/.*$/, '')}/64` : 'fe80::3143/64');

    const serverWireguardSnippet = `[Interface]
Address = ${serverAddressLine}
PrivateKey = <SERVER_PRIVATE_KEY>
ListenPort = ${hostPort}
${serverPostUpBlock}Table = off
MTU = ${mtu}

[Peer]
PublicKey = ${clientPublicKey}
${serverEndpointLine}AllowedIPs = ${serverAllowedIpsList.join(', ')}
PersistentKeepalive = 25
`;

    return {
      hostPort,
      clientPort: clientPortNum,
      serverEndpoint: serverEndpointFormatted,
      serverPublicKey: node.wgPublicKey || '',
      serverIpv4: node.tunnelIpv4 || '',
      serverIpv6Ula: node.tunnelIpv6ULA || '',
      serverLinkLocal: node.tunnelIpv6LLA || 'fe80::3143',
      clientWireguard,
      serverWireguardSnippet
    };
  }
}
