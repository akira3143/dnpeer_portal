#!/usr/bin/env node
/**
 * AkiLab DN42 Lightweight Probe Agent (scripts/probe-agent.js)
 *
 * Runs native commands (wg show all dump, ss -tulnp)
 * and reports lightweight snapshot to master portal backend.
 *
 * Supports automatic node identity claim via WireGuard private key derivation:
 * 1. process.env.NODE_ID
 * 2. /var/lib/dn42-probe/node_id
 * 3. Auto-claim: derives candidate public keys from /etc/wireguard/*private*
 *    and registers with master (POST /api/probe/register).
 *
 * Private keys NEVER leave the local machine.
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export function parseWgDump(dumpOutput) {
  const ports = [];
  const peers = [];
  if (!dumpOutput || typeof dumpOutput !== 'string') return { ports, peers };

  for (const line of dumpOutput.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split(/\t+|\s+/);
    if (parts.length === 5) {
      const iface = parts[0];
      const port = parseInt(parts[3], 10);
      if (!isNaN(port) && port > 0) {
        ports.push({ port, name: iface, source: 'wg' });
      }
    } else if (parts.length >= 8) {
      const iface = parts[0];
      const pubkey = parts[1];
      const endpoint = parts[3] === '(none)' ? '' : parts[3];
      const latestHandshake = parseInt(parts[5], 10) || 0;
      const rxBytes = parseInt(parts[6], 10) || 0;
      const txBytes = parseInt(parts[7], 10) || 0;
      if (pubkey) {
        peers.push({
          interface: iface,
          publicKey: pubkey,
          endpoint,
          latestHandshake,
          rxBytes,
          txBytes
        });
      }
    }
  }
  return { ports, peers };
}

export function parseSsOutput(ssOutput, existingPorts = []) {
  const systemPorts = [];
  if (!ssOutput || typeof ssOutput !== 'string') return systemPorts;

  for (const line of ssOutput.split('\n')) {
    const match = line.match(/:(\d{4,5})\s/);
    if (match) {
      const portNum = parseInt(match[1], 10);
      if (portNum >= 1024 && portNum <= 65535) {
        if (!existingPorts.some(p => p.port === portNum) && !systemPorts.some(p => p.port === portNum)) {
          let procName = 'service';
          const procMatch = line.match(/users:\(\("([^"]+)"/);
          if (procMatch) procName = procMatch[1];
          systemPorts.push({ port: portNum, name: procName, source: 'system_service' });
        }
      }
    }
  }
  return systemPorts;
}

function runCmd(cmd, options = {}) {
  try {
    return execSync(cmd, { encoding: 'utf8', timeout: 5000, ...options }).trim();
  } catch (err) {
    return '';
  }
}

/**
 * Scan WireGuard directory for private key files and derive public keys using wg pubkey.
 * The private keys NEVER leave the local process memory.
 */
export function deriveCandidatePublicKeys(wgDir = '/etc/wireguard') {
  const candidateKeys = [];
  if (!fs.existsSync(wgDir)) return candidateKeys;

  try {
    const files = fs.readdirSync(wgDir);
    for (const file of files) {
      // Fuzzy match any file containing 'private' in its name
      if (/private/i.test(file)) {
        const fullPath = path.join(wgDir, file);
        try {
          const stat = fs.statSync(fullPath);
          if (!stat.isFile()) continue;
          const privKeyContent = fs.readFileSync(fullPath, 'utf8').trim();
          if (privKeyContent) {
            const pubKey = runCmd('wg pubkey', { input: privKeyContent });
            if (pubKey && pubKey.length >= 40) {
              candidateKeys.push(pubKey);
            }
          }
        } catch {}
      }
    }
  } catch {}

  return [...new Set(candidateKeys)];
}

export async function resolveIdentity({ masterUrl, authToken, stateFile, tokenFile, wgDir, claimNodeId, claimToken } = {}) {
  const statePath = stateFile || process.env.NODE_ID_STATE_FILE || '/var/lib/dn42-probe/node_id';
  const tokenPath = tokenFile || process.env.TOKEN_STATE_FILE || '/var/lib/dn42-probe/token';

  // 1. Check local persistent state files
  let savedNodeId = null;
  let savedToken = null;
  try {
    if (fs.existsSync(statePath)) savedNodeId = fs.readFileSync(statePath, 'utf8').trim();
    if (fs.existsSync(tokenPath)) savedToken = fs.readFileSync(tokenPath, 'utf8').trim();
  } catch {}

  if (savedNodeId && savedToken) {
    return { nodeId: savedNodeId, token: savedToken };
  }

  // 1b. Check if explicit environment variables are provided (NODE_ID + NODE_TOKEN)
  if (process.env.NODE_ID && (process.env.NODE_TOKEN || authToken)) {
    return {
      nodeId: process.env.NODE_ID.trim(),
      token: (process.env.NODE_TOKEN || authToken).trim()
    };
  }

  // 2. Local state not fully established -> Auto-claim via WireGuard secret matching & dedicated token
  const targetClaimNodeId = (claimNodeId || process.env.CLAIM_NODE_ID || process.env.NODE_ID || '').trim();
  const targetClaimToken = (claimToken || process.env.CLAIM_TOKEN || process.env.NODE_TOKEN || authToken || '').trim();

  if (!targetClaimNodeId || !targetClaimToken) {
    console.error('[Probe-Agent] Registration failed: Missing claim node ID or dedicated token.');
    console.error('[Probe-Agent] Please ensure CLAIM_NODE_ID and CLAIM_TOKEN are configured in /etc/default/dn42-probe.');
    return null;
  }

  const targetWgDir = wgDir || process.env.WG_DIR || '/etc/wireguard';
  const candidatePublicKeys = deriveCandidatePublicKeys(targetWgDir);

  if (candidatePublicKeys.length === 0) {
    console.error(`[Probe-Agent] Registration failed: No WireGuard private key files (*private*) found in ${targetWgDir}.`);
    console.error('[Probe-Agent] Cannot auto-claim node identity without WireGuard key pair.');
    return null;
  }

  const registerUrl = `${(masterUrl || 'http://127.0.0.1:4242').replace(/\/+$/, '')}/api/probe/register`;
  console.log(`[Probe-Agent] Auto-claiming node identity "${targetClaimNodeId}" from ${registerUrl} with ${candidatePublicKeys.length} derived key(s)...`);

  try {
    const res = await fetch(registerUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${targetClaimToken}`
      },
      body: JSON.stringify({
        nodeId: targetClaimNodeId,
        token: targetClaimToken,
        publicKeys: candidatePublicKeys
      })
    });

    const body = await res.json();
    if (res.ok && body.success && body.data?.nodeId) {
      const claimedNodeId = body.data.nodeId;
      console.log(`[Probe-Agent] ✓ Successfully claimed node identity: ${claimedNodeId} (matched key: ${body.data.matchedPublicKey})`);

      // Write to persistent state files
      try {
        fs.mkdirSync(path.dirname(statePath), { recursive: true });
        fs.writeFileSync(statePath, claimedNodeId, 'utf8');
      } catch (writeErr) {
        console.warn(`[Probe-Agent] Notice: Could not persist claimed node ID to ${statePath}:`, writeErr.message);
      }

      try {
        fs.mkdirSync(path.dirname(tokenPath), { recursive: true });
        fs.writeFileSync(tokenPath, targetClaimToken, 'utf8');
      } catch (writeErr) {
        console.warn(`[Probe-Agent] Notice: Could not persist claimed token to ${tokenPath}:`, writeErr.message);
      }

      return { nodeId: claimedNodeId, token: targetClaimToken };
    } else {
      console.error('[Probe-Agent] Auto-claim failed:', body.error?.message || body);
      return null;
    }
  } catch (netErr) {
    console.error('[Probe-Agent] Network error during node registration:', netErr.message);
    return null;
  }
}

export async function resolveNodeId(options = {}) {
  const identity = await resolveIdentity(options);
  return identity ? identity.nodeId : null;
}

export async function collectAndReport(options = {}) {
  const masterUrl = options.masterUrl || process.env.PORTAL_MASTER_URL || 'http://127.0.0.1:4242';
  const stateFile = options.stateFile || process.env.NODE_ID_STATE_FILE;
  const tokenFile = options.tokenFile || process.env.TOKEN_STATE_FILE;
  const wgDir = options.wgDir || process.env.WG_DIR;
  const claimNodeId = options.claimNodeId;
  const claimToken = options.claimToken;
  const authToken = options.authToken;

  const identity = await resolveIdentity({
    masterUrl,
    authToken,
    stateFile,
    tokenFile,
    wgDir,
    claimNodeId,
    claimToken
  });

  if (!identity || !identity.nodeId || !identity.token) {
    console.error('[Probe-Agent] Exiting: Unable to establish node identity or auto-claim failed.');
    if (options.throwOnError) {
      throw new Error('Unable to establish node identity or auto-claim failed');
    }
    process.exit(1);
  }

  const { nodeId, token } = identity;
  console.log(`[Probe-Agent] Collecting snapshot for node ${nodeId}...`);

  // 1. Collect WireGuard Listen Ports and Peers: wg show all dump
  const wgDumpOutput = options.mockWgDump !== undefined ? options.mockWgDump : runCmd('wg show all dump');
  const { ports, peers } = parseWgDump(wgDumpOutput);

  // 2. Collect Non-WG System Ports: ss -tulnp
  const ssOutput = options.mockSsOutput !== undefined ? options.mockSsOutput : runCmd('ss -tulnp');
  const systemPorts = parseSsOutput(ssOutput, ports);

  const payload = {
    nodeId,
    ports,
    systemPorts,
    peers
  };

  const targetUrl = `${masterUrl.replace(/\/+$/, '')}/api/probe/report`;
  console.log(`[Probe-Agent] Reporting to ${targetUrl}...`);

  try {
    const res = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(payload)
    });

    const body = await res.json();
    if (res.ok && body.success) {
      console.log(`[Probe-Agent] Report successful. Ports: ${ports.length + systemPorts.length}, Peers: ${peers.length}`);
      return { success: true, data: body.data };
    } else {
      console.error(`[Probe-Agent] Report failed:`, body);
      return { success: false, error: body };
    }
  } catch (err) {
    console.error(`[Probe-Agent] Network error reporting to master:`, err.message);
    return { success: false, error: err.message };
  }
}

// Execute CLI run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  collectAndReport();
}
