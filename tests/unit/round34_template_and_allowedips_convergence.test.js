import test from 'node:test';
import assert from 'node:assert/strict';
import { ConfigEngine } from '../../server/services/configEngine.js';
import { getActiveConfig } from '../../server/storage/configLoader.js';
import { parseAllowedIps } from '../../server/services/sessionService.js';

test('Round 34: WireGuard Template & AllowedIPs Convergence (Option A)', async (t) => {
  const node = getActiveConfig().nodes[0];

  await t.test('1. LLA-only peer produces clean LLA-only server Address, Table = off, and Option A AllowedIPs', () => {
    const config = ConfigEngine.generateFullConfig({
      asn: 4242420078,
      nodeId: node.id,
      clientPublicKey: 'ED1DzcikAI0E6r4ZQ0sFqczu64Rng4HJcJYR4FEfrSo=',
      clientEndpoint: 'us03.tes286.top',
      clientLinkLocal: 'fe80::78',
      clientIpv4: '',
      clientIpv6Ula: '',
      hostPort: 20078,
      clientPort: 23143,
      mtu: 1420
    });

    // Server WireGuard Snippet
    assert.ok(config.serverWireguardSnippet.includes('[Interface]'));
    assert.ok(config.serverWireguardSnippet.includes(`Address = ${node.tunnelIpv6LLA || 'fe80::3143'}/64`));
    assert.doesNotMatch(config.serverWireguardSnippet, /Address = .*172\./, 'Must NOT contain IPv4 in Address when client did not provide IPv4');
    assert.doesNotMatch(config.serverWireguardSnippet, /Address = .*fd[0-9a-fA-F:]+/, 'Must NOT contain IPv6 ULA in Address when client did not provide ULA');
    assert.ok(config.serverWireguardSnippet.includes('Table = off'), 'Server snippet MUST include Table = off');
    assert.ok(config.serverWireguardSnippet.includes('AllowedIPs = 172.20.0.0/14, 172.31.0.0/16, 10.0.0.0/8, fd00::/8, fe80::/64'));
    assert.doesNotMatch(config.serverWireguardSnippet, /172\.16\.0\.0\/12/, 'Must NOT contain 172.16.0.0/12');
    assert.doesNotMatch(config.serverWireguardSnippet, /fe80::\/10/, 'Must NOT contain fe80::/10');

    // Client WireGuard Config
    assert.ok(config.clientWireguard.includes('[Interface]'));
    assert.ok(config.clientWireguard.includes('Address = fe80::78/64'));
    assert.ok(config.clientWireguard.includes('Table = off'), 'Client config MUST include Table = off');
    assert.ok(config.clientWireguard.includes('AllowedIPs = 172.20.0.0/14, 172.31.0.0/16, 10.0.0.0/8, fd00::/8, fe80::/64'));
    assert.doesNotMatch(config.clientWireguard, /172\.16\.0\.0\/12/, 'Must NOT contain 172.16.0.0/12');
    assert.doesNotMatch(config.clientWireguard, /fe80::\/10/, 'Must NOT contain fe80::/10');
  });

  await t.test('2. Dual-stack peer prioritizes LLA as the first address on both server and client', () => {
    const config = ConfigEngine.generateFullConfig({
      asn: 4242421816,
      nodeId: node.id,
      clientPublicKey: 'yA+N64x7tN/4H1XqJd+7qf3K9z1V8uT5R7o+P2w8x1E=',
      clientEndpoint: 'peer.potat0.dn42',
      clientLinkLocal: 'fe80::1816',
      clientIpv4: '172.20.150.99',
      clientIpv6Ula: 'fd00:4242:1816::1',
      hostPort: 21816,
      clientPort: 23143,
      mtu: 1420
    });

    // Server Address line order: LLA first
    const serverAddrMatch = config.serverWireguardSnippet.match(/^Address\s*=\s*(.+)$/m);
    assert.ok(serverAddrMatch, 'Server Address line must exist');
    assert.match(serverAddrMatch[1], /^fe80:[^,]+,\s*172\./, 'Server Address must list LLA first, then IPv4');

    // Client Address line order: LLA first
    const clientAddrMatch = config.clientWireguard.match(/^Address\s*=\s*(.+)$/m);
    assert.ok(clientAddrMatch, 'Client Address line must exist');
    assert.match(clientAddrMatch[1], /^fe80:[^,]+,\s*172\./, 'Client Address must list LLA first, then IPv4');
  });

  await t.test('3. parseAllowedIps correctly filters out all converged route summaries', () => {
    const rawAllowedIps = '172.20.0.0/14, 172.31.0.0/16, 10.0.0.0/8, fd00::/8, fe80::/64, 172.20.188.55/32, fe80::55/64';
    const parsed = parseAllowedIps(rawAllowedIps);

    assert.equal(parsed.ipv4, '172.20.188.55', 'Must extract true host IPv4');
    assert.equal(parsed.linkLocal, 'fe80::55', 'Must extract true host LLA');
    assert.equal(parsed.ipv6Ula, '', 'No ULA host was present');
  });
});
