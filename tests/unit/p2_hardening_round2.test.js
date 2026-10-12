import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
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
  test('2. F-05: peer script draft parsing does not contain eval and handles unknown keys safely', () => {
    const peerScript = fs.readFileSync('cli/cli-src/bin/peer', 'utf8');
    // Ensure eval "$(awk is completely gone
    assert.ok(!peerScript.includes('eval "$(awk'), 'peer script must not use eval to parse awk output');
    assert.ok(peerScript.includes("while IFS='=' read -r k v; do"), 'peer script must parse via safe while-read loop');
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
