import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { URL, pathToFileURL } from 'node:url';

import { ENV, ROOT_DIR } from './config.js';
import { getActiveConfig, initConfigWatcher, stopConfigWatcher } from './storage/configLoader.js';
import { AuthService } from './services/authService.js';
import { RegistryService } from './services/registryService.js';
import { sendJson, successEnvelope, errorEnvelope } from './utils/envelope.js';

import { MetaController } from './controllers/metaController.js';
import { PeeringController } from './controllers/peeringController.js';
import { AuthController } from './controllers/authController.js';
import { SessionController } from './controllers/sessionController.js';
import { ProbeController } from './controllers/probeController.js';
import { LookingGlassController } from './controllers/lgController.js';
import { generateInstallProbeScript } from './services/installScriptService.js';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.ts': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.dat': 'application/octet-stream',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8'
};

function parseJsonBody(req, limitBytes = 1048576) {
  return new Promise((resolve, reject) => {
    let raw = '';
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > limitBytes) {
        reject(new Error('Payload Too Large'));
        req.destroy();
        return;
      }
      raw += chunk;
    });
    req.on('end', () => {
      if (!raw.trim()) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(new Error('Invalid JSON payload'));
      }
    });
    req.on('error', err => reject(err));
  });
}

function extractUser(req) {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  return AuthService.verifyJwt(token);
}

export function createServer() {
  initConfigWatcher();
  RegistryService.startPeriodicSync();

  const server = http.createServer(async (req, res) => {
    const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = parsedUrl.pathname;
    const method = req.method.toUpperCase();

    // Default Security & CORS Headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');

    // COOP/COEP Headers for WASM SharedArrayBuffer & Multi-threading
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');

    if (method === 'OPTIONS') {
      res.writeHead(204);
      return res.end();
    }

    try {
      // -------------------------------------------------------------
      // API Gateway Routes (/api/*)
      // -------------------------------------------------------------
      if (pathname.startsWith('/api/')) {
        // Meta
        if (pathname === '/api/network-meta' && method === 'GET') {
          const resp = await MetaController.getNetworkMeta(req, res);
          return sendJson(res, 200, resp);
        }

        // DN42 Lookup
        if (pathname === '/api/dn42-lookup' && method === 'GET') {
          const cleanAsn = (parsedUrl.searchParams.get('asn') || '').replace(/^AS/i, '');
          try {
            const info = await AuthService.getAsnRegistryInfo(cleanAsn);
            if (!info) {
              return sendJson(res, 200, {
                success: true,
                valid: false,
                error: `ASN AS${cleanAsn} not found in DN42 registry`
              });
            }
            return sendJson(res, 200, {
              success: true,
              valid: true,
              identity: {
                asName: info.asName || `AS${cleanAsn}`,
                descr: info.descr || 'DN42 Autonomous System',
                maintainer: info.maintainer || '',
                adminContact: info.adminContact || '',
                personName: info.personName || ''
              }
            });
          } catch (err) {
            return sendJson(res, 200, {
              success: false,
              valid: false,
              error: err.message || 'Registry sync failed, please retry later'
            });
          }
        }

        // Auth
        if (pathname === '/api/auth/challenge' && (method === 'GET' || method === 'POST')) {
          let body = {};
          if (method === 'POST') body = await parseJsonBody(req);
          const resp = await AuthController.getChallenge({ ...Object.fromEntries(parsedUrl.searchParams), ...body });
          return sendJson(res, 200, resp);
        }

        if ((pathname === '/api/auth/verify-signature' || pathname === '/api/auth/verify-ssh') && method === 'POST') {
          const body = await parseJsonBody(req);
          const resp = await AuthController.verifySignature(body);
          return sendJson(res, 200, resp);
        }

        if (pathname === '/api/auth/login-password' && method === 'POST') {
          const body = await parseJsonBody(req);
          const resp = await AuthController.loginPassword(body);
          return sendJson(res, 200, resp);
        }

        if (pathname === '/api/auth/set-password' && method === 'POST') {
          const user = extractUser(req);
          if (!user) return sendJson(res, 401, errorEnvelope('Unauthorized', null, 401));
          const body = await parseJsonBody(req);
          const resp = await AuthController.setPassword(user, body);
          return sendJson(res, resp.code || 200, resp);
        }

        if (pathname === '/api/auth/me' && method === 'GET') {
          const user = extractUser(req);
          if (!user) return sendJson(res, 401, errorEnvelope('Unauthorized', null, 401));
          const resp = await AuthController.getMe(user);
          return sendJson(res, resp.code || 200, resp);
        }

        if (pathname === '/api/auth/logout') {
          // Stateless signal: CLI gateway mirrors localStorage cleanup on this path
          return sendJson(res, 200, successEnvelope({ message: 'Signed out' }, 200));
        }

        if (pathname === '/api/auth/status' && method === 'GET') {
          const user = extractUser(req);
          const resp = await AuthController.getStatus(user);
          return sendJson(res, 200, resp);
        }

        // Peering Submissions (7.1: Auth Required)
        if (pathname === '/api/peering/submit' && method === 'POST') {
          const user = extractUser(req);
          if (!user) return sendJson(res, 401, errorEnvelope('Unauthorized', null, 401));
          const body = await parseJsonBody(req);
          const resp = await PeeringController.submitPeering(body, user);
          return sendJson(res, resp.code || 200, resp);
        }

        // Peering Sessions List & Delete
        if (pathname === '/api/sessions' && method === 'GET') {
          const user = extractUser(req);
          if (!user) return sendJson(res, 401, errorEnvelope('Unauthorized', null, 401));
          const resp = await SessionController.listSessions(user);
          return sendJson(res, resp.code || 200, resp);
        }

        if (pathname.startsWith('/api/sessions/') && method === 'DELETE') {
          const user = extractUser(req);
          if (!user) return sendJson(res, 401, errorEnvelope('Unauthorized', null, 401));
          const id = pathname.slice('/api/sessions/'.length);
          const resp = await SessionController.deleteSession(id, user);
          return sendJson(res, resp.code || 200, resp);
        }

        if (pathname === '/api/sessions/remove' && method === 'POST') {
          const user = extractUser(req);
          if (!user) return sendJson(res, 401, errorEnvelope('Unauthorized', null, 401));
          const body = await parseJsonBody(req);
          const id = body.sessionId || body.id;
          if (!id) return sendJson(res, 200, errorEnvelope('Session ID is required', null, 200));
          const resp = await SessionController.deleteSession(id, user);
          return sendJson(res, resp.code || 200, resp);
        }

        // Looking Glass
        if ((pathname === '/api/looking-glass' || pathname === '/api/looking-glass/query') && method === 'POST') {
          const body = await parseJsonBody(req);
          const resp = await LookingGlassController.query(body);
          return sendJson(res, 200, resp);
        }

        // Probe Registration (Auto-Claim via WireGuard Public Key)
        if (pathname === '/api/probe/register' && method === 'POST') {
          const authHeader = req.headers['authorization'] || '';
          const body = await parseJsonBody(req);
          const resp = await ProbeController.handleRegister(authHeader, body);
          return sendJson(res, resp.code || (resp.success ? 200 : 400), resp);
        }

        // Probe Reports
        if (pathname === '/api/probe/report' && method === 'POST') {
          const authHeader = req.headers['authorization'] || '';
          const body = await parseJsonBody(req);
          const resp = await ProbeController.handleReport(authHeader, body);
          return sendJson(res, resp.code || (resp.success ? 200 : 401), resp);
        }

        if (pathname === '/api/probe/status' && method === 'GET') {
          const resp = await ProbeController.getStatus();
          return sendJson(res, 200, resp);
        }

        return sendJson(res, 404, errorEnvelope('Endpoint Not Found', null, 404));
      }

      // -------------------------------------------------------------
      // Unified One-Click Probe Installer & Agent Distribution
      // -------------------------------------------------------------
      if (pathname === '/install-probe.sh' && method === 'GET') {
        const host = req.headers['x-forwarded-host'] || req.headers.host || `127.0.0.1:${ENV.PORT}`;
        const proto = req.headers['x-forwarded-proto'] || (req.socket.encrypted ? 'https' : 'http');
        const masterUrl = `${proto}://${host}`;
        const script = generateInstallProbeScript({ masterUrl });
        res.writeHead(200, {
          'Content-Type': 'text/x-shellscript; charset=utf-8',
          'Cache-Control': 'no-cache, no-store, must-revalidate'
        });
        return res.end(script);
      }

      if ((pathname === '/scripts/probe-agent.js' || pathname === '/probe-agent.js') && method === 'GET') {
        const probeAgentFile = path.resolve(ROOT_DIR, 'scripts/probe-agent.js');
        if (fs.existsSync(probeAgentFile)) {
          res.writeHead(200, {
            'Content-Type': 'application/javascript; charset=utf-8',
            'Cache-Control': 'no-cache, no-store, must-revalidate'
          });
          return fs.createReadStream(probeAgentFile).pipe(res);
        }
      }

      // Direct Brand Logos Hosting (/logos/*)
      if (pathname.startsWith('/logos/') && method === 'GET') {
        const logoRel = pathname.slice('/logos/'.length);
        const logoFile = path.resolve(ROOT_DIR, 'gui/public/logos', logoRel);
        if (fs.existsSync(logoFile) && !fs.statSync(logoFile).isDirectory()) {
          const ext = path.extname(logoFile);
          res.writeHead(200, {
            'Content-Type': MIME_TYPES[ext] || 'image/png',
            'Cache-Control': 'no-cache, no-store, must-revalidate'
          });
          return fs.createReadStream(logoFile).pipe(res);
        }
      }

      // -------------------------------------------------------------
      // Static Hosting: Web GUI (/gui or custom guiPath) & WASM CLI (/)
      // -------------------------------------------------------------
      const config = getActiveConfig();
      const guiRoute = config.guiPath || '/gui';

      // 1. Web GUI (React Vite SPA)
      if (pathname === guiRoute) {
        res.writeHead(301, {
          'Location': `${guiRoute}/`,
          'Cache-Control': 'no-cache'
        });
        return res.end();
      }

      if (pathname.startsWith(`${guiRoute}/`)) {
        const guiDist = path.resolve(ROOT_DIR, 'gui/dist');
        let rawRel = pathname.slice(guiRoute.length).replace(/^\/+/, '');
        let relPath = rawRel;
        try {
          relPath = decodeURIComponent(rawRel);
        } catch {
          return sendJson(res, 400, errorEnvelope('Bad Request: Invalid URI encoding', null, 400));
        }
        if (!relPath) relPath = 'index.html';

        let targetFile = path.resolve(guiDist, relPath);
        if (!targetFile.startsWith(guiDist)) {
          return sendJson(res, 403, errorEnvelope('Forbidden: Access Denied', null, 403));
        }

        if (!fs.existsSync(targetFile) || fs.statSync(targetFile).isDirectory()) {
          targetFile = path.resolve(guiDist, 'index.html');
        }

        if (fs.existsSync(targetFile)) {
          const ext = path.extname(targetFile);
          const mime = MIME_TYPES[ext] || 'application/octet-stream';
          const headers = {
            'Content-Type': mime,
            'Cache-Control': 'no-cache, no-store, must-revalidate'
          };
          if (ext === '.dat' || ext === '.wasm') {
            const filename = path.basename(targetFile);
            headers['Content-Disposition'] = `inline; filename="${filename}"`;
          }
          res.writeHead(200, headers);
          return fs.createReadStream(targetFile).pipe(res);
        } else {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          return res.end('<!DOCTYPE html><html><body><h1>DN42 Web GUI</h1><p>Run <code>npm run build:gui</code> to compile React frontend.</p></body></html>');
        }
      }

      // 2. Terminal CLI (Root / and all other static resources)
      const cliPublic = path.resolve(ROOT_DIR, 'cli/public');
      let rawCliRel = pathname.replace(/^\/+/, '');
      let cliRel = rawCliRel;
      try {
        cliRel = decodeURIComponent(rawCliRel);
      } catch {
        return sendJson(res, 400, errorEnvelope('Bad Request: Invalid URI encoding', null, 400));
      }
      if (!cliRel) cliRel = 'index.html';

      let cliFile = path.resolve(cliPublic, cliRel);
      if (!cliFile.startsWith(cliPublic)) {
        return sendJson(res, 403, errorEnvelope('Forbidden: Access Denied', null, 403));
      }

      if (fs.existsSync(cliFile) && !fs.statSync(cliFile).isDirectory()) {
        const stat = fs.statSync(cliFile);
        const ext = path.extname(cliFile);
        const mime = MIME_TYPES[ext] || 'application/octet-stream';
        // Weak ETag from size+mtime: unchanged files get 304, no re-download
        const etag = `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
        // Third-party vendor assets (4.3MB WASM kernel etc.) rarely change: cache 7 days;
        // rootfs.dat and app files stay no-cache (revalidated via ETag each load).
        const cacheControl = cliRel.startsWith('vendor/') ? 'public, max-age=604800' : 'no-cache';
        const headers = {
          'Content-Type': mime,
          'Content-Length': stat.size,
          'Cache-Control': cacheControl,
          'ETag': etag
        };
        if (req.headers['if-none-match'] === etag) {
          res.writeHead(304, { ETag: etag, 'Cache-Control': cacheControl });
          return res.end();
        }
        if (ext === '.dat' || ext === '.wasm') {
          const filename = path.basename(cliFile);
          headers['Content-Disposition'] = `inline; filename="${filename}"`;
        }
        res.writeHead(200, headers);
        return fs.createReadStream(cliFile).pipe(res);
      }

      // Fallback index.html for CLI
      const cliIndex = path.resolve(cliPublic, 'index.html');
      if (fs.existsSync(cliIndex)) {
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-cache, no-store, must-revalidate'
        });
        return fs.createReadStream(cliIndex).pipe(res);
      }

      // Placeholder
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<!DOCTYPE html><html><body><h1>AkiLab DN42 Interactive Terminal</h1><p>Terminal assets preparing...</p></body></html>');

    } catch (err) {
      console.error('[Server Error]', err);
      sendJson(res, 500, errorEnvelope('Internal Server Error', null, 500));
    }
  });

  // Resource cleanup helper to ensure 100% clean termination in tests
  server.closeAll = function() {
    stopConfigWatcher();
    RegistryService.stopPeriodicSync();
    return new Promise(resolve => {
      server.close(resolve);
    });
  };

  return server;
}

// Start standalone if executed directly (normalize windows path separator via pathToFileURL)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createServer();
  server.listen(ENV.PORT, ENV.HOST, () => {
    console.log(`[DN42-Portal-2.0] Server running at http://${ENV.HOST}:${ENV.PORT}`);
    console.log(`[DN42-Portal-2.0] Terminal CLI: http://${ENV.HOST}:${ENV.PORT}/`);
    console.log(`[DN42-Portal-2.0] Web GUI:      http://${ENV.HOST}:${ENV.PORT}${getActiveConfig().guiPath || '/gui'}`);
  });
}
