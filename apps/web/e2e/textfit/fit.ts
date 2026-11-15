import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, type Page } from '@playwright/test';
import { measureOverflow } from './measure';

// The `fit` locale (the longest of en/ru/uk per key, `scripts/build-fit-locale.mjs`) is served by
// swapping the `en` i18n files by request interception, so the app needs no harness-only locale and
// nothing about it shows in the language picker. Install it only AFTER seeding: the seeding helpers
// click English labels.
const FIT_DIR = join(__dirname, '../../.fit-locale');
const I18N_EN = /\/assets\/i18n\/(.+\/)?en\.json$/;

export async function installFitLocale(page: Page): Promise<void> {
  await page.route(I18N_EN, async (route) => {
    const rel = new URL(route.request().url()).pathname.replace(/^.*\/assets\/i18n\//, '');
    await route.fulfill({
      contentType: 'application/json',
      body: readFileSync(join(FIT_DIR, rel)),
    });
  });
}

/**
 * One `test.step` per screen: `check(name, action)` runs the action (navigate, open a dialog),
 * measures, and records every overflow as `name: line`. A throwing action is recorded against its
 * own name too, so one broken screen neither hides the others nor goes unnamed. The caller asserts
 * `violations` is empty at the end.
 */
export function fitChecker(page: Page): {
  violations: string[];
  check: (name: string, action?: () => Promise<unknown>) => Promise<void>;
  visit: (path: string) => Promise<void>;
} {
  const violations: string[] = [];
  const at = (): string => `${page.viewportSize()?.width}px`;
  const check = (name: string, action?: () => Promise<unknown>): Promise<void> =>
    test.step(name, async () => {
      try {
        await action?.();
        await page.waitForLoadState('networkidle');
        for (const line of await measureOverflow(page)) violations.push(`${at()} ${name}: ${line}`);
      } catch (error) {
        violations.push(`${at()} ${name}: threw ${String(error).split('\n')[0]}`);
      }
    });
  return { violations, check, visit: (path) => check(path, () => page.goto(path)) };
}
