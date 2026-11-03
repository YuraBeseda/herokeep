# CoinPouch

The purse: a drawstring leather pouch beside four stacked coin discs (platinum, gold, silver, copper) with their counts in Forum, the total in gold, and an edit button that turns each metal into a NumberField; "Spend" takes a sum and makes change downward.

## Anatomy

A `hk-leather` strip: the pouch SVG (`leather`, `leather-highlight`, `leather-edge`, brass drawstring), four `hk-coinstack`s (six stacked ellipses alternating `coin-<metal>` and `coin-<metal>-shade`, Forum 17px count with the unit in `text-on-leather-2`), the total ("≈ 79 gp", Forum 19px) and the quill `IconButton`. Edit mode: `NumberField`s per metal on a leaf or in a bottom sheet.

## States

View, edit, zero (a stack still shows, count "0"), over the carry weight (coins count 50 per lb when the per-character encumbrance option is on; the WeightStrap reflects it).

## Accessibility

Each stack is `role="img"` "38 gold"; the metal is told by the word, not the disc colour. Counts `text-on-leather` on leather 9+:1.

## Tokens

`coin-platinum`, `coin-platinum-shade`, `coin-gold`, `coin-gold-shade`, `coin-silver`, `coin-silver-shade`, `coin-copper`, `coin-copper-shade`, `leather`, `leather-highlight`, `leather-light`, `leather-edge`, `brass`, `brass-top`, `stitch`, `text-on-leather`, `text-on-leather-2`.
