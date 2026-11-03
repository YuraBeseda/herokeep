# SkillRow

One skill in the skills list: a proficiency dot (empty, filled, or double-ringed for expertise), the skill name, an optional disadvantage mark, the modifier in Forum, and a small roll button; every mark explains itself on hover.

## Anatomy

- `hk-sk`: flex row, gap 7px, min-height 28px (`row-compact`) or 36px (`row-comfortable`), 15px text; `hk-sk--leather` on the folio (`text-on-leather`), default on a leaf (`text-1`).
- `hk-dot`: 10px ring in `brass` (folio) or `accent-strong` (leaf). `hk-dot--on` filled brass = proficient (hint "Proficient (+3)"); `hk-dot--x2` filled with a second ring = expertise (hint "Expertise (+6)"); empty = not proficient (hint "Not proficient"). Never a legend row.
- `hk-dis`: the disadvantage mark, `broken-arrow` glyph + the word in italic `danger-strong` (leaf) / `danger-on-leather` (folio), hint names the cause: "Disadvantage: chain mail". Advantage uses `arrow-cluster` in `success-strong`.
- Modifier: `numeral-m`-style Forum 17px, signed, tabular.
- Roll: `IconButton` small (`hk-ico--leaf hk-ico--s`, d20 glyph), hint "Roll Athletics"; on the folio the row itself is the roll target (the modifier is a button).

## States

Proficient / expertise / none; advantage / disadvantage; hover (row tint `leaf-sunken`); focus on the roll button. Rolls post to the roll log drawer and the campaign feed.

## Density

Compact 28px rows in two columns on the desktop folio; comfortable 36px rows in one column on phones and in the Hero tab.

## Accessibility

Dots and marks are `role="img"` with the state as their label and the hint as `title`; the roll button has `aria-label="Roll <skill>"`. Dot contrast `brass` on leather 5.2:1, `accent-strong` on leaf 3.7:1 (mark floor 3:1); disadvantage text 4.5:1+ on both grounds.

## Tokens

`brass`, `brass-top`, `brass-bottom`, `accent-strong`, `text-1`, `text-on-leather`, `danger-strong`, `danger-on-leather`, `success-strong`, `leaf`, `leather`, `row-compact`, `row-comfortable`.
