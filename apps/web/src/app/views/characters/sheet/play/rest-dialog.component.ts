import { Component, computed, inject, signal } from '@angular/core';
import { parseRollSpec, propose, roll, type ProposedEvent, type Sheet } from '@hk/engine';
import { TranslocoDirective } from '@jsverse/transloco';
import { ButtonComponent } from '@shared/components/button/button.component';
import { DIALOG_DATA, DialogRef } from '@shared/components/dialog/dialog.service';
import { DiceResultComponent } from '@shared/components/dice-result/dice-result.component';
import { cryptoRng } from '@shared/services/engine/rng';

/** One class's hit-die row, PRE-RESOLVED by the caller (`PlayTabComponent`) — same "resolve names
 * before opening" convention `ConditionDialogOption`/`CastDialogSlotOption` document. Only classes
 * with `remaining > 0` at dialog-open time are ever included here — nothing to roll for a class
 * already fully spent (`PlayTabComponent.hitDiceRollOptions` filters this before opening). */
export interface RestDialogHitDieOption {
  readonly classId: string;
  readonly className: string;
}

export interface RestDialogData {
  readonly kind: 'short' | 'long';
  /** The sheet at dialog-OPEN time. Used only for `kind: 'short'` — to read each class's die/
   * remaining count and to call `propose.spendHitDie` per rolled die (see the class doc below for
   * why this is the one play-tab dialog that calls a `propose.*` function itself). Unused for
   * `kind: 'long'` (still required so `RestDialogData` stays one non-discriminated shape). */
  readonly sheet: Sheet;
  /** Empty for `kind: 'long'` — the caller never resolves hit-dice options for that flow. */
  readonly hitDiceOptions: readonly RestDialogHitDieOption[];
}

export interface RestDialogRolledDie {
  readonly classId: string;
  readonly className: string;
  readonly die: number;
  readonly rolled: number;
  readonly healed: number;
}

export type RestDialogResult =
  { readonly kind: 'short'; readonly drafts: ProposedEvent[] } | { readonly kind: 'long' };

/**
 * The short/long rest dialog (task-6-brief.md) — `PlayTabComponent.onShortRest`/`onLongRest` open
 * this via `DialogService.open()`. Same "own injector, no inherited `provideTranslocoScope
 * ('characters')`, full unscoped keys through its own `*transloco`" pattern as every other
 * play-tab dialog (`CastDialogComponent`, `ConditionDialogComponent`, `NoteDialogComponent`).
 *
 * CANONICAL REST FLOW (binding, plan-4 carry — Global Constraints, `CharacterStore`'s own class
 * doc, `propose/rest.ts`'s header comment): hit-dice HEALING goes through `propose.spendHitDie`
 * once PER DIE the player actually rolls — NEVER `propose.rest(sheet, 'short', hitDice)`, whose
 * `hitDice` param only bookkeeps spent dice without healing (double-spend trap if both are used
 * for the same dice). So the short-rest flow here is: roll → `propose.spendHitDie` → collect,
 * repeated one die at a time, then on confirm every collected draft is handed back to
 * `PlayTabComponent`, which concatenates them with `propose.rest(sheet, 'short')` into ONE
 * `appendTx` call so the whole rest shares a single `txId` (Global Constraints: "CONCAT related
 * proposals into ONE `appendTx` call").
 *
 * This makes `RestDialogComponent` the one play-tab dialog that calls a `propose.*` function
 * itself — every sibling dialog (cast/condition/note/add-item) only returns a plain decision for
 * `PlayTabComponent` to build proposals from. That's deliberate here: `propose.spendHitDie`
 * computes `healed = max(0, rolled + con.mod)` (`packages/engine/src/propose/vitals.ts`), which
 * this dialog needs live for each roll's kept-style display — recomputing that formula here
 * instead (rather than reading it off the real draft) would encode a 5e rule in TypeScript twice
 * (CLAUDE.md rule 1), guaranteed to drift the moment the formula ever changes.
 *
 * Double-spend safety WITHOUT an interim `reduce()`+`derive()` replay sheet (task-6-brief.md's
 * required design decision — see `packages/engine/src/propose/rest.ts` and
 * `packages/engine/src/propose/vitals.ts#spendHitDie`): `spendHitDie`'s own "any dice left?" guard
 * (`hd.total - hd.spent`) reads directly off the `sheet` argument it's called with — and every
 * roll in this dialog calls it with the SAME `data.sheet` object, since nothing is actually
 * appended until confirm (there is no incrementally-updated "current" sheet to pass instead
 * without building one). Read literally, that means calling it repeatedly against an unchanging
 * sheet could tolerate rolling MORE dice than the sheet's own `remaining` count — but this
 * component never lets that happen: `remainingByClass` is its OWN signal, seeded from
 * `data.sheet.hp.hitDice[classId].remaining` and decremented locally after every roll, with the
 * roll control disabled the instant it hits zero. So `propose.spendHitDie` is never actually
 * called more times than the sheet's true remaining dice, which makes its own internal check
 * redundant-but-harmless here rather than something this component depends on. No replay sheet is
 * needed for a second, independent reason: `healed` depends only on `rolled` and `sheet.abilities
 * ['con'].mod` — con modifier is never affected by spending hit dice — so nothing about an
 * EARLIER collected draft could ever change what a LATER one's `healed` amount should be; there's
 * nothing for a replay to bring "up to date" for this specific proposer.
 */
@Component({
  selector: 'app-rest-dialog',
  imports: [TranslocoDirective, ButtonComponent, DiceResultComponent],
  templateUrl: './rest-dialog.component.html',
})
export class RestDialogComponent {
  protected readonly data = inject<RestDialogData>(DIALOG_DATA);
  private readonly dialogRef = inject(DialogRef);

  // Collected `hit_dice.spent` drafts, one per roll, in roll order — handed back verbatim to
  // `PlayTabComponent` on confirm (never appended by this dialog itself; see class doc).
  private readonly collectedDrafts: ProposedEvent[] = [];

  // Kept-style display rows, one per roll, in roll order — rendered via the shared
  // `hk-dice-result` component (controller ruling R-pf2, task-7-brief.md: "your extraction of the
  // shared dice-result component refactors that markup into the component too — 'used in 3
  // places' includes the rest dialog").
  protected readonly rolls = signal<RestDialogRolledDie[]>([]);

  protected readonly remainingByClass = signal<Record<string, number>>(
    Object.fromEntries(
      this.data.hitDiceOptions.map((o) => [
        o.classId,
        this.data.sheet.hp.hitDice[o.classId]?.remaining ?? 0,
      ]),
    ),
  );

  // Merges the caller-resolved `classId`/`className` with the live `die`/`remaining` off
  // `data.sheet` / `remainingByClass` — the template's single source for the hit-dice list.
  protected readonly hitDiceRows = computed(() =>
    this.data.hitDiceOptions.map((o) => ({
      classId: o.classId,
      className: o.className,
      die: this.data.sheet.hp.hitDice[o.classId]?.die ?? 0,
      remaining: this.remainingByClass()[o.classId] ?? 0,
    })),
  );

  protected readonly hasAnyHitDice = computed(() => this.hitDiceRows().length > 0);

  protected rollDie(option: RestDialogHitDieOption): void {
    const remaining = this.remainingByClass()[option.classId] ?? 0;
    if (remaining <= 0) return;
    const die = this.data.sheet.hp.hitDice[option.classId]?.die;
    if (die === undefined) return;

    const result = roll(parseRollSpec(`1d${die}`), cryptoRng);
    const rolled = result.total;

    // `remainingByClass`'s own gate just above (and the disabled roll button it drives) never
    // lets this run once a class's dice are exhausted, so `propose.spendHitDie`'s own "any dice
    // left?" check (`ProposeError('hitdice.none-left')`) is unreachable here — see the class doc's
    // "double-spend safety" section. Left uncaught deliberately: a `ProposeError` here would mean
    // that gate itself has a bug, not a real refusal to surface, and this dialog has no
    // `ToastService` to show one anyway.
    const [draft] = propose.spendHitDie(this.data.sheet, option.classId, rolled);

    this.collectedDrafts.push(draft);
    const healed = (draft.payload as { healed: number }).healed;
    this.rolls.update((prev) => [
      ...prev,
      { classId: option.classId, className: option.className, die, rolled, healed },
    ]);
    this.remainingByClass.update((prev) => ({ ...prev, [option.classId]: remaining - 1 }));
  }

  protected cancel(): void {
    this.dialogRef.close(undefined);
  }

  protected confirm(): void {
    if (this.data.kind === 'short') {
      this.dialogRef.close({
        kind: 'short',
        drafts: this.collectedDrafts,
      } satisfies RestDialogResult);
      return;
    }
    this.dialogRef.close({ kind: 'long' } satisfies RestDialogResult);
  }
}
