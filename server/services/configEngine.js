import { getActiveConfig } from '../storage/configLoader.js';

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

    // 1. Client WireGuard Address Lines: LLA /64, ULA /128, IPv4 /32
    const clientAddresses = [];
    if (clientIpv4) {
      const cleanV4 = clientIpv4.replace(/\/.*$/, '');
      if (cleanV4) clientAddresses.push(`${cleanV4}/32`);
    }
    if (clientIpv6Ula) {
      const cleanUla = clientIpv6Ula.replace(/\/.*$/, '');
      if (cleanUla) clientAddresses.push(`${cleanUla}/128`);
    }
    if (clientLinkLocal) {
      const cleanLla = clientLinkLocal.replace(/\/.*$/, '');
      if (cleanLla) clientAddresses.push(`${cleanLla}/64`);
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

    // 3. Client ListenPort line (only written when clientPort is a custom integer)
    const clientPortNum = parseInt(clientPort, 10);
    const clientListenPortLine = (!isNaN(clientPortNum) && clientPort !== 'auto')
      ? `ListenPort = ${clientPortNum}\n`
      : '';

    // 4. Server WG AllowedIPs
    const serverAllowedIps = [
      '10.0.0.0/8',
      '172.20.0.0/14',
      '172.31.0.0/16',
      'fd00::/8',
      'fe80::/64'
    ];

    // 5. Client WireGuard Configuration (no '#' comments inside body)
    const clientWireguard = `[Interface]
PrivateKey = <YOUR_PRIVATE_KEY>
Address = ${clientAddressLine}
${postUpBlock}${clientListenPortLine}MTU = ${mtu}

[Peer]
PublicKey = ${node.wgPublicKey || '<SERVER_WG_PUBLIC_KEY>'}
Endpoint = ${node.endpointDomain || 'jp1.akilab.dn42'}:${hostPort}
AllowedIPs = ${serverAllowedIps.join(', ')}
PersistentKeepalive = 25
`;

    // 6. Server-side WireGuard snippet for Administrator (no '#' comments inside body)
    const peerAllowedIps = [];
    if (clientIpv4) peerAllowedIps.push(`${clientIpv4.replace(/\/.*$/, '')}/32`);
    if (clientIpv6Ula) peerAllowedIps.push(`${clientIpv6Ula.replace(/\/.*$/, '')}/128`);
    if (clientLinkLocal) peerAllowedIps.push(`${clientLinkLocal.replace(/\/.*$/, '')}/128`);
    if (peerAllowedIps.length === 0) peerAllowedIps.push('fe80::/128');

    const serverWireguardSnippet = `[Peer]
PublicKey = ${clientPublicKey}
${clientEndpoint ? `Endpoint = ${clientEndpoint}\n` : ''}AllowedIPs = ${peerAllowedIps.join(', ')}
`;

    return {
      hostPort,
      clientPort: !isNaN(clientPortNum) && clientPort !== 'auto' ? clientPortNum : 'auto',
      serverEndpoint: `${node.endpointDomain || 'jp1.akilab.dn42'}:${hostPort}`,
      serverPublicKey: node.wgPublicKey || '',
      serverIpv4: node.tunnelIpv4 || '',
      serverIpv6Ula: node.tunnelIpv6ULA || '',
      serverLinkLocal: node.tunnelIpv6LLA || 'fe80::3143',
      clientWireguard,
      serverWireguardSnippet
    };
  }
}
