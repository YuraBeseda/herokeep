import { expect, test } from '@playwright/test';
import { createFighter } from '../helpers/create-fighter';

test('tablet (1024 px): the Play tab splits into Combat and Spells & bag sub-tabs', async ({
  page,
}) => {
  await createFighter(page, 'Aldric Tablet');
  const tabs = page.getByRole('tablist', { name: 'Play sheet sections' });
  const combat = tabs.getByRole('tab', { name: 'Combat', exact: true });
  const spellsBag = tabs.getByRole('tab', { name: 'Spells & bag', exact: true });

  await expect(combat).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('app-attacks-leaf')).toBeVisible();
  await expect(page.locator('app-bag-leaf')).toBeHidden();

  await spellsBag.click();
  await expect(spellsBag).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('app-bag-leaf')).toBeVisible();
  await expect(page.locator('app-attacks-leaf')).toBeHidden();

  await combat.click();
  await expect(page.locator('app-attacks-leaf')).toBeVisible();
});

test('desktop width (1280 px) shows both columns and no sub-tabs', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await createFighter(page, 'Aldric Wide');
  await expect(page.getByRole('tablist', { name: 'Play sheet sections' })).toBeHidden();
  await expect(page.locator('app-attacks-leaf')).toBeVisible();
  await expect(page.locator('app-bag-leaf')).toBeVisible();
});
