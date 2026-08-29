#!/usr/bin/env node
/**
 * AkiLab DN42 Lightweight Probe Agent (scripts/probe-agent.js)
 *
 * Runs 3 native commands (wg show all listen-port, wg show all, ss -tulnp)
 * and reports lightweight snapshot to master portal backend.
 */

import { execSync } from 'node:child_process';
import os from 'node:os';

const MASTER_URL = process.env.PORTAL_MASTER_URL || 'http://127.0.0.1:4242';
const PROBE_AUTH_TOKEN = process.env.PROBE_AUTH_TOKEN || 'probe-secret-token-please-change-in-env';
const NODE_ID = process.env.NODE_ID || 'JP-TYO-1';

function runCmd(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8', timeout: 5000 }).trim();
  } catch (err) {
    return '';
  }
}

async function collectAndReport() {
  console.log(`[Probe-Agent] Collecting snapshot for node ${NODE_ID}...`);

  // 1. Collect WireGuard Listen Ports: wg show all listen-port
  const ports = [];
  const wgPortOutput = runCmd('wg show all listen-port');
  if (wgPortOutput) {
    for (const line of wgPortOutput.split('\n')) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 2) {
        const iface = parts[0];
        const port = parseInt(parts[1], 10);
        if (!isNaN(port) && port > 0) {
          ports.push({ port, name: iface, source: 'wg' });
        }
      }
    }
  }

  // 2. Collect Peer Snapshots: wg show all
  const peers = [];
  const wgAllOutput = runCmd('wg show all');
  if (wgAllOutput) {
    let currentPeer = null;
    for (const line of wgAllOutput.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.startsWith('peer:')) {
        if (currentPeer && currentPeer.publicKey) {
          peers.push(currentPeer);
        }
        currentPeer = {
          publicKey: trimmed.split(/\s+/)[1],
          endpoint: '',
          latestHandshake: 0,
          rxBytes: 0,
          txBytes: 0
        };
      } else if (currentPeer) {
        if (trimmed.startsWith('endpoint:')) {
          currentPeer.endpoint = trimmed.replace('endpoint:', '').trim();
        } else if (trimmed.startsWith('latest handshake:')) {
          // Parse relative or unix timestamp if dump is used
          currentPeer.latestHandshake = Math.floor(Date.now() / 1000);
        } else if (trimmed.startsWith('transfer:')) {
          const match = trimmed.match(/([0-9.]+ \w+) received, ([0-9.]+ \w+) sent/);
          if (match) {
            currentPeer.transferStr = trimmed;
          }
        }
      }
    }
    if (currentPeer && currentPeer.publicKey) {
      peers.push(currentPeer);
    }
  }

  // 3. Collect Non-WG System Ports: ss -tulnp
  const systemPorts = [];
  const ssOutput = runCmd('ss -tulnp');
  if (ssOutput) {
    for (const line of ssOutput.split('\n')) {
      const match = line.match(/:(\d{4,5})\s/);
      if (match) {
        const portNum = parseInt(match[1], 10);
        if (portNum >= 10000 && portNum <= 65535) {
          // Avoid duplicate with WG ports
          if (!ports.some(p => p.port === portNum)) {
            let procName = 'service';
            const procMatch = line.match(/users:\(\("([^"]+)"/);
            if (procMatch) procName = procMatch[1];
            systemPorts.push({ port: portNum, name: procName, source: 'system_service' });
          }
        }
      }
    }
  }

  const payload = {
    nodeId: NODE_ID,
    ports,
    systemPorts,
    peers
  };

  const targetUrl = `${MASTER_URL.replace(/\/+$/, '')}/api/probe/report`;
  console.log(`[Probe-Agent] Reporting to ${targetUrl}...`);

  try {
    const res = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${PROBE_AUTH_TOKEN}`
      },
      body: JSON.stringify(payload)
    });

    const body = await res.json();
    if (res.ok && body.success) {
      console.log(`[Probe-Agent] Report successful. Ports: ${ports.length + systemPorts.length}, Peers: ${peers.length}`);
    } else {
      console.error(`[Probe-Agent] Report failed:`, body);
    }
  } catch (err) {
    console.error(`[Probe-Agent] Network error reporting to master:`, err.message);
  }
}

collectAndReport();
