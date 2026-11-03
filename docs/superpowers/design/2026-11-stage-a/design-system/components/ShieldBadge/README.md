# ShieldBadge

Armor class drawn as a brass heater shield with the number in Forum on a dark plate; on phones the same value sits in a leather badge row with initiative and speed.

## Anatomy

- Desktop: an 82×96 SVG: shadow (`leather-edge` 60%), brass face (`hkShieldBrass` gradient `brass-top` / `brass` / `brass-bottom`, `brass-shadow` stroke), inner plate (`plate`, `rivet-dark` stroke), the AC in `numeral-l` (40px) `text-on-leather`. A 56×66 size fits party cards and the phone header.
- A temporary modifier (Shield of Faith, cover) shows as an arcane chip under the shield and in the hint: "Armor class 20, +2 from Shield of Faith".
- Phone: `hk-badge` (leather gradient, brass hairline, stitch) with `hk-badge__l` label (14px `text-on-leather-2`) and `hk-badge__v` value (Forum 28px `text-on-leather`, glyph in `brass`). Three badges make the vitals row: Клас броні · Ініціатива · Швидкість.

## States

Static value; a modified AC shows the chip; an override (Edit) shows the quill glyph in the hint.

## Accessibility

`role="img"` with the full value and its sources. Numeral `text-on-leather` on `plate` 12:1 (24px+ floor 3:1).

## Tokens

`brass-top`, `brass`, `brass-bottom`, `brass-shadow`, `plate`, `rivet-dark`, `leather-edge`, `leather-highlight`, `leather-dark`, `border-brass`, `stitch`, `text-on-leather`, `text-on-leather-2`, `arcane-strong`, `text-on-arcane`.
