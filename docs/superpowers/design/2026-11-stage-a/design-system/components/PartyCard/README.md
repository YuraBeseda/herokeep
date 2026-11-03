# PartyCard

One party member on the campaign's Party tab: portrait, name with the concentration orb when concentrating, class and player line, AC shield, an HP strap, the member's condition chips and inspiration mark, and (for the DM) a row of quick-effect chips that apply effects or open the member's sheet in a drawer.

## Anatomy

`hk-leaf hk-party`: a 3-column grid (50px portrait · name block · AC + open button) over three full-width rows: `hk-party__hp` (a slim `HpGauge`: 24px numeral, gauge with temp hatch), `hk-party__chips` (`ConditionChip`s at 28px, the inspiration chip), and `hk-party__fx` (DM only; `FilterChips`-styled buttons: Damage (ember) · Heal (moss) · Temp HP · Condition · XP · Level · Item · Inspiration · Override). Players see the same card without the fx row; a pregen shows the `padlock` "pregen, claimable" chip and "Claim for…".

## States

Online / offline (the player word in `success-strong` or `text-3`), concentrating (orb chip with hint), dying (0 HP: numeral in `danger-on-leather`, an ember "dying · 1 ✓ 2 ✗" chip), unconscious, stable, unclaimed pregen, pending sync (a `hourglass` chip "syncing").

## Density

Cards 420px wide in a responsive grid; comfortable adds 4px to the row gaps. Phone: one column, fx row scrolls sideways.

## Accessibility

`<article aria-labelledby>` the name; every chip is a labelled button; the gauge is `role="img"` with HP and death-save numbers. Ink on leaf 11.6:1, `success-strong` 6.6:1, `text-3` 5.5:1.

## Tokens

The Leaf, PortraitFrame, HpGauge, ShieldBadge, ConditionChip and FilterChips tokens, plus `success-strong`, `text-3`, `danger-on-leather`, `arcane-strong`.
