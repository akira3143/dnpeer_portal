import { getActiveConfig } from '../storage/configLoader.js';

export class ConfigEngine {
  /**
   * Assemble all configuration snippets (client wireguard, client bird, server wireguard, server bird)
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
    mtu = 1420,
    bgpMode = 'mpbgp_enh'
  }) {
    const config = getActiveConfig();
    const node = config.nodes.find(n => n.id === nodeId) || config.nodes[0] || {};
    const serverAsn = config.network.asnNumber || 4242423143;
    const serverAsnFull = config.network.asn || 'AS4242423143';
    const cleanAsn = parseInt(String(asn).replace(/^AS/i, ''), 10);
    const nodeCode = (node.code || node.id || 'node').toLowerCase().replace(/[^a-z0-9]/g, '_');
    const ifaceName = `dn42_${nodeCode}`;

    // Client WG Addresses
    const clientAddresses = [];
    if (clientLinkLocal) clientAddresses.push(`${clientLinkLocal}/128`);
    if (clientIpv6Ula) clientAddresses.push(`${clientIpv6Ula.replace(/\/.*$/, '')}/128`);
    if (clientIpv4) clientAddresses.push(`${clientIpv4.replace(/\/.*$/, '')}/32`);
    const clientAddressLine = clientAddresses.join(', ') || 'fe80::.../128';

    // Server WG AllowedIPs
    const serverAllowedIps = [
      '10.0.0.0/8',
      '172.20.0.0/14',
      '172.31.0.0/16',
      'fd00::/8',
      'fe80::/64'
    ];

    // Client WireGuard Configuration
    const clientWireguard = `[Interface]
# AkiLab DN42 - Client WireGuard Tunnel Configuration
# Node: ${node.name || node.id} (${node.city || ''}, ${node.country || ''})
PrivateKey = <YOUR_PRIVATE_KEY>
Address = ${clientAddressLine}
ListenPort = ${hostPort}
MTU = ${mtu}

[Peer]
# AkiLab Server Peer
PublicKey = ${node.wgPublicKey || '<SERVER_WG_PUBLIC_KEY>'}
Endpoint = ${node.endpointDomain || 'jp1.akilab.dn42'}:${hostPort}
AllowedIPs = ${serverAllowedIps.join(', ')}
PersistentKeepalive = 25
`;

    // Client BIRD2 BGP Configuration
    const clientBird = `protocol bgp akilab_${nodeCode} {
    description "AkiLab DN42 (${node.name || node.id})";
    local as ${cleanAsn};
    neighbor ${node.tunnelIpv6LLA || 'fe80::3143'} % '${ifaceName}' as ${serverAsn};

    ipv6 {
        import filter {
            # Accept valid DN42 IPv6 routes
            if (net ~ [fd00::/8{44,64}]) then accept;
            reject;
        };
        export filter {
            # Export your announced DN42 IPv6 prefixes
            if (net ~ [${clientIpv6Ula ? clientIpv6Ula.replace(/\/.*$/, '') + '/48+' : 'fd00::/8{44,48}'}]) then accept;
            reject;
        };
    };

    ipv4 {
        extended next hop on;
        import filter {
            # Accept valid DN42 IPv4 routes
            if (net ~ [172.20.0.0/14{21,29}, 10.0.0.0/8{16,29}]) then accept;
            reject;
        };
        export filter {
            # Export your announced DN42 IPv4 prefixes
            if (net ~ [${clientIpv4 ? clientIpv4.replace(/\/.*$/, '') + '/24+' : '172.20.0.0/14{21,29}'}]) then accept;
            reject;
        };
    };
}
`;

    // Server-side WireGuard snippet for Administrator
    const peerAllowedIps = [];
    if (clientLinkLocal) peerAllowedIps.push(`${clientLinkLocal}/128`);
    if (clientIpv6Ula) peerAllowedIps.push(`${clientIpv6Ula.replace(/\/.*$/, '')}/128`);
    if (clientIpv4) peerAllowedIps.push(`${clientIpv4.replace(/\/.*$/, '')}/32`);
    if (peerAllowedIps.length === 0) peerAllowedIps.push('fe80::/128');

    const serverWireguardSnippet = `[Peer]
# Peer: AS${cleanAsn} | Node: ${node.id} | Port: ${hostPort}
PublicKey = ${clientPublicKey}
${clientEndpoint ? `Endpoint = ${clientEndpoint}` : '# Endpoint = <roaming>'}
AllowedIPs = ${peerAllowedIps.join(', ')}
`;

    // Server-side BIRD snippet for Administrator
    const serverBirdSnippet = `protocol bgp dn42_${cleanAsn}_${nodeCode} from dn42_peers {
    description "Peer AS${cleanAsn}";
    neighbor ${clientLinkLocal || `fe80::${cleanAsn}`} % 'wg_${nodeCode}' as ${cleanAsn};
    ipv6 {
        extended next hop on;
        import where dn42_import_filter();
        export where dn42_export_filter();
    };
    ipv4 {
        extended next hop on;
        import where dn42_import_filter();
        export where dn42_export_filter();
    };
}
`;

    return {
      hostPort,
      serverEndpoint: `${node.endpointDomain || 'jp1.akilab.dn42'}:${hostPort}`,
      serverPublicKey: node.wgPublicKey || '',
      serverIpv4: node.tunnelIpv4 || '',
      serverIpv6Ula: node.tunnelIpv6ULA || '',
      serverLinkLocal: node.tunnelIpv6LLA || 'fe80::3143',
      clientWireguard,
      clientBird,
      serverWireguardSnippet,
      serverBirdSnippet
    };
  }
}
