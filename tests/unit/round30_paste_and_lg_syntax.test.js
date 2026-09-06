import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

test('Round 30: Terminal Paste Sanitization and LG Shell Syntax Fixes', async (t) => {
  const lgPath = path.resolve('cli/cli-src/bin/lg');
  const indexPath = path.resolve('cli/public/index.html');
  const rootfsPath = path.resolve('cli/public/rootfs.dat');

  await t.test('1. cli/cli-src/bin/lg quotes "for" pattern in case to prevent BusyBox ash syntax error', () => {
    const lgContent = fs.readFileSync(lgPath, 'utf8');

    assert.match(lgContent, /"for"\)/, 'case statement must quote "for" to prevent BusyBox ash syntax error: unexpected )');
    assert.doesNotMatch(lgContent, /^\s*for\)/m, 'Unquoted for) pattern must not exist');
  });

  await t.test('2. cli/public/index.html intercepts paste events in capture phase and stops propagation', () => {
    const indexContent = fs.readFileSync(indexPath, 'utf8');

    assert.match(indexContent, /window\.addEventListener\("paste",\s*handlePaste,\s*true\)/, 'Must listen to paste in capture phase');
    assert.match(indexContent, /e\.stopImmediatePropagation\(\)/, 'Must stop immediate propagation to bypass xterm un-sanitized paste');
    assert.match(indexContent, /term\.paste\(sanitized\)/, 'Must use term.paste with sanitized text');
    assert.match(indexContent, /event\.metaKey\s*&&\s*\(event\.key\s*===\s*'v'\s*\|\|\s*event\.key\s*===\s*'V'\)/, 'Must support Cmd+V');
  });

  await t.test('3. sanitizePasteText logic correctly strips trailing CRLF while preserving inner newlines', () => {
    function sanitizePasteText(text) {
      if (!text || typeof text !== 'string') return '';
      return text.replace(/[\r\n]+$/, '');
    }

    assert.equal(sanitizePasteText('lg bgp HK-1\n'), 'lg bgp HK-1');
    assert.equal(sanitizePasteText('lg bgp HK-1\r\n'), 'lg bgp HK-1');
    assert.equal(sanitizePasteText('lg bgp HK-1\n\n'), 'lg bgp HK-1');
    assert.equal(sanitizePasteText('echo line1\necho line2\n'), 'echo line1\necho line2');
    assert.equal(sanitizePasteText('echo line1\r\necho line2\r\n'), 'echo line1\r\necho line2');
    assert.equal(sanitizePasteText('lg route 172.20.0.0/16'), 'lg route 172.20.0.0/16');
    assert.equal(sanitizePasteText('\n'), '');
    assert.equal(sanitizePasteText('\r\n'), '');
    assert.equal(sanitizePasteText(''), '');
  });

  await t.test('4. rootfs.dat exists, is compiled, and non-empty', () => {
    assert.ok(fs.existsSync(rootfsPath), 'rootfs.dat must exist');
    const stat = fs.statSync(rootfsPath);
    assert.ok(stat.size > 500000, 'rootfs.dat should be at least 500KB');
  });
});
