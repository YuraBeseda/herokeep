# ItemRow

The phone's ledger row for one carried item: a leather glyph ring, the name over a sub-line (rarity, weight, charges), the same equipped / attuned / quantity marks as the satchel slots, and a details button; selecting a row reveals the selected-item strip beneath it.

## Anatomy

`hk-item`: grid 32px ring · name block · marks · 44px button, min-height 44px, 16px `text-1`, a `leaf-edge` hairline between rows. `hk-iring--l` 32px with the item glyph in `brass-top`; `hk-item__sub` 14px `text-2` (the rarity word may take its `damage-*`-style ink only as a tint, never alone); `hk-item__marks` holds `hk-tagE`, `hk-gem`, `hk-qty` in static position; the details `IconButton` (44px, leaf variant). The selected row takes a `leaf-sunken` band and the strip (Use · Attune · Equip · Details) in 44px buttons.

## States

Default, selected (band + strip), equipped, attuned, out of charges, unidentified (name in italic `text-2` with "unknown item").

## Density

Rows 44px (touch floor); comfortable 52px. On desktop the satchel grid replaces this list.

## Accessibility

Rows are buttons or contain one; marks are `role="img"` with their meaning in the row's language; the details button names the item. Ink 11.6:1, sub-line 6.2:1.

## Tokens

`text-1`, `text-2`, `leaf-edge`, `leaf-sunken`, `brass-top`, `leather-highlight`, `leather-dark`, `brass`, `text-on-brass`, `arcane`, `arcane-light`, `arcane-deep`, `control-phone`.
