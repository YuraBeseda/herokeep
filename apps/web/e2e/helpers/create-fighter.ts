import { expect, type Page } from '@playwright/test';

/**
 * Drives the character-creation wizard through the exact "fighter-1" binding decisions
 * (task-15-brief.md's Global Constraints): the same choices `packages/engine/test/golden/
 * fighter-1.json` encodes — human, soldier (+2 str/+1 con), fighter, standard array
 * str15/dex13/con14/int10/wis12/cha8, skills athletics+perception, fighting style Defense,
 * chain mail + longsword + shield equipped — which that golden fixture asserts produce
 * AC 19 / HP 12 / prof +2. `fighter-2.json` (XP 300, `hpRoll: 'average'`) is the level-up
 * counterpart `level-up.spec.ts` drives interactively for HP 20 (12 + 6 + 2).
 *
 * IMPORTANT — do NOT click `.create-wizard__next` after a `hk-choice-step` selection: the moment
 * a choice's decision becomes fully valid, `CreateWizardState.steps()` drops it, and
 * `CreateWizardComponent`'s own `reHomeActiveStep` effect re-homes `activeStepId` onto whatever
 * now sits at that vanished step's former index — i.e. the wizard ALREADY auto-advances to the
 * next step. Clicking Next afterward advances a SECOND time, silently skipping a step (confirmed
 * the hard way — an earlier version of this helper did exactly that and landed on the Class step
 * having never visited Background). Only 'name' and 'equipment' never vanish from `steps()`, so
 * only those two functions below click Next themselves.
 */

const NEXT_BUTTON = '.create-wizard__next';

async function clickNext(page: Page): Promise<void> {
  await page.locator(NEXT_BUTTON).click();
}

/** How to reach `/characters/new`: a plain `page.goto` (every spec but `locale.spec.ts`, which
 * tracks the browser's `load` event count and must stay on ONE hard navigation for its whole
 * test — see that spec's own doc), a client-side click through the nav + list's own "New
 * character" button (no navigation event at all), or (plan-10 task-16, the DM "Add pregen" flow —
 * `party-tab.component.ts`'s `addPregen()`) `'current'`, which navigates nowhere at all: the
 * caller has ALREADY landed on `/characters/new?returnUrl=...` via its own in-app navigation (a
 * fresh `page.goto` here would drop that query param, and with it `CreateWizardComponent`'s own
 * post-create `returnUrl` redirect — see `nameCharacter`'s own doc for why `finishReviewAndCreate`
 * can't be reused unmodified in that flow either). */
export async function openCreateWizard(
  page: Page,
  via: 'goto' | 'nav' | 'current' = 'goto',
): Promise<void> {
  if (via === 'current') {
    return;
  } else if (via === 'nav') {
    await page.getByRole('link', { name: 'Characters', exact: true }).click();
    await page.getByRole('button', { name: 'New character', exact: true }).click();
  } else {
    await page.goto('/characters/new');
  }
}

/** Step 1: name + grammatical gender (masculine — mirrors the golden fixtures' "Aldric"). The
 * 'name' step never leaves `steps()`, so — unlike every choice step below — this one DOES need
 * its own explicit Next click to reach species. */
export async function nameCharacter(
  page: Page,
  name: string,
  via: 'goto' | 'nav' | 'current' = 'goto',
): Promise<void> {
  await openCreateWizard(page, via);
  await page.locator('.create-wizard__name-input').fill(name);
  await page.getByRole('radio', { name: 'Masculine', exact: true }).check();
  await clickNext(page);
}

/** Step 2: species — Human. Selecting it resolves the choice, which auto-advances the wizard to
 * Background (see this file's module doc) — no Next click here. */
export async function pickSpecies(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Human', exact: true }).click();
}

/** Step 3: background — Soldier. Auto-advances to Background's own ability bump. */
export async function pickBackground(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Soldier', exact: true }).click();
}

/** Step 4: Soldier's own +2/+1 ability bump — Strength +2, Constitution +1 (matches
 * `fighter-1.json`'s `["str:+2", "con:+1"]`). Scoped per delta slot so the same ability chip
 * label appearing in both slots (if ever offered in both) can't cause an ambiguous click. The
 * choice only resolves (and auto-advances) once BOTH slots are filled. */
export async function applyBackgroundAbilities(page: Page): Promise<void> {
  const plusTwoSlot = page.locator('.abilities-improve-step__slot', { hasText: '+2' });
  await plusTwoSlot.getByRole('button', { name: 'Strength', exact: true }).click();
  const plusOneSlot = page.locator('.abilities-improve-step__slot', { hasText: '+1' });
  await plusOneSlot.getByRole('button', { name: 'Constitution', exact: true }).click();
}

/** Step 5: class — Fighter. Auto-advances to ability scores. */
export async function pickClass(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Fighter', exact: true }).click();
}

/** The SRD 2024 standard array, keyed by full ability name (as `hk-ability-scores-step` renders
 * each row's label) — matches `fighter-1.json`'s `str:15/dex:13/con:14/int:10/wis:12/cha:8`.
 * Assigning by the `<select>` option's visible LABEL (the score itself) rather than its index
 * means this is correct regardless of the array's declared order in the pack. */
const STANDARD_ARRAY: ReadonlyMap<string, string> = new Map([
  ['Strength', '15'],
  ['Dexterity', '13'],
  ['Constitution', '14'],
  ['Intelligence', '10'],
  ['Wisdom', '12'],
  ['Charisma', '8'],
]);

/** Step 6: ability scores via the Standard Array method (the tab `hk-tabs` already defaults to,
 * per `AbilityScoresStepComponent.availableMethods`'s own declared order — clicked explicitly
 * anyway so this stays correct even if that default ever changes). Auto-advances to class skills
 * once all six abilities are assigned. */
export async function assignStandardArray(page: Page): Promise<void> {
  await page.getByRole('tab', { name: 'Standard array', exact: true }).click();
  for (const [ability, score] of STANDARD_ARRAY) {
    const row = page.locator('.ability-scores-step__row', { hasText: ability });
    await row.locator('select').selectOption({ label: score });
  }
}

/** Step 7: the synthetic class-skills pick — Athletics + Perception (matches `fighter-1.json`'s
 * `["athletics", "perception"]`). Auto-advances once both are selected (the count-2 choice is
 * only valid, and therefore only resolved, with exactly two). */
export async function pickSkills(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Athletics', exact: true }).click();
  await page.getByRole('button', { name: 'Perception', exact: true }).click();
}

/** Step 8/9: the fighter's own two level-1 choices — Fighting Style (a `query` pick, rendered as
 * `hk-entity-picker` cards: Defense, matching `fighter-1.json`) and Weapon Masteries. Task 8
 * (phase 4 plan 11) closed T6's carry and swapped Weapon Masteries from a `literal:'text'` pick
 * into a REAL `query` pick — `{query: {type: 'item', hasField: ['weapon.mastery']}}`, `count: 3`
 * as of fix round 1 (matching the SRD's "three kinds of Simple or Martial weapons") — see
 * `packages/content/src/overlays/fighter.json`'s own note. Both choices now render as
 * `hk-entity-picker` card grids — the SAME DOM shape the old literal-vs-picker branch used to tell
 * them apart by — so this loop instead reads the step's own `.choice-step__title` heading text:
 * `choicePrompt` renders the pack's own `prompt` field verbatim in the default 'en' locale
 * (`packages/engine/src/i18n/localizer.ts`), i.e. literally "Fighting Style" or "Weapon
 * Masteries". Which three weapons are picked for Masteries doesn't matter to
 * `fighter-1.json`'s golden assertions (AC/HP/prof — masteries only feed the attacks table,
 * unexercised by `create-fighter.spec.ts`); Longsword and Shortsword (already equipped by
 * `equipGear` below) plus Dagger are picked, all three carrying a real `weapon.mastery` field
 * (every weapon in the pack does — `packages/content/src/transform/items.ts` throws at build time
 * on any that doesn't).
 *
 * `outstandingChoices`' own ordering between the two choices isn't asserted here — whichever
 * renders first, the title-text check above decides the branch, not position. Each resolves (and
 * auto-advances) the instant its own last required pick lands: Fighting Style after one click
 * (`count: 1`, single-select — `onToggle`'s replace-on-tap branch), Weapon Masteries after its
 * third (`count: 3`, accumulate/multi-select) — so, like the old literal shape, this loop never
 * clicks Next itself; the SECOND iteration's own final click is what carries the wizard on to
 * Equipment.
 *
 * `CreateWizardComponent`'s own `reHomeActiveStep` effect (this file's module doc) runs on its OWN
 * scheduling tick, not synchronously with the click that resolves a decision, so the
 * JUST-COMPLETED step's view can still be sitting on screen for a brief window afterward — reading
 * `.choice-step__title` inside that window on the loop's SECOND iteration would see the
 * (about-to-vanish) FIRST step's own heading and act on it again, same failure class the original
 * comment here described (a re-click on an already-selected card can even DESELECT it). Each
 * branch below waits for its own LAST acted-on button to leave the DOM before the loop reads the
 * title again: the entity-picker's `@for` tracks `row.id`, and Fighting Style's `ids` are entirely
 * different entities from Weapon Masteries', so every row — the just-clicked one included — is
 * torn down and rebuilt the instant `ChoiceStepComponent`'s reused instance receives the next
 * `choiceId`, closing the race the same way the original branch's own detached-wait did. */
export async function pickFightingStyleAndWeaponMasteries(page: Page): Promise<void> {
  const WEAPON_MASTERIES_TITLE = 'Weapon Masteries';
  const WEAPON_PICKS: readonly string[] = ['Longsword', 'Shortsword', 'Dagger'];

  for (let i = 0; i < 2; i++) {
    const title = page.locator('.choice-step__title');
    await title.waitFor({ state: 'visible' });
    const heading = (await title.textContent())?.trim();
    if (heading === WEAPON_MASTERIES_TITLE) {
      for (const weapon of WEAPON_PICKS) {
        await page.getByRole('button', { name: weapon, exact: true }).click();
      }
      const lastWeaponButton = page.getByRole('button', {
        name: WEAPON_PICKS[WEAPON_PICKS.length - 1],
        exact: true,
      });
      await lastWeaponButton.waitFor({ state: 'detached' });
    } else {
      const defenseButton = page.getByRole('button', { name: 'Defense', exact: true });
      await defenseButton.click();
      await defenseButton.waitFor({ state: 'detached' });
    }
  }
}

/** Step 10: equipment — add, then equip, chain mail + longsword + shield (`fighter-1.json`'s
 * `item.added`/`item.equipped` triple; these are what actually raise AC to 19 and set the
 * attacks table). The item picker caps its card grid at 60 entries out of the SRD pack's ~960
 * items (`EquipmentStepComponent`'s own `ITEM_PICKER_LIMIT`) — alphabetically, "Longsword" and
 * "Shield" fall well past that cap, so each item is searched for by name first rather than
 * assumed to already be on-screen. 'equipment' never leaves `steps()` (it isn't choice-gated), so
 * — like 'name' — this DOES need its own explicit Next click, to Review. */
export async function equipGear(page: Page): Promise<void> {
  const items = ['Chain Mail', 'Longsword', 'Shield'];
  const searchBox = page.getByRole('searchbox');
  for (const item of items) {
    await searchBox.fill(item);
    await page.getByRole('button', { name: item, exact: true }).click();
  }
  await searchBox.fill('');

  for (const item of items) {
    const row = page.locator('.equipment-step__entry', { hasText: item });
    await row.getByRole('button', { name: 'Equip', exact: true }).click();
  }
  await clickNext(page);
}

/** Step 11: the review step — asserts it reports complete (no outstanding/invalid decisions),
 * creates the character, and returns its new id (parsed off the post-create `/c/<id>/play`
 * URL). */
export async function finishReviewAndCreate(page: Page): Promise<string> {
  await expect(page.locator('.create-wizard__incomplete')).toHaveCount(0);
  const createButton = page.locator('.create-wizard__create');
  await expect(createButton).toBeEnabled();
  await createButton.click();
  await expect(page).toHaveURL(/\/c\/[^/]+\/play$/);
  const match = /\/c\/([^/]+)\/play$/.exec(page.url());
  if (!match) throw new Error(`unexpected URL after character creation: ${page.url()}`);
  return match[1];
}

/** The full binding path, start to finish: name → species → background → background abilities →
 * class → ability scores → skills → fighting style/weapon masteries → equipment → create.
 * Returns the new character's id (parsed off the post-create URL — NOT valid when `via:
 * 'current'` and a `returnUrl` is in play, since creation then lands somewhere other than
 * `/c/<id>/play`; see `finishReviewAndCreate`'s own doc). `via: 'nav'` is for `locale.spec.ts`
 * only, `via: 'current'` for the campaign e2e's DM-pregen flow (see `openCreateWizard`'s doc). */
export async function createFighter(
  page: Page,
  name: string,
  via: 'goto' | 'nav' | 'current' = 'goto',
): Promise<string> {
  await nameCharacter(page, name, via);
  await pickSpecies(page);
  await pickBackground(page);
  await applyBackgroundAbilities(page);
  await pickClass(page);
  await assignStandardArray(page);
  await pickSkills(page);
  await pickFightingStyleAndWeaponMasteries(page);
  await equipGear(page);
  return finishReviewAndCreate(page);
}
