import { expect, test } from '@playwright/test';
import {
  applyBackgroundAbilities,
  finishReviewAndCreate,
  nameCharacter,
  pickBackground,
  pickSpecies,
} from './helpers/create-fighter';

const CHARACTER_NAME = 'Lian Open Hand';

/**
 * Task 16 (phase 4 plan 12) — the offline slice-2 e2e: a Monk through the REAL creation wizard.
 *
 * Why Monk and not the brief's other option (level a fighter into Paladin at 3, picking Devotion):
 * that flow is not reachable with this suite's fighter fixture. Paladin's multiclass prerequisite
 * is STR 13 AND CHA 13 (`packages/content/src/overlays/paladin.json`'s note —
 * `transform/classes.ts` MULTICLASS_PREREQUISITES), and `create-fighter.ts`'s standard array leaves
 * the fighter at CHA 8, so "Multiclass into Paladin" is never offered by the which-class picker.
 * Changing the shared fighter fixture's array would perturb every other spec. The Monk path instead
 * exercises a brand-new overlay class end to end through the real wizard: the class card, its
 * six-skill pool (`skillChoice` replacing the placeholder from `transformClasses`), NO
 * weapon-mastery / fighting-style choice (the wizard must flow straight from skills to equipment),
 * and the new `ac.formula` Unarmored Defense (10 + DEX mod + WIS mod) feeding the derived AC.
 *
 * Scores: standard array Str8 Dex15 Con13 Int10 Wis14 Cha12, plus the Soldier's +2 Str / +1 Con
 * (`applyBackgroundAbilities`) = Str10 Dex15 Con14 Int10 Wis14 Cha12 -> AC 10 + 2 + 2 = 14,
 * HP 8 (d8) + 2 (Con) = 10, proficiency +2. No armor/shield is equipped (Unarmored Defense).
 */
test.describe('character creation — Monk (slice 2)', () => {
  test('creates a Monk through the wizard; the play tab shows Unarmored Defense AC 14, HP 10/10, prof +2', async ({
    page,
  }) => {
    await test.step('name, species, background, background ability bumps', async () => {
      await nameCharacter(page, CHARACTER_NAME);
      await pickSpecies(page);
      await pickBackground(page);
      await applyBackgroundAbilities(page);
      await expect(page.getByRole('button', { name: 'Monk', exact: true })).toBeVisible();
    });

    await test.step('class: Monk', async () => {
      await page.getByRole('button', { name: 'Monk', exact: true }).click();
      await expect(page.locator('.ability-scores-step')).toBeVisible();
    });

    await test.step('ability scores: standard array str8/dex15/con13/int10/wis14/cha12', async () => {
      await page.getByRole('tab', { name: 'Standard array', exact: true }).click();
      const scores: ReadonlyMap<string, string> = new Map([
        ['Strength', '8'],
        ['Dexterity', '15'],
        ['Constitution', '13'],
        ['Intelligence', '10'],
        ['Wisdom', '14'],
        ['Charisma', '12'],
      ]);
      for (const [ability, score] of scores) {
        const row = page.locator('.ability-scores-step__row', { hasText: ability });
        await row.locator('select').selectOption({ label: score });
      }
      await expect(page.locator('.choice-step__chips')).toBeVisible();
    });

    await test.step("class skills: Monk's own pool (Acrobatics + Stealth)", async () => {
      await page.getByRole('button', { name: 'Acrobatics', exact: true }).click();
      await page.getByRole('button', { name: 'Stealth', exact: true }).click();
      // No weapon-mastery / fighting-style choice for Monk: straight on to equipment.
      await expect(page.locator('.equipment-step')).toBeVisible();
    });

    await test.step('equipment: nothing equipped (unarmored); review is complete; create', async () => {
      await page.locator('.create-wizard__next').click();
      await expect(page.locator('.create-wizard__review')).toBeVisible();
      await finishReviewAndCreate(page);
    });

    await test.step('the sheet names the class; play tab shows AC 14, HP 10/10, prof +2', async () => {
      await expect(page.locator('.sheet-shell__class-line')).toHaveText('Monk 1');
      const statsSection = page.locator('.play-tab__stats');
      await expect(
        statsSection
          .locator('hk-stat-tile', { hasText: 'Armor Class' })
          .locator('.hk-stat-tile__value'),
      ).toHaveText('14');
      await expect(
        statsSection
          .locator('hk-stat-tile', { hasText: 'Proficiency bonus' })
          .locator('.hk-stat-tile__value'),
      ).toHaveText('+2');
      const hpSection = page.locator('.play-tab__hp-stats');
      await expect(
        hpSection.locator('hk-stat-tile', { hasText: 'Current' }).locator('.hk-stat-tile__value'),
      ).toHaveText('10');
      await expect(
        hpSection.locator('hk-stat-tile', { hasText: 'Max' }).locator('.hk-stat-tile__value'),
      ).toHaveText('10');
    });
  });
});
