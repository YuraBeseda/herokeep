# ActionStrap

The one fixed action bar at the bottom of every screen: a brass-riveted leather strap with three zones, left to right, Exit (Cancel, Back), Primary (screen-specific, fixed order) and Secondary (icon-only with hints); a given action never changes slot between steps or tabs.

## Anatomy

- `hk-astrap`: leather gradient `leather-highlight` / `leather` / `leather-dark`, leather texture, `rivets` rows top and bottom (`rivet-light`, `rivet`, `rivet-dark` at a 26px pitch; transparent in plain), raised shadow. Desktop height 70px (`strap-height`); the page reserves it so content never hides behind it (`position: sticky; bottom: 0` in the app shell).
- `hk-astrap__row`: padding 6px 22px, gap 10px. `hk-astrap__zone` groups a zone; `hk-astrap__divider` is a 2px brass fade between zones.
- Zone 1 Exit: `Button` ghost-leather Cancel (flows only), leather Back. Always leftmost; Back is always the second slot when present. Nothing on the sheet.
- Zone 2 Primary, `hk-btn--l` 40px: sheet → Damage (ember) · Heal (moss) · Roll (brass) · Short rest · Long rest (leather); wizard / level-up → Next (brass), which reads "Create hero" / "Finish level up" on the review step in the same slot; campaign Party (DM) → Damage · Heal · Condition · XP · Item; lists → New · Import / Join.
- Zone 3 Secondary: `IconButton`s with hints: sheet → Add condition · Notes · Roll log · Export · Edit (override); campaign → Session start/end · Export; pickers → Filter · Search.
- Right end (`hk-astrap__note`): the concentration note on desktop when concentrating (orb glyph `concentration-orb` in `arcane-light`), or the wizard's "Step 4 of 9 · Ability scores".
- Phone: `hk-astrap__row--phone`, a 5-column grid of `hk-act` tiles (54px, icon over label, 14px) above the `hk-tabbar`; zone 3 collapses into one "More" tile that opens a bottom sheet with the same order.

## States

Each button carries its own states (`Button`, `IconButton`). The strap itself never scrolls away and never overlaps content. Disabled primary actions keep their slot and explain why in their hint.

## Density

Fixed heights; the row gap stays 10px. Labels are designed at the Ukrainian length ("Лікування", "Відпочинок").

## Accessibility

`<footer aria-label="Actions">`, zones as groups; every icon-only control has `aria-label` and a tooltip. Destructive Damage keeps its text.

## Tokens

`leather-highlight`, `leather`, `leather-dark`, `rivet-light`, `rivet`, `rivet-dark`, `brass`, `arcane-light`, `text-on-leather-2`, `border-brass`, `strap-height`, `tab-bar-height`, `texture-leather-tint`, plus the Button and IconButton tokens.
