import { expect, type Locator, type Page } from '@playwright/test';
import {
  applyBackgroundAbilities,
  chooseOption,
  equipGear,
  finishReviewAndCreate,
  nameCharacter,
  pickBackground,
  pickGamingSet,
  pickSpecies,
} from './create-fighter';

/**
 * Drives the character-creation wizard through a Wizard (class) character — reuses every
 * class-agnostic step from `create-fighter.ts` verbatim (name/species/background/
 * background-abilities/equipment/review; ability scores use the SAME standard array assignment
 * `create-fighter.ts`'s own `STANDARD_ARRAY` — not re-exported since it's a private module
 * constant, so this helper drives the ability-scores step directly) and only replaces the two
 * Fighter-specific bits: the class pick itself, and the class's own level-1 skill choice (Wizard's
 * `skillChoice` pool — Arcana + History, vs. Fighter's Athletics + Perception).
 *
 * Learns exactly two level-1 spellbook spells during creation — Magic Missile (no concentration)
 * and Sleep (concentration) — via the wizard's own 'spells' step. NEITHER is prepared here;
 * callers prepare through the sheet's own real Prepare button (`prepareSpell` below), matching
 * task-12-brief.md's "prepare a spell -> cast" sequencing.
 *
 * Deliberately NOT Fireball (task-12-brief.md's own illustrative example): `SpellsStepComponent`'s
 * `spellbookIds` (`create-wizard/steps/spells-step.component.ts`) queries `{ type: 'spell', level:
 * 1, classes: [classId] }` UNCONDITIONALLY — at creation AND at every level-up (`LevelUpComponent`
 * reuses the exact same component, overriding only the mutator callbacks, never this query) — so
 * the spellbook picker never offers anything above a 1st-level spell, at any character level, in
 * 1b. A 3rd-level spell like Fireball can therefore never be LEARNED through this app's real UI at
 * all (confirmed by reading the component directly, not assumed) — a genuine 1b scope limit, not a
 * bug in anything the play/cast mechanics this task covers actually exercise: `propose.cast`/the
 * cast dialog impose no such restriction themselves, they only ever consume slots at/above
 * whatever level the spell being CAST already has. So callers prove the identical mechanism the
 * brief cares about — prepare -> cast consuming a 3rd-level slot -> pip fills -> concentration chip
 * — using a spell this app can actually teach a wizard, upcast into a higher slot via the cast
 * dialog's own slot picker (5e's normal upcasting rule), exactly as "cast … at level 3" literally
 * means: a spell cast consuming a 3rd-level slot.
 */
export async function createWizard(page: Page, name: string): Promise<string> {
  await nameCharacter(page, name);
  await pickSpecies(page);
  await pickBackground(page);
  await applyBackgroundAbilities(page);
  await chooseOption(page, 'Wizard');

  await page.getByRole('tab', { name: 'Standard array', exact: true }).click();
  const scores: ReadonlyMap<string, string> = new Map([
    ['Strength', '8'],
    ['Dexterity', '13'],
    ['Constitution', '14'],
    ['Intelligence', '15'],
    ['Wisdom', '12'],
    ['Charisma', '10'],
  ]);
  for (const [ability, score] of scores) {
    const row = page.locator('.ability-scores-step__row', { hasText: ability });
    await row.locator('select').selectOption({ label: score });
  }
  // The ability step stays open once the scores are valid (no auto-advance): Next moves on.
  await page.locator('[data-action="next"]').click();

  await chooseOption(page, 'Arcana');
  await chooseOption(page, 'History');
  await pickGamingSet(page);

  // The spellbook lists every level-1 spell of the class (no search, no cap): tick two of them by
  // the toggle named after the spell. The step has no Continue button; Next leaves it.
  await expect(page.locator('.spells-step__spellbook')).toBeVisible();
  for (const spell of ['Magic Missile', 'Sleep']) {
    await page
      .locator('.spells-step__spellbook')
      .getByRole('button', { name: new RegExp(`^${spell} —`) })
      .click();
  }
  await page.locator('[data-action="next"]').click();
  await expect(page.locator('.equipment-step')).toBeVisible();

  await equipGear(page);
  return finishReviewAndCreate(page);
}

/** Clicks the Play tab's known-spells list Prepare toggle for `spellName`, then returns a locator
 * for that SAME spell's row in the separate "Prepared spells" list (`play-tab.component.html`'s
 * own two-list split — a prepared spell keeps its Known-list `<li>`, now showing Unprepare, AND
 * gains a second `<li>` in the Prepared list, the only one of the two that ever carries a Cast
 * button — `.filter({ has: ... })` on that Cast button is what disambiguates the two same-named
 * rows). */
export async function prepareSpell(page: Page, spellName: string): Promise<Locator> {
  const spellBlock = page.locator('.play-tab__spellblock');
  await spellBlock
    .locator('li', { hasText: spellName })
    .getByRole('button', { name: 'Prepare', exact: true })
    .click();
  const preparedRow = spellBlock
    .locator('li', { hasText: spellName })
    .filter({ has: page.getByRole('button', { name: 'Cast', exact: true }) });
  await expect(preparedRow).toBeVisible();
  return preparedRow;
}
