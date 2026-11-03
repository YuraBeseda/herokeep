# WaxSeal

The signature mark of the system: a hand-pressed blob of red wax with an embossed glyph or level numeral; filled wax means a resource is available, a pale cooled ring means it is spent. Spell slots, resource pips, proficiency marks, selection and done-steps all use it.

## Anatomy

A 64-unit SVG drawn by the `x-seal` helper (see `tools/build.cjs` in the design kit, to be ported as an Angular component): a wobbly outer blob (20 points, 7% wobble, `seed` varies the shape), a soft shadow (`wax-ink` 45%), radial fill `wax-light` / `wax` / `wax-dark`, a stamped disc `wax-rim` stroked `wax-rim-dark` with an offset `wax-rim-light` highlight, a specular ellipse, and either:

- a glyph: three stacked copies in `wax-ink` (+0.7 offset), `wax-sheen` (-0.7) and `wax-glyph`, or
- a numeral (Forum, 18px in s/m, 23px in l) in `wax-ink` shadow + `wax-emboss` face.

Spent: `wax-spent-light` / `wax-spent` / `wax-spent-dark` body, `wax-spent-inner` disc stroked `wax-spent-rim`, a dashed `wax-spent-dash` ring, numeral in `wax-spent-ink`.

## Sizes

s 24px (slot rows), m 28px (pips, selection marks), l 46-58px (ability modifiers, phone saves). Row gap 3-4px.

## States

Filled (available), spent, disabled (`hk-seal--disabled`: 45% + desaturated, e.g. charges of an unattuned wand), selected (`hk-seal--selected`: brass glow, picker cards and done steps). As a control wrap it in `hk-seal-btn` (a `<button>` with `aria-label`); spending animates over `duration-base` (scale down + fade to spent) unless reduced motion.

## Hints

Every seal has a hint: "Spell slot, level 1 — 3 of 4 left", "Use available (Channel Divinity, short rest)", "Charge spent". A row of seals is a `role="group"` with the aggregate label; the level numeral I, II, III… is embossed on spell-slot seals (owner fix 2).

## Accessibility

`wax-emboss` numeral on `wax-rim` 5.6:1 (24px glyph floor 3:1); `wax-spent-ink` on `wax-spent-inner` 4.6:1. Filled vs spent differ in lightness and shape, never hue alone. In plain the gradients collapse to flat fills and the sheen is hidden.

## Tokens

`wax`, `wax-light`, `wax-dark`, `wax-rim`, `wax-rim-dark`, `wax-rim-light`, `wax-sheen`, `wax-ink`, `wax-emboss`, `wax-glyph`, `wax-spent`, `wax-spent-light`, `wax-spent-dark`, `wax-spent-rim`, `wax-spent-inner`, `wax-spent-dash`, `wax-spent-ink`, `brass-top` (selected glow), `duration-base`.
