#!/usr/bin/env node
/**
 * A tiny static + reverse-proxy server for the `sync` e2e project (task-11-brief.md; plan-8
 * design ruling 7): serves the production build (`dist/web/browser`, SPA-fallback to
 * `index.html`, same shape the default `playwright.config.ts` gets from the `serve` package) and
 * proxies everything under `/api/*` — both plain HTTP requests AND WebSocket upgrades — to the
 * Node API adapter (`apps/api/src/adapters/node/server.ts`, started separately by
 * `start-e2e-api.mjs` as `playwright.sync.config.ts`'s OTHER `webServer` entry).
 *
 * This exists so the browser's origin in the sync e2e suite is THIS server's origin
 * (`http://127.0.0.1:<port>`) — never the API's own port directly — mirroring how a real
 * self-hosted deployment fronts the API with a reverse proxy (ADR-014 §Adapter B) and, more
 * concretely, letting `apps/api`'s `APP_ORIGIN` WebSocket-upgrade Origin check
 * (`core/routes/characters.ts`) validate against a stable, single origin regardless of which port
 * the API adapter itself ends up bound to.
 *
 * No new dependency: plain `node:http`/`node:net`, no `http-proxy`/`ws`. HTTP requests are
 * streamed straight through (`req.pipe(proxyReq)`, `proxyRes.pipe(res)`) so a POST body of any
 * size works without buffering it here first. A WS upgrade is tunneled by hand — Node's HTTP
 * parser only ever fires `'upgrade'` with the raw pieces of the handshake (`req`, `socket`,
 * `head`); this reconstructs the original request line + headers onto a fresh `net.Socket` to the
 * API adapter and then pipes both raw sockets together in both directions, exactly the technique
 * `apps/api/src/adapters/node/server.ts`'s own header comment describes for ITS half of a upgrade
 * (this file is the other end of that same TCP hop, one proxy layer up).
 */
import { createServer } from 'node:http';
import { connect as netConnect } from 'node:net';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, normalize, resolve, sep } from 'node:path';
import http from 'node:http';

function parseArgs(argv) {
  const out = {};
  for (const arg of argv) {
    const match = /^--([a-z-]+)=(.*)$/.exec(arg);
    if (match) out[match[1]] = match[2];
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const PORT = Number(args.port ?? process.env['PROXY_PORT'] ?? 4320);
const API_PORT = Number(args['api-port'] ?? process.env['API_PORT'] ?? 4331);
const API_HOST = args['api-host'] ?? process.env['API_HOST'] ?? '127.0.0.1';
const DIST_DIR = resolve(args.dist ?? process.env['DIST_DIR'] ?? 'dist/web/browser');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
};

/** Path-traversal-safe resolution of a request pathname under `DIST_DIR`, `null` if it escapes —
 * same guard shape `apps/api`'s own `NodeStaticAssets` uses. */
function resolveUnderDist(pathname) {
  const relative = normalize(decodeURIComponent(pathname)).replace(/^([/\\])+/, '');
  const filePath = resolve(DIST_DIR, relative);
  if (filePath !== DIST_DIR && !filePath.startsWith(DIST_DIR + sep)) return null;
  return filePath;
}

async function serveStatic(req, res) {
  const url = new URL(req.url, 'http://internal');
  const direct = resolveUnderDist(url.pathname);
  const candidates = direct ? [direct] : [];
  const indexPath = resolveUnderDist('/index.html');
  if (indexPath) candidates.push(indexPath); // SPA fallback

  for (const candidate of candidates) {
    try {
      const stats = await stat(candidate);
      if (!stats.isFile()) continue;
      const ext = extname(candidate);
      res.writeHead(200, { 'content-type': MIME_TYPES[ext] ?? 'application/octet-stream' });
      createReadStream(candidate).pipe(res);
      return;
    } catch {
      continue;
    }
  }
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('Not found');
}

function proxyHttp(req, res) {
  const proxyReq = http.request(
    { host: API_HOST, port: API_PORT, method: req.method, path: req.url, headers: req.headers },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
      proxyRes.pipe(res);
    },
  );
  proxyReq.on('error', () => {
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Bad gateway: the API server is unreachable');
  });
  req.pipe(proxyReq);
}

const server = createServer((req, res) => {
  if (req.url?.startsWith('/api/')) return proxyHttp(req, res);
  return void serveStatic(req, res);
});

// WebSocket upgrade tunnel (`/api/characters/:id/ws`): rebuild the original request line and
// headers onto a fresh raw socket to the API adapter, then splice the two raw sockets together —
// `ws`'s own handshake on the API side writes the real 101 response straight back through this
// tunnel to the browser, untouched.
server.on('upgrade', (req, clientSocket, head) => {
  if (!req.url?.startsWith('/api/')) {
    clientSocket.destroy();
    return;
  }

  const apiSocket = netConnect(API_PORT, API_HOST, () => {
    const headerLines = [`${req.method} ${req.url} HTTP/1.1`];
    for (const [key, value] of Object.entries(req.headers)) {
      if (Array.isArray(value)) {
        for (const v of value) headerLines.push(`${key}: ${v}`);
      } else if (value !== undefined) {
        headerLines.push(`${key}: ${value}`);
      }
    }
    apiSocket.write(`${headerLines.join('\r\n')}\r\n\r\n`);
    if (head?.length) apiSocket.write(head);
    apiSocket.pipe(clientSocket);
    clientSocket.pipe(apiSocket);
  });

  const teardown = () => {
    if (!apiSocket.destroyed) apiSocket.destroy();
    if (!clientSocket.destroyed) clientSocket.destroy();
  };
  apiSocket.on('error', () => {
    // Clean 502 on API-down (task-11-brief.md): best-effort — the handshake may already be
    // in-flight, but when it's still safe to write, tell the client plainly instead of a silent
    // hang-up.
    if (!clientSocket.destroyed) {
      try {
        clientSocket.write('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n');
      } catch {
        // socket already unusable — nothing more to do.
      }
    }
    teardown();
  });
  clientSocket.on('error', teardown);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(
    `serve-with-proxy: http://127.0.0.1:${PORT} (dist: ${DIST_DIR}; api: http://${API_HOST}:${API_PORT})`,
  );
});
