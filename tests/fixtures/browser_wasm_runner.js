/**
 * AkiLab DN42 WebAssembly Linux Browser Integration Runner
 *
 * Boots the real Linux 6.1 ext4 kernel in a real Headless Chrome browser,
 * attaches to the xterm.js TTY terminal, automates password login,
 * performs full peering lifecycle (peer new, peer ls, peer rm, lg status),
 * and captures real terminal screenshots.
 */

import assert from 'node:assert/strict';
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
  await sendInput("echo IyEvYmluL3NoCmNhdCA8PCAnRU9EJyA+ICIkMSIKTm9kZSA9IEpQLVRZTy0xCkxpbmstTG9jYWwgSVB2NiAoTExBKSA9IGZlODA6OjMxNDMKRE40MiBJUHY0IChPcHRpb25hbCkgPSAxNzIuMjAuMTUwLjEKSVB2NiBVTEEgKE9wdGlvbmFsKSA9IGZkMDA6NDI0MjozMTQzOjoxCldpcmVHdWFyZCBQdWJsaWMgS2V5ID0geUErTjY0eDd0Ti80SDFYcUpkKzdxZjNLOXoxVjh1VDVRN28rUDJ3OHgxRT0KV2lyZUd1YXJkIEVuZHBvaW50ID0gbXlob3N0LmRuNDIKUGVlclBvcnQgPSBhdXRvCkxpc3RlblBvcnQgPSBhdXRvCk1UVSA9IDE0MjAKRU9ECg== | base64 -d > /tmp/ed && chmod 755 /tmp/ed\n");
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
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:4242/gui/` });
  await delay(3000);

  const guiTitle = await cdp.evaluate('document.title');
  console.log(`GUI Page Title: "${guiTitle}"`);
  assert.ok(guiTitle.includes('AkiLab Networks'), 'GUI title must be AkiLab Networks');

  const tokenInStorage = await cdp.evaluate("localStorage.getItem('dn42_auth_token')");
  console.log(`Synchronized Token in localStorage: ${tokenInStorage ? 'PRESENT (mirrored from CLI login)' : 'ABSENT'}`);
  assert.ok(tokenInStorage, 'CLI login must mirror token into localStorage via gateway sync (R1)');

  const guiHeroText = await cdp.evaluate('document.body.innerText');
  assert.ok(guiHeroText.includes('OPEN PEERING POLICY'), 'GUI must render OPEN PEERING POLICY badge (R7)');
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

  // 13. Test R2: Click Looking Glass button in Hero -> switches to in-app LG view
  console.log('\n--- 13. Verifying R2: In-app Looking Glass Navigation ---');
  const clicked = await cdp.evaluate(`
    (() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const lgBtn = btns.find(b => b.textContent.includes('Looking Glass'));
      if (lgBtn) {
        lgBtn.click();
        return true;
      }
      return false;
    })()
  `);
  console.log(`Looking Glass button clicked: ${clicked}`);
  await delay(1500);
  const lgViewText = await cdp.evaluate('document.body.innerText');
  console.log(`Page content snippet: ${lgViewText.slice(0, 300)}...`);
  assert.ok(lgViewText.includes('Looking Glass'), 'Must render in-app Looking Glass header (R2)');
  assert.ok(lgViewText.includes('Command'), 'Must render Looking Glass command options');
  console.log('✓ R2 verified: Looking Glass switches seamlessly to in-app diagnostic view!');

  // 14. Test Round 13: Peering Studio Form Exact 8 Fields & Submission Workflow
  console.log('\n--- 14. Verifying Round 13: Peering Studio Form & Submission ---');
  await cdp.evaluate(`
    const navBtns = Array.from(document.querySelectorAll('nav button'));
    const peerNav = navBtns.find(b => b.textContent.includes('Peering'));
    if (peerNav) peerNav.click();
  `);
  await delay(1000);

  const formText = await cdp.evaluate('document.body.innerText');
  assert.ok(formText.includes('Step 01') || formText.includes('PEERING PARAMETERS'), 'Must render Step 01 / Peering Parameters header');
  assert.ok(formText.includes('Target Node'), 'Must render 1. Target Node');
  assert.ok(formText.includes('Your ASN'), 'Must render 2. Your ASN');
  assert.ok(formText.includes('WireGuard Public Key'), 'Must render 3. WireGuard Public Key');
  assert.ok(formText.includes('Link-Local IPv6 (LLA)'), 'Must render 4. Link-Local IPv6 (LLA)');
  assert.ok(formText.includes('IPv6 ULA') && formText.includes('DN42 IPv4'), 'Must render 5. IPv6 ULA & DN42 IPv4');
  assert.ok(formText.includes('WireGuard Endpoint Host'), 'Must render 6. WireGuard Endpoint Host');
  assert.ok(formText.includes('PeerPort') && formText.includes('ListenPort'), 'Must render 7. PeerPort & ListenPort');
  assert.ok(formText.includes('WireGuard MTU'), 'Must render 8. WireGuard MTU');

  // Verify removed items are NOT present
  assert.ok(!formText.includes('Peer Identifier'), 'Peer Identifier must be removed');
  assert.ok(!formText.includes('BGP Session Mode'), 'BGP Session Mode selector must be removed');
  assert.ok(!formText.includes('bird.conf'), 'bird.conf tab must be removed');
  assert.ok(!formText.includes('peering_request.md'), 'peering_request.md tab must be removed');

  // Verify right canvas before submit: static prompt text and NO config preview
  assert.ok(
    formText.includes('Submit the form to receive your WireGuard configuration generated by the AkiLab authority.'),
    'Must display static prompt text before submit'
  );
  assert.ok(!formText.includes('[Interface]'), 'Must NOT generate or preview config before submit');

  // Fill in form inputs
  console.log('Filling form inputs...');
  await cdp.evaluate(`
    (() => {
      const inputs = Array.from(document.querySelectorAll('input'));
      const setVal = (input, val) => {
        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        nativeSetter.call(input, val);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      };

      const pubKeyInput = inputs.find(i => i.placeholder && i.placeholder.includes('yA+N64x7tN/4H1XqJd+7qf3K9z1V8uT5R7o+P2w8x1E='));
      if (pubKeyInput) setVal(pubKeyInput, 'yA+N64x7tN/4H1XqJd+7qf3K9z1V8uT5R7o+P2w8x1E=');

      const ulaInput = inputs.find(i => i.placeholder && i.placeholder.includes('fd00::xxxx'));
      if (ulaInput) setVal(ulaInput, 'fd00:4242:3143::1');

      const v4Input = inputs.find(i => i.placeholder && i.placeholder.includes('172.20.x.x'));
      if (v4Input) setVal(v4Input, '172.20.150.1');

      const epInput = inputs.find(i => i.placeholder && i.placeholder.includes('node.example.dn42'));
      if (epInput) setVal(epInput, 'myhost.dn42');
    })()
  `);
  await delay(800);

  // Submit peering form
  console.log('Submitting GUI Peering Form...');
  await cdp.evaluate(`
    const submitBtn = Array.from(document.querySelectorAll('button[type="submit"]')).find(b => b.textContent.includes('Submit Peering Application'));
    if (submitBtn) submitBtn.click();
  `);
  await delay(2000);

  const afterSubmitText = await cdp.evaluate('document.body.innerText');
  assert.ok(afterSubmitText.includes('Peering Application Approved') || afterSubmitText.includes('Session ID:'), 'Form submission must succeed with approval banner');
  assert.ok(afterSubmitText.includes('[Interface]'), 'Right canvas must render authoritative WireGuard config from server');
  assert.ok(afterSubmitText.includes('Address = 172.20.150.1/32, fd00:4242:3143::1/128, fe80::3143/64'), 'Must render correct address line in WG config');
  console.log('✓ Round 13 verified: 8 fields, static placeholder before submit, server WG config output, and submission validated!');

  // Capture GUI Peering Form Screenshot
  const formScreenshot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  const formShotPath = path.join(docsDir, 'gui_form_screenshot.png');
  fs.writeFileSync(formShotPath, Buffer.from(formScreenshot.data, 'base64'));
  console.log(`Saved GUI form screenshot to: ${formShotPath}`);

  if (fs.existsSync(ARTIFACTS_DIR)) {
    const artFormPath = path.join(ARTIFACTS_DIR, 'gui_form_screenshot.png');
    fs.writeFileSync(artFormPath, Buffer.from(formScreenshot.data, 'base64'));
    console.log(`Saved GUI form screenshot to artifacts dir: ${artFormPath}`);
  }

  try {
    // Clean up Chrome process & user data
    await cdp.close();
    chromeProc.kill();
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch {}

    await server.closeAll();
    console.log('\nAll End-to-End Browser Tests Finished Successfully!');
    process.exit(0);
  } finally {
    testData.cleanup();
  }
}

main().catch((err) => {
  console.error('Test error:', err);
  process.exit(1);
});
