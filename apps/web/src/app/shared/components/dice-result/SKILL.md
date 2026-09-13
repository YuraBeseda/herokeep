# hk-dice-result

Element selector `hk-dice-result`. Renders one already-rolled `RollResult` as a row of dice
faces (dice a `kh`/`kl` keep or advantage/disadvantage dropped render struck through), an
optional flat modifier badge, and an optional total — purely presentational, no dice-notation
parsing or arithmetic of its own (`packages/engine`'s `roll()`/`parseRollSpec` own that).

## Usage

```html
<hk-dice-result [dice]="result.dice" [modifier]="mod" [total]="result.total" />
```

A dice-only display (no modifier/total row) — `RestDialogComponent`'s single-die kept-style
roll, where the surrounding translated sentence already states the total:

```html
<hk-dice-result [dice]="[{ sides: die, value: rolled, kept: true }]" />
```

## Inputs

| Input      | Type                                                         | Default     | Notes                                                                  |
| ---------- | ------------------------------------------------------------ | ----------- | ---------------------------------------------------------------------- |
| `dice`     | `{sides: number; value: number; kept: boolean}[]` (required) | —           | One span per die, in roll order. `kept: false` renders struck through. |
| `modifier` | `number`                                                     | `0`         | `0` renders no modifier badge at all.                                  |
| `total`    | `number \| undefined`                                        | `undefined` | `undefined` renders no total row.                                      |

No outputs.

## Do / Don't

Do pass `dice`/`modifier`/`total` straight off an already-computed `RollResult`
(`roll(spec, cryptoRng)`, `packages/engine/src/dice/roll.ts`) — this component never calls
`roll`/`parseRollSpec` itself, and never recomputes a total from `dice`/`modifier` (a caller
that wants no total row at all just omits `total`, rather than this component guessing when
to sum). Don't expect an accessible summary from this component alone — pair it with
translated text stating the roll's purpose (the roll-log panel's own entry label, or a
dialog's own sentence), the same way `hk-hp-bar` is always paired with separately-accessible
numeric text.
