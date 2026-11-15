import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { createFighter } from '../helpers/create-fighter';
import { importPack } from '../helpers/packs';
import { measureOverflow } from './measure';

// Every offline-reachable route of the audit's screen table, rendered with the `fit` locale (the
// longest of en/ru/uk per key — `scripts/build-fit-locale.mjs`) at the project's viewport. The `en`
// i18n files are swapped for the generated ones by request interception, so the app needs no
// harness-only locale and nothing about it shows in the language picker.
const FIT_DIR = join(__dirname, '../../.fit-locale');
const I18N_EN = /\/assets\/i18n\/(.+\/)?en\.json$/;
const SAMPLE_PACK = join(__dirname, '../fixtures/packs/sample-content.hkpack');

const STATIC_ROUTES = [
  '/',
  '/about',
  '/characters',
  '/characters/new',
  '/library',
  '/library/srd-5e-2024:spell%2Fdelayed-blast-fireball',
  '/library/srd-5e-2024:class%2Ffighter',
  '/packs',
  '/packs/srd-5e-2024@0.1.0',
  '/packs/homebrew',
  '/packs/homebrew/new/item',
  '/packs/homebrew/new/spell',
  '/packs/homebrew/new/feat',
  '/packs/homebrew/new/species',
  '/settings',
  '/login',
  '/register',
  '/recover',
];
const SHEET_TABS = ['play', 'combat', 'spells', 'bag', 'hero', 'more', 'build', 'timeline'];

test('every route fits at this width', async ({ page }) => {
  const violations: string[] = [];
  const check = async (name: string): Promise<void> => {
    await page.waitForLoadState('networkidle');
    for (const line of await measureOverflow(page)) violations.push(`${name}: ${line}`);
  };
  const visit = async (path: string): Promise<void> => {
    await page.goto(path);
    await check(path);
  };

  // The seeding helpers drive the desktop layout (a phone lands on a different tab after creation).
  const viewport = page.viewportSize() ?? { width: 1280, height: 800 };
  await page.setViewportSize({ width: 1280, height: 800 });
  const id = await createFighter(page, 'Aldric Fit');
  await page.locator('.sheet-shell__xp-field input').fill('300');
  await page.locator('.sheet-shell__xp-submit').click();
  await expect(page.locator('.sheet-shell__level-up-badge')).toBeVisible();

  await page.setViewportSize(viewport);

  // Only now: the seeding helpers click English labels, the visits below read the fit strings.
  await page.route(I18N_EN, async (route) => {
    const rel = new URL(route.request().url()).pathname.replace(/^.*\/assets\/i18n\//, '');
    await route.fulfill({
      contentType: 'application/json',
      body: readFileSync(join(FIT_DIR, rel)),
    });
  });

  for (const tab of SHEET_TABS) await visit(`/c/${id}/${tab}`);
  await visit(`/c/${id}/level-up`);
  for (const path of STATIC_ROUTES) await visit(path);

  const dialog = await importPack(page, SAMPLE_PACK);
  await check('/packs (trust dialog)');
  await expect(dialog).toBeVisible();

  expect(violations, violations.join('\n')).toEqual([]);
});
