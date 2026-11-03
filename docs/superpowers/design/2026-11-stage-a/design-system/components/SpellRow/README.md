# SpellRow

A prepared spell in the Spells leaf, grouped under a level header whose slots are wax seals embossed with the level numeral; each row has the spell's glyph, name, optional marks (concentrating orb chip, always-prepared fleur-de-lys) and a Cast button.

## Anatomy

- Level header `hk-lvl`: "Level 1" in Forum 17px, `hk-seal-row` of `WaxSeal` s (24px) with `text` I / II / III…, the count "3 / 4", a fading rule and the recharge hint. Each seal's hint: "Spell slot, level 1 — 3 of 4 left" (the group) / "available" / "spent".
- `hk-srow`: grid 22px glyph · name · button, min-height 28px, 16px text. Glyph in `accent-strong` from the spell's school or effect (`fire-spell-cast`, `healing`, `holy-symbol`, `shield`…).
- Marks: `hk-chip--arcane` "concentrating" with the `concentration-orb` glyph (hint "Concentrating on Bless, round 3"); `fleur-de-lys` in `accent-strong` = always prepared (hint "Always prepared (Oath of Devotion)"); no legend line.
- Cast: brass `Button` 28px with `fire-spell-cast`; disabled with the reason in `title` when no slot of that level is left ("No level 2 slot left; cast with a higher slot?"). Unprepared spells sit at 60% with a ghost Prepare button (`spell-book`).
- The concentration ribbon (arcane gradient, `text-on-arcane`, notched bottom) hangs off the leaf's top-right while concentrating; the same note appears on the action strap.

## States

Prepared, not prepared, concentrating, no slot, ritual (`hk-chip` "ritual"), upcast picker on Cast when higher slots exist.

## Density

Compact 28px rows; `hk-srow--comfortable` 36px. Phone: the Spells tab lists levels as `Tabs` straps when more than 3 levels.

## Accessibility

Seals and rows carry full hints; `text-on-arcane` on `arcane-strong` 7:1; `accent-strong` marks 3.7:1 on leaf with text backing in the hint.

## Tokens

`text-1`, `text-2`, `accent-strong`, `arcane`, `arcane-strong`, `arcane-deep`, `text-on-arcane`, `leaf-edge`, `brass-*` (Cast), the WaxSeal tokens, `night-sleep`/`campfire` hints in `hk-hint`.
