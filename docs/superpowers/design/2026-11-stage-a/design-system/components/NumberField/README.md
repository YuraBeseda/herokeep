# NumberField

A numeric input drawn as a well with a Forum numeral and round − / + buttons either side, used for HP, damage and heal amounts, rounds, coins and levels; plus the plain text field, its error state and the same label pattern for selects and textareas.

## Anatomy

- `hk-numfield`: grid 36px · 78px · 36px (`hk-numfield--phone` 44 · 88 · 44). `hk-numfield__in` is a real `<input type="number">` with the spinners hidden: on leather a `recess` well with a `brass` border and `text-on-leather` 24px Forum (26px phone); `hk-numfield--leaf` uses `leaf-glow` with an `accent-strong` border and `text-1`. The − / + are `IconButton`s (leaf or leather variants; the HP field uses the ember − and a brass +).
- `hk-field`: label above (`hk-field__label`, 14px `text-2`, `text-on-leather-2` on leather), the control, and `hk-field__msg` below (italic hint, or `hk-field__msg--error` in `danger-strong` with a glyph).
- `hk-input`: 36px text field on `leaf-glow` with an `accent-strong` border, 16px Alegreya, italic `text-3` placeholder; `hk-input--error` doubles the border in `danger-strong`. Selects and textareas (notes) share the same frame; textareas grow to 6 rows.

## States

Default, focus (two-tone ring on the well), at min / max (the button disables and its hint says why: "Exhaustion caps at 6"), error (`aria-invalid` + message linked by `aria-describedby`), disabled.

## Density

Fixed control sizes; comfortable adds 4px between label and control.

## Accessibility

Always a visible `<label for>`; the − / + buttons have labels naming the step ("Damage 1"). Numerals `text-on-leather` on `recess` 15:1; `text-1` on `leaf-glow` 12:1; placeholder `text-3` 5.5:1.

## Tokens

`recess`, `brass`, `brass-top`, `text-on-leather`, `text-on-leather-2`, `leaf-glow`, `accent-strong`, `text-1`, `text-2`, `text-3`, `danger-strong`, `ember`, `focus-ring`, `focus-ring-outer`, `radius-leaf`, `control-phone`.
