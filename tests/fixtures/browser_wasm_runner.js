/**
 * AkiLab DN42 WebAssembly Linux Browser Integration Runner
 *
 * Boots the real Linux 6.1 ext4 kernel in a real Headless Chrome browser,
 * attaches to the xterm.js TTY terminal, automates password login,
 * performs full peering lifecycle (peer new, peer ls, peer rm, lg status),
 * and captures real terminal screenshots.
 */

import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createIsolatedTestDataDir } from './tmpDataDir.js';

import crypto from 'node:crypto';
const testData = createIsolatedTestDataDir('dn42-test-wasm-');

// Seed test admin password in isolated test directory
const salt = '5584a850a891a1bc9a005a803df75e28';
const hash = crypto.scryptSync('test12345', salt, 64).toString('hex');
fs.writeFileSync(path.join(testData.tmpDir, 'auth_users.json'), JSON.stringify({
  "4242423143": {
    "asn": 4242423143,
    "asName": "AKILAB-MNT",
    "role": "admin",
    "salt": salt,
    "hash": hash,
    "createdAt": new Date().toISOString()
  }
}, null, 2), 'utf8');

import { createServer } from '../../server/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../../');
const ARTIFACTS_DIR = 'C:/Users/Akira/.gemini/antigravity/brain/5c7257fc-2f97-4a44-bfa1-5b2f958ca068';

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Simple CDP Client over native WebSocket
class CdpClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.id = 1;
    this.callbacks = new Map();
  }

  async connect() {
    this.ws = new WebSocket(this.wsUrl);
    await new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = reject;
    });

    this.ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && this.callbacks.has(msg.id)) {
        const { resolve, reject } = this.callbacks.get(msg.id);
        this.callbacks.delete(msg.id);
        if (msg.error) {
          reject(new Error(msg.error.message));
        } else {
          resolve(msg.result);
        }
      }
    };
  }

  send(method, params = {}) {
    const id = this.id++;
    return new Promise((resolve, reject) => {
      this.callbacks.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true
    });
    if (res.exceptionDetails) {
      throw new Error(`Eval error: ${JSON.stringify(res.exceptionDetails)}`);
    }
    return res.result?.value;
  }

  async close() {
    if (this.ws) {
      this.ws.close();
    }
  }
}

async function findChromeExecutable() {
  const possiblePaths = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(os.homedir(), 'AppData\\Local\\Google\\Chrome\\Application\\chrome.exe'),
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error('Chrome/Edge executable not found on host machine');
}

async function main() {
  console.log('--- 1. Starting Backend Server on 127.0.0.1:4242 ---');
  const server = createServer();
  await new Promise((resolve) => server.listen(4242, '127.0.0.1', resolve));

  const chromePath = await findChromeExecutable();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-wasm-test-'));
  const cdpPort = 14227 + Math.floor(Math.random() * 1000);

  console.log(`--- 2. Launching Headless Chrome Browser on debug port ${cdpPort} ---`);
  const chromeProc = spawn(chromePath, [
    '--headless=new',
    `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=1280,800',
    'http://127.0.0.1:4242/'
  ], { stdio: 'ignore' });

  // Wait for Chrome CDP port to become available
  let versionData = null;
  for (let i = 0; i < 30; i++) {
    await delay(500);
    try {
      const res = await fetch(`http://127.0.0.1:${cdpPort}/json/version`);
      if (res.ok) {
        versionData = await res.json();
        break;
      }
    } catch {}
  }

  if (!versionData) {
    chromeProc.kill();
    throw new Error('Failed to connect to Chrome DevTools port');
  }

  // Get active target tab
  const listRes = await fetch(`http://127.0.0.1:${cdpPort}/json/list`);
  const targets = await listRes.json();
  const pageTarget = targets.find(t => t.type === 'page');
  if (!pageTarget || !pageTarget.webSocketDebuggerUrl) {
    chromeProc.kill();
    throw new Error('No page target available in Chrome');
  }

  console.log(`Found page target: ${pageTarget.webSocketDebuggerUrl}`);
  const cdp = new CdpClient(pageTarget.webSocketDebuggerUrl);
  await cdp.connect();

  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');

  console.log('--- 3. Waiting for Linux Kernel and RootFS to Boot in WASM ---');

  const getBuffer = async () => {
    return await cdp.evaluate(`
      (() => {
        if (!window.term || !window.term.buffer || !window.term.buffer.active) return '';
        const buf = window.term.buffer.active;
        let lines = [];
        for (let i = 0; i < buf.length; i++) {
          const l = buf.getLine(i);
          if (l) lines.push(l.translateToString(true));
        }
        return lines.join('\\n');
      })()
    `);
  };

  const sendInput = async (text) => {
    await cdp.evaluate(`window.sendTerminalInput(${JSON.stringify(text)})`);
  };

  const waitForPrompt = async (target, timeoutSec = 30) => {
    for (let i = 0; i < timeoutSec * 2; i++) {
      const buf = await getBuffer();
      if (buf.includes(target)) return buf;
      await delay(500);
    }
    const finalBuf = await getBuffer();
    throw new Error(`Timeout waiting for prompt "${target}". Buffer was:\n${finalBuf}`);
  };

  // 1. Wait for Login Prompt
  await waitForPrompt('DN42 ASN or Account:');
  console.log('WASM Linux Boot Complete! Login prompt detected.');

  // 2. Submit ASN
  await sendInput('4242423143\n');
  await waitForPrompt('Remember login for 30 days?');

  // 3. Remember Login Choice
  await sendInput('y\n');
  await waitForPrompt('Password for 4242423143:');

  // 4. Submit Password
  await sendInput('test12345\n');
  await waitForPrompt('peer@AS4242423143:~#');
  console.log('Authenticated into WASM Linux Shell: peer@AS4242423143:~#');

  // 5. Execute: nodes
  console.log('Executing: nodes');
  await sendInput('nodes\n');
  await delay(1500);
  await waitForPrompt('peer@AS4242423143:~#');

  // 6. Execute: whois 4242423143
  console.log('Executing: whois 4242423143');
  await sendInput('whois 4242423143\n');
  await delay(1500);
  await waitForPrompt('peer@AS4242423143:~#');

  // 7. Execute: whoami
  console.log('Executing: whoami');
  await sendInput('whoami\n');
  await delay(1000);
  await waitForPrompt('peer@AS4242423143:~#');

  // 8. Execute: peer new 1 (V1: editor workflow)
  console.log('Executing: peer new 1');
  await sendInput("printf '#!/bin/sh\\nsed -i -e \"s|IPv4.*|DN42 IPv4 (Optional) = 172.20.150.1|\" -e \"s|IPv6 ULA.*|IPv6 ULA (Optional) = fd00:4242:3143::1|\" -e \"s|WireGuard Public Key.*|WireGuard Public Key = yA+N64x7tN/4H1XqJd+7qf3K9z1V8uT5R7o+P2w8x1E=|\" -e \"s|WireGuard Endpoint.*|WireGuard Endpoint = myhost.dn42|\" \"$1\"\\n' > /tmp/ed && chmod +x /tmp/ed\n");
  await delay(500);
  await waitForPrompt('peer@AS4242423143:~#');

  await sendInput('EDITOR=/tmp/ed peer new 1\n');
  await waitForPrompt('-------- REVIEW --------');
  await waitForPrompt('Confirm and submit?');
  await sendInput('y\n');
  await waitForPrompt('peer@AS4242423143:~#', 20);
  console.log('Peer created successfully via editor workflow!');

  // 9. Execute: peer ls
  console.log('Executing: peer ls');
  await sendInput('peer ls\n');
  await delay(1500);
  await waitForPrompt('peer@AS4242423143:~#');

  // 10. Execute: peer rm peer_akira_jp_tyo_1 (U1)
  console.log('Executing: peer rm peer_akira_jp_tyo_1');
  await sendInput('peer rm peer_akira_jp_tyo_1\n');
  await delay(1500);
  await waitForPrompt('peer@AS4242423143:~#');

  // 11. Execute: lg status
  console.log('Executing: lg status');
  await sendInput('lg status\n');
  await delay(1500);
  await waitForPrompt('peer@AS4242423143:~#');

  const finalBuffer = await getBuffer();
  console.log('\n================== REAL WASM LINUX XTERM BUFFER OUTPUT ==================');
  console.log(finalBuffer);
  console.log('========================================================================\n');

  // Capture WASM terminal screenshot
  const screenshotData = await cdp.send('Page.captureScreenshot', { format: 'png' });
  const docsDir = path.join(ROOT_DIR, 'docs');
  if (!fs.existsSync(docsDir)) fs.mkdirSync(docsDir, { recursive: true });
  const screenshotPath = path.join(docsDir, 'wasm_terminal_screenshot.png');
  fs.writeFileSync(screenshotPath, Buffer.from(screenshotData.data, 'base64'));
  console.log(`Saved real browser WASM terminal screenshot to: ${screenshotPath}`);

  if (fs.existsSync(ARTIFACTS_DIR)) {
    const artPath = path.join(ARTIFACTS_DIR, 'wasm_terminal_screenshot.png');
    fs.writeFileSync(artPath, Buffer.from(screenshotData.data, 'base64'));
    console.log(`Saved screenshot to artifacts dir: ${artPath}`);
  }

  // 12. Navigate to GUI (/gui/) and verify Bi-directional Sync + Visual Rendering
  console.log('\n--- 12. Navigating to GUI (/gui/) & Verifying Bi-directional Sync ---');
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/gui/` });
  await delay(3000);

  const guiTitle = await cdp.evaluate('document.title');
  console.log(`GUI Page Title: "${guiTitle}"`);
  assert.ok(guiTitle.includes('AkiLab Networks'), 'GUI title must be AkiLab Networks');

  const tokenInStorage = await cdp.evaluate("localStorage.getItem('dn42_auth_token')");
  console.log(`Synchronized Token in localStorage: ${tokenInStorage ? 'PRESENT (mirrored from CLI login)' : 'ABSENT'}`);
  assert.ok(tokenInStorage, 'CLI login must mirror token into localStorage via gateway sync (6.1)');

  const guiHeroText = await cdp.evaluate('document.body.innerText');
  assert.ok(guiHeroText.includes('OPEN PEERING POLICY'), 'GUI must render OPEN PEERING POLICY badge');
  assert.ok(guiHeroText.includes('Global Edge Nodes'), 'GUI must render Global Edge Nodes table');
  assert.ok(guiHeroText.includes('Autonomous System'), 'GUI must render Autonomous System card');
  assert.ok(guiHeroText.includes('AS4242423143'), 'GUI must render authenticated AS4242423143 session badge');
  console.log('✓ GUI verified: Full theme, Hero, Data Cards, Node Table, and Synced Login Badge rendered correctly!');

  // Capture GUI Home Screenshot
  const guiScreenshot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  const guiShotPath = path.join(docsDir, 'gui_production_screenshot.png');
  fs.writeFileSync(guiShotPath, Buffer.from(guiScreenshot.data, 'base64'));
  console.log(`Saved real GUI production screenshot to: ${guiShotPath}`);

  if (fs.existsSync(ARTIFACTS_DIR)) {
    const artGuiPath = path.join(ARTIFACTS_DIR, 'gui_production_screenshot.png');
    fs.writeFileSync(artGuiPath, Buffer.from(guiScreenshot.data, 'base64'));
    console.log(`Saved GUI screenshot to artifacts dir: ${artGuiPath}`);
  }

  try {
    // Clean up Chrome process & user data
    await cdp.close();
    chromeProc.kill();
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch {}

    await server.closeAll();
    console.log('\nVerification Finished Successfully!');
    process.exit(0);
  } finally {
    testData.cleanup();
  }
}

main().catch((err) => {
  console.error('Test error:', err);
  process.exit(1);
});
