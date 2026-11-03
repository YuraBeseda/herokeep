# DescriptionDrawer

The one place every description opens (species, class, background, feat, spell, item, condition, mastery, fighting style): a parchment drawer sliding in from the right on desktop and tablet, a bottom sheet on phones, with the title, meta chips, the pack text and the context actions (Choose, Cast, Prepare, Equip…).

## Anatomy

- `hk-drawer` (`role="dialog" aria-modal`, 360px wide, full height) over `hk-overlay`: paper gradient, `shadow-raised`, padding 16px 18px, 15/1.4 body. `hk-drawer__head` with the entity glyph, `display-m` title and a small close `IconButton` (Esc closes too). `hk-drawer__meta` chips (level, school, concentration with the orb glyph, casting time, range; size and speed for species). Paragraphs from the pack via the Localizer, the source line in `hk-hint`, and the action row pinned at the bottom.
- Phone `hk-sheet`: the same drawer as a bottom sheet with `radius-strap` top corners, a `hk-sheet__grip`, 16px body, 44px controls; drag down or the close button dismisses it.
- Drawers close with the control that opened them and with Escape; they never change the URL.

## States

Open / closing (`duration-base` slide), loading (title + chips first), gated (the reason as an ember banner above the actions, the Choose button disabled).

## Accessibility

Focus moves to the title on open and returns to the opener on close; the overlay is inert. Ink 11.6:1 on the paper gradient; chips 9:1.

## Tokens

`overlay`, `leaf-glow`, `leaf`, `leaf-dark`, `text-1`, `text-2`, `accent-strong`, `chip-bg`, `chip-border`, `arcane-strong`, `text-on-arcane`, `shadow-raised`, `radius-leaf`, `radius-strap`, `duration-base`.
