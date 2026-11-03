# Concept A v2 — "Tavern Table" with the owner's four fixes

Built from the v1 templates (`A2-*.src.html` + `build.cjs`, copied from `out/A`), everything else unchanged.

## Measurements
- Desktop `document.documentElement.scrollHeight` at 1440 px: **1393 px** (v1 was 1244; the grouped Features leaf and the expanded condition slip add content) → `$preview {"width":1440,"height":1393}`.
- At 1440 × 960 the first screen still shows HP, AC, speed, saves, attacks, resources, both slot rows and all ten spells, the condition chips with the open slip, death saves and the satchel's first two rows. The coin pouch and weight strap now sit under the satchel (right column) to keep the three columns balanced.
- Phone 390 × 844: attacks leaf bottom at **679 px**, action row from ~709 px; HP/AC/speed/saves/attacks above the fold. Overflow probe: 0 (the only report is the open tooltip's own pointer).
- 1200 px: no overflow.

## Fonts
Forum (display, numbers, seal numerals) + Alegreya 400/700 + italics. One Google Fonts link.

## What changed for each fix
1. **Hint rule.** All inline legends are gone ("shield = saving throw, star = proficient", "filled dot = proficient", "marked spells are always prepared by your oath", "зірка = майстерність"). Every meaning-bearing glyph now carries `aria-label` + a native `<title>`/`title` hint: save shield "Saving throw +4", star "Proficient saving throw", skill dot "Proficient"/"Not proficient", the Stealth mark (now `broken-arrow`) "Disadvantage (armor)", oath mark "Always prepared (Oath of Devotion)", E tag "Equipped", gem "Attuned", slot seals "Spell slot, level 1 — 3 of 4 left", resource pips "Channel Divinity use — 2 of 2 left" / "Wand charge — 5 of 7 left" / "Paladin's Smite free cast — 1 of 1 left". Open tooltip pattern shown on the desktop in three places (Wisdom's star, the first level-1 slot seal, the Chain mail E tag) and on the phone on the МДР save seal (long-press style, above the finger). The "Level up" tab keeps "6,500 / 14,000" and the hint "Level up at 14,000 XP".
2. **Icons.** Concentration keeps the v1 orb glyph (`concentration-orb`, violet) in the spells ribbon, Bless chip, action-strap note and phone chip — the owner judged the eye glyph worse and asked for the orb back — with the hint "Concentrating on Bless, round 3" (phone: "Концентрація: Благословення, раунд 3"). Spell-slot seals are embossed with the numeral (I / II) and each row has a small "Level 1 slots" / "Level 2 slots" label with the count. Javelin is `thrown-spear` (lorc) in the attacks row and the bag slot. The other item glyphs were re-checked and kept: broadsword, chain-mail, round-shield, crystal-wand, health-potion, rope-coil, torch, gem-pendant, medical-pack, backpack, rolled-cloth, bread, water-flask, dice-six-faces-six, fist.
3. **Conditions with duration.** Chips are buttons: icon + name + duration badge. Desktop: "Poisoned · 3 rounds" expanded (highlighted border, `aria-expanded`), with a parchment slip under it holding a −/+ round stepper, an ember "End" button and "from Giant Spider" (spider glyph); "Frightened" collapsed with no badge; "Add condition" stays. Phone: the same two chips collapsed at 44 px plus "Додати стан". Chip hint "Poisoned, 3 rounds left, from Giant Spider" / "Отруєний, залишилось 3 раунди, від Гігантського павука".
4. **Features by source.** Two columns: Paladin (templar-shield; Lay on Hands lv 1, Spellcasting lv 1, Weapon Mastery lv 1, Fighting Style: Protection lv 2, Paladin's Smite lv 2, Channel Divinity: Sacred Weapon lv 3, Extra Attack lv 5, Faithful Steed lv 5), then Oath of Devotion (holy-symbol; Sacred Weapon lv 3), Human (person; Resourceful, Skillful, Versatile), Soldier (medal; Savage Attacker with a "feat" chip). Each row: source icon, name, brass level badge, details (i) button; row hint "From Paladin, level 3" etc. No items or spells.

## Compromises
- Page height grew to 1393 px (from 1244); still one screen for the combat reads but the Features leaf and the tray scroll.
- Open tooltips overlay neighbours as real tooltips would: the slot-seal tooltip covers most of the Bless "concentrating" chip, the E-tag tooltip covers part of the "Chain mail" caption. Both anchors were chosen as the owner specified.
- Level badges appear on class and subclass rows only (the spec's "Class (with the level gained)"); Human and Soldier rows carry the row hint and, for Savage Attacker, a "feat" chip instead.
- "Frightened" hint reads "Frightened, indefinite"; "Giant Spider" was translated as "Гігантський павук" and "Frightened" as "Наляканий" for the phone (not in CONTENT.md).
- The phone's save tooltip is the shorter "Мудрість +4, майстерність" so it stays inside the 390 px frame.
- The spec's wider icon vocabulary (e.g. `checked-shield` for saves, `hand-ok` for Use) was not applied beyond the four fixes, per "keep everything else exactly as in v1".
- Hints are native `title`/SVG `<title>` plus static open tooltips; the 300 ms hover / 400 ms long-press timing is for the build, not drawable here.
