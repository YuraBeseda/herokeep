# IconVocabulary

The complete glyph vocabulary of the app with the hint text each glyph carries, grouped as navigation, actions, sheet, abilities, classes, conditions and marks, coins and rarity; it is the reference the engineer builds the SVG sprite from and the owner reviews the hint copy against.

## Source and licence

game-icons.net (CC BY 3.0; authors are credited on the About screen: Lorc, Delapouite, Skoll, sbed, Willdabeast, Caro Asercion, Quoting and others as listed in the sprite manifest). Bodies are 512-box paths set to `fill="currentColor"`; the nine "circle" style glyphs (heart, shield, skull, star, cog, eye, plus, minus, anvil) are used with their background discs stripped and a 216-unit viewBox so they match the others in weight. Inline the sprite per route group; never load icons by URL.

## The hint rule

Every icon-only control has `aria-label` and a `Tooltip`; every meaning-bearing glyph (proficiency dot, save shield, oath mark, equipped tag, attuned gem, disadvantage mark, concentration orb, rarity tint, spell-slot seal) explains itself on hover / long-press. No legend rows anywhere; a "?" help popover may repeat them.

## Changes from concept A (owner fix 2)

- Concentration: `concentration-orb` in `arcane-strong`, hint "Concentrating on Bless, round 3" (the owner kept the concept's orb; the spec's eye glyph is not used).
- Spell slots: wax seals embossed with the level numeral I / II / III…, hint "Spell slot, level 1 — 3 of 4 left" (were fleur-de-lys seals).
- Javelin: `thrown-spear` (was `spears`); weapons always use weapon glyphs, never action glyphs.
- Heroes: `person`; campaigns: `three-friends`; packs: `chest`; account: `hood`; speed: `running-shoe`; damage: `broken-heart`; notes: `scroll-unfurled`; condition: `skull` (the concept used `character`, `flag-objective`, `stack`, `boots`, `health-decrease`, `notebook`, `poison-bottle`).

## Substitutions

Every name in the spec exists in the set; `hand-ok` and `thrown-spear` come from the full repository (Delapouite, Lorc) rather than the kit subset. `gauntlet` serves both equip and unequip (outlined when already equipped). The "theme" toggle uses `sun` for scroll and `moon` for tavern; plain is chosen in Settings.

## Tokens

Glyphs inherit `color`: `accent-strong` on parchment, `brass` / `brass-top` on leather, `text-on-brass` on brass, `arcane-strong` for concentration, `danger-strong` for disadvantage, `success-strong` for advantage; `class-*` tints are available but off by default (open call 2).
