# ConditionChip

An active condition as an ember chip: glyph, name and a duration badge ("3 rounds", "1 min", "until short rest", "until long rest", a level numeral for exhaustion, or none when indefinite); tapping expands it for −/+ on rounds, Edit and End, and the hover hint reads the whole story ("Poisoned, 3 rounds left, from Giant Spider").

## Anatomy

- `hk-cond`: 36px, `danger-soft` fill, `danger-border` hairline, `danger-strong` ink; `hk-cond--arcane` for beneficial magical effects (Blessed) in `arcane-soft` / `arcane-strong`.
- `hk-cond__main`: the button that expands (`aria-expanded`), with the condition glyph (`skull` by default; the pack may name another), the name and `hk-cond__dur` (Forum 14px on an 8% dark plate).
- `hk-x`: a 36px hit area around a 22px `ember-bottom` disc with a cross: End, hint "End Poisoned".
- Expanded `hk-cond--open`: the source line in `hk-hint`, then `hk-cond__edit`: small − / + `IconButton`s around the Forum count (rounds or minutes), a parchment Edit `Button` (opens the add-condition sheet pre-filled) and an ember End.
- Leaf header: the dashed ghost "Add condition" and, if the owner keeps it, the `hourglass` "Advance round" button that decrements every round-based duration by one (open call 3).

## The add-condition sheet

Asks: condition (picker with descriptions), level when level-bearing (capped by the pack), duration type (rounds, minutes, until short rest, until long rest, indefinite) and amount, optional source note. Users decrement manually; nothing expires on its own.

## States

Collapsed, expanded, beneficial (arcane), expiring (0 rounds: badge reads "ends now" in bold), on a party card (read-only, DM taps to open the member's sheet).

## Accessibility

`danger-strong` on `danger-soft` 5.6:1; `arcane-strong` on `arcane-soft` 6.5:1; controls are 36px (44px on phone). The chip's full text is both its hint and the accessible name of `hk-cond__main`.

## Tokens

`danger-soft`, `danger-border`, `danger-strong`, `ember-bottom`, `text-on-ember`, `arcane-soft`, `arcane-strong`, `text-on-arcane`, `text-2`, `leaf-glow`, `brass-*` (Edit), `duration-fast`.
