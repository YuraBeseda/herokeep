#!/usr/bin/env node
/**
 * Boots the Node API adapter (`apps/api/src/adapters/node/server.ts`) for the `sync` e2e project
 * (task-11-brief.md; plan-8 design ruling 7) — `playwright.sync.config.ts`'s FIRST `webServer`
 * entry. Creates a fresh OS temp directory for `accounts.sqlite`/`streams.sqlite` (never the repo,
 * never `apps/api`'s own gitignored `./data` a developer might be using for `pnpm dev`), sets the
 * three ADR-012 secrets to fixed test-only values, and sets `APP_ORIGIN` to the PROXY's origin
 * (`serve-with-proxy.mjs`'s port, not this server's own) — the browser in this suite is always
 * served from the proxy, so that is the `Origin` header every WebSocket upgrade
 * (`core/routes/characters.ts`) will actually carry, and `APP_ORIGIN` has to match it exactly
 * (scheme + host + port) for the sync scenarios' sockets to open at all.
 *
 * Run directly with plain `node` (no build step): `server.ts`'s own header comment already
 * establishes this repo's convention of running `apps/api`'s TS sources unchanged under Node 24's
 * native type-stripping (`node src/adapters/node/server.ts`, `dev:node`'s own script) — this file
 * does the same, importing that module by URL rather than spawning it as a child process, so a
 * single `node tools/start-e2e-api.mjs` IS the long-lived server process Playwright's `webServer`
 * expects (a real, immediate exit here would look like the command "failing to start" to
 * Playwright, so this file intentionally never resolves/exits on its own — the API server keeps
 * its own event loop alive via `httpServer.listen`).
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PROXY_PORT = Number(process.env['PROXY_PORT'] ?? 4320);
const API_PORT = Number(process.env['API_PORT'] ?? 4331);

// Fixed test-only secrets (task-11-brief.md: "env secrets test values") — never real deployment
// values, and distinct from `apps/api/.env.example`'s own placeholders so a stray real `.env`
// picked up by accident would be obviously wrong rather than silently shadowed (this script never
// loads one anyway — see `envFile` below).
process.env['SESSION_PEPPER'] ??= 'e2e-sync-suite-session-pepper-not-a-real-secret';
process.env['SALT_HMAC_KEY'] ??= 'e2e-sync-suite-salt-hmac-key-not-a-real-secret';
// The browser's origin in this suite is ALWAYS the proxy's origin (`serve-with-proxy.mjs`), never
// this server's own `API_PORT` directly — see this file's header comment.
process.env['APP_ORIGIN'] ??= `http://127.0.0.1:${PROXY_PORT}`;
process.env['HK_HOST'] ??= '127.0.0.1';
process.env['HK_PORT'] = String(API_PORT);
// A fresh OS temp dir per run (task-11-brief.md: "creates a fresh temp dir, writes nothing to
// repo") — never reused across runs, so the two consecutive stability-gate runs each start from a
// genuinely empty account/stream store, and never collides with a developer's own `pnpm dev`
// data dir (`apps/api/data`, gitignored but very much NOT temporary).
process.env['HK_DATA_DIR'] = mkdtempSync(join(tmpdir(), 'hk-e2e-sync-data-'));

const serverModuleUrl = new URL('../../api/src/adapters/node/server.ts', import.meta.url);
const { startNodeServer } = await import(serverModuleUrl);

// `envFile` points at a path that can never exist: this run's secrets/origin/port are ALREADY
// fully set above via `process.env`, and `loadEnvFile` never overwrites an existing `process.env`
// value (its own doc comment) — but a developer's real `apps/api/.env` sitting on disk should
// still never be read into THIS process at all, on principle (it's an unrelated deployment's
// secrets file, not this suite's).
const handle = await startNodeServer({
  envFile: join(process.env['HK_DATA_DIR'], 'unused.env'),
});

// Security of logs (repo-wide convention — see `server.ts`'s own boot log): host/port/data-dir
// only, no secrets, no request content.
console.log(
  `e2e api adapter listening on http://${handle.host}:${handle.port} (data: ${handle.dataDir}, app-origin: ${process.env['APP_ORIGIN']})`,
);
