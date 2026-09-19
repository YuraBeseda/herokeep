#!/usr/bin/env node
/**
 * Root `pnpm dev` (docs/02-architecture/10-backend-architecture.md §Local development: "`pnpm
 * dev` -> `ng serve` (proxying `/api` and `/packs`) + the Node adapter (fast, no wrangler
 * needed)"). A tiny zero-dependency concurrent runner (task-11-brief: "a simple concurrent
 * runner -- npm-run-all/concurrently -- check what the repo already has; if none ... a tiny node
 * script to avoid a dep -- choose minimal"): this repo has no concurrently/npm-run-all dependency
 * anywhere, and running two `pnpm --filter <pkg> <script>` child processes side by side is a
 * small enough job that adding one felt like the wrong tradeoff.
 *
 * Runs BOTH of the following, each already responsible for its own prerequisites via its own
 * package's pre-hook -- this script does not duplicate either:
 *   - `pnpm --filter api dev:node`  (the Node adapter, `127.0.0.1:8787` -- apps/api's own
 *     `predev:node` hook builds `@hk/protocol` first, since the adapter is run via plain `node`,
 *     which resolves the workspace package through its published `dist/`, not source, unlike
 *     Vitest's own `@hk/protocol` source alias).
 *   - `pnpm --filter web start`     (`ng serve`, proxying `/api` + `/packs` to the adapter above
 *     -- `apps/web/proxy.conf.json`, wired via `angular.json`'s `serve.options.proxyConfig`;
 *     apps/web's own `prestart` hook builds design tokens + the content pack + copies `/packs`
 *     before `ng serve` starts).
 *
 * Ctrl-C (SIGINT) or either child exiting on its own stops both -- a stray orphaned `ng serve` or
 * Node adapter left running in the background after one half crashes is worse than a slightly
 * blunt "one dies, both die" policy for a local dev script.
 */
import { spawn } from 'node:child_process';

const children = [];
let shuttingDown = false;

function run(name, args) {
  const child = spawn('pnpm', args, { stdio: 'inherit', shell: process.platform === 'win32' });
  children.push({ name, child });
  child.on('exit', (code, signal) => {
    if (shuttingDown) return;
    console.log(`[dev] ${name} exited (${signal ?? code}) -- stopping the other process.`);
    shutdown(code ?? 1);
  });
  child.on('error', (err) => {
    console.error(`[dev] failed to start ${name}:`, err);
    shutdown(1);
  });
  return child;
}

function shutdown(exitCode) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const { child } of children) {
    if (!child.killed) child.kill();
  }
  process.exitCode = exitCode;
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

console.log('[dev] starting the Node adapter (api) and ng serve (web) -- Ctrl-C stops both.');
run('api', ['--filter', 'api', 'dev:node']);
run('web', ['--filter', 'web', 'start']);
