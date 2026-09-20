import { defineConfig, devices } from '@playwright/test';

/**
 * e2e runs against the real production build (`dist/web/browser`), never `ng serve` — the
 * offline/service-worker spec needs the actual `ngsw-worker.js` and its prefetched caches, which
 * only exist in a production build (`provideServiceWorker(..., { enabled: !isDevMode() })`, see
 * `src/app/app.config.ts`). The web package's `pree2e` script (`package.json`) runs the full
 * build chain — content pack, design tokens, pack copy, `ng build`, the gzip budget gate — before
 * Playwright starts; `webServer` below then serves that output as static files, with SPA fallback
 * (`serve -s`) so client-side routes like `/library/:id` resolve to `index.html` instead of
 * 404ing on a hard navigation (`page.goto('/library')`, a page reload while offline, etc.).
 */
const PORT = 4310;
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  // `e2e/sync/**` (task-11-brief.md) is its own project with its own config
  // (`playwright.sync.config.ts`, real API + proxy webServers) — excluded here so this offline,
  // no-server suite never picks those specs up and runs them against the plain static server this
  // config starts below (which has no `/api/*` at all): every real-API assertion in there would
  // just fail for the wrong reason. Ruling 7's "the default e2e project stays untouched and
  // offline-pure" is enforced by this line, not just by convention.
  testIgnore: '**/sync/**',
  // A single shared `webServer` (one `serve` process) backs every test below. offline.spec.ts's
  // service-worker install already has its own real, variable-length wait (Angular's driver
  // caches its prefetched assetGroups as a background idle task — see that spec's module doc);
  // running many browser contexts against the one server at once adds CPU/IO contention on top of
  // that, which is exactly the kind of thing that turns a correct wait into an occasional CI
  // timeout. This suite is only 8 tests — serializing it (one worker) costs a few seconds and
  // removes that variable entirely.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env['CI'],
  // No retries: a flaky e2e run is a bug to fix (missing web-first assertion, a race the app
  // itself has), not something to paper over by re-running — see task-15-brief.md.
  retries: 0,
  // Default (30s) is too tight for offline.spec.ts: a real service-worker install has to
  // download and cache every prefetched asset (app shell, fonts, icon sprite, i18n JSON, the
  // ~2 MB core pack) before it activates, which this bounds along with the rest of that test.
  timeout: 90_000,
  // The CI job uploads `playwright-report/` on failure (see `.github/workflows/ci.yml`), so it
  // needs the `html` reporter actually writing there, alongside `github` (PR annotations) and
  // `list` (readable job-log output).
  reporter: process.env['CI'] ? [['github'], ['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
  },
  projects: [
    // Chromium only (task-15-brief.md: "chromium only") — service-worker/offline behavior is
    // what this suite most needs to get right, and Chromium is the one engine Playwright can
    // drive with full Service Worker + Cache Storage + `context.setOffline` support in CI.
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    // `-s` (single/SPA fallback): unmatched paths resolve to `index.html` instead of 404, which
    // real static hosts for this app (and the service worker's own navigation handling) do too.
    // `-n` skips serve's "copy address to clipboard" step (no clipboard in CI); `-L` silences its
    // per-request access log so it doesn't interleave with the Playwright reporter's output.
    command: `pnpm exec serve -s dist/web/browser -l tcp://127.0.0.1:${PORT} -n -L`,
    url: BASE_URL,
    reuseExistingServer: !process.env['CI'],
    timeout: 60_000,
  },
});
