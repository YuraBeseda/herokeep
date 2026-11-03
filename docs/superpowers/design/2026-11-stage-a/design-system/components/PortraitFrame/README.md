# PortraitFrame

A brass frame with four rivets around the hero's portrait, falling back to a two-letter monogram in Forum on a dark well; it sits in the folio beside the brass name plate and on hero cards, party cards and the home Continue leaf.

## Anatomy

- `hk-frame`: brass gradient border (`brass-top` / `brass` / `brass-mid` / `brass-bottom`), `shadow-brass` bevel, 5px padding, radius 4px (12px `radius-frame` at l). Sizes: s 50×56 (3px padding), m 98×118 (default), l 140×168 (6px padding).
- `hk-frame__well`: the picture well, radial `leather-edge` to `ground` with an inset shadow; the `<img>` covers it; without an image the monogram (initials, 22 / 42 / 56px) in `brass`.
- `hk-frame__rivet`: 7px rivets in the corners (`rivet-*`; transparent in plain).
- `hk-frame__edit`: a small `IconButton` (quill) in the bottom-right corner when the portrait is editable (wizard step 1, Build tab).
- `hk-nameplate`: the brass name plate beside it, Forum 25px, `text-on-brass`, truncating with an ellipsis (full name in `title`).

## States

Static; editable adds the edit button; loading shows the monogram until the image arrives.

## Accessibility

The well is `role="img"` with "Portrait of <name>" or "Portrait placeholder, monogram IV". The image carries `alt`. Monogram `brass` on the well 7+:1.

## Tokens

`brass-top`, `brass`, `brass-mid`, `brass-bottom`, `brass-shadow`, `leather-edge`, `ground`, `rivet-light`, `rivet`, `rivet-dark`, `text-on-brass`, `shadow-brass`, `radius-frame`.
