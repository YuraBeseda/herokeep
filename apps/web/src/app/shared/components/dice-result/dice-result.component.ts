import { Component, input } from '@angular/core';

/** Mirrors `RollResult['dice'][number]` (`packages/engine/src/dice/roll.ts`) structurally — this
 * component takes the already-rolled shape, never `RollSpec`/`roll()` itself (see class doc). */
export interface DiceResultDie {
  readonly sides: number;
  readonly value: number;
  readonly kept: boolean;
}

/**
 * `hk-dice-result` (task-7-brief.md): the shared kept/dropped dice-face display, extracted from
 * the near-duplicate per-die markup that had grown in `AbilityScoresStepComponent`'s roll-method
 * tab, `LevelUpComponent`'s hit-point roll, and (per controller ruling R-pf2) `RestDialogComponent`
 * 's short-rest hit-die rolls — this task's own roll-log panel is the third/fourth consumer.
 *
 * Purely presentational: every number it renders (`dice[].value`, `modifier`, `total`) comes
 * straight off an already-computed `roll()` result — no dice-notation parsing or arithmetic
 * happens here (`packages/engine/src/dice/{parse,roll}.ts` own that; CLAUDE.md rule 1 — never
 * re-encode a rule/computation the engine already owns).
 */
@Component({
  selector: 'hk-dice-result',
  templateUrl: './dice-result.component.html',
  styleUrl: './dice-result.component.scss',
})
export class DiceResultComponent {
  // Inputs
  readonly dice = input.required<readonly DiceResultDie[]>();
  // `0` (the default) renders no modifier badge at all — e.g. `RestDialogComponent`'s single-die
  // kept-style roll, whose surrounding translated sentence already states the healed amount.
  readonly modifier = input<number>(0);
  // `undefined` (the default) renders no total row — same "omit rather than duplicate/derive a
  // value the caller already has" convention `modifier` follows.
  readonly total = input<number | undefined>(undefined);

  protected signedModifier(): string {
    const m = this.modifier();
    return m > 0 ? `+${m}` : `${m}`;
  }
}
