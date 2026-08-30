import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rulesShPath = path.resolve(__dirname, '../../cli/cli-src/lib/rules.sh');

function findSh() {
  const candidates = [
    'sh',
    'C:\\Program Files\\Git\\bin\\sh.exe',
    'C:\\Program Files\\Git\\usr\\bin\\sh.exe',
    'C:\\Program Files (x86)\\Git\\bin\\sh.exe'
  ];
  for (const c of candidates) {
    try {
      const res = spawnSync(c, ['-c', 'echo ok'], { encoding: 'utf8' });
      if (res.status === 0 && res.stdout.trim() === 'ok') {
        return c;
      }
    } catch {}
  }
  return null;
}

const shBin = findSh();

describe('Shell Rules POSIX Validation Tests', { skip: !shBin ? 'sh binary not found' : false }, () => {
  function runShScript(code) {
    const unixRulesPath = rulesShPath.replace(/\\/g, '/');
    const fullScript = `. "${unixRulesPath}"\n${code}`;
    return spawnSync(shBin, ['-c', fullScript], { encoding: 'utf8' });
  }

  test('rules.sh exists and is non-empty', () => {
    assert.ok(fs.existsSync(rulesShPath));
    const content = fs.readFileSync(rulesShPath, 'utf8');
    assert.ok(content.includes('normalize_asn'));
    assert.ok(content.includes('calc_default_port'));
    assert.ok(content.includes('validate_asn'));
  });

  test('shell normalize_asn and calc_default_port', () => {
    const res = runShScript(`
      normalize_asn "AS4242423143"
      calc_default_port "4242423143"
      calc_default_port "AS4242420001"
    `);
    assert.equal(res.status, 0);
    const lines = res.stdout.trim().split('\n').map(l => l.trim());
    assert.equal(lines[0], '4242423143');
    assert.equal(lines[1], '23143');
    assert.equal(lines[2], '20001');
  });

  test('shell validate_asn returns correct exit codes', () => {
    const res = runShScript(`
      validate_asn "4242423143" || echo "fail 1"
      validate_asn "AS4242423143" || echo "fail 2"
      validate_asn "invalid" && echo "should have failed 3"
      validate_asn "" && echo "should have failed 4"
      echo "done"
    `);
    assert.equal(res.status, 0);
    const lines = res.stdout.trim().split('\n').map(l => l.trim());
    assert.equal(lines.length, 1);
    assert.equal(lines[0], 'done');
  });

  test('shell validate_pubkey returns correct exit codes', () => {
    const res = runShScript(`
      validate_pubkey "yA+N64x7tN/4H1XqJd+7qf3K9z1V8uT5R7o+P2w8x1E=" || echo "fail 1"
      validate_pubkey "short=" && echo "should have failed 2"
      validate_pubkey "yA+N64x7tN/4H1XqJd+7qf3K9z1V8uT5R7o+P2w8x1E" && echo "should have failed 3"
      echo "done"
    `);
    assert.equal(res.status, 0);
    const lines = res.stdout.trim().split('\n').map(l => l.trim());
    assert.equal(lines[0], 'done');
  });

  test('shell validate_ipv4 returns correct exit codes', () => {
    const res = runShScript(`
      validate_ipv4 "172.20.150.1" || echo "fail 1"
      validate_ipv4 "10.0.0.1/32" || echo "fail 2"
      validate_ipv4 "256.0.0.1" && echo "should have failed 3"
      validate_ipv4 "abc" && echo "should have failed 4"
      echo "done"
    `);
    assert.equal(res.status, 0);
    const lines = res.stdout.trim().split('\n').map(l => l.trim());
    assert.equal(lines[0], 'done');
  });

  test('shell validate_ipv6_ula and validate_link_local', () => {
    const res = runShScript(`
      validate_ipv6_ula "fd00:4242:3143::1" || echo "fail 1"
      validate_ipv6_ula "2001:db8::1" && echo "should have failed 2"
      validate_link_local "fe80::3143" || echo "fail 3"
      validate_link_local "fe80::4242:3143" || echo "fail 4"
      validate_link_local "fe80::4242423143" && echo "should have failed 5"
      validate_link_local "fd00::1" && echo "should have failed 6"
      echo "done"
    `);
    assert.equal(res.status, 0);
    const lines = res.stdout.trim().split('\n').map(l => l.trim());
    assert.equal(lines[0], 'done');
  });
});
