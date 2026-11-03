# WeightStrap

Carried weight as a leather strap gauge: label, a status chip (lightly loaded, encumbered, heavily encumbered, over capacity), a brass fill that turns ember when over capacity, and "108 / 240 lb" in Forum.

## Anatomy

`hk-strap` with `hk-strap__label` (`weight` glyph), a `hk-chip--dark` status chip (glyph + word; the hint carries the effect: "Encumbered: speed −10 ft"), a 12px `hk-gauge` (`hk-gauge__brass` fill; darker brass ramp when past the first threshold; `hk-gauge__hp` ember at 100% when over capacity) and the numeral in `text-on-leather` (`danger-on-leather` when over). Units follow the pack and locale (lb / кг).

## States

Lightly loaded, encumbered, heavily encumbered, over capacity. The variant encumbrance thresholds are a per-character option; off, the only states are loaded and over capacity.

## Accessibility

The gauge is `role="img"` with the numbers and the state word; state is never colour alone (chip word + glyph). `text-on-leather` 9+:1, `danger-on-leather` 6.3:1 on leather.

## Tokens

`leather-highlight`, `leather`, `leather-dark`, `stitch`, `recess`, `border-brass`, `brass-top`, `brass`, `brass-mid`, `brass-bottom`, `ember-top`, `ember`, `ember-bottom`, `chip-dark`, `text-on-leather`, `text-on-leather-2`, `danger-on-leather`.
