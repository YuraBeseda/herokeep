import { expect, type Locator, type Page } from '@playwright/test';
import { isPhone, openPhoneTab } from './viewport';

/** The character sheet's tab bar: selects `tab` and waits for its panel. */
export async function openTab(page: Page, tab: 'Play' | 'Build' | 'Timeline'): Promise<void> {
  if (isPhone(page)) {
    // The phone has no Play/Build/Timeline tabs: Play is Combat, the others sit behind More.
    if (tab === 'Play') return openPhoneTab(page, 'Combat');
    await openPhoneTab(page, 'More');
    await page.locator(`.more__${tab.toLowerCase()}`).click();
    await expect(page.locator(`.${tab.toLowerCase()}-tab`)).toBeVisible();
    return;
  }
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

/** Clicks a strap action; on a phone the secondary ones sit in the strap's More sheet. */
export async function clickStrapAction(page: Page, id: string): Promise<void> {
  const action = strapAction(page, id);
  if (isPhone(page) && (await action.count()) === 0) {
    await page.locator('.hk-astrap__more').click();
  }
  await action.click();
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

/** The focusable control of a bag row: the satchel slot (desktop) or the ledger row's select
 * button (phone). Opens the phone Bag tab first. */
export async function bagRow(page: Page, name: string): Promise<Locator> {
  if (!isPhone(page)) return bagSlot(page, name).first();
  await openPhoneTab(page, 'Bag');
  return page.locator('.bag__ledger li').filter({ hasText: name }).locator('.hk-item__select');
}

/** Selects an item in the satchel and returns its action strip. */
export async function selectBagItem(page: Page, name: string): Promise<Locator> {
  const slot = bagSlot(page, name).first();
  if ((await slot.getAttribute('aria-pressed')) !== 'true') await slot.click();
  const actions = page.locator('.bag__actions');
  await expect(actions).toBeVisible();
  return actions;
}

// --- Drawers and play dialogs (plan 17 B9b) --------------------------------------------------------

/** Opens a sheet drawer from its action-strap button and returns the drawer panel. */
export async function openDrawer(page: Page, action: 'notes' | 'roll-log'): Promise<Locator> {
  await page.locator(`[data-action="${action}"]`).click();
  const drawer = page.locator('.hk-drawer__panel');
  await expect(drawer).toBeVisible();
  return drawer;
}

/** Closes the open sheet drawer with Escape (its scrim sits over the strap, so the opener cannot be clicked). */
export async function closeDrawer(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await expect(page.locator('.hk-drawer__panel')).toHaveCount(0);
}

/** Chooses the cast dialog's slot lane by its spell level (a regular slot lane, never the pact or free lane). */
export async function chooseCastSlotLane(page: Page, level: number): Promise<void> {
  await page
    .locator('.cast-dialog__lane[data-kind="slot"]', { hasText: `Level ${level} (` })
    .click();
}

/** Chooses the cast dialog's pact slot lane. */
export async function chooseCastPactLane(page: Page): Promise<void> {
  await page.locator('.cast-dialog__lane[data-kind="pact"]').click();
}

// --- Viewport-aware sheet chrome (plan 17 B15a) -----------------------------------------------------

/** The entry to the level-up flow: the folio badge on tablet/desktop, the More tab's row on a phone
 * (which opens More first when the player is not already there). */
export async function levelUpLink(page: Page): Promise<Locator> {
  if (!isPhone(page)) return page.locator('.sheet-shell__level-up-badge');
  if (!page.url().endsWith('/more')) await openPhoneTab(page, 'More');
  return page.locator('.more__level-up');
}

/** Awards XP through the folio's award field (the same control at every width). */
export async function awardXp(page: Page, xp: number): Promise<void> {
  await page.locator('.sheet-shell__xp-field input').fill(String(xp));
  await page.locator('.sheet-shell__xp-submit').click();
}
