import { defineConfig } from '@playwright/test';

/**
 * Text-fit harness: serves the same production build as `playwright.config.ts`, but every `en` i18n
 * file is swapped (by the spec, via request interception) for `.fit-locale/` — the longest of
 * en/ru/uk per key (`scripts/build-fit-locale.mjs`). Two projects, the smallest phone and the default
 * desktop width. Service workers are blocked so interception sees every i18n request.
 */
const PORT = 4310;
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './e2e/textfit',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 180_000,
  reporter: process.env['CI'] ? [['github'], ['list']] : 'list',
  use: { baseURL: BASE_URL, locale: 'en-US', serviceWorkers: 'block' },
  projects: [
    { name: 'phone-360', use: { viewport: { width: 360, height: 640 }, hasTouch: true } },
    { name: 'desktop-1280', use: { viewport: { width: 1280, height: 800 } } },
  ],
  webServer: {
    command: `pnpm exec serve -s dist/web/browser -l tcp://127.0.0.1:${PORT} -n -L`,
    url: BASE_URL,
    reuseExistingServer: !process.env['CI'],
    timeout: 60_000,
  },
});
