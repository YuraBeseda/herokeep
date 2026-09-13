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
});
