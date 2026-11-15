import { defineConfig } from '@playwright/test';

/**
 * Mobile project: the same production build and static server as `playwright.config.ts`, driven as
 * a touch phone (390 x 844) through the core flows (create, play, level-up) plus `e2e/mobile/`, and
 * as a 1024 x 768 tablet for the sheet's "Combat | Spells & bag" sub-tabs. The specs shared with the
 * desktop suite switch on the viewport in their helpers (`e2e/helpers/viewport.ts`).
 */
const PORT = 4310;
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  reporter: process.env['CI'] ? [['github'], ['list']] : 'list',
  use: { baseURL: BASE_URL, locale: 'en-US', trace: 'retain-on-failure' },
  projects: [
    {
      name: 'phone-390',
      testMatch: [
        '**/create-fighter.spec.ts',
        '**/play-actions.spec.ts',
        '**/level-up.spec.ts',
        '**/mobile/tabs.spec.ts',
      ],
      use: {
        viewport: { width: 390, height: 844 },
        hasTouch: true,
        isMobile: true,
        deviceScaleFactor: 2,
      },
    },
    {
      name: 'tablet-1024',
      testMatch: ['**/mobile/tablet.spec.ts'],
      use: { viewport: { width: 1024, height: 768 }, hasTouch: true },
    },
  ],
  webServer: {
    command: `pnpm exec serve -s dist/web/browser -l tcp://127.0.0.1:${PORT} -n -L`,
    url: BASE_URL,
    reuseExistingServer: !process.env['CI'],
    timeout: 60_000,
  },
});
