import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { URL, pathToFileURL } from 'node:url';

import { ENV, ROOT_DIR } from './config.js';
import { getActiveConfig, initConfigWatcher, stopConfigWatcher } from './storage/configLoader.js';
import { AuthService } from './services/authService.js';
import { sendJson, successEnvelope, errorEnvelope } from './utils/envelope.js';

import { MetaController } from './controllers/metaController.js';
import { PeeringController } from './controllers/peeringController.js';
import { AuthController } from './controllers/authController.js';
import { SessionController } from './controllers/sessionController.js';
import { ProbeController } from './controllers/probeController.js';
import { LookingGlassController } from './controllers/lgController.js';

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
          const info = await AuthService.getAsnRegistryInfo(cleanAsn);
          if (!info) {
            return sendJson(res, 200, {
              success: true,
              valid: false,
              error: `ASN AS${cleanAsn} not found in registry cache`
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
        const guiDist = path.join(ROOT_DIR, 'gui/dist');
        let relPath = pathname.slice(guiRoute.length).replace(/^\/+/, '');
        if (!relPath) relPath = 'index.html';

        let targetFile = path.join(guiDist, relPath);
        if (!fs.existsSync(targetFile) || fs.statSync(targetFile).isDirectory()) {
          targetFile = path.join(guiDist, 'index.html');
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
      const cliPublic = path.join(ROOT_DIR, 'cli/public');
      let cliRel = pathname.replace(/^\/+/, '');
      if (!cliRel) cliRel = 'index.html';

      let cliFile = path.join(cliPublic, cliRel);
      if (fs.existsSync(cliFile) && !fs.statSync(cliFile).isDirectory()) {
        const ext = path.extname(cliFile);
        const mime = MIME_TYPES[ext] || 'application/octet-stream';
        const headers = {
          'Content-Type': mime,
          'Cache-Control': 'no-cache, no-store, must-revalidate'
        };
        if (ext === '.dat' || ext === '.wasm') {
          const filename = path.basename(cliFile);
          headers['Content-Disposition'] = `inline; filename="${filename}"`;
        }
        res.writeHead(200, headers);
        return fs.createReadStream(cliFile).pipe(res);
      }

      // Fallback index.html for CLI
      const cliIndex = path.join(cliPublic, 'index.html');
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
