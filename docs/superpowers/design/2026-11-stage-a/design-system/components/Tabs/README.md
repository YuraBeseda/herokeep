# Tabs

Three tab shapes: brass folio tabs on leather for the sheet (Play · Build · Timeline + the Level up action) and the campaign (Party · Table · Lobby · Settings), chip tabs inside a leaf for sub-regions (spell levels, bag categories), and the phone's bottom leather tab bar with icons and labels.

## Anatomy

- `hk-tabs` / `hk-tab` (desktop, on the folio): 30px, Forum 15px, leather gradient with a brass hairline, `radius 4px 4px 0 0`; `hk-tab--on` is brass with `text-on-brass`; `hk-tab--action` is a brass-ringed tab-shaped action (Level up); `hk-tab--off` is disabled at 55% with a `padlock` and the reason in its hint. Tabs flex to equal widths and never wrap: at narrow widths the labels keep the glyph only (hint carries the word).
- Chip tabs inside a leaf: `FilterChips` styling with `role="tab"`; a level tab may carry tiny slot seals.
- Phone `hk-tabbar`: 60px (`tab-bar-height`) leather bar; `hk-tabb` buttons (24px glyph over a 13px label in `brass`); the current tab has the brass `hk-tabb__glow` and `text-on-brass`. Sheet tabs on phone: Combat · Spells · Bag · Hero · More; campaign: Party · Table · Lobby · Settings.

## Rules

Deep links restore the exact tab; tabs reflect the URL. A given action never changes slot between tabs (ActionStrap). Labels are designed at the Ukrainian length ("Налаштування").

## States

Selected, hover, focus-visible, disabled-with-reason, action (highlighted).

## Accessibility

`role="tablist"` / `role="tab"` with `aria-selected`, arrow-key movement; the phone bar is a `<nav>` with `aria-current`. `text-on-leather-2` tab labels on leather 8.5:1; `brass` glyphs 5.2:1; `text-on-brass` on brass 6.6:1. Phone labels are 13px (`caption`) by exception, backed by the glyph and hint.

## Tokens

`leather-highlight`, `leather`, `leather-dark`, `border-brass`, `brass-top`, `brass`, `brass-mid`, `text-on-brass`, `text-on-leather-2`, `shadow-glow-brass`, `radius-slot`, `tab-bar-height`.
