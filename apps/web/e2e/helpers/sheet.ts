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

// --- Locators of the redesigned sheet (plan 17 B9a) -----------------------------------------------

/** Current HP, as the HP gauge's big numeral (the vitals leaf in the folio). */
export function hpCurrent(page: Page): Locator {
  return page.locator('.hk-hp-gauge__current');
}

/** Maximum HP (the vitals leaf's "Max" tile). */
export function hpMax(page: Page): Locator {
  return page.locator('.vitals__max .hk-stat-tile__value');
}

/** Armor class, the number on the AC shield. */
export function acValue(page: Page): Locator {
  return page.locator('hk-shield-badge .hk-shield-num');
}

/** The proficiency bonus tile's value. */
export function profBonus(page: Page): Locator {
  return page.locator('.vitals__prof .hk-stat-tile__value');
}

/** A button of the action strap (zone 2 or 3), by its action id (`data-action`). */
export function strapAction(page: Page, id: string): Locator {
  return page.locator(`[data-action="${id}"]`);
}

/** Types an HP amount into the gauge and presses its Damage / Heal button. */
export async function applyHp(
  page: Page,
  amount: number,
  action: 'Damage' | 'Heal',
): Promise<void> {
  await page.locator('.hk-hp-gauge__amount').fill(String(amount));
  await page.locator('hk-hp-gauge').getByRole('button', { name: action, exact: true }).click();
}

/** The satchel slot (desktop) of an item, by the start of its name. */
export function bagSlot(page: Page, name: string): Locator {
  return page.locator('.hk-slot').filter({ has: page.locator('.hk-slot__cap', { hasText: name }) });
}

/** Selects an item in the satchel and returns its action strip. */
export async function selectBagItem(page: Page, name: string): Promise<Locator> {
  const slot = bagSlot(page, name).first();
  if ((await slot.getAttribute('aria-pressed')) !== 'true') await slot.click();
  const actions = page.locator('.bag__actions');
  await expect(actions).toBeVisible();
  return actions;
}
