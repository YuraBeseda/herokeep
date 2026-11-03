# StatTile

A small sunken leather plate for one vital (initiative, speed, proficiency bonus, hit dice, passive perception, inspiration): gold label above, Forum value with its glyph below; plus the two tiny brass and leather plates used for ability scores and saving throws.

## Anatomy

- `hk-vplate`: gradient `plate` to `plate-bottom`, inset shadow + `border-brass` hairline, radius 4px, padding 6px 7px, min-height 56px. `hk-vlabel` 14px `text-on-leather-2`; `hk-vval` Forum 21px `text-on-leather` with a 16px glyph in `brass`.
- `hk-vplate--on`: a highlighted plate (brass ring + glow) for inspiration when available.
- `hk-plate`: the brass number plate (22px, Forum 15px, `text-on-brass`) for ability scores, quantities and "+1" bonus tags.
- `hk-save`: the leather save plate (22px, shield glyph in `brass`, Forum 15px `text-on-leather`); `hk-save--prof` adds the `star` in `brass-top` for a proficient save, with the hint "Saving throw, proficient".

## States

Static; an overridden value shows the quill glyph in its hint; inspiration toggles `hk-vplate--on`.

## Density

Compact: a 3-column grid at 84px + 2 columns in the folio; comfortable: 2 columns, min-height 64px.

## Accessibility

Each plate is a labelled pair (label text precedes the value). `text-on-leather` on `plate` 12:1, `text-on-leather-2` 8.5:1; `text-on-brass` on brass 6.6:1. The proficient star is backed by the hint text.

## Tokens

`plate`, `plate-bottom`, `border-brass`, `brass`, `brass-top`, `brass-mid`, `text-on-leather`, `text-on-leather-2`, `text-on-brass`, `shadow-brass`, `shadow-glow-brass`.
