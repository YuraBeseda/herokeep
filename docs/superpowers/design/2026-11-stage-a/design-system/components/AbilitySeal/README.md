# AbilitySeal

One of the six abilities as a large wax seal with the modifier embossed in it, the ability name in Forum beneath, and two small plates: the score on brass and the saving throw on leather with a star for proficiency; the wizard adds a brass "+1" tag on the seal for background or species bonuses.

## Anatomy

- `hk-ability`: a column, gap 4px. `WaxSeal` l (58px desktop, 46px phone) with `text` = the modifier (always signed, a real minus "−1").
- `hk-ability__name`: Forum 15px `text-on-leather` (folio) or `text-1` (leaf); phone saves row uses 13px three-letter abbreviations (СИЛ, СПР, СТА, ІНТ, МДР, ХАР) with the full name in the hint.
- `hk-plate` score (brass, hint "Score 16"); `hk-save` saving throw (leather, shield glyph, hint "Saving throw +6, proficient"); `hk-save--prof` adds the `star` in `brass-top`.
- `hk-ability__bonus`: a brass "+1" tag at the seal's top-right in the wizard's Ability scores step, hint "+1 from Soldier background".

## States

Static on the sheet; in the wizard the seal is a button (`hk-seal-btn`) that opens the assignment picker, selected = brass glow.

## Density

Desktop folio: a 3-column grid (two rows); comfortable spreads to 2 columns. Phone: a single row of six 46px seals on the Combat leaf.

## Accessibility

The seal is `role="img"` with "Strength 16, modifier +3"; the proficiency star is backed by the save plate's hint. Emboss `wax-emboss` on `wax-rim` 5.6:1 at 23px.

## Tokens

The WaxSeal tokens, `brass-top`, `brass`, `brass-mid`, `text-on-brass`, `plate`, `plate-bottom`, `border-brass`, `text-on-leather`, `text-1`, `accent-strong`.
