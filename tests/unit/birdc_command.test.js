import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { LookingGlassService } from '../../server/services/lookingGlassService.js';
import { LookingGlassController } from '../../server/controllers/lgController.js';
import { createServer } from '../../server/index.js';

test('birdc show protocols and LookingGlass command emulation unit tests', async (t) => {
  const origMock = process.env.MOCK_LG_OUTPUT;

  t.after(() => {
    if (origMock !== undefined) {
      process.env.MOCK_LG_OUTPUT = origMock;
    } else {
      delete process.env.MOCK_LG_OUTPUT;
    }
  });

  await t.test('LookingGlassService normalizes "show protocols" command and targets', async () => {
    process.env.MOCK_LG_OUTPUT = 'BIRD 2.15.1 ready.\nName Proto Table State Since Info\nibgp_tyix_jp2 BGP --- up 2026-08-31 Established\n';

    // 1. show protocols
    const res1 = await LookingGlassService.query({ nodeId: 'JP-7', command: 'show protocols' });
    assert.equal(res1.success, true);
    assert.equal(res1.command, 'protocols');
    assert.ok(res1.output.includes('ibgp_tyix_jp2'));

    // 2. show protocols all
    const res2 = await LookingGlassService.query({ nodeId: 'JP-7', command: 'show protocols all' });
    assert.equal(res2.success, true);
    assert.equal(res2.command, 'protocols');
    assert.equal(res2.target, 'all');

    // 3. show route for 172.20.188.0/24
    const res3 = await LookingGlassService.query({ nodeId: 'JP-7', command: 'show route for 172.20.188.0/24' });
    assert.equal(res3.success, true);
    assert.equal(res3.command, 'route');
    assert.equal(res3.target, 'for 172.20.188.0/24');

    // 4. show status
    const res4 = await LookingGlassService.query({ nodeId: 'JP-7', command: 'show status' });
    assert.equal(res4.success, true);
    assert.equal(res4.command, 'status');
  });

  await t.test('LookingGlassController accepts show protocols and returns successEnvelope', async () => {
    process.env.MOCK_LG_OUTPUT = 'BIRD 2.15.1 ready.\nName Proto Table State Since Info\nibgp_us BGP --- start 2026-09-04 Connect BGP Error: Hold timer expired\n';

    const resp = await LookingGlassController.query({
      nodeId: 'JP-7',
      command: 'show protocols'
    });
    assert.equal(resp.success, true);
    assert.equal(resp.code, 200);
    assert.equal(resp.data.command, 'protocols');
    assert.ok(resp.data.output.includes('Hold timer expired'));
  });

  await t.test('HTTP POST /api/looking-glass returns bird protocols output', async () => {
    process.env.MOCK_LG_OUTPUT = 'BIRD 2.15.1 ready.\nName Proto Table State Since Info\ndn42_cow_jp BGP --- up 2026-09-04 Established\n';

    const server = createServer();
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;

    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/looking-glass`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nodeId: 'JP-7',
          command: 'show protocols'
        })
      });

      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.success, true);
      assert.ok(json.data.output.includes('dn42_cow_jp'));
      assert.equal(json.data.command, 'protocols');
    } finally {
      if (server && server.closeAll) await server.closeAll();
    }
  });

  await t.test('bin/help lists only lg subcommands and does NOT mention birdc', () => {
    const helpFile = path.resolve('cli/cli-src/bin/help');
    const content = fs.readFileSync(helpFile, 'utf8');
    assert.equal(content.includes('birdc'), false, 'help must not contain any mention of birdc');
    assert.ok(content.includes('lg route <IP|ASN> [node]'));
    assert.ok(content.includes('lg bgp [node]'));
    assert.ok(content.includes('lg status [node]'));
    assert.ok(content.includes('lg ping <IP> [node]'));
    assert.ok(content.includes('lg trace <IP> [node]'));
  });

  await t.test('bin/birdc is a slim alias delegating directly to lg without independent query logic', () => {
    const birdcFile = path.resolve('cli/cli-src/bin/birdc');
    const content = fs.readFileSync(birdcFile, 'utf8');
    assert.equal(content.includes('api_post'), false, 'birdc must not have independent api_post calls');
    assert.equal(content.includes('/api/looking-glass'), false, 'birdc must not call looking-glass api directly');
    assert.ok(content.includes('LG_BIN'), 'birdc must reference LG_BIN');
    assert.ok(content.includes('"$LG_BIN" protocols'), 'birdc must delegate protocols to lg');
    assert.ok(content.includes('"$LG_BIN" status'), 'birdc must delegate status to lg');
    assert.ok(content.includes('"$LG_BIN" route'), 'birdc must delegate route to lg');
    assert.ok(content.includes('bird> '), 'birdc must preserve interactive prompt loop');
  });

  await t.test('dn42-lib.sh provides colorize_bird_output matching screenshot palette', () => {
    const libFile = path.resolve('cli/cli-src/etc/dn42-lib.sh');
    const content = fs.readFileSync(libFile, 'utf8');
    assert.ok(content.includes('colorize_bird_output()'));
    // Palette assertions
    assert.ok(content.includes('38;5;111m'), 'Protocol name must be sky blue');
    assert.ok(content.includes('38;5;147m'), 'Protocol type must be lavender');
    assert.ok(content.includes('38;5;153m'), 'Established info must be soft cyan');
    assert.ok(content.includes('38;5;222m'), 'Connect info must be soft yellow');
    assert.ok(content.includes('38;5;208m'), 'Date since must be warm orange');
    assert.ok(content.includes('1;31mError'), 'Error must be bold red');
    assert.ok(content.includes('1;37m'), 'Table header must be bold white');
  });

  await t.test('bin/lg handles -n/--node flag and pipes output to colorize_bird_output', () => {
    const lgFile = path.resolve('cli/cli-src/bin/lg');
    const content = fs.readFileSync(lgFile, 'utf8');
    assert.ok(content.includes('-n|--node'), 'lg must parse -n and --node flags');
    assert.ok(content.includes('colorize_bird_output'), 'lg must pipe BIRD queries to colorize_bird_output');
    assert.ok(content.includes('protocols'), 'lg must support protocols');
    assert.ok(content.includes('status'), 'lg must support status');
    assert.ok(content.includes('route'), 'lg must support route');
  });
});
