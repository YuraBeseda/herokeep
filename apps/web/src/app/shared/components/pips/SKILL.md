# hk-pips

Element selector `hk-pips`. A clickable pip row for a bounded `[0, max]` counter (spell
slots, limited-use resources): the first `used` pips render filled/`aria-pressed="true"`,
the rest empty/`aria-pressed="false"`. Clicking a filled pip emits `restore`; clicking an
empty one emits `spend` — no index or count payload, every click is worth exactly one unit.

## Usage

```html
<hk-pips
  [max]="slot.max"
  [used]="slot.used"
  [labelKey]="'characters.sheet.spellcasting.slotPipLabel'"
  [labelParams]="{ level: slot.level }"
  (spend)="onSpendSlot(slot.level)"
  (restore)="onRestoreSlot(slot.level)"
/>
```

## Inputs

| Input         | Type                      | Default | Notes                                                                                     |
| ------------- | ------------------------- | ------- | ----------------------------------------------------------------------------------------- |
| `max`         | `number` (required)       | —       | Total pip count. `<= 0` renders no pips.                                                  |
| `used`        | `number` (required)       | —       | The first `used` pips render filled.                                                      |
| `labelKey`    | `string` (required)       | —       | A full Transloco key for each pip's `aria-label` (ICU `{index}`/`{max}` + `labelParams`). |
| `labelParams` | `Record<string, unknown>` | `{}`    | Extra ICU params merged with `{index, max}` (e.g. `{level}`, `{name}`).                   |

## Outputs

| Output    | Payload | Fired when...            |
| --------- | ------- | ------------------------ |
| `spend`   | `void`  | An empty pip is clicked. |
| `restore` | `void`  | A filled pip is clicked. |

## Do / Don't

Do treat `spend`/`restore` as "one unit, direction only" signals — this component never
emits an index or count, and never calls `propose.*`/`appendTx` itself; the caller decides
what event(s) that unit maps to (a `propose.spendSlot` refusal vs. a hand-assembled draft,
what "restore" means for the specific event payload involved — see
`play-tab.component.ts`'s own slot vs. resource restore handlers, which pass different
payloads to the very different `slot.restored` vs. `resource.restored` reducer defaults).
Don't expect per-pip position to carry meaning beyond filled/empty — clicking ANY empty pip
spends one unit, clicking ANY filled pip restores one; which physical pip you clicked is
purely a rendering detail. Don't rely on `disabled` for real bounds enforcement — under a
well-formed `[0, max]` `used`, no pip is ever individually disabled (there's always exactly
one FEWER "wrong" pip than would need disabling); it exists only to guard a transiently
inconsistent input, not as the primary way the row respects `max`.
