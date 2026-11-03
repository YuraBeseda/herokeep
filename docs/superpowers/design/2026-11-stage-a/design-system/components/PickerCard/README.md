# PickerCard

A parchment card for one option in a picker grid (species, background, class, subclass, feat, spell, item, fighting style, mastery): glyph and title, a one-line description, meta chips and a Choose button; selected cards wear a wax seal, gated options stay listed but disabled with the reason on the card and in the hint.

## Anatomy

`hk-card` (a `<button aria-pressed>`, 220px wide in a responsive grid that uses the full height, no inner scroll box): paper gradient, `radius-frame`, `shadow-leaf`, padding 12px. `hk-card__head` (20px glyph in `accent-strong` + `display-s` title), `hk-card__desc` (14/20 `text-2`, the pack's first sentence), `hk-card__foot` with `hk-chip` meta (hit die, key abilities, level, school) and a 28px brass Choose or parchment Details. Tapping the card body opens the `DescriptionDrawer` with a Choose button there too.

## States

- Default; hover (brightness); focus-visible (two-tone ring).
- Selected `hk-card--selected`: brass 2px ring + glow and a `WaxSeal` with the check glyph at the top-right (`hk-card__seal`); `aria-pressed="true"`.
- Gated `hk-card--gated`: `aria-disabled`, title and description at 60%, the reason in `hk-card__gate` (`padlock` + `danger-strong` italic) and in the hint; still opens the drawer so the reason can be read in full.
- Disabled (already taken, e.g. a duplicate skill): same as gated with "already chosen".

## Density

Compact 220×150; comfortable 240×170. Phone: cards stretch to the column; the drawer becomes a bottom sheet.

## Accessibility

`aria-describedby` links the gate reason; selected state is `aria-pressed`. Ink 11.6:1, `text-2` 6.2:1, gate text `danger-strong` 5.6:1 on leaf.

## Tokens

`leaf-glow`, `leaf`, `leaf-dark`, `text-1`, `text-2`, `accent-strong`, `chip-bg`, `chip-border`, `brass`, `shadow-leaf`, `shadow-glow-brass`, `danger-strong`, `radius-frame`, the WaxSeal tokens.
