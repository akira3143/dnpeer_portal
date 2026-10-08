import test from 'node:test';
import assert from 'node:assert/strict';
import { LookingGlassService, formatBirdRouteQuery } from '../../server/services/lookingGlassService.js';
import { LookingGlassController } from '../../server/controllers/lgController.js';
import { getActiveConfig } from '../../server/storage/configLoader.js';

test('Security Hardening: Looking Glass BIRD Command Injection Prevention', async (t) => {
  const origMock = process.env.MOCK_LG_OUTPUT;
  process.env.MOCK_LG_OUTPUT = 'BIRD 2.15.1 mock output';

  t.after(() => {
    if (origMock !== undefined) {
      process.env.MOCK_LG_OUTPUT = origMock;
    } else {
      delete process.env.MOCK_LG_OUTPUT;
    }
  });

  const node = getActiveConfig().nodes[0];

  await t.test('1. Strictly rejects newlines (CRLF) in target parameter', async () => {
    // Attack scenario from security audit report: target="all\ndisable all"
    const res1 = await LookingGlassService.query({
      nodeId: node.id,
      command: 'protocols',
      target: 'all\ndisable all'
    });
    assert.equal(res1.success, false);
    assert.match(res1.error, /newlines are strictly forbidden/i);

    // CRLF in route target
    const res2 = await LookingGlassService.query({
      nodeId: node.id,
      command: 'route',
      target: '172.20.150.1\r\nrestart all'
    });
    assert.equal(res2.success, false);
    assert.match(res2.error, /newlines are strictly forbidden/i);

    // Controller envelope layer also surfaces error
    const ctrlRes = await LookingGlassController.query({
      nodeId: node.id,
      command: 'protocols',
      target: 'all\ndisable all'
    });
    assert.equal(ctrlRes.success, false);
    assert.match(ctrlRes.error?.message || ctrlRes.error, /newlines are strictly forbidden/i);
  });

  await t.test('2. Strictly rejects newlines (CRLF) in command parameter', async () => {
    const res = await LookingGlassService.query({
      nodeId: node.id,
      command: 'protocols\ndisable all',
      target: ''
    });
    assert.equal(res.success, false);
    assert.match(res.error, /newlines are strictly forbidden/i);
  });

  await t.test('3. Strictly rejects unwhitelisted administrative commands', async () => {
    const dangerousCommands = [
      'disable all',
      'restart all',
      'reload',
      'down',
      'configure',
      'eval',
      'echo test'
    ];

    for (const cmd of dangerousCommands) {
      const res = await LookingGlassService.query({
        nodeId: node.id,
        command: cmd,
        target: ''
      });
      assert.equal(res.success, false, `Should reject dangerous command: ${cmd}`);
      assert.match(res.error, /invalid command/i);
    }
  });

  await t.test('4. Rejects argument injection and shell metacharacters in ping and traceroute', async () => {
    const maliciousTargets = [
      '172.20.0.1; rm -rf /',
      '172.20.0.1 | cat /etc/passwd',
      '172.20.0.1 && echo pwned',
      '-c 10 172.20.0.1',
      '--privileged',
      '172.20.0.1 10.0.0.1',
      '`whoami`'
    ];

    for (const target of maliciousTargets) {
      const resPing = await LookingGlassService.query({
        nodeId: node.id,
        command: 'ping',
        target
      });
      assert.equal(resPing.success, false, `Ping should reject target: ${target}`);
      assert.match(resPing.error, /invalid target for ping\/traceroute/i);

      const resTrace = await LookingGlassService.query({
        nodeId: node.id,
        command: 'traceroute',
        target
      });
      assert.equal(resTrace.success, false, `Traceroute should reject target: ${target}`);
      assert.match(resTrace.error, /invalid target for ping\/traceroute/i);
    }
  });

  await t.test('5. Rejects dangerous shell metacharacters in route target', async () => {
    const maliciousRouteTargets = [
      '172.20.0.1; disable all',
      '172.20.0.1 | ls',
      '172.20.0.1 && quit',
      '$(whoami)',
      '172.20.0.1`id`'
    ];

    for (const target of maliciousRouteTargets) {
      const res = await LookingGlassService.query({
        nodeId: node.id,
        command: 'route',
        target
      });
      assert.equal(res.success, false, `Route should reject target: ${target}`);
      assert.match(res.error, /unsupported characters/i);
    }
  });

  await t.test('6. formatBirdRouteQuery strips newlines and sanitizes fallback query safely', () => {
    // Newline stripped cleanly
    assert.equal(formatBirdRouteQuery('172.20.0.53\n'), 'show route for 172.20.0.53');
    assert.equal(formatBirdRouteQuery('AS4242421816\r\n'), 'show route where bgp_path ~ [= * 4242421816 * =]');

    // Dangerous characters in fallback return safe default 'show route'
    assert.equal(formatBirdRouteQuery('custom; disable all'), 'show route');
    assert.equal(formatBirdRouteQuery('custom && reload'), 'show route');
  });

  await t.test('7. Valid legitimate queries continue to work normally', async () => {
    // Route lookup IPv4
    const resRoute4 = await LookingGlassService.query({
      nodeId: node.id,
      command: 'route',
      target: '172.20.150.1'
    });
    assert.equal(resRoute4.success, true);

    // Route lookup ASN
    const resRouteAsn = await LookingGlassService.query({
      nodeId: node.id,
      command: 'route',
      target: 'AS4242423143'
    });
    assert.equal(resRouteAsn.success, true);

    // Protocols
    const resProtocols = await LookingGlassService.query({
      nodeId: node.id,
      command: 'protocols',
      target: 'all'
    });
    assert.equal(resProtocols.success, true);

    // Ping
    const resPing = await LookingGlassService.query({
      nodeId: node.id,
      command: 'ping',
      target: '172.20.150.1'
    });
    assert.equal(resPing.success, true);

    // Traceroute
    const resTrace = await LookingGlassService.query({
      nodeId: node.id,
      command: 'traceroute',
      target: 'node1.akilab.dn42'
    });
    assert.equal(resTrace.success, true);
  });
});
