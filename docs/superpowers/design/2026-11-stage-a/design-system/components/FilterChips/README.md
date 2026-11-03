# FilterChips

A row of toggle chips under a search field (or in the action strap's Filter sheet): each chip is a pressed / unpressed button, selected chips turn brass, and damage-type chips carry their ink dot.

## Anatomy

`hk-chip hk-chip--l hk-chip--btn` (30px, 16px text) as `<button aria-pressed>`: `chip-bg` with `chip-border`, optional leading glyph in `accent-strong`, optional count `hk-btn__badge`. Selected `hk-chip--selected`: brass gradient with `text-on-brass`. `hk-chip--damage` with `--dmg: var(--damage-<type>)` draws the dot and the word in that ink on `leaf-sunken`. Groups are `role="group"` with a label; chips wrap on desktop and scroll sideways on phones.

## States

Off, on (brass), hover, focus-visible, disabled with the reason in `title` ("No cantrips in the installed packs"). Clearing: a trailing ghost "Clear filters" chip appears when any is on.

## Accessibility

`text-1` on `chip-bg` 9:1; `text-on-brass` on brass 6.6:1; every `damage-*` ink 4.5:1+ on `leaf-sunken`. State is never colour alone: `aria-pressed` plus the brass fill's lightness change.

## Tokens

`chip-bg`, `chip-border`, `text-1`, `accent-strong`, `brass-top`, `brass`, `brass-mid`, `text-on-brass`, `leaf-sunken`, `leaf-edge`, `damage-*`, `focus-ring`, `focus-ring-outer`.
