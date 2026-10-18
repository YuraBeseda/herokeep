import { expect, test, type Page } from '@playwright/test';
import {
  applyBackgroundAbilities,
  finishReviewAndCreate,
  nameCharacter,
  pickBackground,
  pickSpecies,
} from './helpers/create-fighter';

const CHARACTER_NAME = 'Vessa Quickfingers';

/**
 * A Rogue through the REAL creation wizard (offline), exercising the expertise pick end to end
 * (`srd-5e-2024:class/rogue@1/expertise`, pick
 * `{query:{type:'skill'}, proficiency:'expertise', requireProficient:true}`, count 2 —
 * `packages/content/src/overlays/rogue.json`), the wizard's step order (Weapon Masteries follows
 * Expertise directly once Expertise resolves) and the tool proficiency rows (Rogue's fixed
 * `toolProficiencies: ['thieves-tools']` lands in `sheet.proficiencies` as a `kind:'tool'` row, which
 * the play tab's Proficiencies section lists under "Tools").
 *
 * The expertise pick's options come from the engine's `queryPickOptions`: only skills the
 * draft character is ALREADY proficient in are offered — the 4 rogue class picks below plus the
 * Soldier's fixed Athletics and Intimidation. Perception sits in the rogue pool but is not picked
 * here, and Arcana is outside it, so neither may appear as an expertise option.
 *
 * Scores: standard array Str8 Dex15 Con13 Int12 Wis10 Cha14, plus the Soldier's +2 Str / +1 Con
 * (`applyBackgroundAbilities`) = Str10 Dex15 Con14 Int12 Wis10 Cha14. Proficiency bonus +2 at level 1.
 * Stealth (DEX, expertise) = DEX mod +2 + 2 × prof 2 = +6; Acrobatics (DEX, proficient only) = +4.
 */

const DEX_MOD = 2;
const PROFICIENCY_BONUS = 2;
const EXPERTISE_TOTAL = `+${DEX_MOD + 2 * PROFICIENCY_BONUS}`;
const PROFICIENT_TOTAL = `+${DEX_MOD + PROFICIENCY_BONUS}`;

const CLASS_SKILLS: readonly string[] = ['Acrobatics', 'Deception', 'Sleight of Hand', 'Stealth'];
const PROFICIENT_SKILLS: readonly string[] = [
  ...CLASS_SKILLS,
  // The Soldier background's fixed skill proficiencies.
  'Athletics',
  'Intimidation',
];
const EXPERTISE_PICKS: readonly string[] = ['Stealth', 'Sleight of Hand'];
const WEAPON_MASTERY_PICKS: readonly string[] = ['Dagger', 'Shortsword'];
const EXPERTISE_TITLE = 'Expertise: choose two of your skill proficiencies';
const WEAPON_MASTERIES_TITLE = 'Weapon Masteries';

/** Clicks each named card, then waits for the last one to leave the DOM (the step resolved and
 * the view moved on) — the same detached-wait `create-fighter.ts`'s
 * `pickFightingStyleAndWeaponMasteries` uses (see that helper's doc for the re-home race it closes). */
async function pickCards(page: Page, names: readonly string[]): Promise<void> {
  for (const name of names) {
    await page.getByRole('button', { name, exact: true }).click();
  }
  await page
    .getByRole('button', { name: names[names.length - 1], exact: true })
    .waitFor({ state: 'detached' });
}

test.describe('character creation — Rogue with Expertise (slice 3)', () => {
  test('creates a Rogue; Expertise offers only proficient skills and doubles the bonus; Thieves’ Tools is listed', async ({
    page,
  }) => {
    await test.step('name, species, background, background ability bumps', async () => {
      await nameCharacter(page, CHARACTER_NAME);
      await pickSpecies(page);
      await pickBackground(page);
      await applyBackgroundAbilities(page);
      await expect(page.getByRole('button', { name: 'Rogue', exact: true })).toBeVisible();
    });

    await test.step('class: Rogue', async () => {
      await page.getByRole('button', { name: 'Rogue', exact: true }).click();
      await expect(page.locator('.ability-scores-step')).toBeVisible();
    });

    await test.step('ability scores: standard array str8/dex15/con13/int12/wis10/cha14', async () => {
      await page.getByRole('tab', { name: 'Standard array', exact: true }).click();
      const scores: ReadonlyMap<string, string> = new Map([
        ['Strength', '8'],
        ['Dexterity', '15'],
        ['Constitution', '13'],
        ['Intelligence', '12'],
        ['Wisdom', '10'],
        ['Charisma', '14'],
      ]);
      for (const [ability, score] of scores) {
        const row = page.locator('.ability-scores-step__row', { hasText: ability });
        await row.locator('select').selectOption({ label: score });
      }
      await expect(page.locator('.choice-step__chips')).toBeVisible();
    });

    await test.step('class skills: four from the rogue pool', async () => {
      for (const skill of CLASS_SKILLS) {
        await page.getByRole('button', { name: skill, exact: true }).click();
      }
      // The skills chips step resolves on the 4th pick and auto-advances; the next step renders
      // entity-picker cards whose names repeat these skills, so wait on the chips container.
      await expect(page.locator('.choice-step__chips')).toHaveCount(0);
    });

    await test.step('Expertise: only proficient skills are offered; pick Stealth + Sleight of Hand', async () => {
      await expect(page.locator('.choice-step__title')).toHaveText(EXPERTISE_TITLE);
      const offered = page.locator('.entity-picker__name');
      await expect(offered).toHaveCount(PROFICIENT_SKILLS.length);
      expect((await offered.allTextContents()).map((s) => s.trim()).sort()).toEqual(
        [...PROFICIENT_SKILLS].sort(),
      );
      // In the rogue pool but not picked (Perception) / outside the pool (Arcana): not offered.
      await expect(page.getByRole('button', { name: 'Perception', exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Arcana', exact: true })).toHaveCount(0);
      await pickCards(page, EXPERTISE_PICKS);
    });

    await test.step('weapon masteries: Dagger + Shortsword (directly after Expertise)', async () => {
      // Expertise is a count-2 pick committed per toggle: after its first toggle it is
      // decided-but-invalid, and it must keep its choice-id-sorted step slot so that resolving it
      // re-homes the wizard onto the still-outstanding Weapon Masteries step, not past it.
      await expect(page.locator('.choice-step__title')).toHaveText(WEAPON_MASTERIES_TITLE);
      await expect(page.locator('.equipment-step')).toHaveCount(0);
      await pickCards(page, WEAPON_MASTERY_PICKS);
      await expect(page.locator('.equipment-step')).toBeVisible();
    });

    await test.step('equipment: nothing equipped; review is complete; create', async () => {
      await page.locator('.create-wizard__next').click();
      await expect(page.locator('.create-wizard__review')).toBeVisible();
      await finishReviewAndCreate(page);
    });

    await test.step('the sheet: expertise skills doubled, proficient skill single', async () => {
      await expect(page.locator('.sheet-shell__class-line')).toHaveText('Rogue 1');
      for (const skill of EXPERTISE_PICKS) {
        const row = page.locator('.play-tab__skill', {
          has: page.locator('.play-tab__skill-name', { hasText: new RegExp(`^${skill}$`) }),
        });
        await expect(row).toContainText('Expertise');
        await expect(row.locator('.play-tab__skill-total')).toHaveText(EXPERTISE_TOTAL);
      }
      const acrobatics = page.locator('.play-tab__skill', {
        has: page.locator('.play-tab__skill-name', { hasText: /^Acrobatics$/ }),
      });
      await expect(acrobatics).toContainText('Proficient');
      await expect(acrobatics.locator('.play-tab__skill-total')).toHaveText(PROFICIENT_TOTAL);
    });

    await test.step("the sheet: Thieves' Tools under Tools", async () => {
      await expect(page.locator('.play-tab__tools li', { hasText: "Thieves' Tools" })).toHaveCount(
        1,
      );
    });
  });
});
