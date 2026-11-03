# HpGauge

The hero's hit points as a leather strap with a brass buckle: the current value is the biggest numeral on the board, the gauge fills with ember for current HP and a brass hatch for temporary HP, and Damage / Heal controls sit on the strap (desktop) or as − / + around a number field (phone).

## Anatomy

- `hk-strap`: leather gradient, `shadow-strap`, dashed `stitch` inset, padding 9px 14px 9px 10px. A brass buckle (16×44, `brass-top` / `brass` / `brass-bottom`, `brass-shadow` ring, `recess` tongue) leads.
- Numerals: current in `numeral-xl` (44px here, 56px on the home leaf) `text-on-leather`; "/ max" at half size in `brass`. Tabular numerals so the strap never jitters.
- `hk-gauge` (14px, `recess` track, `border-brass` hairline): `hk-gauge__hp` width = current / (max + temp) in `ember-top` / `ember` / `ember-bottom`; `hk-gauge__temp` width = temp / (max + temp) as a 135° hatch of `brass-top` and `brass-mid`. The track reads `role="img"` with "31 of 44 hit points, plus 5 temporary".
- Labels `hk-strap__label` in `text-on-leather-2` with `heart` and `heart-armor` glyphs.
- Controls: desktop → `Button` ember Damage and moss Heal (the same two live on the ActionStrap; here they open the amount dialog). Phone → `NumberField` on leather with 44px ember − and brass +, the input itself editable.
- At 0 HP the strap shows the skull note in `danger-on-leather` and the DeathSaves tracker opens.

## States

Full, damaged, temp HP present, at 0 (death saves), over-max (temp). Damage applies with a short shake (`duration-slow`) unless reduced motion; heal glows moss for `duration-base`.

## Density

The strap keeps its height; comfortable density adds 4px to its padding.

## Accessibility

Numerals `text-on-leather` on leather 9+:1; `brass` "/ 44" 5.2:1; the hatch and the ember segment differ in lightness and pattern. The phone input has a visually hidden `<label>`.

## Tokens

`leather-highlight`, `leather`, `leather-dark`, `stitch`, `brass-top`, `brass`, `brass-mid`, `brass-bottom`, `brass-shadow`, `recess`, `border-brass`, `ember-top`, `ember`, `ember-bottom`, `text-on-leather`, `text-on-leather-2`, `danger-on-leather`, `shadow-strap`, `duration-base`, `duration-slow`.
