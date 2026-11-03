# SearchField

A pill-shaped search input with the magnifying-glass glyph, used at the top of the Library, pickers and the satchel; results filter as you type and a small clear button appears when there is text.

## Anatomy

`hk-search` is a `<label>` wrapping the glyph (`accent-strong`, 18px), a visually hidden label text, the `<input type="search">` (`hk-search__in`, 16px Alegreya, italic `text-3` placeholder) and, when filled, a 28px clear `IconButton`. 36px high, `radius-seal`, `leaf-glow` fill with an `accent-strong` hairline and a soft inset; `hk-search--leather` sits on straps and the phone top bar (`recess` well, `brass` glyph, `text-on-leather`). `FilterChips` sit directly under it.

## States

Empty, typing (clear button visible), focus-within (two-tone ring on the pill), no results (an `hk-hint` under the chips: "Nothing matches 'xyz' in the installed packs").

## Accessibility

The label is the wrapping element, so clicking anywhere focuses the input; `type="search"` gives Escape-to-clear. Placeholder `text-3` on `leaf-glow` 5.5:1; `text-on-leather-3` placeholder on `recess` 9:1.

## Tokens

`leaf-glow`, `accent-strong`, `text-1`, `text-3`, `recess`, `border-brass`, `brass`, `text-on-leather`, `text-on-leather-3`, `focus-ring`, `focus-ring-outer`, `radius-seal`.
