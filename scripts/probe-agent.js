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

  const ifacePortMap = {};

  for (const line of dumpOutput.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split(/\t+|\s+/);
    if (parts.length === 5) {
      const iface = parts[0];
      const port = parseInt(parts[3], 10);
      if (!isNaN(port) && port > 0) {
        ports.push({ port, name: iface, source: 'wg' });
        ifacePortMap[iface] = port;
      }
    } else if (parts.length >= 8) {
      const iface = parts[0];
      const pubkey = parts[1];
      const endpoint = parts[3] === '(none)' ? '' : parts[3];
      const allowedIps = (parts[4] && parts[4] !== '(none)') ? parts[4] : '';
      const latestHandshake = parseInt(parts[5], 10) || 0;
      const rxBytes = parseInt(parts[6], 10) || 0;
      const txBytes = parseInt(parts[7], 10) || 0;
      if (pubkey) {
        peers.push({
          interface: iface,
          publicKey: pubkey,
          endpoint,
          allowedIps,
          latestHandshake,
          rxBytes,
          txBytes,
          listenPort: ifacePortMap[iface] || null
        });
      }
    }
  }

  // Backfill listenPort for peers encountered before interface line
  for (const peer of peers) {
    if ((!peer.listenPort || peer.listenPort === 0) && ifacePortMap[peer.interface]) {
      peer.listenPort = ifacePortMap[peer.interface];
    }
  }

  return { ports, peers };
}

/**
 * Parse WireGuard .conf files in wgDir to extract AllowedIPs, Endpoint, and ListenPort for each peer.
 * Fail-safe: returns empty object on any read/parse error.
 */
export function parseWireguardConfigs(wgDir = '/etc/wireguard') {
  const configPeers = {};
  if (!fs.existsSync(wgDir)) return configPeers;

  try {
    const files = fs.readdirSync(wgDir);
    for (const file of files) {
      if (!file.endsWith('.conf')) continue;
      const fullPath = path.join(wgDir, file);
      try {
        const content = fs.readFileSync(fullPath, 'utf8');
        let currentPeer = null;
        let currentIfaceListenPort = null;
        let currentIfaceMtu = null;
        let inInterface = false;

        for (const line of content.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) continue;
          if (/^\[interface\]/i.test(trimmed)) {
            inInterface = true;
            currentPeer = null;
            continue;
          }
          if (/^\[peer\]/i.test(trimmed)) {
            inInterface = false;
            currentPeer = {
              listenPort: currentIfaceListenPort,
              mtu: currentIfaceMtu,
              interface: path.basename(file, '.conf')
            };
            continue;
          }
          if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
            inInterface = false;
            currentPeer = null;
            continue;
          }

          const eqIdx = trimmed.indexOf('=');
          if (eqIdx !== -1) {
            const key = trimmed.slice(0, eqIdx).trim().toLowerCase();
            const val = trimmed.slice(eqIdx + 1).trim();
            if (inInterface) {
              if (key === 'listenport') {
                const lp = parseInt(val, 10);
                if (!isNaN(lp) && lp > 0) currentIfaceListenPort = lp;
              } else if (key === 'mtu') {
                const m = parseInt(val, 10);
                if (!isNaN(m) && m > 0) currentIfaceMtu = m;
              }
            } else if (currentPeer) {
              if (key === 'publickey') {
                currentPeer.publicKey = val;
                configPeers[val] = currentPeer;
              } else if (key === 'allowedips') {
                currentPeer.allowedIps = val;
              } else if (key === 'endpoint') {
                currentPeer.endpoint = val;
              }
            }
          }
        }

        // Backfill MTU and interface for all peers in this file if currentIfaceMtu was found
        if (currentIfaceMtu) {
          const ifaceName = path.basename(file, '.conf');
          for (const k of Object.keys(configPeers)) {
            if (configPeers[k].interface === ifaceName && !configPeers[k].mtu) {
              configPeers[k].mtu = currentIfaceMtu;
            }
          }
        }
      } catch {}
    }
  } catch {}

  return configPeers;
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

export function parseBgpProtocols(bgpOutput) {
  const sessions = [];
  if (!bgpOutput || typeof bgpOutput !== 'string') return sessions;

  let currentSession = null;
  const KNOWN_STATES = ['Established', 'Connect', 'Active', 'Idle', 'Start'];

  for (const line of bgpOutput.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // Strip BIRD machine-readable numeric code prefix like "1002-" or "2002-" or "1006-" or "0000 "
    const cleaned = trimmed.replace(/^[0-9]{4}[- ]/, '').trim();
    const parts = cleaned.split(/\s+/);

    // Check if this line is a protocol header line: <name> <proto> <table/state> ...
    if (parts.length >= 4 && parts[1].toUpperCase() === 'BGP') {
      const name = parts[0];
      const proto = 'BGP';
      const table = parts[2];
      const state = parts[3];
      const since = parts[4] || '';
      const info = parts.slice(5).join(' ');

      let bgpState = '';
      for (let i = 4; i < parts.length; i++) {
        const candidate = parts[i].replace(/[^A-Za-z0-9_-]/g, '');
        if (KNOWN_STATES.includes(candidate)) {
          bgpState = candidate;
          break;
        }
      }
      if (!bgpState) {
        if (state.toLowerCase() === 'up') bgpState = 'Established';
        else if (state.toLowerCase() === 'start') bgpState = 'Connect';
        else bgpState = 'Idle';
      }

      // Extract ASN from protocol name (as default / fallback)
      let asn = null;
      let cleanAsn = null;
      const mFull = name.match(/424242\d{4}/) || name.match(/(?:as|asn|peer|p|dn42|_|^)(\d{5,10})(?:_|$|[a-z])/i);
      const mTail = name.match(/(?:as|asn|peer|p|dn42|_|^)(\d{4})(?:_|$|[a-z])/i) || name.match(/(\d{4,10})/);

      const m = mFull || mTail;
      if (m) {
        asn = parseInt(m[1] || m[0], 10);
        cleanAsn = (asn < 10000 && asn > 0) ? (4242420000 + asn) : asn;
      }

      currentSession = {
        name,
        proto: 'BGP',
        table,
        state,
        since,
        bgpState,
        info: info || bgpState,
        asn,
        cleanAsn,
        neighborAddress: null,
        neighborAsn: null
      };
      sessions.push(currentSession);
      continue;
    }

    // If we are currently inside a BGP session block, parse detailed attributes (from show protocols all)
    if (currentSession) {
      // Check if this line is another protocol header (non-BGP, like Device/Direct)
      if (parts.length >= 4 && parts[1].toUpperCase() !== 'BGP' && ['DEVICE', 'DIRECT', 'STATIC', 'OSPF', 'BABEL', 'KERNEL'].includes(parts[1].toUpperCase())) {
        currentSession = null;
        continue;
      }

      // Neighbor address / Peer IP: e.g. "Neighbor address: 172.20.150.100" or "Peer IP: fe80::3143%dn42_3143"
      const addrMatch = cleaned.match(/(?:neighbor\s+address|peer\s+(?:ip|address)):\s*([^\s%]+)/i);
      if (addrMatch) {
        currentSession.neighborAddress = addrMatch[1].trim().toLowerCase();
      }

      // Neighbor AS / Peer AS: e.g. "Neighbor AS: 4242423143" or "Peer AS: 4242423143"
      const asnMatch = cleaned.match(/(?:neighbor\s+as|peer\s+as):\s*(\d+)/i);
      if (asnMatch) {
        const parsedAsn = parseInt(asnMatch[1], 10);
        currentSession.neighborAsn = parsedAsn;
        currentSession.asn = parsedAsn;
        currentSession.cleanAsn = (parsedAsn < 10000 && parsedAsn > 0) ? (4242420000 + parsedAsn) : parsedAsn;
      }

      // BGP state detail line: e.g. "BGP state: Established"
      const stateMatch = cleaned.match(/bgp\s+state:\s*([A-Za-z]+)/i);
      if (stateMatch) {
        const parsedState = stateMatch[1].trim();
        if (KNOWN_STATES.includes(parsedState)) {
          currentSession.bgpState = parsedState;
        }
      }
    }
  }

  return sessions;
}

function runCmd(cmd, options = {}) {
  try {
    return execSync(cmd, { encoding: 'utf8', timeout: 5000, stdio: ['pipe', 'pipe', 'ignore'], ...options }).trim();
  } catch (err) {
    return '';
  }
}

/**
 * Universal HTTP request helper: uses global fetch if available,
 * with safe AbortSignal timeout, and falls back to system curl on older Node.js runtimes.
 */
async function httpFetch(url, { method = 'GET', headers = {}, body = null, timeout = 5000 } = {}) {
  if (typeof fetch === 'function') {
    const timeoutSignal = (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function')
      ? AbortSignal.timeout(timeout)
      : undefined;

    const res = await fetch(url, {
      method,
      headers,
      body: body ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
      signal: timeoutSignal
    });

    const contentType = res.headers.get('content-type') || '';
    let data;
    if (contentType.includes('application/json')) {
      data = await res.json();
    } else {
      const text = await res.text();
      try { data = JSON.parse(text); } catch { data = text; }
    }
    return { ok: res.ok, status: res.status, data };
  }

  // Fallback for Node < 18 without global fetch: use curl
  const headerArgs = Object.entries(headers).map(([k, v]) => `-H ${JSON.stringify(`${k}: ${v}`)}`).join(' ');
  const maxSec = Math.ceil(timeout / 1000);
  let curlCmd = `curl -s -S --max-time ${maxSec} -X ${method} ${headerArgs} "${url}"`;
  let input = undefined;
  if (body) {
    curlCmd += ' -d @-';
    input = typeof body === 'string' ? body : JSON.stringify(body);
  }
  const raw = runCmd(curlCmd, { input, timeout: timeout + 1000 });
  if (!raw) {
    return { ok: false, status: 500, data: null, error: 'curl returned empty response' };
  }
  let data;
  try { data = JSON.parse(raw); } catch { data = raw; }
  return { ok: true, status: 200, data };
}

/**
 * Query BGP session details via local bird-lgproxy (127.0.0.1:5000)
 * Uses show protocols all to capture neighbor IPs and states.
 * Fails safely with empty output if lgproxy is unreachable.
 */
export async function queryLocalLgProxy(lgProxyUrl = 'http://127.0.0.1:5000') {
  try {
    const url = new URL('/bird', lgProxyUrl);
    url.searchParams.set('q', 'show protocols all');

    const res = await httpFetch(url.toString(), {
      headers: { 'Accept': 'application/json, text/plain;q=0.9, */*;q=0.8' },
      timeout: 3000
    });

    if (res && res.ok && res.data) {
      if (typeof res.data === 'object') {
        return res.data.output || res.data.result || '';
      }
      return String(res.data);
    }
  } catch {}
  return '';
}

/**
 * Scan WireGuard directory for private key files and derive public keys using wg pubkey.
 * The private keys NEVER leave the local process memory.
 */
export function deriveCandidatePublicKeys(wgDir = '/etc/wireguard') {
  const candidateKeys = [];

  // 1. Derive from active kernel WireGuard interfaces if available
  try {
    const activeDump = runCmd('wg show all private-key');
    if (activeDump) {
      for (const line of activeDump.split('\n')) {
        const parts = line.trim().split(/\s+/);
        const privKey = parts.length >= 2 ? parts[1] : parts[0];
        if (privKey && privKey.length >= 40) {
          const pubKey = runCmd('wg pubkey', { input: privKey });
          if (pubKey && pubKey.length >= 40) {
            candidateKeys.push(pubKey);
          }
        }
      }
    }
  } catch {}

  if (!fs.existsSync(wgDir)) return [...new Set(candidateKeys)];

  // 2. Scan wgDir for private key files and .conf files with PrivateKey = ...
  try {
    const files = fs.readdirSync(wgDir);
    for (const file of files) {
      const fullPath = path.join(wgDir, file);
      try {
        const stat = fs.statSync(fullPath);
        if (!stat.isFile()) continue;

        // 2a. Match files with private / key / priv in name
        if (/private|key|priv/i.test(file)) {
          const privKeyContent = fs.readFileSync(fullPath, 'utf8').trim();
          if (privKeyContent) {
            // Check first line or valid base64 key
            const firstLine = privKeyContent.split('\n')[0].trim();
            const pubKey = runCmd('wg pubkey', { input: firstLine });
            if (pubKey && pubKey.length >= 40) {
              candidateKeys.push(pubKey);
            }
          }
        }

        // 2b. Match PrivateKey = <base64> in .conf files
        if (file.endsWith('.conf')) {
          const confContent = fs.readFileSync(fullPath, 'utf8');
          const m = confContent.match(/^\s*PrivateKey\s*=\s*([A-Za-z0-9+/]{43}=)/im);
          if (m && m[1]) {
            const pubKey = runCmd('wg pubkey', { input: m[1].trim() });
            if (pubKey && pubKey.length >= 40) {
              candidateKeys.push(pubKey);
            }
          }
        }
      } catch {}
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
    const res = await httpFetch(registerUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${targetClaimToken}`
      },
      body: {
        nodeId: targetClaimNodeId,
        token: targetClaimToken,
        publicKeys: candidatePublicKeys
      },
      timeout: 10000
    });

    const body = res?.data || {};
    if (res?.ok && body.success && body.data?.nodeId) {
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

  // 1b. Parse /etc/wireguard/*.conf to supplement AllowedIPs & Endpoint
  const targetWgDir = wgDir || process.env.WG_DIR || '/etc/wireguard';
  const configPeers = options.mockConfigPeers !== undefined ? options.mockConfigPeers : parseWireguardConfigs(targetWgDir);
  for (const peer of peers) {
    const conf = configPeers[peer.publicKey];
    if (conf) {
      if (!peer.allowedIps && conf.allowedIps) {
        peer.allowedIps = conf.allowedIps;
      }
      // Prefer endpoint from conf file (preserves domain names over kernel-resolved IPs)
      if (conf.endpoint) {
        peer.endpoint = conf.endpoint;
      } else {
        // If peer is defined in .conf without an endpoint, it's roaming/responder; don't leak dynamic client IP
        peer.endpoint = '';
      }
      if ((!peer.listenPort || peer.listenPort === 0) && conf.listenPort) {
        peer.listenPort = conf.listenPort;
      }
      if (conf.mtu) {
        peer.mtu = conf.mtu;
      }
    }

    // Inspect live Linux interface MTU if available (/sys/class/net/<iface>/mtu)
    if (peer.interface) {
      try {
        const mtuPath = `/sys/class/net/${peer.interface}/mtu`;
        if (fs.existsSync(mtuPath)) {
          const sysMtu = parseInt(fs.readFileSync(mtuPath, 'utf8').trim(), 10);
          if (!isNaN(sysMtu) && sysMtu > 0) {
            peer.mtu = sysMtu;
          }
        }
      } catch {}
    }
  }

  // 2. Collect Non-WG System Ports: ss -tulnp
  const ssOutput = options.mockSsOutput !== undefined ? options.mockSsOutput : runCmd('ss -tulnp');
  const systemPorts = parseSsOutput(ssOutput, ports);

  // 3. Collect BGP Session States via local lgproxy (127.0.0.1:5000)
  let bgpOutput = options.mockBgpOutput !== undefined ? options.mockBgpOutput : process.env.MOCK_BGP_OUTPUT;
  if (bgpOutput === undefined) {
    const lgUrl = options.lgProxyUrl || process.env.LG_PROXY_URL || 'http://127.0.0.1:5000';
    bgpOutput = await queryLocalLgProxy(lgUrl);
  }
  const bgpSessions = parseBgpProtocols(bgpOutput);

  const payload = {
    nodeId,
    ports,
    systemPorts,
    peers,
    bgpSessions,
    rawBgpOutput: typeof bgpOutput === 'string' ? bgpOutput : ''
  };

  const targetUrl = `${masterUrl.replace(/\/+$/, '')}/api/probe/report`;
  console.log(`[Probe-Agent] Reporting to ${targetUrl}...`);

  try {
    const res = await httpFetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: payload,
      timeout: 10000
    });

    const body = res?.data || {};
    if (res?.ok && body.success) {
      console.log(`[Probe-Agent] Report successful. Ports: ${ports.length + systemPorts.length}, Peers: ${peers.length}, BGP: ${bgpSessions.length}`);
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
