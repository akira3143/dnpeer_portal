import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { formatBirdRouteQuery, LookingGlassService } from '../../server/services/lookingGlassService.js';
import { getActiveConfig } from '../../server/storage/configLoader.js';

test('Round 33: Looking Glass Route Lookup & CLI/GUI Query Fixes', async (t) => {

  await t.test('1. formatBirdRouteQuery normalizes bare IP and CIDR prefixes to "show route for <target>"', () => {
    // Bare IPv4 (user exact bug scenario)
    assert.equal(formatBirdRouteQuery('172.20.0.53'), 'show route for 172.20.0.53');
    assert.equal(formatBirdRouteQuery('172.20.0.53 all'), 'show route for 172.20.0.53 all');
    assert.equal(formatBirdRouteQuery('172.20.0.53 primary'), 'show route for 172.20.0.53 primary');

    // IPv4 CIDR prefix
    assert.equal(formatBirdRouteQuery('172.20.0.0/16'), 'show route for 172.20.0.0/16');
    assert.equal(formatBirdRouteQuery('172.20.0.53/32'), 'show route for 172.20.0.53/32');

    // Bare IPv6 & IPv6 CIDR
    assert.equal(formatBirdRouteQuery('fd5c::1'), 'show route for fd5c::1');
    assert.equal(formatBirdRouteQuery('fd5c:1111:2222::1 all'), 'show route for fd5c:1111:2222::1 all');
    assert.equal(formatBirdRouteQuery('fd5c::/48'), 'show route for fd5c::/48');
  });

  await t.test('2. formatBirdRouteQuery normalizes ASN queries to BIRD bgp_path filter', () => {
    // 10-digit DN42 ASN
    assert.equal(formatBirdRouteQuery('4242421816'), 'show route where bgp_path ~ [= * 4242421816 * =]');
    assert.equal(formatBirdRouteQuery('AS4242421816'), 'show route where bgp_path ~ [= * 4242421816 * =]');
    assert.equal(formatBirdRouteQuery('as4242421816'), 'show route where bgp_path ~ [= * 4242421816 * =]');
    assert.equal(formatBirdRouteQuery('AS4242421816 all'), 'show route where bgp_path ~ [= * 4242421816 * =] all');

    // 16-bit / 32-bit public ASN
    assert.equal(formatBirdRouteQuery('20473'), 'show route where bgp_path ~ [= * 20473 * =]');
    assert.equal(formatBirdRouteQuery('AS20473'), 'show route where bgp_path ~ [= * 20473 * =]');

    // Strips "for" prefix if user entered "for AS4242421816" or "for 4242421816"
    assert.equal(formatBirdRouteQuery('for AS4242421816'), 'show route where bgp_path ~ [= * 4242421816 * =]');
    assert.equal(formatBirdRouteQuery('for 4242421816'), 'show route where bgp_path ~ [= * 4242421816 * =]');
  });

  await t.test('3. formatBirdRouteQuery preserves BIRD keywords and handles empty target', () => {
    // Explicit "for"
    assert.equal(formatBirdRouteQuery('for 172.20.0.53'), 'show route for 172.20.0.53');
    assert.equal(formatBirdRouteQuery('for 172.20.0.0/16'), 'show route for 172.20.0.0/16');

    // Explicit "where", "all", "table", "filter", "export", "primary"
    assert.equal(formatBirdRouteQuery('where bgp_path.len > 4'), 'show route where bgp_path.len > 4');
    assert.equal(formatBirdRouteQuery('all'), 'show route all');
    assert.equal(formatBirdRouteQuery('table master4'), 'show route table master4');
    assert.equal(formatBirdRouteQuery('primary'), 'show route primary');

    // Empty or whitespace
    assert.equal(formatBirdRouteQuery(''), 'show route');
    assert.equal(formatBirdRouteQuery('   '), 'show route');
    assert.equal(formatBirdRouteQuery(null), 'show route');
  });

  await t.test('4. LookingGlassService sends correct q param to bird-lgproxy for route, ping, and traceroute', async () => {
    const receivedQueries = [];
    const mockServer = http.createServer((req, res) => {
      const u = new URL(req.url, 'http://127.0.0.1');
      receivedQueries.push({
        pathname: u.pathname,
        q: u.searchParams.get('q')
      });
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('BIRD 2.15.1 mock output');
    });

    await new Promise(resolve => mockServer.listen(0, '127.0.0.1', resolve));
    const port = mockServer.address().port;

    const config = getActiveConfig();
    const testNode = {
      id: 'TEST-LG-ROUTING-NODE',
      name: 'Test LG Node',
      lgProxyUrl: `http://127.0.0.1:${port}`
    };
    config.nodes.push(testNode);

    try {
      // 1. Route query with bare IP (user bug)
      const res1 = await LookingGlassService.query({
        nodeId: 'TEST-LG-ROUTING-NODE',
        command: 'route',
        target: '172.20.0.53'
      });
      assert.equal(res1.success, true);
      assert.equal(receivedQueries[receivedQueries.length - 1].pathname, '/bird');
      assert.equal(receivedQueries[receivedQueries.length - 1].q, 'show route for 172.20.0.53');

      // 2. Route query with ASN
      const res2 = await LookingGlassService.query({
        nodeId: 'TEST-LG-ROUTING-NODE',
        command: 'route',
        target: 'AS4242421816'
      });
      assert.equal(res2.success, true);
      assert.equal(receivedQueries[receivedQueries.length - 1].pathname, '/bird');
      assert.equal(receivedQueries[receivedQueries.length - 1].q, 'show route where bgp_path ~ [= * 4242421816 * =]');

      // 3. Ping query
      const res3 = await LookingGlassService.query({
        nodeId: 'TEST-LG-ROUTING-NODE',
        command: 'ping',
        target: '172.20.0.53'
      });
      assert.equal(res3.success, true);
      assert.equal(receivedQueries[receivedQueries.length - 1].pathname, '/ping');
      assert.equal(receivedQueries[receivedQueries.length - 1].q, '172.20.0.53');

      // 4. Traceroute query
      const res4 = await LookingGlassService.query({
        nodeId: 'TEST-LG-ROUTING-NODE',
        command: 'trace',
        target: '172.20.0.53'
      });
      assert.equal(res4.success, true);
      assert.equal(receivedQueries[receivedQueries.length - 1].pathname, '/traceroute');
      assert.equal(receivedQueries[receivedQueries.length - 1].q, '172.20.0.53');
    } finally {
      const idx = config.nodes.indexOf(testNode);
      if (idx !== -1) config.nodes.splice(idx, 1);
      await new Promise(resolve => mockServer.close(resolve));
    }
  });

  await t.test('5. CLI lg script supports route node resolution and ping command', () => {
    const lgPath = path.resolve('cli/cli-src/bin/lg');
    const content = fs.readFileSync(lgPath, 'utf8');

    assert.match(content, /if \[ "\$cmd" = "route" \]; then/, 'lg must handle route command node identification');
    assert.match(content, /is_known_node "\$target"/, 'lg must check if target is a known node');
    assert.match(content, /if \[ "\$cmd" = "ping" \]; then/, 'lg must support ping command');
  });

  await t.test('6. rootfs.dat is newly compiled and non-empty', () => {
    const rootfsPath = path.resolve('cli/public/rootfs.dat');
    assert.ok(fs.existsSync(rootfsPath), 'rootfs.dat must exist');
    const stat = fs.statSync(rootfsPath);
    assert.ok(stat.size > 500000, `rootfs.dat size is ${stat.size} bytes`);
  });
});
