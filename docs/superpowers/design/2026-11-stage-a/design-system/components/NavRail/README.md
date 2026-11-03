# NavRail

The app's top navigation on desktop and tablet: a leather rail with a brass bar carrying six icon-only buttons (Home, Heroes, Campaigns, Library, Packs, Settings), the wordmark on the left and the campaign chip plus account button on the right; on phones it collapses into a slim top bar (folio button, screen title, one context action).

## Anatomy

- Rail: `hk-rail`, 60px (`rail-height`), gradient `leather-highlight` to `leather-dark`, leather texture, a 1px `brass-bottom` line and the raised shadow. Wordmark in `display-m` Forum, colour `brass`, with the `wax-seal` glyph.
- Nav bar: `hk-rail__bar` is the 5px brass rail the buttons sit on (`brass-top`, `brass`, `rivet-dark`).
- Buttons: `IconButton` (`hk-ico`), the current section `hk-ico--on` with `aria-current="page"`. Each has `aria-label` and a tooltip (`Tooltip`, shown open on Campaigns here).
- Right side: the current campaign as a `hk-chip` when one is open or the hero is linked; the account `IconButton` (`hood`).
- Phone (< 768px): `hk-topbar`, 52px, three columns 44px / title / 44px: the folio button opens the app drawer; `hk-topbar__title` truncates with an ellipsis and carries the full title in `title`.

## States

Current section (`hk-ico--on`, brass fill, dark glyph), hover (brightness), focus (`shadow-focus` two-tone ring), tooltip open on hover/focus after `hint-delay-hover`.

## Density

The rail height does not change with density; at 768px the wordmark becomes the mark only. The rail never wraps.

## Accessibility

`<nav aria-label="App">`; links are real `<a>`; the icons are `aria-hidden` with the label on the control. Contrast: `brass` glyphs on leather 5.2:1; tooltip ink `text-1` on `leaf`.

## Tokens

`leather-highlight`, `leather-dark`, `brass`, `brass-top`, `brass-bottom`, `rivet-dark`, `brass-shadow`, `text-on-leather`, `shadow-focus`, `rail-height`, `icon-button`, `texture-leather-tint`.
