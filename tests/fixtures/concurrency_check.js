// 并发端口分配验证：同节点并发提交，验证无重复端口
// 7.1 要求 payload.asn === token.asn，因此使用 5 个独立测试账号并发提交同一节点
import { createServer } from '../../server/index.js';
import { hashPassword } from '../../server/services/authService.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const isAutoTemp = !process.env.PORTAL_DATA_DIR;
const dataDir = process.env.PORTAL_DATA_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'dn42-concurrency-'));
process.env.PORTAL_DATA_DIR = dataDir;
fs.mkdirSync(dataDir, { recursive: true });

const asns = [4242420001, 4242421001, 4242422001, 4242423001, 4242424001];
const users = {};
for (const asn of asns) {
  const h = hashPassword('test12345');
  users[String(asn)] = { asn, asName: `AS${asn}`, role: 'user', salt: h.salt, hash: h.hash, createdAt: new Date().toISOString() };
}
fs.writeFileSync(path.join(dataDir, 'auth_users.json'), JSON.stringify(users, null, 2));
fs.writeFileSync(path.join(dataDir, 'peering_sessions.json'), '[]');
fs.writeFileSync(path.join(dataDir, 'port_ledger.json'), '{}');

const PORT = 4255;
const server = createServer();
await new Promise(r => server.listen(PORT, '127.0.0.1', r));
const base = `http://127.0.0.1:${PORT}`;

const key = 'yA+N64x7tN/4H1XqJd+7qf3K9z1V8uT5R7o+P2w8x1E=';

async function login(asn) {
  const res = await fetch(`${base}/api/auth/login-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: String(asn), password: 'test12345' })
  });
  const body = await res.json();
  if (!body.success) throw new Error(`login failed for ${asn}: ${body.error?.message}`);
  return body.data.token;
}

const tokens = {};
for (const asn of asns) tokens[asn] = await login(asn);
console.log('[auth] 5 accounts logged in');

const results = await Promise.all(asns.map(asn =>
  fetch(`${base}/api/peering/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens[asn]}` },
    body: JSON.stringify({
      asn, nodeId: 'JP-7',
      publicKey: key,
      linkLocal: `fe80::${String(asn).slice(-4)}`,
      ipv4: '', ipv6Ula: '',
      endpoint: '',
      listenPort: 30000, clientPort: 'auto',
      mtu: 1420, bgpMode: 'mpbgp_enh'
    })
  }).then(r => r.json())
));

console.table(results.map((r, i) => ({ asn: asns[i], success: r.success, port: r.data?.port, err: r.error?.message?.slice(0, 40) })));

const ok = results.filter(r => r.success).map(r => r.data.port);
const unique = new Set(ok);
console.log(ok.length === 5
  ? (unique.size === 5 ? 'PASS: 5 concurrent submissions, 5 unique ports' : `FAIL: duplicate ports! ${JSON.stringify(ok)}`)
  : `FAIL: only ${ok.length}/5 succeeded`);

await server.closeAll();
if (isAutoTemp) {
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch {}
}
process.exit(ok.length === 5 && unique.size === 5 ? 0 : 1);
