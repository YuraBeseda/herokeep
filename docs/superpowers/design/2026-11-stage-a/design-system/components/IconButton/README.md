# IconButton

A round brass-rimmed button holding one glyph, always with an `aria-label` and a hint (tooltip on hover/focus, long-press on touch); it is how every repeated control on the rail, the action strap, leaf headers and rows is drawn.

## Anatomy

- `hk-ico`: 40px disc (`icon-button`), leather radial fill `leather-highlight` to `leather-dark`, double inset ring `brass` + `brass-shadow`, glyph in `brass` at 20-22px. A `::before` extends the hit area by 4px on each side (48px).
- `hk-ico--s`: 28px (`icon-button-s`) inside rows (details, remove); glyph 14px.
- `hk-ico--phone`: 44px (`control-phone`).
- `hk-ico--leaf`: on parchment, parchment fill with `accent-strong` ring and glyph.
- `hk-ico--ember`: destructive (remove a condition), `ember` fill with `text-on-ember` glyph.
- Hint: a `Tooltip` (`hk-tip`) as the last child, linked with `aria-describedby`, shown after `hint-delay-hover` (300ms) or `hint-delay-touch` (400ms).

## States

Default, hover (brightness 1.15), on/pressed (`hk-ico--on`: brass fill, `text-on-brass` glyph, `shadow-glow-brass`; set `aria-pressed` or `aria-current`), focus-visible (`focus-ring` inner + `focus-ring-outer` outer), disabled (`disabled`, 55% opacity; the reason goes in the hint, e.g. "Level up: not available, 6,500 of 14,000 XP").

## Density

Unchanged by density. Desktop pointer floor 36px hit area, touch floor 44px.

## Accessibility

Real `<button>` or `<a>`; the SVG is `aria-hidden`; the label is the hint text. Glyph contrast: `brass` on leather 5.2:1, `accent-strong` on leaf 3.7:1 (icon floor 3:1).

## Tokens

`brass`, `brass-top`, `brass-mid`, `brass-shadow`, `leather-highlight`, `leather-dark`, `text-on-brass`, `accent-strong`, `leaf-glow`, `ember`, `ember-bottom`, `text-on-ember`, `shadow-glow-brass`, `focus-ring`, `focus-ring-outer`, `icon-button`, `icon-button-s`, `control-phone`, `duration-fast`, `hint-delay-hover`, `hint-delay-touch`.
