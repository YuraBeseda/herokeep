import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

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
});
