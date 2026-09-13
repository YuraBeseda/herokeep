import { expect, test } from '@playwright/test';
import {
  applyBackgroundAbilities,
  assignStandardArray,
  equipGear,
  finishReviewAndCreate,
  nameCharacter,
  pickBackground,
  pickClass,
  pickFightingStyleAndWeaponMasteries,
  pickSkills,
  pickSpecies,
} from './helpers/create-fighter';

const CHARACTER_NAME = 'Aldric Golden Path';

test.describe('character creation — golden path', () => {
  // The binding creation path (task-15-brief.md's Global Constraints): drives the real UI
  // through fighter-1's exact decisions (mirrors `packages/engine/test/golden/fighter-1.json`)
  // and checks the resulting character sheet matches that same golden fixture's expectations —
  // AC 19, HP max 12, proficiency +2 (see the play-tab test.step below for why current HP is 0,
  // not 12). One continuous test (library.spec.ts's own pattern): each step's wizard state is
  // exactly the precondition the next step needs.
  test('drives species/background/class/abilities/skills/fighting-style/weapon-masteries/equipment to a complete review, creates the character, and the play tab shows AC 19, HP max 12, prof +2', async ({
    page,
  }) => {
    await test.step('name the character and pick a grammatical gender', async () => {
      await nameCharacter(page, CHARACTER_NAME);
      // Landed on the next (species) step.
      await expect(page.getByRole('button', { name: 'Human', exact: true })).toBeVisible();
    });

    await test.step('species: Human', async () => {
      await pickSpecies(page);
      await expect(page.getByRole('button', { name: 'Soldier', exact: true })).toBeVisible();
    });

    await test.step('background: Soldier', async () => {
      await pickBackground(page);
      await expect(page.locator('.abilities-improve-step')).toBeVisible();
    });

    await test.step('background ability bumps: +2 Strength, +1 Constitution', async () => {
      await applyBackgroundAbilities(page);
      await expect(page.getByRole('button', { name: 'Fighter', exact: true })).toBeVisible();
    });

    await test.step('class: Fighter', async () => {
      await pickClass(page);
      await expect(page.locator('.ability-scores-step')).toBeVisible();
    });

    await test.step('ability scores: standard array str15/dex13/con14/int10/wis12/cha8', async () => {
      await assignStandardArray(page);
      // Landed on the class-skills step (chips).
      await expect(page.locator('.choice-step__chips')).toBeVisible();
    });

    await test.step('skills: Athletics + Perception', async () => {
      await pickSkills(page);
    });

    await test.step('fighting style (Defense) and weapon masteries (freeform chips)', async () => {
      await pickFightingStyleAndWeaponMasteries(page);
      await expect(page.locator('.equipment-step')).toBeVisible();
    });

    await test.step('equipment: add + equip chain mail, longsword, shield', async () => {
      await equipGear(page);
      await expect(page.locator('.create-wizard__review')).toBeVisible();
    });

    let characterId = '';
    await test.step('review shows complete; create the character', async () => {
      characterId = await finishReviewAndCreate(page);
    });

    await test.step('play tab shows AC 19, HP max 12, and proficiency bonus +2', async () => {
      expect(characterId).not.toBe('');

      const statsSection = page.locator('.play-tab__stats');
      await expect(
        statsSection
          .locator('hk-stat-tile', { hasText: 'Armor Class' })
          .locator('.hk-stat-tile__value'),
      ).toHaveText('19');
      await expect(
        statsSection
          .locator('hk-stat-tile', { hasText: 'Proficiency bonus' })
          .locator('.hk-stat-tile__value'),
      ).toHaveText('+2');

      // `facts.hp.current` defaults to the literal `0`, not the `'max'` sentinel
      // (`reduce/facts.ts`'s `initialFacts`) — no creation-path handler
      // (`character.created`/`decision.made`/`level.gained`) ever sets it, so a freshly created
      // character legitimately shows current HP 0 until an explicit heal/rest/damage event. This
      // is documented, intentional behavior (`packages/engine/test/derive/hp.test.ts` covers the
      // clamp explicitly): task-10-report.md hit this exact "12/12" assumption in a unit test —
      // "renders fighter-1's hp max / AC / proficiency bonus straight off the store's sheet
      // (12/19/+2)" — and fixed the ASSERTION, not the component; same correction applied here.
      const hpSection = page.locator('.play-tab__hp-stats');
      await expect(
        hpSection.locator('hk-stat-tile', { hasText: 'Current' }).locator('.hk-stat-tile__value'),
      ).toHaveText('0');
      await expect(
        hpSection.locator('hk-stat-tile', { hasText: 'Max' }).locator('.hk-stat-tile__value'),
      ).toHaveText('12');
    });
  });
});
