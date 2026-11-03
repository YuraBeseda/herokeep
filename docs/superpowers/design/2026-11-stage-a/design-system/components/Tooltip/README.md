# Tooltip

The hint: a small parchment slip that names what a glyph means or does, shown on hover and keyboard focus after 300ms and on long-press (400ms) on touch; it is the whole UI's replacement for legends, so every icon-only control and every meaning-bearing mark has one.

## Anatomy

`hk-tip`: `leaf` fill, `text-1` in `body-s` (14px), padding 7px 10px, radius 4px, `shadow-tooltip` (hairline `leaf-edge` + drop), a 9px rotated-square arrow. Position below the anchor by default (`top: 100% + 10px`); `hk-tip--above` and `hk-tip--left` flip it. Optional second line `hk-tip__sub` in `hint` style (italic, `text-2`, 13px) for the detail: "3 of 4 left · long rest", "from Giant Spider".

## Behaviour

- Anchor gets `aria-describedby` pointing at the tip (`role="tooltip"`); the anchor's own `aria-label` carries the same primary text so screen readers never depend on hover.
- Delay `hint-delay-hover` (300ms) on hover/focus, `hint-delay-touch` (400ms) long-press on touch; fade in `duration-fast`; Escape and blur hide it.
- Text is the full, untruncated meaning. Where the UI truncates a label with an ellipsis, the tooltip repeats the full label.
- Never interactive content inside; for actions use `DescriptionDrawer` or a popover.

## The hint rule

A glyph that encodes state (proficiency dot, save shield, oath mark, equipped tag, attuned gem, disadvantage mark, concentration orb, rarity rim, spell-slot seal) must have a hint. Inline legends ("filled dot = proficient") are removed everywhere; a "?" help popover may repeat them.

## Accessibility

Contrast `text-1` on `leaf` 11.6:1, `text-2` sub-line 6.2:1. Hints never appear only on hover for essential information: the same text is the control's accessible name.

## Tokens

`leaf`, `leaf-edge`, `text-1`, `text-2`, `shadow-tooltip`, `hint-delay-hover`, `hint-delay-touch`, `duration-fast`.
