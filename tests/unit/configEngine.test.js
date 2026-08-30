import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ConfigEngine } from '../../server/services/configEngine.js';

describe('ConfigEngine Unit Tests', () => {
  test('generates valid client WireGuard configuration with /64 LLA, PostUp bindings and custom clientPort (U8 & U9)', () => {
    const config = ConfigEngine.generateFullConfig({
      asn: '4242423143',
      nodeId: 'JP-TYO-1',
      clientPublicKey: 'yA+N64x7tN/4H1XqJd+7qf3K9z1V8uT5R7o+P2w8x1E=',
      clientEndpoint: 'peer.example.dn42:23143',
      clientIpv4: '172.20.150.100',
      clientIpv6Ula: 'fd00:4242:3143::1',
      clientLinkLocal: 'fe80::4242:3143',
      hostPort: 23143,
      clientPort: 25000,
      mtu: 1420
    });

    assert.equal(config.hostPort, 23143);
    assert.equal(config.clientPort, 25000);
    assert.ok(config.serverEndpoint.includes('23143'));
    assert.ok(config.clientWireguard.includes('[Interface]'));
    assert.ok(config.clientWireguard.includes('ListenPort = 25000'), 'Custom clientPort must be written in client WG [Interface]');
    assert.ok(config.clientWireguard.includes('fe80::4242:3143/64'), 'LLA must have /64 prefix');
    assert.ok(config.clientWireguard.includes('172.20.150.100/32'), 'IPv4 must have /32 prefix');
    assert.ok(config.clientWireguard.includes('fd00:4242:3143::1/128'), 'IPv6 ULA must have /128 prefix');
    
    // PostUp bindings (U8)
    assert.ok(config.clientWireguard.includes('PostUp = ip addr del dev %i 172.20.150.100/32'));
    assert.ok(config.clientWireguard.includes('PostUp = ip addr add dev %i 172.20.150.100/32 peer 172.20.150.1/32'));
    assert.ok(config.clientWireguard.includes('PostUp = ip addr del dev %i fd00:4242:3143::1/128'));
    assert.ok(config.clientWireguard.includes('PostUp = ip addr add dev %i fd00:4242:3143::1/128 peer fd00:4242:3143::1/128'));

    // Peer section
    assert.ok(config.clientWireguard.includes('[Peer]'));
    assert.ok(config.clientWireguard.includes('AllowedIPs = 10.0.0.0/8, 172.20.0.0/14, 172.31.0.0/16, fd00::/8, fe80::/64'));
    assert.ok(config.clientWireguard.includes('PersistentKeepalive = 25'));

    // No comments inside config body (U11)
    const lines = config.clientWireguard.split('\n');
    assert.equal(lines.some(l => l.trim().startsWith('#')), false, 'Config body must not contain # comments');

    // BIRD snippet must be completely removed (U9)
    assert.equal(config.clientBird, undefined, 'clientBird must be removed');
    assert.equal(config.serverBirdSnippet, undefined, 'serverBirdSnippet must be removed');

    // Server WG snippet
    assert.ok(config.serverWireguardSnippet.includes('PublicKey = yA+N64x7tN/4H1XqJd+7qf3K9z1V8uT5R7o+P2w8x1E='));
    assert.ok(config.serverWireguardSnippet.includes('Endpoint = peer.example.dn42:23143'));
  });

  test('P2-1: omits ListenPort in client WG when clientPort is auto and omits PostUp when no IPv4/ULA', () => {
    const config = ConfigEngine.generateFullConfig({
      asn: '4242423143',
      nodeId: 'JP-TYO-1',
      clientPublicKey: 'yA+N64x7tN/4H1XqJd+7qf3K9z1V8uT5R7o+P2w8x1E=',
      clientLinkLocal: 'fe80::4242:3143',
      hostPort: 23143,
      clientPort: 'auto',
      mtu: 1420
    });

    assert.equal(config.clientPort, 'auto');
    assert.ok(!config.clientWireguard.includes('ListenPort'), 'Client WG config must NOT contain ListenPort when clientPort is auto');
    assert.ok(!config.clientWireguard.includes('PostUp'), 'Client WG config must NOT contain PostUp when no IPv4/ULA provided');
    assert.ok(config.clientWireguard.includes('Endpoint = jp1.akilab.dn42:23143'));
  });
});
