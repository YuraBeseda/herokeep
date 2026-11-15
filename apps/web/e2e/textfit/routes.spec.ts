import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { createFighter } from '../helpers/create-fighter';
import { importPack } from '../helpers/packs';
import { createWizard, prepareSpell } from '../helpers/create-wizard';
import { fitChecker, installFitLocale } from './fit';

// Every offline-reachable route of the audit's screen table, plus the sheet's dialogs and drawer and
// the homebrew edit form, rendered with the `fit` locale (see `fit.ts`) at the project's viewport.
// Campaign screens need an account and a server: `e2e/sync/textfit.spec.ts` covers them.
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

/** Opens a strap action: a tile (or icon button) on the strap, or an entry of the phone "More" sheet. */
async function openStrapAction(page: Page, id: string): Promise<void> {
  const direct = page.locator(`.hk-astrap__zone [data-action="${id}"]`);
  if (!(await direct.count())) {
    await page.locator('.hk-astrap__more').click();
    await page.locator(`.hk-astrap__sheet [data-action="${id}"]`).click();
  } else {
    await direct.click();
  }
}

test('every route fits at this width', async ({ page }) => {
  const { violations, check, visit } = fitChecker(page);

  // The seeding helpers drive the desktop layout (a phone lands on a different tab after creation).
  const viewport = page.viewportSize() ?? { width: 1280, height: 800 };
  await page.setViewportSize({ width: 1280, height: 800 });
  const id = await createFighter(page, 'Aldric Fit');
  await page.locator('.sheet-shell__xp-field input').fill('300');
  await page.locator('.sheet-shell__xp-submit').click();
  await expect(page.locator('.sheet-shell__level-up-badge')).toBeVisible();
  const wizardId = await createWizard(page, 'Mira Fit');
  await prepareSpell(page, 'Magic Missile');
  await page.goto('/packs/homebrew');
  await page.locator('.hb-list__new-link[data-type="item"]').click();
  await page.locator('.hb-form__name input').fill('Starlit Lantern');
  await page.locator('[data-action="save-entry"]').click();
  await expect(page).toHaveURL(/\/packs\/homebrew$/);
  const editPath = await page.locator('.hb-list__edit').first().getAttribute('href');

  await page.setViewportSize(viewport);
  await installFitLocale(page);

  for (const tab of SHEET_TABS) await visit(`/c/${id}/${tab}`);
  await visit(`/c/${id}/level-up`);
  for (const path of STATIC_ROUTES) await visit(path);
  await visit(editPath ?? '/packs/homebrew/edit/item/starlit-lantern');

  // Dialogs and the notes drawer, from the seeded sheets.
  const phone = viewport.width < 600;
  await visit(`/c/${id}/${phone ? 'combat' : 'play'}`);
  for (const [name, action, dialog] of [
    ['short rest dialog', 'short-rest', 'hk-dialog'],
    ['long rest dialog', 'long-rest', 'hk-dialog'],
    ['condition dialog', 'add-condition', 'hk-dialog'],
    ['notes drawer', 'notes', '.hk-drawer__panel'],
  ] as const) {
    await check(name, async () => {
      await openStrapAction(page, action);
      await expect(page.locator(`${dialog} >> visible=true`).first()).toBeVisible();
    });
    await page.keyboard.press('Escape');
  }
  await visit(`/c/${wizardId}/${phone ? 'spells' : 'play'}`);
  await check('cast dialog', async () => {
    await page.locator('.spells__prepared hk-spell-row button').first().click();
    await expect(page.locator('.cast-dialog__title')).toBeVisible();
  });
  await page.keyboard.press('Escape');

  const dialog = await importPack(page, SAMPLE_PACK);
  await check('/packs (trust dialog)', () => expect(dialog).toBeVisible());

  expect(violations, violations.join('\n')).toEqual([]);
});
