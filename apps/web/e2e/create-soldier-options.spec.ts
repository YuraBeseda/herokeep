import { expect, test, type Page } from '@playwright/test';
import {
  applyBackgroundAbilities,
  assignStandardArray,
  finishReviewAndCreate,
  nameCharacter,
  pickBackground,
  pickClass,
  pickFightingStyleAndWeaponMasteries,
  pickGamingSet,
  pickSkills,
  pickSpecies,
} from './helpers/create-fighter';

const CHARACTER_NAME = 'Aldric Card Sharp';
const GAMING_SET = 'Gaming Set, Playing Cards';

/** The equipment step for this spec: the fighter-1 kit (Chain Mail 55 lb + Longsword 3 lb + Shield
 * 6 lb, all equipped — the same search-then-add pattern as `equipGear`) plus an UNEQUIPPED Plate
 * Armor (65 lb), so the load is 129 lb. With STR 17 (15 + Soldier's +2) that load discriminates the
 * two encumbrance modes (pack `system.encumbrance`): `standard` — capacity 17 × 15 = 255 → Normal;
 * `variant` — 129 ≥ 17 × 5 = 85 and < 17 × 10 = 170 → Encumbered, Speed −10 ft. Clicks Next to
 * Review ('equipment' never leaves `steps()`, see the helper module's doc). */
async function equipKitWithSpareArmor(page: Page): Promise<void> {
  const searchBox = page.getByRole('searchbox');
  for (const item of ['Chain Mail', 'Longsword', 'Shield', 'Plate Armor']) {
    await searchBox.fill(item);
    await page.getByRole('button', { name: item, exact: true }).click();
  }
  await searchBox.fill('');
  for (const item of ['Chain Mail', 'Longsword', 'Shield']) {
    const row = page.locator('.equipment-step__entry', { hasText: item });
    await row.getByRole('button', { name: 'Equip', exact: true }).click();
  }
  await page.locator('.create-wizard__next').click();
}

test.describe('character creation — Soldier gaming set + per-character encumbrance option', () => {
  // Plan 14 (phase 4 slice 4) task 8. Two slice-4 carries through the REAL UI, one continuous test:
  // (1) task 2 — the Soldier background's "Choose one kind of Gaming Set" is a real wizard pick
  //     (`background/soldier@0/tools`), and the chosen set (not a generic "gaming-set" row) is
  //     what the play tab's Tools list shows;
  // (2) task 5 — the Build tab's Rule options select records `character.options.set@1`
  //     {encumbrance: 'variant'}, and the play tab's carry line appears (it is absent while the
  //     mode is the default `off`) with the variant tier the load puts the character in.
  test('picks Playing Cards in the wizard, the play tab lists it under Tools, and switching encumbrance to Variant in the Build tab shows the Encumbered carry state on the play tab', async ({
    page,
  }) => {
    await test.step('wizard: human soldier fighter through the gaming-set pick', async () => {
      await nameCharacter(page, CHARACTER_NAME);
      await pickSpecies(page);
      await pickBackground(page);
      await applyBackgroundAbilities(page);
      await pickClass(page);
      await assignStandardArray(page);
      await pickSkills(page);
      // The step right after class skills is the Soldier tool pick: its four Gaming Set cards.
      await expect(page.locator('.entity-picker__select')).toHaveCount(4);
      await pickGamingSet(page, GAMING_SET);
      await pickFightingStyleAndWeaponMasteries(page);
      await expect(page.locator('.equipment-step')).toBeVisible();
    });

    await test.step('equipment: fighter kit equipped plus a spare Plate Armor; create', async () => {
      await equipKitWithSpareArmor(page);
      await expect(page.locator('.create-wizard__review')).toBeVisible();
      await finishReviewAndCreate(page);
    });

    await test.step('play tab: Tools lists exactly the chosen gaming set; no carry line yet', async () => {
      await expect(page.locator('.play-tab__tools li')).toHaveText([GAMING_SET]);
      // Encumbrance defaults to `off` (no campaign, no character option) → no carry summary.
      await expect(page.locator('.play-tab__inventory-total-weight')).toBeVisible();
      await expect(page.locator('.play-tab__inventory-carry')).toHaveCount(0);
    });

    await test.step('build tab: Rule options → Encumbrance → Variant', async () => {
      await page.getByRole('tab', { name: 'Build', exact: true }).click();
      const select = page.getByLabel('Encumbrance', { exact: true });
      await expect(select).toBeEnabled();
      await expect(select).toHaveValue('off');
      await select.selectOption('variant');
      await expect(select).toHaveValue('variant');
      // No campaign → no house-rule reason.
      await expect(page.locator('.build-tab__options-reason')).toHaveCount(0);
    });

    await test.step('play tab: carry line shows 129 / 255 lb, Encumbered, Speed −10 ft.', async () => {
      await page.getByRole('tab', { name: 'Play', exact: true }).click();
      const carry = page.locator('.play-tab__inventory-carry');
      await expect(carry.locator('.play-tab__inventory-carry-summary')).toHaveText(
        '129 / 255 lb carried',
      );
      await expect(carry.locator('.play-tab__inventory-carry-state')).toHaveText('Encumbered');
      await expect(carry.locator('.play-tab__inventory-carry-penalty')).toHaveText('Speed −10 ft.');
    });
  });
});
