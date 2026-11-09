import { expect, type Locator, type Page } from '@playwright/test';

/** The character sheet's tab bar: selects `tab` and waits for its panel. */
export async function openTab(page: Page, tab: 'Play' | 'Build' | 'Timeline'): Promise<void> {
  await page.getByRole('tab', { name: tab, exact: true }).click();
  await expect(page.locator(`.${tab.toLowerCase()}-tab`)).toBeVisible();
}

/** Opens the Play tab's "Add from library" dialog and searches it; returns the open dialog. The
 * picker lists the items of the character's own content index (its pinned packs). */
export async function searchLibrary(page: Page, search: string): Promise<Locator> {
  await page.getByRole('button', { name: 'Add from library', exact: true }).click();
  const dialog = page.locator('hk-dialog', { has: page.locator('.add-item-dialog__title') });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('searchbox').fill(search);
  return dialog;
}

/** The Play tab's "Add from library" dialog: search, then pick. Picking closes the dialog. */
export async function addFromLibrary(page: Page, search: string, item: string): Promise<void> {
  const dialog = await searchLibrary(page, search);
  await dialog
    .locator('.entity-picker__row')
    .filter({ has: page.locator('.entity-picker__name').getByText(item, { exact: true }) })
    .locator('.entity-picker__toggle')
    .click();
  await expect(page.locator('.add-item-dialog__title')).toHaveCount(0);
}
