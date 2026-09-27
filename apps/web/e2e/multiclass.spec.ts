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
 * `isNewClass` pick — `level-up.state.ts`'s own `steps()` doc) — so this flow skips straight from
 * the class picker into Barbarian's own level-1 choices: the synthetic `@1/skills` class-skills
 * pick (unconditionally offered on ANY newly-taken class today — `multiclass.gains
 * .skillChoiceCount` is a documented, ledgered slice-2 gap, not something this test works around or
 * asserts against — the 2024 SRD's own multiclass table only grants a bonus skill for Bard/Rogue,
 * neither being Barbarian) and `@1/weapon-masteries` (a real `count: 2` query pick, same shape as
 * Fighter's own `count: 3` pick since task 8). Which of the two renders first isn't asserted
 * (mirrors `create-fighter.ts`'s own stance on its analogous pair) — told apart here by DOM shape
 * (`.choice-step__chips` vs `.entity-picker`), which — unlike Fighter's two level-1 choices, both
 * `query` picks as of task 8 — genuinely differs between these two.
 */
test.describe('level up — multiclassing into a second class', () => {
  test('leveling a fighter offers a which-class picker; multiclassing into Barbarian skips HP, completes both new-class level-1 choices, and the sheet shows both classes', async ({
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

    await test.step("the which-class picker offers Fighter's own advancement plus multiclass options", async () => {
      await expect(page.locator('.level-up__class-picker')).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Which class?' })).toBeVisible();
      await expect(
        page.getByRole('button', { name: 'Level up Fighter to 2', exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole('button', { name: 'Multiclass into Barbarian', exact: true }),
      ).toBeVisible();
    });

    await test.step('choosing Barbarian skips the HP step and lands on its own first level-1 choice', async () => {
      await page.getByRole('button', { name: 'Multiclass into Barbarian', exact: true }).click();
      await expect(page.locator('.level-up__class-picker')).toHaveCount(0);
      await expect(page.locator('.level-up__hp-average')).toHaveCount(0);
      await expect(page.locator('.choice-step__title')).toBeVisible();
    });

    await test.step("Barbarian's own level-1 choices: class skills and weapon masteries", async () => {
      // Same "which shape is up right now" + "wait for the just-acted-on element to leave the DOM
      // before looping" technique `create-fighter.ts`'s own module doc explains at length — the
      // SAME `ChoiceStepComponent`/`reHomeActiveStep` auto-advance race applies here too.
      for (let i = 0; i < 2; i++) {
        const chips = page.locator('.choice-step__chips');
        const picker = page.locator('.entity-picker');
        const shown = await Promise.race([
          chips.waitFor({ state: 'visible' }).then((): 'chips' => 'chips'),
          picker.waitFor({ state: 'visible' }).then((): 'picker' => 'picker'),
        ]);
        if (shown === 'chips') {
          await page.getByRole('button', { name: 'Athletics', exact: true }).click();
          const survival = page.getByRole('button', { name: 'Survival', exact: true });
          await survival.click();
          await survival.waitFor({ state: 'detached' });
        } else {
          await page.getByRole('button', { name: 'Handaxe', exact: true }).click();
          const javelin = page.getByRole('button', { name: 'Javelin', exact: true });
          await javelin.click();
          await javelin.waitFor({ state: 'detached' });
        }
      }
    });

    await test.step('review shows complete (no HP roll was ever required); finish', async () => {
      await expect(page.locator('.level-up__review')).toBeVisible();
      await expect(page.locator('.level-up__incomplete')).toHaveCount(0);
      await page.locator('.level-up__finish').click();
      await expect(page).toHaveURL(/\/c\/[^/]+\/play$/);
    });

    await test.step('the sheet shows both classes', async () => {
      await expect(page.locator('.sheet-shell__class-line')).toHaveText('Fighter 1 · Barbarian 1');
    });
  });
});
