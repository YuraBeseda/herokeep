import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { assertNoSeriousViolations } from './helpers/axe';
import {
  applyBackgroundAbilities,
  createFighter,
  nameCharacter,
  pickBackground,
  pickClass,
  pickSpecies,
} from './helpers/create-fighter';
import { createWizard, prepareSpell } from './helpers/create-wizard';
import { openDrawer } from './helpers/sheet';

const SAMPLE_PACK_FIXTURE = path.join(
  __dirname,
  '..',
  'src',
  'testing',
  'fixtures',
  'packs',
  'sample-content.json',
);

// Every scan runs on each theme: the stored theme is set before the app loads (ThemeService reads
// `hk.theme` at construction), so contrast is audited against each theme's tokens and textures.
for (const theme of ['tavern', 'scroll', 'plain']) {
  test.describe(`accessibility (axe) — ${theme} theme`, () => {
    test.beforeEach(async ({ page }) => {
      await page.addInitScript((id) => localStorage.setItem('hk.theme', id), theme);
    });

    // Proves the theme took effect, so a renamed key or attribute cannot silently scan the default theme.
    const scan = async (page: Page, name: string) => {
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await assertNoSeriousViolations(page, name);
    };

    test('home has no serious/critical violations', async ({ page }) => {
      await page.goto('/');
      await scan(page, 'home');
    });

    test('library has no serious/critical violations', async ({ page }) => {
      await page.goto('/library');
      await expect(page.locator('.library-browse__row').first()).toBeVisible();
      await scan(page, 'library');
    });

    test('a library detail has no serious/critical violations', async ({ page }) => {
      await page.goto('/library');
      await page.locator('.library-browse__row').first().click();
      await expect(page.locator('.library-detail__name')).toBeVisible();
      await scan(page, 'library detail');
    });

    test('settings has no serious/critical violations', async ({ page }) => {
      await page.goto('/settings');
      await scan(page, 'settings');
    });

    // Plan 15 Task 3: the packs screens (list, core-pack detail with its rendered attribution
    // links, and the import trust dialog — fresh and "already installed").

    test('the packs list has no serious/critical violations', async ({ page }) => {
      await page.goto('/packs');
      await expect(page.locator('.packs-list__title')).toBeVisible();
      await scan(page, 'packs list');
    });

    test('the core pack detail has no serious/critical violations', async ({ page }) => {
      await page.goto('/packs/srd-5e-2024@0.1.0');
      await expect(page.locator('.pack-info__attribution-body a').first()).toBeVisible();
      await scan(page, 'pack detail — core');
    });

    test('the pack trust dialog has no serious/critical violations', async ({ page }) => {
      // The sample content fixture as a bare pack.json: a bare JSON file cannot carry assets, so
      // the icon and its asset entry are dropped.
      const pack = JSON.parse(readFileSync(SAMPLE_PACK_FIXTURE, 'utf8')) as {
        entities: Record<string, unknown>[];
        assets: unknown[];
      };
      pack.assets = [];
      for (const entity of pack.entities) delete entity['icon'];
      const file = {
        name: 'pack.json',
        mimeType: 'application/json',
        buffer: Buffer.from(JSON.stringify(pack)),
      };

      await page.goto('/packs');
      await expect(page.locator('.packs-list__title')).toBeVisible();
      await page.locator('.packs-list__import-input').setInputFiles(file);
      await expect(page.locator('.pack-trust-dialog__title')).toBeVisible();
      await scan(page, 'pack trust dialog');

      await page.locator('.pack-trust-dialog__install').click();
      await expect(page.locator('.pack-trust-dialog__title')).toHaveCount(0);
      await expect(page.locator('.packs-list__content .packs-list__row')).toHaveCount(1);

      await page.locator('.packs-list__import-input').setInputFiles(file);
      await expect(page.locator('.pack-trust-dialog__installed')).toBeVisible();
      await scan(page, 'pack trust dialog — already installed');
    });

    test('about has no serious/critical violations', async ({ page }) => {
      await page.goto('/about');
      // /about redirects into Settings, About & licences (spec §2.1).
      await expect(page).toHaveURL(/\/settings#about$/);
      await expect(page.locator('#about')).toBeVisible();
      await scan(page, 'about');
    });

    // task-15-brief.md: extend the axe screens with the characters list, one wizard step (ability
    // scores — "the richest"), and the sheet's play/build/timeline tabs.

    test('the characters list has no serious/critical violations', async ({ page }) => {
      await page.goto('/characters');
      await scan(page, 'characters list');
    });

    test('the ability-scores creation-wizard step has no serious/critical violations', async ({
      page,
    }) => {
      await nameCharacter(page, 'Aldric A11y Wizard');
      await pickSpecies(page);
      await pickBackground(page);
      await applyBackgroundAbilities(page);
      await pickClass(page);
      await expect(page.locator('.ability-scores-step')).toBeVisible();
      await scan(page, 'creation wizard — ability scores step');
    });

    test('the sheet play/build/timeline tabs have no serious/critical violations', async ({
      page,
    }) => {
      await createFighter(page, 'Aldric A11y Sheet');
      await expect(page.locator('.play-tab')).toBeVisible();
      await scan(page, 'sheet — play tab');

      await page.getByRole('tab', { name: 'Build', exact: true }).click();
      await expect(page.locator('.build-tab')).toBeVisible();
      await scan(page, 'sheet — build tab');

      await page.getByRole('tab', { name: 'Timeline', exact: true }).click();
      await expect(page.locator('.timeline-tab')).toBeVisible();
      await scan(page, 'sheet — timeline tab');
    });

    // task-12-brief.md scenario (d): the new dialog states plan 6 adds (rest dialog open, cast
    // dialog open) plus the roll log with an actual entry logged (its default-expanded state, per
    // `SheetSectionComponent`'s own `collapsed = signal(false)` default — but empty/untouched
    // already goes unaudited by the play-tab check above, so this exercises it populated instead).

    test('the short-rest dialog (open) has no serious/critical violations', async ({ page }) => {
      await createFighter(page, 'Aldric A11y Rest');
      await page.locator('[data-action="short-rest"]').click();
      await expect(page.locator('.rest-dialog__title')).toBeVisible();
      await scan(page, 'play tab — short-rest dialog open');
    });

    test('the cast dialog (open) has no serious/critical violations', async ({ page }) => {
      await createWizard(page, 'Aldric A11y Cast');
      await prepareSpell(page, 'Magic Missile');
      const preparedRow = page.locator('.spells__prepared .spells__item', {
        hasText: 'Magic Missile',
      });
      await preparedRow.getByRole('button', { name: 'Cast Magic Missile', exact: true }).click();
      await expect(page.locator('.cast-dialog__title')).toBeVisible();
      await scan(page, 'play tab — cast dialog open');
    });

    test('the roll log with a logged entry has no serious/critical violations', async ({
      page,
    }) => {
      await createFighter(page, 'Aldric A11y Roll Log');
      await page
        .locator('app-abilities-leaf .abilities__item')
        .first()
        .getByRole('button', { name: /^Roll .* check$/ })
        .click();
      // The roll log is a drawer opened from the action strap (zone 3), board D02.
      await openDrawer(page, 'roll-log');
      await expect(page.locator('.roll-log-drawer__feed .roll-log-drawer__entry')).toHaveCount(1);
      await scan(page, 'play tab — roll log with an entry');
    });

    // task-11-brief.md / plan-8 design ruling R-pf3: the auth screens render fully OFFLINE (their
    // forms mount with no server round trip — only *submitting* them needs a reachable API), so
    // their axe coverage lives here, in the default (server-less) suite, alongside every other
    // screen above. The FUNCTIONAL auth flows (an actual register/login/recover round trip) belong
    // to the `sync` project instead (`e2e/sync/auth.spec.ts`), which is the one with a real API to
    // submit against.

    test('the login screen has no serious/critical violations', async ({ page }) => {
      await page.goto('/login');
      await expect(page.locator('.login__form')).toBeVisible();
      await scan(page, 'login');
    });

    test('the register screen (form step) has no serious/critical violations', async ({ page }) => {
      await page.goto('/register');
      await expect(page.locator('.register__form')).toBeVisible();
      await scan(page, 'register — form step');
    });

    test('the recover screen has no serious/critical violations', async ({ page }) => {
      await page.goto('/recover');
      await expect(page.locator('.recover__form')).toBeVisible();
      await scan(page, 'recover');
    });
  });
}
