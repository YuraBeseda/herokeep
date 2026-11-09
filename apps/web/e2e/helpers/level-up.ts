import type { Page } from '@playwright/test';

/**
 * Task 12 (phase 4 plan 11) added a "which class?" step to `/c/:id/level-up` (the flow's first
 * step, shown while `LevelUpState.classChoices()` is non-empty and no class is chosen, ADR-007)
 * whenever `CharacterStore.advancements()` reports MORE THAN ONE eligible option — which
 * happens for every fighter/wizard fixture this e2e suite builds: `create-fighter.ts`'s standard
 * array (str15/dex13/con14/...) clears the SRD's Fighter-own DEX13-or-STR13 gate AND Rogue's own
 * DEX13 gate, and `create-wizard.ts`'s array (dex13/int15/...) clears Rogue's DEX13 and Fighter's
 * DEX13 the same way — so `classChoices()` always offers at least one multiclass entry alongside
 * the character's own current-class advancement, and the step always renders, in every e2e
 * scenario that levels either fixture up.
 *
 * Every level-up flow in this suite wants the SAME answer every time — keep leveling the class
 * already being played, never multiclass (multiclassing itself has its own dedicated e2e coverage,
 * `multiclass.spec.ts`) — so this is called right after navigating to `/c/:id/level-up`, before
 * touching the HP step. It presses Choose on the card in the step's own-class group
 * (`.level-up__class-own`, as opposed to the `.level-up__class-multi` cards that start a second
 * class) and waits for the step itself to clear.
 *
 * When `CharacterStore.advancements()` ever reports exactly one option (no multiclass offer
 * clears), `LevelUpState.advancement()` auto-selects it and the picker never renders at all — a
 * bounded `waitFor` (not an unconditional one) is what lets this no-op correctly in that case
 * instead of hanging for the rest of the test's timeout; it isn't exercised by any fixture in this
 * suite today, but nothing about the picker's own gate guarantees it never will be.
 */
export async function chooseOwnClassIfPrompted(page: Page): Promise<void> {
  const picker = page.locator('.level-up__class-picker');
  const appeared = await picker
    .waitFor({ state: 'visible', timeout: 10_000 })
    .then((): boolean => true)
    .catch((): boolean => false);
  if (!appeared) return;

  await page.locator('.level-up__class-own .hk-picker-card__choose').click();
  await picker.waitFor({ state: 'detached' });
}
