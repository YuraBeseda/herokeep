import { defineConfig, devices } from '@playwright/test';

/**
 * The `sync` e2e project (task-11-brief.md; plan-8 design ruling 7) — real-API scenarios that the
 * default `playwright.config.ts` (offline-only, no server, no account) deliberately never
 * exercises: register/login/recover against a REAL Node API adapter, cross-device restore, live
 * two-context sync over a real WebSocket, and device revocation. Kept as a SEPARATE Playwright
 * config/project (not folded into the default one) so the default suite stays exactly what
 * task-15-brief.md built it as — offline-pure, no server process beyond the static file host — and
 * this suite's own stability is judged independently (task-11-brief.md's "2 consecutive clean
 * sync-suite runs" gate).
 *
 * Like the default config, this always runs against the real PRODUCTION build
 * (`dist/web/browser`) — never `ng serve` — for the same reason (`playwright.config.ts`'s own doc
 * comment: the service worker/offline machinery only exists in a production build). `e2e:sync`
 * (`package.json`) builds it via its own `pree2e:sync` hook, identical to the default suite's
 * `pree2e` — the SAME `dist/web/browser` output both suites read from (no reason for the two
 * builds to differ; running both suites back-to-back in one session only pays the build cost once
 * per invocation of whichever ran second, since `ng build`'s output is deterministic for an
 * unchanged source tree — see `package.json`'s own script comment).
 *
 * TWO `webServer` entries (Playwright's array form), matching ruling 7 exactly:
 *   [0] the Node API adapter itself (`tools/start-e2e-api.mjs`) — a SEEDED, fresh-per-run temp
 *       data dir, fixed test secrets, `APP_ORIGIN` pinned to entry [1]'s own origin (see below).
 *   [1] `tools/serve-with-proxy.mjs` — serves `dist/web/browser` (SPA fallback, same shape as the
 *       default config's `serve -s`) and reverse-proxies `/api/*` (HTTP + WS upgrades) to [0].
 * The BROWSER's origin in every test below is [1]'s origin — never [0]'s port directly — which is
 * exactly why `APP_ORIGIN` (the API's own WebSocket-upgrade `Origin` check,
 * `core/routes/characters.ts`) is set to [1]'s `http://127.0.0.1:${PROXY_PORT}` in
 * `start-e2e-api.mjs`, not [0]'s own `API_PORT`.
 */
const PROXY_PORT = 4320;
const API_PORT = 4331;
const BASE_URL = `http://127.0.0.1:${PROXY_PORT}`;
const API_HEALTH_URL = `http://127.0.0.1:${API_PORT}/api/health`;

export default defineConfig({
  testDir: './e2e/sync',
  // Same reasoning as the default config's `fullyParallel: false`/`workers: 1`, amplified: these
  // scenarios drive TWO browser contexts against ONE shared server (real accounts, real SQLite
  // files, a real per-stream Web Lock) — parallel test cases would mean parallel registrations/
  // characters racing the same process's rate limiter and stream actors for no benefit this suite
  // needs.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env['CI'],
  // No retries — task-15-brief.md's "a flaky e2e run is a bug to fix" stance applies here too,
  // doubly so: this task's whole purpose is proving the real integration, not hiding its flakes.
  retries: 0,
  // Real PBKDF2 (600,000 iterations, WebCrypto) in the browser (~1-2s per derivation, task-11-
  // brief.md), plus real network round trips through the proxy for every scenario, plus enough
  // margin for the API adapter's own cold-start latency right after boot (SQLite WAL file
  // creation, better-sqlite3's native binding first touch, V8 JIT warmup — measurably slower for
  // the first requests of a run than steady-state) — generous but not unbounded.
  timeout: 90_000,
  reporter: process.env['CI'] ? [['github'], ['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
  },
  projects: [
    // Chromium only — same reasoning as the default config (full WebSocket/Service-Worker support
    // in CI), and this suite never needs cross-engine coverage beyond what that one already buys.
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: [
    {
      command: 'node tools/start-e2e-api.mjs',
      url: API_HEALTH_URL,
      reuseExistingServer: !process.env['CI'],
      timeout: 30_000,
      env: {
        PROXY_PORT: String(PROXY_PORT),
        API_PORT: String(API_PORT),
      },
    },
    {
      command: `node tools/serve-with-proxy.mjs --port=${PROXY_PORT} --api-port=${API_PORT} --dist=dist/web/browser`,
      url: BASE_URL,
      reuseExistingServer: !process.env['CI'],
      timeout: 30_000,
    },
  ],
});
