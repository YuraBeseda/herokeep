# FeatureRow

One granted feature in the Features leaf: its source glyph, name, a level badge (or a source chip), and a details button; rows are grouped under source headers in a fixed order: Class (with the level gained), Subclass, Species, Background, Feats, Chosen options.

## Anatomy

- `hk-srcgroup`: the group header, Forum 17px with the source glyph in `accent-strong` and a fading rule: class icon (`templar-shield` paladin, `barbarian`, `lyre` bard, `holy-symbol` cleric, `oak-leaf` druid, `crossed-swords` fighter, `fist` monk, `bowman` ranger, `hood` rogue, `fire-spell-cast` sorcerer, `pentacle` warlock, `wizard-staff` wizard), subclass glyph, `hood` species, `medal` background, `laurel-crown` feats, `sword-array` chosen options.
- `hk-feat`: flex row, min-height 30px, 15px text: source glyph (18px, hint "From Paladin, level 3"), name, `hk-lvlbadge` (Forum 14px on `leaf-sunken`, hint "Gained at level 3") for class and subclass rows or an `hk-chip` naming the source for species / background / feats / chosen, and the details `IconButton` (`info`, opens the DescriptionDrawer).
- Two columns on desktop, one on phones.

## Rules

Items and spells never appear here; resources with uses appear in Resources, and only their rule text here. Names are the pack's own; no inline descriptions.

## States

Static; rows from an inactive multiclass level dim to 60% with "needs level 2" in the hint.

## Density

Compact 30px rows in two columns; comfortable 36px in one column.

## Accessibility

Glyphs are `role="img"` with the source as their label; the details button is `aria-label="Details: <name>"`. Ink 11.6:1; badges `text-2` on `leaf-sunken` 5.6:1.

## Tokens

`text-1`, `text-2`, `accent-strong`, `leaf-sunken`, `leaf-edge`, `chip-bg`, `chip-border`, `leaf-glow` (details button).
