# Banner

A full-width parchment notice at the top of a screen for things the user must act on before the screen is right: missing content packs (warning), campaign packs to pin (arcane), an app update (info); each with a title, one sentence and one or two actions.

## Anatomy

`hk-banner` (padding 10px 14px, `radius-leaf`): a 22px glyph, `hk-banner__body` with `hk-banner__title` (Forum 17px) and the sentence (15px), and `hk-banner__actions` (a brass primary, a parchment secondary or a dismiss `IconButton`). Variants: default = warning (`warning-soft` fill, `warning` hairline and glyph); `hk-banner--arcane` (`arcane-soft`, `arcane-strong`) for campaign relay notices; `hk-banner--info` (a plain leaf with the paper texture, `accent-strong` glyph).

## Rules

One banner at a time, above the first leaf, never over the rail. Dismissable only when the state can be ignored (update); pack banners stay until resolved. Copy says what is missing and what happens if ignored.

## States

Warning, arcane, info; busy (the primary shows the spinner); failed (an ember line under the sentence with the error, e.g. a pin failure).

## Accessibility

`role="status"` (or `alert` for failures); `text-1` on `warning-soft` 10:1, `warning` on `warning-soft` 5.8:1, `arcane-strong` on `arcane-soft` 6.5:1.

## Tokens

`warning-soft`, `warning`, `arcane-soft`, `arcane-strong`, `leaf`, `text-1`, `accent-strong`, `shadow-leaf`, `radius-leaf`, `brass-*`.
