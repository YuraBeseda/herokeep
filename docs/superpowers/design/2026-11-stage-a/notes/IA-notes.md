# IA boards — navigation, home and shell in concept A "Tavern Table" — build notes

Deliverables (all in this folder, each `.dc.html` self-contained, built from `*.src.html` by `build.cjs`, which inlines the game-icons SVGs, the wax seals and the feTurbulence textures exactly as `out/A/build.cjs` does, plus `shared.css` = the concept-A classes):

| Board | File | Frame | Screenshot |
|---|---|---|---|
| App map and navigation (diagram) | `IA-NavMap.dc.html` | fixed 1440 × 980 | `navmap.png` |
| Home, desktop (English, fluid page) | `IA-Home-Desktop.dc.html` | 1440 × 960 | `desktop.png`, `desktop-fold.png`, `desktop-1200.png` |
| Home, phone (Ukrainian) | `IA-Home-Phone.dc.html` | fixed 390 × 844 | `phone.png`, `phone-scrolled.png` |
| App drawer open over Home, phone (Ukrainian) | `IA-Phone-Drawer.dc.html` | fixed 390 × 844 | `drawer.png` |
| Play sheet re-flowed for a portrait tablet | `IA-Sheet-Tablet.dc.html` | fixed 768 × 1024 | `tablet.png`, `tablet-scrolled.png` |
| The action strap contract | `IA-ActionStrap.dc.html` | fixed 1440 × 760 | `strap.png` |

Scripts: `navmap-gen.cjs` (writes the diagram source with every arrow computed from card edges), `build.cjs` (macro expander + forbidden-token check), `shoot.cjs` (Playwright render, overflow / clipping / touch-target probes), `measure.cjs`.

## Measurements (Chromium, fonts loaded)

- Home desktop at 1440: `document.documentElement.scrollHeight` = **960** with the 1440 × 960 viewport (the root has `min-height:100vh`); the natural content height is **924** (main content ends at 854, the sticky strap is 70). `$preview` = `{"width":1440,"height":960}`. At 1200 nothing overflows or clips; the campaign names wrap to two lines instead of truncating.
- Home phone 390 × 844: Continue leaf (portrait, name, class, HP strap 31/44 + 5 temp, campaign chip, Open) and the first hero row are above the fold; no element overflows, no text is clipped, no interactive element under 44 × 44.
- Drawer 390 × 844: flap 316 px wide; all rows ≥ 52 px tall; no clipping, no small targets.
- Tablet 768 × 1024: the inner scroller holds 996 px of content in 898 visible, so the page scrolls 98 px (the lower half of the Features leaf). Above the fold: identity, Play/Build/Timeline/Level up, XP, HP 31/44 (+5), concentration chip, AC 18, initiative, speed, proficiency, hit dice, passive perception, inspiration, six ability seals with saves, the first skills, the three attacks with Roll (attacks leaf bottom at 362), all four combat resources, conditions, death saves. No interactive element under 36 px.
- Action strap board: no overflow; zone 3's "Roll log" tooltip is the only probe hit (it is the tooltip pattern shown on purpose).

## Fonts (Google Fonts, Cyrillic verified)

- **Forum** — display: wordmark, names, leaf titles, big numbers (HP 44 / 40 / 36 px), tab labels, seal modifiers, diagram section cards.
- **Alegreya** 400 / 700 + italics — body, buttons, chips, hints, diagram card text.

## What the boards decide (5 lines)

1. The shell is one brass rail with the spec's icon vocabulary (house, person, three-friends, open-book, chest, cog, hood for the account); at 768 the wordmark becomes the wax-seal mark only; on the phone the rail disappears into a leather folio flap opened and closed by the same book button, with the six sections as brass rings, account, theme and language rows.
2. Home is a table of objects: a Continue leaf (portrait frame, name plate, HP strap, campaign chip + live-session chip, XP line, Open, and direct tab links), a Tonight slip when a session is live, hero and campaign leaves in rows, a dashed "Join a campaign" slot, and a leather quick-actions strap.
3. The action strap has three fixed-width zones separated by brass dividers; the strap board shows the same slots on five screens, with Next and Create hero sharing a slot, and the phone collapse into a More button.
4. The tablet sheet keeps the folio at 296 px and splits the loose leaves into two brass sub-tabs on the Play tab (Combat; Spells & bag) so nothing becomes a long scroll.
5. The navigation diagram is parchment with leather section cards, ink child cards, slip-shaped flow steps and a plain-sentence key (no legend), every box and arrow a separate placed element.

## Compromises (all of them)

- **Invented numbers for the two extra heroes.** CONTENT.md gives no HP for Bramble Underfoot or Sister Maren; the cards show 21 / 21 and 27 / 31 as placeholders, and both are shown outside The Emberfall Company (Bramble "not in a campaign", Sister Maren in Tombs of the Salt King, which has no session). Replace with real data at build time.
- **Ukrainian strings not supplied** were added minimally: "Усі герої / Усі кампанії" (all heroes / campaigns), "без кампанії" (no campaign), "без сесії" (no session), "5 учасників / 3 учасники" (members), "Тимчасові" (temporary HP, shortened from "Тимчасові ОЗ" to fit the strap header), "Швидкі дії" (quick actions), "Обліковий запис · не ввійшли · синхронізація вимкнена" (account row), "Тема · Таверна", "Мова · Українська", "Меню розділів / Закрити меню", "щойно відкрито" (last opened), "Клятва відданості" as in CONTENT. "Herokeep" stays Latin as a wordmark.
- **Home has two "New hero" entry points** (the quick-actions strap and action-strap zone 2): the spec asks for both the quick-actions strap and the lists' zone-2 New · Import / Join, so both are drawn; the quick-actions tiles carry a sub-hint so they read differently from the strap pills.
- **Desktop home fills to 960, content is 924.** The 36 px of oak between the quick-actions strap and the sticky action strap is the only empty area; the frame is set to the 960 viewport measurement per the rules.
- **Tablet Level up tab** wraps onto its own row under Play · Build · Timeline (the four Forum labels do not fit 260 px in one row); it reads as a locked wide bar and sits right above the XP line, which is acceptable but a deliberate wrap, not a bug.
- **Tablet action strap at 768** keeps all five primaries and all five secondaries by using 11 px button padding and an 8 px gap; the concentration note moved from the strap to a violet chip in the folio because the strap has no room at this width.
- **Tablet Combat tab** holds Lay on Hands, Channel Divinity, Paladin's Smite and the wand; spell slots (levels 1 and 2), the ten spells, bag, coins and weight are on the "Spells & bag" tab, which is not drawn (only its tab is). The hint next to the tabs says so.
- **Phone strap "Rest" slot.** At 390 the five sheet primaries plus More do not fit with labels, so Short rest and Long rest share one Rest slot that asks which (same as the concept-A phone board); the strap board states this under the phone strap.
- **Fixed zone widths on the strap board** (184 / 576 / rest) are an illustration device so the dividers align across screens; a real strap sizes zone 1 and 2 to content, with the rule that a slot never moves between steps or tabs of the same screen.
- **Zone 3 on Home** is empty (lists are not pickers in §3); the campaign-session status fills the right side instead.
- **Icon substitutions:** the spec's `third-eye` is not in icons.json, so concentration uses `eye` in violet; Back and Next use my own chevron SVGs (no arrow glyph in the set); `rolling-dices` stands for Roll log; `spear-feather` for the javelin; the paladin class icon is `templar-shield` per the existing sprite order, so `hood` is used both for the rogue and for the account button (two different contexts, flagged).
- **Diagram text sizes:** the diagram guide suggests 13 px arrow labels; the board rules say ≥ 14 px on desktop, so labels are 14 px. Cards on the diagram use classes for their material (leather, brass, ink, slip) plus inline position and size, so the editor can still move each one; the parchment background and the paper texture are two separate placed elements under everything.
- **Diagram shell node:** instead of a wide "shell" card above the six sections, a short brass plate ("Shell · the same six sections on every device") sits on the vertical stub with the device note to its left, so the key slip could stay top-right without crossing the distribution line.
- **Tooltips overlap content** by design (the Heroes tooltip on the desktop rail covers the Continue leaf's top edge; Campaigns on the tablet covers the folio's rivet; Roll log on the strap board floats above the strap).
- The desktop page is sticky-bottom for the strap (`position:sticky`), as in concept A, so the canvas frame of the measured height and a scrolling viewport both show the strap at the bottom.
- The textures are feTurbulence filters inlined per panel with unique ids; the tablet board is 219 KB because of 53 inline icons and seals.

## Contrast (computed)

ink on parchment 11.6; hint ink on parchment 6.2 (5.3 at the darkened edge, 5.1 on chips); gold labels on leather 7.2–8.4; cream on leather 9.4–10; button text on ember 5.6 / moss 5.7 / brass 6.6; live-session chip 5.6; violet chip 6.8; diagram ink cards 9.8; diagram labels on the flow band 5.6; the dimmed strap hints ("nothing here on the sheet", #C9B992 at 80 %) 4.7; tab gold on tab leather 5.6; links on wood 11.1. State colours also differ by shape or icon (candle for live sessions, crown for DM, padlock on the disabled tab, filled vs hollow dots, filled vs pale seals).
