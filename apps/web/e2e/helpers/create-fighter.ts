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
 * test — see that spec's own doc) or a client-side click through the nav + list's own "New
 * character" button (no navigation event at all). */
export async function openCreateWizard(page: Page, via: 'goto' | 'nav' = 'goto'): Promise<void> {
  if (via === 'nav') {
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
  via: 'goto' | 'nav' = 'goto',
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

/** Step 8/9: the fighter's own two level-1 choices — Fighting Style (a `query` pick, rendered
 * as `hk-entity-picker` cards: Defense, matching `fighter-1.json`) and Weapon Masteries (a
 * `literal:'text'` pick with `count: 1` — see `packages/content/src/overlays/fighter.json`'s own
 * note on why it's freeform text, not a query). A single literal ENTRY naming two weapons
 * ("Longsword, Shortsword") is what satisfies task-15-brief.md's "freeform chips — enter two
 * weapon names" AND the choice's `count: 1`: two SEPARATE chips would push `selection.length` to
 * 2, which `validateSelection` flags as a `selection.count` error, blocking the review's
 * `complete()` gate — confirmed against `choice-step.component.spec.ts`'s own literal-pick unit
 * test, which records exactly one string per submitted chip.
 *
 * `outstandingChoices`' own ordering between these two isn't asserted here — whichever renders
 * first, this loop tells them apart by DOM shape (`hk-entity-picker`'s card grid vs the literal
 * pick's text-entry form), not position. Each resolves (and auto-advances) the instant it's
 * picked — the SECOND iteration's own selection is what carries the wizard on to Equipment, so
 * this loop (unlike every other choice step here) never clicks Next either.
 *
 * Which of the two is showing is decided with a `Promise.race` between two POLLING `waitFor`
 * calls (not a one-shot `locator.count()`, which isn't actionability-polled and proved less
 * reliable here first) — whichever selector's element is ACTUALLY, currently visible decides the
 * branch. That alone still isn't enough, though: `CreateWizardComponent`'s own `reHomeActiveStep`
 * effect (the thing that auto-advances once a decision resolves — see this file's module doc) runs
 * on its OWN scheduling tick, not synchronously with the click that resolved the decision, so the
 * JUST-COMPLETED step's view can still be sitting on screen for a brief window afterward. Without
 * waiting that out, the loop's SECOND iteration can start its own check inside that window, see
 * the (about-to-vanish) FIRST step still "currently visible" and act on it AGAIN — re-clicking an
 * already-selected `hk-entity-picker` card actually DESELECTS it (count:1 toggle) — and then hang
 * for the rest of the test's timeout once the real transition finally fires mid-click and the
 * target element is never seen again (confirmed via this exact failure's trace: the second
 * `.entity-picker` wait resolved in ~6ms, far too fast to be a fresh render, and the following
 * click log ends on "element was detached from the DOM, retrying" with no further progress).
 * Explicitly waiting for THIS iteration's own acted-on element to leave the DOM before looping
 * closes that window. */
export async function pickFightingStyleAndWeaponMasteries(page: Page): Promise<void> {
  for (let i = 0; i < 2; i++) {
    const picker = page.locator('.entity-picker');
    const literalForm = page.locator('.choice-step__literal-form');
    const shown = await Promise.race([
      picker.waitFor({ state: 'visible' }).then((): 'picker' => 'picker'),
      literalForm.waitFor({ state: 'visible' }).then((): 'literal' => 'literal'),
    ]);
    if (shown === 'picker') {
      const defenseButton = page.getByRole('button', { name: 'Defense', exact: true });
      await defenseButton.click();
      await defenseButton.waitFor({ state: 'detached' });
    } else {
      await literalForm.locator('.choice-step__literal-input').fill('Longsword, Shortsword');
      const addButton = literalForm.getByRole('button', { name: 'Add', exact: true });
      await addButton.click();
      await addButton.waitFor({ state: 'detached' });
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
 * Returns the new character's id. `via: 'nav'` is for `locale.spec.ts` only (see
 * `openCreateWizard`'s doc). */
export async function createFighter(
  page: Page,
  name: string,
  via: 'goto' | 'nav' = 'goto',
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
