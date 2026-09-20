import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import {
  applyBackgroundAbilities,
  createFighter,
  nameCharacter,
  pickBackground,
  pickClass,
  pickSpecies,
} from './helpers/create-fighter';
import { createWizard, prepareSpell } from './helpers/create-wizard';

const SERIOUS_IMPACTS = new Set(['serious', 'critical']);

/** Runs axe-core against the current page and fails on any serious/critical violation. */
async function assertNoSeriousViolations(page: Page, screen: string): Promise<void> {
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter((v) => SERIOUS_IMPACTS.has(v.impact ?? ''));
  expect(serious, `${screen}: ${JSON.stringify(serious, null, 2)}`).toEqual([]);
}

test.describe('accessibility (axe)', () => {
  test('home has no serious/critical violations', async ({ page }) => {
    await page.goto('/');
    await assertNoSeriousViolations(page, 'home');
  });

  test('library has no serious/critical violations', async ({ page }) => {
    await page.goto('/library');
    await expect(page.locator('.library-browse__row').first()).toBeVisible();
    await assertNoSeriousViolations(page, 'library');
  });

  test('a library detail has no serious/critical violations', async ({ page }) => {
    await page.goto('/library');
    await page.locator('.library-browse__row').first().click();
    await expect(page.locator('.library-detail__name')).toBeVisible();
    await assertNoSeriousViolations(page, 'library detail');
  });

  test('settings has no serious/critical violations', async ({ page }) => {
    await page.goto('/settings');
    await assertNoSeriousViolations(page, 'settings');
  });

  test('about has no serious/critical violations', async ({ page }) => {
    await page.goto('/about');
    await assertNoSeriousViolations(page, 'about');
  });

  // task-15-brief.md: extend the axe screens with the characters list, one wizard step (ability
  // scores — "the richest"), and the sheet's play/build/timeline tabs.

  test('the characters list has no serious/critical violations', async ({ page }) => {
    await page.goto('/characters');
    await assertNoSeriousViolations(page, 'characters list');
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
    await assertNoSeriousViolations(page, 'creation wizard — ability scores step');
  });

  test('the sheet play/build/timeline tabs have no serious/critical violations', async ({
    page,
  }) => {
    await createFighter(page, 'Aldric A11y Sheet');
    await expect(page.locator('.play-tab')).toBeVisible();
    await assertNoSeriousViolations(page, 'sheet — play tab');

    await page.getByRole('tab', { name: 'Build', exact: true }).click();
    await expect(page.locator('.build-tab')).toBeVisible();
    await assertNoSeriousViolations(page, 'sheet — build tab');

    await page.getByRole('tab', { name: 'Timeline', exact: true }).click();
    await expect(page.locator('.timeline-tab')).toBeVisible();
    await assertNoSeriousViolations(page, 'sheet — timeline tab');
  });

  // task-12-brief.md scenario (d): the new dialog states plan 6 adds (rest dialog open, cast
  // dialog open) plus the roll log with an actual entry logged (its default-expanded state, per
  // `SheetSectionComponent`'s own `collapsed = signal(false)` default — but empty/untouched
  // already goes unaudited by the play-tab check above, so this exercises it populated instead).

  test('the short-rest dialog (open) has no serious/critical violations', async ({ page }) => {
    await createFighter(page, 'Aldric A11y Rest');
    await page.getByRole('button', { name: 'Short rest', exact: true }).click();
    await expect(page.locator('.rest-dialog__title')).toBeVisible();
    await assertNoSeriousViolations(page, 'play tab — short-rest dialog open');
  });

  test('the cast dialog (open) has no serious/critical violations', async ({ page }) => {
    await createWizard(page, 'Aldric A11y Cast');
    await prepareSpell(page, 'Magic Missile');
    const preparedRow = page
      .locator('.play-tab__spellblock')
      .locator('li', { hasText: 'Magic Missile' })
      .filter({ has: page.getByRole('button', { name: 'Cast', exact: true }) });
    await preparedRow.getByRole('button', { name: 'Cast', exact: true }).click();
    await expect(page.locator('.cast-dialog__title')).toBeVisible();
    await assertNoSeriousViolations(page, 'play tab — cast dialog open');
  });

  test('the roll log with a logged entry has no serious/critical violations', async ({ page }) => {
    await createFighter(page, 'Aldric A11y Roll Log');
    await page
      .locator('.play-tab__ability')
      .first()
      .getByRole('button', { name: 'Roll check', exact: true })
      .click();
    await expect(page.locator('.roll-log-panel__entries .roll-log-panel__entry')).toHaveCount(1);
    await assertNoSeriousViolations(page, 'play tab — roll log with an entry');
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
    await assertNoSeriousViolations(page, 'login');
  });

  test('the register screen (form step) has no serious/critical violations', async ({ page }) => {
    await page.goto('/register');
    await expect(page.locator('.register__form')).toBeVisible();
    await assertNoSeriousViolations(page, 'register — form step');
  });

  test('the recover screen has no serious/critical violations', async ({ page }) => {
    await page.goto('/recover');
    await expect(page.locator('.recover__form')).toBeVisible();
    await assertNoSeriousViolations(page, 'recover');
  });
});
