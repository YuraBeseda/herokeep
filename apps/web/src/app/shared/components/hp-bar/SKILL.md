# hk-hp-bar

Element selector `hk-hp-bar`. A pure-presentational HP bar: a track filled to
`current / max`, with a `temp` overlay segment picking up where that fill ends. The
percentage base widens to `current + temp` whenever that exceeds `max` — at full HP
(`current === max`), a naive `max`-only base would clamp the fill to 100% and clip the
temp segment off the track entirely (`overflow: hidden`), hiding temp HP exactly when a
full-HP character gains it (False Life, Aid, …). Widening the base instead shrinks both
segments proportionally so fill+temp always share the track.

## Usage

```html
<hk-hp-bar [current]="sheet().hp.current" [max]="sheet().hp.max.value" [temp]="sheet().hp.temp" />
```

## Inputs

| Input     | Type     | Default | Notes                                            |
| --------- | -------- | ------- | ------------------------------------------------ |
| `current` | `number` | —       | Required. Current HP.                            |
| `max`     | `number` | —       | Required. Max HP; `<= 0` renders an empty track. |
| `temp`    | `number` | `0`     | Temporary HP, rendered as an overlay segment.    |

No outputs.

## Do / Don't

Do pass already-resolved numbers straight off `Sheet.hp` (`current`, `max.value`, `temp`) —
this component does no clamping/reachability math of its own beyond formatting a
width percentage; that logic lives in `propose.damage`/`heal`/`tempHp`
(`packages/engine/src/propose/vitals.ts`). Don't expect an accessible label from this
component alone — it's `aria-hidden` (the numeric values are rendered as text
elsewhere, e.g. the sheet's `hk-stat-tile` trio); pair it with visible/accessible text
if you use it somewhere that doesn't already show the numbers.
