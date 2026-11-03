# InspirationToggle

A brass-knobbed leather toggle for heroic inspiration: on means it is available and pressing it spends it; off means none and pressing it marks a grant; it lives on the folio's vitals plate (highlighted when available) and on the Hero tab.

## Anatomy

`hk-toggle`: a `<button aria-pressed>` with `hk-toggle__track` (44×24, `recess` well with `border-brass`; brass gradient when on) and `hk-toggle__knob` (20px leather disc with a brass ring; brass when on, sliding over `duration-fast`), followed by the state word ("available" / "none"). On the folio it sits inside a `StatTile` (`hk-vplate--on` adds the brass ring and glow when available). The `inspiration` glyph marks it everywhere; the DM's party-card chip "Inspiration" grants it remotely.

## States

Off, on (available), focus-visible, disabled when the campaign forbids self-granting (hint explains).

## Accessibility

Toggle semantics via `aria-pressed`; the label names both the state and the effect of pressing. Track on vs off differs in lightness (brass vs recess) and the word is always beside it.

## Tokens

`recess`, `border-brass`, `brass`, `brass-top`, `brass-mid`, `brass-shadow`, `leather-highlight`, `leather-dark`, `text-on-leather`, `text-on-leather-2`, `shadow-glow-brass`, `duration-fast`.
