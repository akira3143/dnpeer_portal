import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const CLI_DIR = __dirname;

console.log('[build_rootfs] 1. Triggering single-source rules generator...');
try {
  execSync('node shared/rules/generator.js', { cwd: ROOT_DIR, stdio: 'inherit' });
} catch (err) {
  console.error('[build_rootfs] Failed to generate rules:', err.message);
  process.exit(1);
}

const staging = path.join(CLI_DIR, 'staging_rootfs');
const cliSrc = path.join(CLI_DIR, 'cli-src');

// 1. Ensure minimal required directory structure
const dirs = ['bin', 'sbin', 'usr/bin', 'usr/sbin', 'etc', 'lib', 'root', 'tmp', 'proc', 'sys', 'dev', 'mnt', 'mnt/host', 'mnt/persist'];
for (const d of dirs) {
  fs.mkdirSync(path.join(staging, d), { recursive: true });
}

// 2. Verify busybox binary
const busyboxSrc = path.join(staging, 'bin', 'busybox');
if (!fs.existsSync(busyboxSrc)) {
  console.error('Error: busybox binary missing in staging_rootfs/bin/busybox');
  process.exit(1);
}

// 3. /etc/banner.txt (Smooth cyan -> neon pink gradient ASCII banner)
const rawBannerLines = [
  '  ___   _     _ _           _     _   _      _                      _                               ',
  ' / _ \\ | |   (_) |         | |   | \\ | |    | |                    | |         _   _      _                      _        ',
  '/ /_\\ \\| | _  _| |     __ _| |__ |  \\| | ___| |___      _____  _ __| | _____  | \\ | | ___| |___      _____  _ __| | _____ ',
  '|  _  || |/ /| | |    / _` | \'_ \\| . ` |/ _ \\ __\\ \\ /\\ / / _ \\| \'__| |/ / __| |  \\| |/ _ \\ __\\ \\ /\\ / / _ \\| \'__| |/ / __|',
  '| | | ||   < | | |___| (_| | |_) | |\\  |  __/ |_ \\ V  V / (_) | |  |   <\\__ \\ | |\\  |  __/ |_ \\ V  V / (_) | |  |   <\\__ \\',
  '\\_| |_/|_|\\_\\|_\\_____/\\__,_|_.__/\\_| \\_/\\___|\\__| \\_/\\_/ \\___/|_|  |_|_|\\_\\___/ |_| \\_|\\___|\\__| \\_/\\_/ \\___/|_|  |_|\\_\\___/'
];

const c1 = [56, 189, 248]; // #38bdf8
const c2 = [244, 114, 182]; // #f472b6

const smoothBannerLines = rawBannerLines.map((line, y) => {
  let out = '';
  let lastColor = '';
  for (let x = 0; x < line.length; x++) {
    const ch = line[x];
    if (ch === ' ') {
      out += ' ';
      continue;
    }
    const t = Math.min(1, Math.max(0, (x / (line.length - 1)) * 0.65 + (y / 5.0) * 0.35));
    const r = Math.round(c1[0] + t * (c2[0] - c1[0]));
    const g = Math.round(c1[1] + t * (c2[1] - c1[1]));
    const b = Math.round(c1[2] + t * (c2[2] - c1[2]));
    const colorCode = `\x1b[38;2;${r};${g};${b}m`;
    if (colorCode !== lastColor) {
      out += colorCode;
      lastColor = colorCode;
    }
    out += ch;
  }
  return out + '\x1b[0m';
});

fs.writeFileSync(path.join(staging, 'etc/banner.txt'), smoothBannerLines.join('\n'));

// 4. Copy CLI source scripts into staging
const cliFiles = [
  'init',
  'etc/dn42-lib.sh',
  'etc/profile',
  'etc/peer_template',
  'lib/rules.sh',
  'sbin/dn42-login',
  'bin/peer',
  'bin/nano',
  'usr/bin/nano',
  'bin/nodes',
  'bin/whoami',
  'bin/logout',
  'bin/exit',
  'bin/startx',
  'bin/passwd',
  'bin/whois',
  'bin/lg',
  'bin/help',
  'bin/systemctl'
];

for (const rel of cliFiles) {
  const src = path.join(cliSrc, rel);
  const dst = path.join(staging, rel);
  if (!fs.existsSync(src)) {
    console.error(`Error: cli-src/${rel} missing`);
    process.exit(1);
  }
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  let content = fs.readFileSync(src, 'utf8');
  if (content.includes('\r')) {
    content = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  }
  fs.writeFileSync(dst, content, 'utf8');
  fs.chmodSync(dst, 0o755);
}

// 5. Clean obsolete staging scripts
const allowedBin = new Set(['busybox', ...cliFiles.filter(f => f.startsWith('bin/')).map(f => f.slice(4))]);
const currentBin = fs.readdirSync(path.join(staging, 'bin'));
for (const f of currentBin) {
  if (!allowedBin.has(f)) {
    try { fs.unlinkSync(path.join(staging, 'bin', f)); } catch {}
  }
}
try { fs.rmSync(path.join(staging, 'var'), { recursive: true, force: true }); } catch {}

// 6. Pack into initramfs cpio and gzip compress
function writeCpioHeader(mode, filesize, filename) {
  const buf = Buffer.alloc(110);
  buf.write('070701', 0, 6, 'ascii');
  buf.write((0).toString(16).padStart(8, '0'), 6, 8, 'ascii');
  buf.write(mode.toString(16).padStart(8, '0'), 14, 8, 'ascii');
  buf.write((0).toString(16).padStart(8, '0'), 22, 8, 'ascii');
  buf.write((0).toString(16).padStart(8, '0'), 30, 8, 'ascii');
  buf.write((1).toString(16).padStart(8, '0'), 38, 8, 'ascii');
  buf.write((Math.floor(Date.now() / 1000)).toString(16).padStart(8, '0'), 46, 8, 'ascii');
  buf.write(filesize.toString(16).padStart(8, '0'), 54, 8, 'ascii');
  buf.write((0).toString(16).padStart(8, '0'), 62, 8, 'ascii');
  buf.write((0).toString(16).padStart(8, '0'), 70, 8, 'ascii');
  buf.write((0).toString(16).padStart(8, '0'), 78, 8, 'ascii');
  buf.write((0).toString(16).padStart(8, '0'), 86, 8, 'ascii');
  buf.write((filename.length + 1).toString(16).padStart(8, '0'), 94, 8, 'ascii');
  buf.write((0).toString(16).padStart(8, '0'), 102, 8, 'ascii');
  return buf;
}

const chunks = [];
function walk(dir, relPath = '.') {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const entryRel = relPath === '.' ? entry.name : relPath + '/' + entry.name;

    if (entry.isDirectory()) {
      const mode = 0o040755;
      const header = writeCpioHeader(mode, 0, entryRel);
      const nameBuf = Buffer.from(entryRel + '\0', 'utf-8');
      const padLen = (4 - ((110 + nameBuf.length) % 4)) % 4;
      chunks.push(header, nameBuf, Buffer.alloc(padLen));
      walk(fullPath, entryRel);
    } else {
      const mode = 0o100755;
      const fileData = fs.readFileSync(fullPath);
      const header = writeCpioHeader(mode, fileData.length, entryRel);
      const nameBuf = Buffer.from(entryRel + '\0', 'utf-8');
      const headPad = (4 - ((110 + nameBuf.length) % 4)) % 4;
      const filePad = (4 - (fileData.length % 4)) % 4;
      chunks.push(header, nameBuf, Buffer.alloc(headPad), fileData, Buffer.alloc(filePad));
    }
  }
}

walk(staging);

const trailerName = 'TRAILER!!!\0';
const trailerHeader = writeCpioHeader(0, 0, 'TRAILER!!!');
const trailerPad = (4 - ((110 + trailerName.length) % 4)) % 4;
chunks.push(trailerHeader, Buffer.from(trailerName, 'utf-8'), Buffer.alloc(trailerPad));

const uncompressed = Buffer.concat(chunks);
const gzipped = zlib.gzipSync(uncompressed);

const outPublic = path.join(CLI_DIR, 'public', 'rootfs.dat');
fs.writeFileSync(outPublic, gzipped);
console.log(`[build_rootfs] Successfully compiled and repacked rootfs.dat (${gzipped.length} bytes) to ${outPublic}`);
