# Leaf

The parchment section panel every sheet, picker and campaign screen is built from: a titled leaf of paper lying on the table, slightly rotated, with a warm shadow, optional header actions and optional tabs inside.

## Anatomy

- `hk-leaf`: radial paper gradient `leaf-glow` 0% / `leaf` 55% / `leaf-dark` 100%, `text-1` ink, radius `radius-leaf`, `shadow-leaf` (edge hairline + warm drop), padding 16px 18px (desktop) or `hk-leaf--phone` 12px with 16px body. A paper texture (`texture-parchment-tint`) sits under the content.
- `hk-leaf__head`: the title row. `hk-leaf__title` is an `<h2>` in `display-s` with a leading 20px glyph in `accent-strong`; `hk-leaf__actions` holds up to one `Button` (ghost) and small `IconButton`s.
- `hk-block`: a sunken sub-panel (`leaf-sunken` + `leaf-edge` inset) for grouped content.
- Tilt: ±0.2 to ±0.35deg (`leaf-tilt`), alternating down a column; none in plain or under reduced motion.

## Rules

- Body text ≥ 15px desktop / 16px phone on the leaf itself; never on textures stronger than the token.
- When a leaf grows past one screen it becomes tabs (`Tabs`) or a drawer, never a 6,000px page.
- The title names the section in sentence case; the glyph is the section's vocabulary icon.
- Leaves overlap neighbours by a few px at most; they never stack as cards with drop shadows.

## Accessibility

`<section aria-labelledby>` with the `<h2>` title; header actions are real buttons with hints. Ink contrast on `leaf` 11.6:1, `text-2` 6.2:1, on `leaf-dark` 5.3:1.

## Tokens

`leaf`, `leaf-glow`, `leaf-dark`, `leaf-sunken`, `leaf-edge`, `text-1`, `text-2`, `accent-strong`, `shadow-leaf`, `radius-leaf`, `space-4`, `texture-parchment-tint`, `leaf-tilt`.
