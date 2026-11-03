# SatchelGrid

The bag drawn as an open leather satchel: handle, folded-back flap with a brass buckle, and a recessed cavity holding a 4×4 grid of leather slots, each with a brass-rimmed item glyph, caption and sub-caption, plus marks for quantity, equipped, attuned and rarity; a selected-item strip under the grid offers Use · Attune · Equip · Details.

## Anatomy

- `hk-satchel`: the handle (an SVG arc in `recess` / `leather-highlight` with a stitch), `hk-satchel__flap` (54px, `leather-light` gradient, `radius-strap` top corners, title in Forum `brass-top`, Add item button), `hk-satchel__buckle` (brass square + strap), `hk-satchel__body` (leather gradient, 30px bottom corners, `shadow-raised`, stitch).
- `hk-satchel__grid`: 4 columns, gap 6px, on a `recess` floor with a deep inset.
- `hk-slot` (`<button>`, min-height 90px, `radius-slot`, `slot` to `slot-bottom` gradient, `shadow-inset-slot`): `hk-slot__ico` (32px leather disc with brass ring, glyph in `text-on-leather-2`), `hk-slot__cap` 14px `text-on-leather`, `hk-slot__sub` in `text-on-leather-3` (weight, rarity word, charges, uses).
- Marks: `hk-qty` brass plate top-right ("×4", hint "Quantity 4"); `hk-tagE` brass "E" top-left (hint "Equipped"); `hk-gem` violet diamond beside it (hint "Attuned"); `hk-slot--rarity` with `--rim` set to a `rarity-*` token draws a 2px inset rim (common parchment, uncommon green, rare blue, very rare violet, legendary orange) and the rarity word is always in the sub-caption.
- `hk-slot--on`: selected (brass ring + glow, `aria-pressed`). `hk-slot--empty`: an empty slot (recess with a brass hairline).
- Selected-item strip: name with glyph, dark chips (weight, rarity), then `Button`s Use (brass, `hand-ok`), Attune (`gem-pendant`), Equip (`gauntlet`), Details (`info`).

## States

Empty, filled, selected, equipped, attuned, out of charges (sub-caption "0/7" in `danger-on-leather`), over capacity (the grid grows by rows; the WeightStrap goes amber).

## Density

4 columns on desktop, 3 on tablets; phones use the `ItemRow` ledger list instead.

## Accessibility

The grid is a list; each slot's `title` is the full sentence ("Ring of Protection, rare, equipped, attuned") and the marks are `role="img"` with their meaning. Captions `text-on-leather` on `slot` 12:1, sub-captions `text-on-leather-3` 7.5:1, rims 3:1+ on `slot`.

## Tokens

`leather`, `leather-light`, `leather-highlight`, `leather-dark`, `recess`, `slot`, `slot-bottom`, `border-brass`, `stitch`, `brass`, `brass-top`, `brass-mid`, `brass-bottom`, `text-on-brass`, `text-on-leather`, `text-on-leather-2`, `text-on-leather-3`, `arcane`, `arcane-light`, `arcane-deep`, `rarity-common`, `rarity-uncommon`, `rarity-rare`, `rarity-very-rare`, `rarity-legendary`, `shadow-inset-slot`, `shadow-raised`, `shadow-glow-brass`, `radius-slot`, `radius-strap`.
