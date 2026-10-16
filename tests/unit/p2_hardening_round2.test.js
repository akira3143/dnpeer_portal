import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

import { StatusTracker } from '../../server/services/statusTracker.js';

describe('Round 2 P2 Hardening: CLI Robustness & Resource Control', () => {
  // ---------------------------------------------------------------------------
  // F-04: json_escape in dn42-lib.sh
  // ---------------------------------------------------------------------------
  test('1. F-04: json_escape in dn42-lib.sh escapes quotes, backslashes, newlines, CR, and tabs', () => {
    const libScript = path.resolve('cli/cli-src/etc/dn42-lib.sh');
    assert.ok(fs.existsSync(libScript), 'dn42-lib.sh must exist');

    const content = fs.readFileSync(libScript, 'utf8');
    assert.ok(content.includes('gsub(/\\\\/, "\\\\\\\\")'), 'json_escape must escape backslashes');
    assert.ok(content.includes('gsub(/"/, "\\\\\\\"")'), 'json_escape must escape quotes');
    assert.ok(content.includes('gsub(/\\r/, "\\\\r")'), 'json_escape must escape carriage returns');
    assert.ok(content.includes('gsub(/\\t/, "\\\\t")'), 'json_escape must escape tabs');

    // Verify dn42-login uses json_escape
    const loginScript = fs.readFileSync('cli/cli-src/sbin/dn42-login', 'utf8');
    assert.ok(loginScript.includes('safe_pwd=$(json_escape "$pwd")'), 'dn42-login must escape password');
    assert.ok(loginScript.includes('safe_new_pwd=$(json_escape "$new_pwd")'), 'dn42-login must escape new password');
    assert.ok(loginScript.includes('safe_sig=$(json_escape "$sig")'), 'dn42-login must escape signature');

    // Verify passwd uses json_escape
    const passwdScript = fs.readFileSync('cli/cli-src/bin/passwd', 'utf8');
    assert.ok(passwdScript.includes('safe_p1=$(json_escape "$p1")'), 'passwd must escape new password');

    // Verify lg uses json_escape
    const lgScript = fs.readFileSync('cli/cli-src/bin/lg', 'utf8');
    assert.ok(lgScript.includes('safe_target=$(json_escape "$target")'), 'lg must escape target');
  });

  // ---------------------------------------------------------------------------
  // F-05: peer draft parsing has no eval
  // ---------------------------------------------------------------------------
  test('2. F-05: peer script draft parsing does not contain eval and preserves trailing = in Base64 keys', () => {
    const peerScript = fs.readFileSync('cli/cli-src/bin/peer', 'utf8');
    // Ensure eval "$(awk is completely gone
    assert.ok(!peerScript.includes('eval "$(awk'), 'peer script must not use eval to parse awk output');
    assert.ok(peerScript.includes('while IFS= read -r _entry; do'), 'peer script must parse via safe while-read loop');

    // Functional verification: test that a draft with WireGuard public key ending in = retains the = character
    const testKey = '3C/iVpKcM86rEvLn63xP/qqcD0T5K9NEyrAnqxDmCyw=';
    const draftContent = [
      'Node = HK-1',
      `WireGuard Public Key = ${testKey}`,
      'Link-Local IPv6 (LLA) = fe80::2054:1'
    ].join('\n');

    const tmpDraft = 'temp_draft_test.txt';
    const tmpScript = 'temp_draft_test.sh';
    fs.writeFileSync(tmpDraft, draftContent, 'utf8');
    const shScriptContent = `#!/bin/sh
while IFS= read -r _entry; do
  [ -z "$_entry" ] && continue
  case "$_entry" in
    *=*) k="\${_entry%%=*}"; v="\${_entry#*=}" ;;
    *) k="$_entry"; v="" ;;
  esac
  case "$k" in
    parsed_pubkey) parsed_pubkey="$v" ;;
  esac
done <<EOF
$(awk '
  {
    line=$0; sub(/\\r$/, "", line)
    if (line ~ /^[[:space:]]*#/ || line ~ /^[[:space:]]*$/) next
    if (index(line, "=") > 0) {
      key=substr(line, 1, index(line, "=")-1)
      val=substr(line, index(line, "=")+1)
      gsub(/[ \\t]/, "", key); key=tolower(key)
      sub(/^[ \\t]+/, "", val); sub(/[ \\t]+$/, "", val)
      gsub(/[^A-Za-z0-9.:\\/+_<>= -]/, "", val)
      if (key=="wireguardpublickey" || key=="publickey" || key=="pubkey") printf "parsed_pubkey=%s\\n", val
    }
  }
' "${tmpDraft}")
EOF
echo "$parsed_pubkey"
`;
    fs.writeFileSync(tmpScript, shScriptContent, 'utf8');
    try {
      const res = spawnSync('bash', [tmpScript], { encoding: 'utf8' });
      assert.strictEqual(res.status, 0, `Shell parsing script must exit with 0: ${res.stderr}`);
      const parsedKey = (res.stdout || '').trim();
      assert.strictEqual(parsedKey, testKey, 'Parsed public key must exactly match original key with trailing =');
      assert.strictEqual(parsedKey.length, 44, 'Parsed key must have length 44');
    } finally {
      if (fs.existsSync(tmpDraft)) fs.unlinkSync(tmpDraft);
      if (fs.existsSync(tmpScript)) fs.unlinkSync(tmpScript);
    }
  });

  // ---------------------------------------------------------------------------
  // F-06: Raw BIRD output cap at 128KB
  // ---------------------------------------------------------------------------
  test('3. F-06: StatusTracker.recordBgpSnapshot caps rawBgpOutput to 128KB', () => {
    const hugeOutput = 'A'.repeat(200000);
    StatusTracker.recordBgpSnapshot('TEST-NODE-LIMIT', {
      rawBgpOutput: hugeOutput,
      bgpSessions: []
    });

    const snapshot = StatusTracker.getBgpSnapshot('TEST-NODE-LIMIT');
    assert.ok(snapshot, 'Snapshot must be recorded');
    assert.ok(snapshot.rawBgpOutput.length <= 131072 + 100, 'rawBgpOutput must be capped to ~128KB');
    assert.ok(snapshot.rawBgpOutput.includes('[TRUNCATED: Output exceeded 128KB limit]'));
  });

  test('4. F-06: probe-agent truncates rawBgpOutput if exceeding 128KB', () => {
    const probeAgent = fs.readFileSync('scripts/probe-agent.js', 'utf8');
    assert.ok(probeAgent.includes('MAX_RAW_BGP_BYTES = 131072'), 'probe-agent must define 128KB cap');
    assert.ok(probeAgent.includes('[TRUNCATED: Output exceeded 128KB limit]'), 'probe-agent must truncate with notice');
  });
});
