import { expect, test, type Locator, type Page } from '@playwright/test';
import { createFighter } from './helpers/create-fighter';
import { createWizard, prepareSpell } from './helpers/create-wizard';

const FIGHTER_NAME = 'Aldric Rest Actions';
const WIZARD_NAME = 'Aldric Spellcaster';

/** Locates one `hk-stat-tile__value` out of `.play-tab__hp-stats`, by the tile's own `hasText`
 * label (`'Current'`/`'Max'`/`'Temp'`) — same locator shape `level-up.spec.ts`/
 * `create-fighter.spec.ts` already use for the exact same section, generalized here since this
 * file reads HP repeatedly across one continuous rest flow. Returns the LOCATOR (never a resolved
 * string) so every caller keeps Playwright's own auto-retrying web-first assertions — a plain
 * `.innerText()` read would race the store's async `appendTx` -> derive -> render cycle instead of
 * waiting it out. */
function hpValueLocator(page: Page, label: 'Current' | 'Max'): Locator {
  return page
    .locator('.play-tab__hp-stats')
    .locator('hk-stat-tile', { hasText: label })
    .locator('.hk-stat-tile__value');
}

/** Fills the shared HP-controls amount field (`hk-number-field`, cleared back to empty by the
 * component itself once a proposal is accepted — see `PlayTabComponent.applyHpChange`) and clicks
 * the named action button (`'Damage'`/`'Heal'`) — mirrors `.sheet-shell__xp-field input` +
 * `.sheet-shell__xp-submit`'s own established fill-then-submit shape (`level-up.spec.ts`). */
async function applyHp(page: Page, amount: number, action: 'Damage' | 'Heal'): Promise<void> {
  await page.locator('.play-tab__hp-controls input').fill(String(amount));
  await page.getByRole('button', { name: action, exact: true }).click();
}

/**
 * Drives ONE `/c/:id/level-up` session to completion (task-13-brief.md's per-level wizard): always
 * an average HP roll (deterministic, unlike a real die), an optional single-entity choice pick
 * (`pickName` — the wizard's own level-3 subclass and level-4 feat, the only two class-defined
 * choices `packages/content/src/overlays/wizard.json` grants across levels 1-5; every other level
 * has none), a no-op through the (non-gating) spells step, and Finish. Mirrors the SAME
 * auto-advance-on-resolved-choice behavior `create-fighter.ts`'s own `pickFightingStyleAndWeapon
 * Masteries` documents at length (`LevelUpComponent`'s `reHomeActiveStep` effect is a verbatim port
 * of the creation wizard's own) — so `pickName`, when given, is clicked and waited detached, never
 * followed by its own explicit Next click.
 */
async function completeLevelUp(page: Page, pickName?: string): Promise<void> {
  await expect(page).toHaveURL(/\/c\/[^/]+\/level-up$/);
  await page.locator('.level-up__hp-average').click();
  await page.locator('.level-up__next').click();

  if (pickName) {
    const pickButton = page.getByRole('button', { name: pickName, exact: true });
    await pickButton.click();
    await pickButton.waitFor({ state: 'detached' });
  }

  await expect(page.locator('.spells-step__continue')).toBeVisible();
  await page.locator('.spells-step__continue').click();
  // 'spells' never leaves `LevelUpState.steps()` either (same "sheet keeps spellcasting forever
  // once it has it" reasoning `createWizard`'s own doc documents for the creation wizard) — no
  // auto-advance, so Next still has to be clicked explicitly.
  await page.locator('.level-up__next').click();

  await expect(page.locator('.level-up__review')).toBeVisible();
  await page.locator('.level-up__finish').click();
  await expect(page).toHaveURL(/\/c\/[^/]+\/play$/);
}

/** Awards enough XP in one submission to reach character level 5 (SRD 5.2.1 Character Advancement
 * table — `packages/content/src/static/system.ts`'s own `XP_THRESHOLDS`: 6500 XP is level 5's
 * threshold) and drives the level-up wizard through every intervening level (2/3/4/5) one visit at
 * a time (`LevelUpState` only ever advances ONE level per session — see its own class doc) — a
 * wizard needs character level 5 for its first 3rd-level spell slot (the full-caster slot table),
 * which this scenario's "cast … at level 3" step needs available. */
async function levelWizardUpToFive(page: Page): Promise<void> {
  await page.locator('.sheet-shell__xp-field input').fill('6500');
  await page.locator('.sheet-shell__xp-submit').click();
  await expect(page.locator('.sheet-shell__level-up-badge')).toBeVisible();

  await page.locator('.sheet-shell__level-up-badge').click();
  await completeLevelUp(page); // level 2: no class choice
  await expect(page.locator('.sheet-shell__class-line')).toHaveText('Wizard 2');

  await page.locator('.sheet-shell__level-up-badge').click();
  await completeLevelUp(page, 'Evoker'); // level 3: subclass
  await expect(page.locator('.sheet-shell__class-line')).toHaveText('Wizard 3');

  await page.locator('.sheet-shell__level-up-badge').click();
  await completeLevelUp(page, 'Alert'); // level 4: feat (no ability-score sub-choice, unlike ASI)
  await expect(page.locator('.sheet-shell__class-line')).toHaveText('Wizard 4');

  await page.locator('.sheet-shell__level-up-badge').click();
  await completeLevelUp(page); // level 5: no class choice — first 3rd-level slot unlocks here
  await expect(page.locator('.sheet-shell__class-line')).toHaveText('Wizard 5');

  await expect(page.locator('.sheet-shell__level-up-badge')).toHaveCount(0);
}

test.describe('play actions', () => {
  // task-12-brief.md scenario (a): damage -> heal -> a short rest healed by a REAL (uncontrolled)
  // hit-die roll -> the timeline groups the whole rest under one card -> reverting that group
  // restores the spent hit die. No scripted rng anywhere in this test — only inequalities/exact
  // non-HP assertions are checked for the die roll's own outcome.
  test('damage, heal, and a short rest (real hit-die roll) group in the timeline and revert cleanly', async ({
    page,
  }) => {
    await test.step('create the fighter-1 character (level 1, HP 12/12, one d10 hit die)', async () => {
      await createFighter(page, FIGHTER_NAME);
      await expect(page.locator('.sheet-shell__class-line')).toHaveText('Fighter 1');
      await expect(hpValueLocator(page, 'Current')).toHaveText('12');
      await expect(hpValueLocator(page, 'Max')).toHaveText('12');
    });

    await test.step('damage 5 -> HP 7/12', async () => {
      await applyHp(page, 5, 'Damage');
      await expect(hpValueLocator(page, 'Current')).toHaveText('7');
    });

    await test.step('heal 5 -> back to full, HP 12/12', async () => {
      await applyHp(page, 5, 'Heal');
      await expect(hpValueLocator(page, 'Current')).toHaveText('12');
    });

    await test.step('damage 4 again -> HP 8/12 (headroom for the short rest to actually heal)', async () => {
      // A short rest's hit-die healing is capped at max HP (`propose.spendHitDie`) — starting the
      // rest already at 12/12 would make "HP increased" trivially false regardless of the die
      // roll. This damage step is what leaves genuine room for that assertion below to be
      // meaningful.
      await applyHp(page, 4, 'Damage');
      await expect(hpValueLocator(page, 'Current')).toHaveText('8');
    });

    await test.step('short rest: roll the one available hit die (real rng) and confirm', async () => {
      await page.getByRole('button', { name: 'Short rest', exact: true }).click();
      await expect(page.locator('.rest-dialog__title')).toHaveText('Short rest');
      await expect(page.locator('.rest-dialog__hit-die-row', { hasText: 'Fighter' })).toContainText(
        '1 hit die remaining',
      );

      const rollButton = page.getByRole('button', { name: 'Roll d10', exact: true });
      await rollButton.click();
      await expect(page.locator('.rest-dialog__rolls .rest-dialog__die')).toHaveCount(1);
      await expect(rollButton).toBeDisabled();

      await page.getByRole('button', { name: 'Take short rest', exact: true }).click();
      await expect(page.locator('.rest-dialog__title')).toHaveCount(0);
    });

    await test.step('HP increased (uncontrolled amount) and the one hit die was spent', async () => {
      // `expect.poll` (not a one-shot `.innerText()` read): the die roll above only just fired
      // `appendTx` on dialog confirm, so this still has to wait out that same async store cycle —
      // it just also needs to assert an INEQUALITY, which `toHaveText` can't express.
      await expect
        .poll(async () => Number(await hpValueLocator(page, 'Current').innerText()))
        .toBeGreaterThan(8);
      const hpAfterRest = Number(await hpValueLocator(page, 'Current').innerText());
      expect(hpAfterRest).toBeLessThanOrEqual(12);
      await expect(page.locator('.play-tab__hit-dice-list')).toContainText('d10 × 0 / 1');
    });

    await test.step('the timeline shows the rest as one grouped, revertible card', async () => {
      await page.getByRole('tab', { name: 'Timeline', exact: true }).click();
      const restRow = page.locator('.timeline-tab__row[data-family="combat"]').first();
      await expect(restRow.locator('.timeline-tab__expand')).toBeVisible();

      await restRow.getByRole('button', { name: 'Revert', exact: true }).click();
      await expect(page.locator('.timeline-revert-confirm__title')).toBeVisible();
      await page.locator('.timeline-revert-confirm__confirm').click();
      await expect(restRow.locator('.timeline-tab__badge')).toHaveText('Reverted');
    });

    await test.step('reverting the rest group restores the spent hit die and pre-rest HP', async () => {
      await page.getByRole('tab', { name: 'Play', exact: true }).click();
      await expect(hpValueLocator(page, 'Current')).toHaveText('8');
      await expect(page.locator('.play-tab__hit-dice-list')).toContainText('d10 × 1 / 1');
    });
  });

  // task-12-brief.md scenario (b): a wizard leveled to 5 (so a 3rd-level slot exists) prepares two
  // known spells, casts the non-concentration one upcast into a 3rd-level slot (slot pip fills, no
  // concentration chip), casts the concentration one (chip appears, naming it), then a long rest
  // restores every spent slot.
  test('wizard: prepare, cast upcast into a 3rd-level slot, concentration chip, long rest restores slots', async ({
    page,
  }) => {
    await test.step('create a level-1 wizard knowing Magic Missile and Sleep (unprepared)', async () => {
      await createWizard(page, WIZARD_NAME);
      await expect(page.locator('.sheet-shell__class-line')).toHaveText('Wizard 1');
    });

    await test.step('level up to 5 via XP + the level-up wizard (four sessions)', async () => {
      await levelWizardUpToFive(page);
    });

    await test.step('prepare Magic Missile and Sleep from the Known list', async () => {
      await prepareSpell(page, 'Magic Missile');
      await prepareSpell(page, 'Sleep');
    });

    const level3Slots = page.locator('.play-tab__slot-row', { hasText: 'Level 3 slots' });

    await test.step('cast Magic Missile upcast into a 3rd-level slot: the slot pip fills, no concentration chip', async () => {
      await expect(level3Slots.locator('.hk-pips__pip--filled')).toHaveCount(0);

      const preparedRow = page
        .locator('.play-tab__spellblock')
        .locator('li', { hasText: 'Magic Missile' })
        .filter({ has: page.getByRole('button', { name: 'Cast', exact: true }) });
      await preparedRow.getByRole('button', { name: 'Cast', exact: true }).click();

      await expect(page.locator('.cast-dialog__title')).toHaveText('Cast Magic Missile');
      await page.locator('.cast-dialog__slot-select').selectOption({ value: '3' });
      await page
        .locator('.cast-dialog__actions')
        .getByRole('button', { name: 'Cast', exact: true })
        .click();
      await expect(page.locator('.cast-dialog__title')).toHaveCount(0);

      await expect(level3Slots.locator('.hk-pips__pip--filled')).toHaveCount(1);
      await expect(page.locator('.play-tab__concentration')).toHaveCount(0);
    });

    await test.step('cast Sleep (concentration): a second slot pip fills and the concentration chip appears', async () => {
      const preparedRow = page
        .locator('.play-tab__spellblock')
        .locator('li', { hasText: 'Sleep' })
        .filter({ has: page.getByRole('button', { name: 'Cast', exact: true }) });
      await preparedRow.getByRole('button', { name: 'Cast', exact: true }).click();

      await expect(page.locator('.cast-dialog__title')).toHaveText('Cast Sleep');
      await page.locator('.cast-dialog__slot-select').selectOption({ value: '3' });
      await page
        .locator('.cast-dialog__actions')
        .getByRole('button', { name: 'Cast', exact: true })
        .click();
      await expect(page.locator('.cast-dialog__title')).toHaveCount(0);

      await expect(level3Slots.locator('.hk-pips__pip--filled')).toHaveCount(2);
      await expect(page.locator('.play-tab__concentration')).toContainText(
        'Concentrating on Sleep',
      );
    });

    await test.step('a long rest restores every spent slot', async () => {
      await page.getByRole('button', { name: 'Long rest', exact: true }).click();
      await expect(page.locator('.rest-dialog__title')).toHaveText('Long rest');
      await page.getByRole('button', { name: 'Take long rest', exact: true }).click();
      await expect(page.locator('.rest-dialog__title')).toHaveCount(0);

      await expect(level3Slots.locator('.hk-pips__pip--filled')).toHaveCount(0);
    });
  });
});
