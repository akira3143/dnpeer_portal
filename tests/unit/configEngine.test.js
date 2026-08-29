import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ConfigEngine } from '../../server/services/configEngine.js';

describe('ConfigEngine Unit Tests', () => {
  test('generates valid client WireGuard and BIRD configuration with custom clientPort', () => {
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
    assert.ok(config.clientWireguard.includes('fe80::4242:3143/128'));
    assert.ok(config.clientWireguard.includes('172.20.150.100/32'));
    assert.ok(config.clientWireguard.includes('fd00:4242:3143::1/128'));
    assert.ok(config.clientWireguard.includes('[Peer]'));
    assert.ok(config.clientWireguard.includes('PersistentKeepalive = 25'));

    // BIRD snippet
    assert.ok(config.clientBird.includes('protocol bgp akilab_'));
    assert.ok(config.clientBird.includes('local as 4242423143'));
    assert.ok(config.clientBird.includes('extended next hop on'));

    // Server snippets
    assert.ok(config.serverWireguardSnippet.includes('PublicKey = yA+N64x7tN/4H1XqJd+7qf3K9z1V8uT5R7o+P2w8x1E='));
    assert.ok(config.serverWireguardSnippet.includes('Endpoint = peer.example.dn42:23143'));
    assert.ok(config.serverBirdSnippet.includes('protocol bgp dn42_4242423143_'));
  });

  test('P2-1: omits ListenPort in client WG when clientPort is auto', () => {
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
    assert.ok(config.clientWireguard.includes('Endpoint = jp1.akilab.dn42:23143'));
  });
});
