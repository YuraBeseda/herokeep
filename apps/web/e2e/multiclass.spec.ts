import { expect, test } from '@playwright/test';
import { createFighter } from './helpers/create-fighter';

const CHARACTER_NAME = 'Aldric Multiclass';

/**
 * Task 14 (phase 4 plan 11) — the offline multiclass e2e (task-14-brief.md). Task 12 (ADR-007)
 * added a "which class?" picker to `/c/:id/level-up` whenever `CharacterStore.advancements()`
 * offers more than one option — every OTHER level-up-driving spec in this suite deliberately keeps
 * leveling its own class (`helpers/level-up.ts`'s `chooseOwnClassIfPrompted`); this is the one spec
 * that walks the OTHER branch, picking "Multiclass into Barbarian" instead. Fighter-1's own ability
 * scores (str15/dex13/con14/int10/wis12/cha8 — `helpers/create-fighter.ts`) clear Barbarian's own
 * STR13 multiclass gate (`packages/content/src/overlays/barbarian.json`), alongside Rogue's DEX13
 * gate (not exercised here — Barbarian's simpler, single-mechanic level-1 choice shape makes a
 * cleaner net, and is the exact class `level-up.component.ts`'s own fix-round-1 doc cites as the
 * reviewer's real-pack repro for the HIGH finding that this picker's `reHomeActiveStep` divergence
 * fixed).
 *
 * A brand-new class's level 1 never asks for HP (`Advancement.hpChoice` is always `false` for an
 * `isNewClass` pick — `level-up.state.ts`'s own `steps()` doc). Plan 12 final wave W1 wired
 * `multiclass.gains.skillChoiceCount`: a later class no longer gets its full `@1/skills` creation
 * pick, and Barbarian's multiclass row grants no bonus skill (only Bard/Rogue/Ranger do, via
 * `@1/multiclass-skills`). Plan 16 task 6 (ruling 10) re-pin: nor is Barbarian's
 * `@1/weapon-masteries` pick offered any more — the Fighter's 3 masteries already fill the shared
 * weapon-mastery cap (max(3, 2) = 3), so a later-class Barbarian is offered 0 — so this flow goes
 * straight from the class picker to a complete Review.
 */
test.describe('level up — multiclassing into a second class', () => {
  test('leveling a fighter offers a which-class picker; multiclassing into Barbarian skips HP, asks nothing once the shared mastery cap is full, and the sheet shows both classes', async ({
    page,
  }) => {
    await test.step('create the fighter-1 character', async () => {
      await createFighter(page, CHARACTER_NAME);
      await expect(page.locator('.sheet-shell__class-line')).toHaveText('Fighter 1');
    });

    await test.step('award 300 XP and open the level-up wizard', async () => {
      await page.locator('.sheet-shell__xp-field input').fill('300');
      await page.locator('.sheet-shell__xp-submit').click();
      await expect(page.locator('.sheet-shell__level-up-badge')).toBeVisible();
      await page.locator('.sheet-shell__level-up-badge').click();
      await expect(page).toHaveURL(/\/c\/[^/]+\/level-up$/);
    });

    await test.step("the which-class step offers Fighter's own advancement plus multiclass options", async () => {
      await expect(page.locator('.level-up__class-picker')).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Which class?' })).toBeVisible();
      await expect(
        page
          .locator('.level-up__class-own')
          .getByRole('button', { name: 'Choose: Fighter', exact: true }),
      ).toBeVisible();
      await expect(
        page
          .locator('.level-up__class-multi')
          .getByRole('button', { name: 'Choose: Barbarian', exact: true }),
      ).toBeVisible();
    });

    await test.step('choosing Barbarian skips the HP step and asks no level-1 choice (no skill pick; the shared mastery cap is full)', async () => {
      await page.getByRole('button', { name: 'Choose: Barbarian', exact: true }).click();
      await expect(page.locator('.level-up__class-picker')).toHaveCount(0);
      await expect(page.locator('.level-up__hp-average')).toHaveCount(0);
      await expect(page.locator('.level-up__review')).toBeVisible();
      await expect(page.locator('.choice-step__title')).toHaveCount(0);
      await expect(page.locator('.entity-picker')).toHaveCount(0);
    });

    await test.step('review shows complete (no HP roll was ever required); finish', async () => {
      await expect(page.locator('.level-up__review')).toBeVisible();
      await expect(page.locator('.level-up__incomplete')).toHaveCount(0);
      await expect(page.locator('[data-action="next"]')).toContainText('Finish level up');
      await page.locator('[data-action="next"]').click();
      await expect(page).toHaveURL(/\/c\/[^/]+\/play$/);
    });

    await test.step('the sheet shows both classes', async () => {
      await expect(page.locator('.sheet-shell__class-line')).toHaveText('Fighter 1 · Barbarian 1');
    });
  });
});
