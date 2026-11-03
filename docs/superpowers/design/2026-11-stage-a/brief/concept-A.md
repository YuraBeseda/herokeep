# Concept A — "Tavern Table"   (ConceptId: A)

## The idea in one line
Your sheet is a leather folio and loose parchment leaves lying on a dark oak tavern table at night, lit by candles. Everything is a physical object you could pick up: brass-riveted frames, wax seals, a real satchel for the bag.

## Reference feel (do not copy any product)
Dark-fantasy CRPG sheets (Baldur's Gate-style warmth and gilt), but material and tactile rather than glossy. Game-UI level 4.5 of 5.

## Palette (commit; derive tints from these only)
- Oak table ground: #241710 with a visible wood-grain texture (feTurbulence stretched horizontally, low contrast) and a warm candle vignette (radial gradient, amber #6B4A1E at 25 % from the top-right).
- Parchment panels: #E9DCBB, edges darkened to #CBB68C; ink text #2B2118; secondary ink #5B4A36.
- Leather (folio, straps, bag): #4A2E1E with #6A4630 highlights; stitching as dashed strokes #C9A24E at 40 %.
- Brass (frames, rivets, icons on leather): #C9A24E, dark brass #8A6A2A.
- Ember (HP, damage, danger): #B8432A. Arcane (spell slots, magic): #6F5AA8. Moss (success, healing): #5F7A3C. Gold coin #E0B64A, silver #C8CDD3, copper #B5693A, platinum #E6E9EF.

## Type
- Display: **Forum** (Roman capitals feel; Cyrillic OK) for the name, section titles, big numbers.
- Body: **Alegreya** 400/700, italics for notes and hints.
- Numbers: Forum, tabular if possible; HP and AC are the largest glyphs on the board.

## Desktop layout (1440 wide; fits 1440 × 960 with little or no scroll)
```
┌──────────── top rail: brass icon nav (Home Heroes Campaigns Library Packs Settings) ── account ─┐
│ ┌ FOLIO (left, ~360px) ───────┐ ┌ TABLE CENTRE (~640px) ─────────────┐ ┌ RIGHT (~360px) ──────┐ │
│ │ portrait in brass frame      │ │ parchment leaf: ATTACKS table       │ │ parchment: SPELLS    │ │
│ │ name plate (brass)           │ │ (3 rows, roll buttons as d20 brass) │ │ slots = wax seals    │ │
│ │ HP as a leather strap gauge  │ │ parchment leaf: RESOURCES (pools    │ │ prepared list, Cast  │ │
│ │ AC shield badge, speed, init │ │ with wax-seal pips), CONDITIONS     │ │ concentration ribbon │ │
│ │ abilities as 6 wax seals     │ │ chips, death saves, inspiration     │ ├──────────────────────┤ │
│ │ saves + skills (two columns) │ │ parchment leaf: FEATURES (short)    │ │ SATCHEL (bag): open  │ │
│ └──────────────────────────────┘ └─────────────────────────────────────┘ │ leather bag SVG with │ │
│   sheet tabs: Play · Build · Timeline · Level up (brass tabs on folio)  │ item slot grid inside│ │
│                                                                          │ coin pouch (4 coins) │ │
│                                                                          │ weight strap         │ │
├─────────── ACTION BAR: a brass-riveted leather strap, fixed bottom: Damage Heal Roll Short rest Long rest | + condition, notes, export, edit ─┤
```
- Parchment leaves are slightly rotated (±0.4°) and overlap edges by a few px so they read as paper on a table, never as cards with drop shadows. Paper shadow: soft, warm, offset down-right.
- Spell slots and resource pips are **wax seals**: filled = red wax with an embossed symbol, spent = a pale wax ring. This is the signature element; make it beautiful.
- Bag: draw an open leather satchel silhouette (SVG, flap folded back, brass buckle) and place a 4 × 4 slot grid inside it; each slot is a recessed leather square with a brass-rimmed icon; equipped items show a small brass "E" tag, attuned a violet gem; quantities as a brass number plate. Beside the bag a drawstring coin pouch with the 4 coin types as stacked discs with counts, and a leather weight strap "108 / 240 lb".
- Icon nav along the top is a brass rail: icons only, with a visible tooltip on one of them ("Campaigns") to show the hint pattern.

## Phone (390 × 844, Ukrainian, Combat tab)
Folio header: portrait small, name, "Паладин 5", HP strap gauge full width. Then AC/Ініціатива/Швидкість as three brass badges, saves as a row of six tiny wax seals, attacks as parchment rows with brass d20 buttons, resources, conditions chips, death saves, inspiration. Bottom: a leather strap tab bar (5 brass icons + labels). Action row above the strap: Шкода · Лікування · Кинути · Відпочинок.

## Do not
No flat white cards, no generic drop-shadow cards, no neon, no blue, no gradient washes, no ALL-CAPS labels except nothing. Keep the brass restrained: frames and icons, not whole backgrounds.
