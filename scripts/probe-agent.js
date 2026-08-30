#!/usr/bin/env node
/**
 * AkiLab DN42 Lightweight Probe Agent (scripts/probe-agent.js)
 *
 * Runs native commands (wg show all dump, ss -tulnp)
 * and reports lightweight snapshot to master portal backend.
 */

import { execSync } from 'node:child_process';
import { parseWgDump, parseSsOutput } from '../server/services/scannerService.js';

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

  // 1. Collect WireGuard Listen Ports and Peers with real epoch timestamps: wg show all dump
  const wgDumpOutput = runCmd('wg show all dump');
  const { ports, peers } = parseWgDump(wgDumpOutput);

  // 2. Collect Non-WG System Ports: ss -tulnp
  const ssOutput = runCmd('ss -tulnp');
  const systemPorts = parseSsOutput(ssOutput, ports);

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
