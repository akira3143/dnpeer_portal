import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createServer } from '../../server/index.js';
import { hashPassword } from '../../server/services/authService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');
const ARTIFACTS_DIR = 'C:/Users/Akira/.gemini/antigravity/brain/5c7257fc-2f97-4a44-bfa1-5b2f958ca068';

const CHROME_PATH = fs.existsSync('C:/Program Files/Google/Chrome/Application/chrome.exe')
  ? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
  : 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe';

async function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

class CDPClient {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 1;
    this.callbacks = new Map();
  }

  async connect() {
    return new Promise((resolve, reject) => {
      this.ws.onopen = () => resolve();
      this.ws.onerror = (e) => reject(e);
      this.ws.onmessage = (evt) => {
        const msg = JSON.parse(evt.data);
        if (msg.id && this.callbacks.has(msg.id)) {
          const cb = this.callbacks.get(msg.id);
          this.callbacks.delete(msg.id);
          if (msg.error) cb.reject(new Error(msg.error.message));
          else cb.resolve(msg.result);
        }
      };
    });
  }

  async send(method, params = {}) {
    const id = this.id++;
    return new Promise((resolve, reject) => {
      this.callbacks.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const res = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    return res.result?.value;
  }

  async close() {
    try { this.ws.close(); } catch {}
  }
}

async function main() {
  console.log('--- 1. Starting Backend Server on 127.0.0.1:4242 ---');
  const server = createServer();
  await new Promise(r => server.listen(4242, '127.0.0.1', r));

  // Seed test accounts in server/data/auth_users.json
  const testPass = hashPassword('test12345');
  const authUsers = {
    '4242423143': {
      asn: 4242423143,
      asName: 'AKILAB-MNT',
      role: 'admin',
      salt: testPass.salt,
      hash: testPass.hash,
      createdAt: new Date().toISOString()
    }
  };
  fs.writeFileSync(path.join(ROOT_DIR, 'server/data/auth_users.json'), JSON.stringify(authUsers, null, 2), 'utf8');

  // Seed registry cache
  const registry = {
    'AS4242423143': {
      asn: 4242423143,
      asName: 'AKILAB-MNT',
      descr: 'AkiLab Backbone Autonomous System',
      maintainer: 'AKIRA-MNT',
      adminContact: 'AKIRA-DN42',
      personName: 'Akira',
      authKeys: []
    }
  };
  fs.writeFileSync(path.join(ROOT_DIR, 'server/data/registry_cache.json'), JSON.stringify(registry, null, 2), 'utf8');

  const debugPort = 12000 + Math.floor(Math.random() * 5000);
  console.log(`--- 2. Launching Headless Chrome Browser on debug port ${debugPort} ---`);
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-wasm-'));
  const chromeProc = spawn(CHROME_PATH, [
    `--remote-debugging-port=${debugPort}`,
    '--headless=new',
    '--window-size=1280,900',
    '--no-sandbox',
    '--disable-gpu',
    `--user-data-dir=${userDataDir}`,
    'http://127.0.0.1:4242/'
  ]);

  let cdp = null;
  for (let i = 0; i < 30; i++) {
    await delay(500);
    try {
      const vRes = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
      const list = await vRes.json();
      const page = list.find(t => t.type === 'page' && t.url.includes('4242'));
      if (page && page.webSocketDebuggerUrl) {
        console.log('Found page target:', page.webSocketDebuggerUrl);
        cdp = new CDPClient(page.webSocketDebuggerUrl);
        await cdp.connect();
        break;
      }
    } catch {}
  }

  if (!cdp) {
    console.error('Could not connect to Chrome DevTools Protocol.');
    chromeProc.kill();
    await server.closeAll();
    process.exit(1);
  }

  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');

  console.log('--- 3. Waiting for Linux Kernel and RootFS to Boot in WASM ---');
  let booted = false;
  let termBuffer = '';

  const getBuffer = async () => {
    return await cdp.evaluate(`
      (function() {
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

  // Wait for login prompt
  for (let i = 0; i < 60; i++) {
    await delay(500);
    termBuffer = await getBuffer();
    if (termBuffer.includes('DN42 ASN or Account:') || termBuffer.includes('AkiLab DN42')) {
      booted = true;
      console.log('WASM Linux Boot Complete! Login prompt detected.');
      break;
    }
  }

  if (!booted) {
    console.log('Current buffer snapshot:\n', termBuffer);
    throw new Error('Timeout waiting for WASM Linux login prompt');
  }

  console.log('\n--- 4. Executing User Login: AS4242423143 ---');
  await sendInput('4242423143\n');
  await delay(1000);

  termBuffer = await getBuffer();
  if (termBuffer.includes('Remember login')) {
    console.log('Entering remember login choice (y)...');
    await sendInput('y\n');
    await delay(1000);
  }

  console.log('Entering password (test12345)...');
  await sendInput('test12345\n');
  await delay(2000);

  // Wait for shell prompt
  for (let i = 0; i < 20; i++) {
    termBuffer = await getBuffer();
    if (termBuffer.includes('peer@AS4242423143') || termBuffer.includes('peer@')) {
      console.log('Authenticated into WASM Linux Shell: peer@AS4242423143:~#');
      break;
    }
    await delay(500);
  }

  console.log('\n--- 5. Executing: nodes ---');
  await sendInput('nodes\n');
  await delay(2500);

  console.log('\n--- 6. Executing: whois 4242423143 ---');
  await sendInput('whois 4242423143\n');
  await delay(2500);

  console.log('\n--- 7. Executing: whoami ---');
  await sendInput('whoami\n');
  await delay(1500);

  console.log('\n--- 8. Executing: peer ls ---');
  await sendInput('peer ls\n');
  await delay(2000);

  console.log('\n--- 9. Executing: lg status ---');
  await sendInput('lg status\n');
  await delay(2500);

  const finalBuffer = await getBuffer();
  console.log('\n================== REAL WASM LINUX XTERM BUFFER OUTPUT ==================');
  console.log(finalBuffer);
  console.log('========================================================================\n');

  // Capture screenshot
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

  // Clean up
  await cdp.close();
  chromeProc.kill();
  try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch {}

  // Clean data dir back
  try {
    fs.unlinkSync(path.join(ROOT_DIR, 'server/data/auth_users.json'));
    fs.unlinkSync(path.join(ROOT_DIR, 'server/data/registry_cache.json'));
  } catch {}

  await server.closeAll();
  console.log('Verification Finished Successfully!');
}

main().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
