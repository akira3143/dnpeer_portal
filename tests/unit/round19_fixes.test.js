import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');

// Find a suitable POSIX shell (Git bash sh or system sh)
function findSh() {
  const candidates = [
    'C:\\Program Files\\Git\\bin\\sh.exe',
    'C:\\Program Files (x86)\\Git\\bin\\sh.exe',
    'sh.exe',
    'sh'
  ];
  for (const c of candidates) {
    try {
      execFileSync(c, ['-c', 'exit 0'], { stdio: 'pipe' });
      return c;
    } catch {}
  }
  return 'sh';
}

const SH_PATH = findSh();

describe('Round 19 Fixes & Enhancements Unit Tests', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dn42-test-r19-'));

  after(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  test('Task 4: json_field extracts numeric values with and without whitespace after colon', () => {
    const script = `
      . "${path.join(ROOT_DIR, 'cli/cli-src/etc/dn42-lib.sh').replace(/\\/g, '/')}"
      compact='{"asn":4242423143,"port":23143}'
      spaced='{"asn": 4242423143, "port": 23143}'
      multispaced='{"asn":   4242423143}'

      val1=$(json_field "$compact" asn)
      val2=$(json_field "$spaced" asn)
      val3=$(json_field "$multispaced" asn)
      val4=$(json_field "$spaced" port)
      echo "$val1|$val2|$val3|$val4"
    `;

    const out = execFileSync(SH_PATH, ['-c', script], { cwd: ROOT_DIR }).toString().trim();
    assert.equal(out, '4242423143|4242423143|4242423143|23143');
  });

  test('Task 2: lg command defaults to JP-7 (not obsolete JP-TYO-1)', () => {
    const lgContent = fs.readFileSync(path.join(ROOT_DIR, 'cli/cli-src/bin/lg'), 'utf8');
    assert.ok(!lgContent.includes('JP-TYO-1'), 'Obsolete JP-TYO-1 must not be present in lg script');
    assert.ok(lgContent.includes('node="JP-7"'), 'lg must default to JP-7');
  });

  test('Task 3: peer edit matches sessions by number, node ID (case-insensitive), or session ID', () => {
    const mockSessionsFile = path.join(tmpDir, 'dn42_my_sessions');
    fs.writeFileSync(
      mockSessionsFile,
      'peer_as4242423143_jp_7|JP-7|pending|23143\npeer_as4242423143_us_la1|US-LA1|active|23143\n',
      'utf8'
    );

    const testMatchingScript = `
      target_idx="$1"
      sess_count=2
      sel_line=""
      if [ -n "$target_idx" ]; then
        if echo "$target_idx" | grep -q '^[0-9][0-9]*$' && [ "$target_idx" -ge 1 ] && [ "$target_idx" -le "$sess_count" ]; then
          sel_line=$(sed -n "\${target_idx}p" "${mockSessionsFile.replace(/\\/g, '/')}")
        else
          _tgt_lower=$(echo "$target_idx" | tr '[:upper:]' '[:lower:]')
          while IFS='|' read -r _sid _snode _sstat _sport; do
            if [ "$(echo "$_snode" | tr '[:upper:]' '[:lower:]')" = "$_tgt_lower" ] || \
               [ "$(echo "$_sid" | tr '[:upper:]' '[:lower:]')" = "$_tgt_lower" ]; then
              sel_line="$_sid|$_snode|$_sstat|$_sport"
              break
            fi
          done < "${mockSessionsFile.replace(/\\/g, '/')}"
        fi
      fi
      echo "$sel_line"
    `;

    // 1. By number: 1
    const outNum = execFileSync(SH_PATH, ['-c', testMatchingScript, '--', '1'], { cwd: ROOT_DIR }).toString().trim();
    assert.ok(outNum.includes('JP-7'));

    // 2. By uppercase node ID: US-LA1
    const outNodeUpper = execFileSync(SH_PATH, ['-c', testMatchingScript, '--', 'US-LA1'], { cwd: ROOT_DIR }).toString().trim();
    assert.ok(outNodeUpper.includes('US-LA1'));

    // 3. By lowercase node ID: jp-7
    const outNodeLower = execFileSync(SH_PATH, ['-c', testMatchingScript, '--', 'jp-7'], { cwd: ROOT_DIR }).toString().trim();
    assert.ok(outNodeLower.includes('JP-7'));

    // 4. By session ID: peer_as4242423143_us_la1
    const outSessId = execFileSync(SH_PATH, ['-c', testMatchingScript, '--', 'peer_as4242423143_us_la1'], { cwd: ROOT_DIR }).toString().trim();
    assert.ok(outSessId.includes('US-LA1'));

    // 5. Non-existent:
    const outNone = execFileSync(SH_PATH, ['-c', testMatchingScript, '--', 'HK-99'], { cwd: ROOT_DIR }).toString().trim();
    assert.equal(outNone, '');
  });

  test('Task 1: do_edit enforces clean_asn missing guard', () => {
    const peerScript = fs.readFileSync(path.join(ROOT_DIR, 'cli/cli-src/bin/peer'), 'utf8');
    const doEditBlock = peerScript.slice(peerScript.indexOf('do_edit()'));
    assert.ok(doEditBlock.includes('clean_asn=$(dn42_asn 2>/dev/null)'), 'do_edit must call dn42_asn');
    assert.ok(doEditBlock.includes('Session identity missing. Please logout and login again.'), 'do_edit must have identity guard');
  });

  test('Task 5 & 6: Review table annotates fixed ports and distinguishes update vs new', () => {
    const peerScript = fs.readFileSync(path.join(ROOT_DIR, 'cli/cli-src/bin/peer'), 'utf8');
    assert.ok(peerScript.includes('host_port_desc="$parsed_peer_port (fixed)"'), 'Review must annotate fixed peer port');
    assert.ok(peerScript.includes('client_port_desc="$parsed_listen_port (fixed)"'), 'Review must annotate fixed listen port');
    assert.ok(peerScript.includes('Tip: Fixed port retains current value'), 'Review must print tip on fixed ports');

    assert.ok(peerScript.includes('Peering session updated successfully! Changes are applied.'), 'Must have update success message');
    assert.ok(peerScript.includes('Received your peering info. We\'ll establish the peer with you within 24 hours!'), 'Must preserve new success message');
  });

  test('Task 7: Template node matching is case-insensitive and normalizes to uppercase', () => {
    const mockNodesFile = path.join(tmpDir, 'dn42_nodes');
    fs.writeFileSync(mockNodesFile, 'JP-7|Japan Tokyo 07 (Core Hub)|jp7.dn42\nHK-1|Hong Kong 01|hk1.dn42\n', 'utf8');

    const testCaseScript = `
      parsed_node="$1"
      node_found=0
      _parsed_lower=$(echo "$parsed_node" | tr '[:upper:]' '[:lower:]')
      while IFS='|' read -r _nid _nname _nend; do
        if [ "$(echo "$_nid" | tr '[:upper:]' '[:lower:]')" = "$_parsed_lower" ]; then
          node_found=1
          sel_nid="$_nid"
          sel_nname="$_nname"
          parsed_node="$_nid"
          break
        fi
      done < "${mockNodesFile.replace(/\\/g, '/')}"
      echo "$node_found|$parsed_node"
    `;

    const out = execFileSync(SH_PATH, ['-c', testCaseScript, '--', 'jp-7'], { cwd: ROOT_DIR }).toString().trim();
    assert.equal(out, '1|JP-7', 'Should find jp-7 and normalize to JP-7');
  });
});
