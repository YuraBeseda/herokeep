# S1 — Hero creation wizard (Tavern Table)

Thirteen boards: ten desktop steps (1440, English, fluid page) and three phone steps (390 × 844, Ukrainian, fixed).
Built from `boards.cjs` through `build.cjs` (macro expansion, design-system CSS inlined); rendered and measured with `shoot.cjs`.
Revision 2 folds in the owner's review comments (options chips/popover, no inline disabled-reasons, no legends, no narrative captions, one tick marker, gated starting gold).

## Files and measured heights (desktop `document.documentElement.scrollHeight` at 1440; phone = fixed 844)

| Board | File | Height | PNG |
|---|---|---|---|
| W01-Name | `W01-Name-Desktop.dc.html` | 960 (min-height 100vh; content ends at 690) | `W01-Name-Desktop.png` |
| W02-Species | `W02-Species-Desktop.dc.html` | 960 (content ends at 770) | `W02-Species-Desktop.png` |
| W03-Background | `W03-Background-Desktop.dc.html` | 960 (content ends at 680) | `W03-Background-Desktop.png` |
| W04-Abilities | `W04-Abilities-Desktop.dc.html` | 960 (content ends at 585) | `W04-Abilities-Desktop.png` |
| W05-Class | `W05-Class-Desktop.dc.html` | 1202 | `W05-Class-Desktop.png` |
| W06-Skills | `W06-Skills-Desktop.dc.html` | 960 (content ends at 560) | `W06-Skills-Desktop.png` |
| W07-Style-Masteries | `W07-Style-Masteries-Desktop.dc.html` | 1237 | `W07-Style-Masteries-Desktop.png` |
| W08-Spells | `W08-Spells-Desktop.dc.html` | 1163 | `W08-Spells-Desktop.png` |
| W09-Equipment | `W09-Equipment-Desktop.dc.html` | 960 (content ends at 860) | `W09-Equipment-Desktop.png` |
| W10-Review | `W10-Review-Desktop.dc.html` | 1125 | `W10-Review-Desktop.png` |
| W02-Species-Phone | `W02-Species-Phone.dc.html` | 844 (body scrolls 758 in 664) | `W02-Species-Phone.png` (+ `-scrolled.png`) |
| W04-Abilities-Phone | `W04-Abilities-Phone.dc.html` | 844 (no scroll: all six seals fit, 656 in 656) | `W04-Abilities-Phone.png` |
| W10-Review-Phone | `W10-Review-Phone.dc.html` | 844 (body scrolls 1281 in 664) | `W10-Review-Phone.png` (+ `-scrolled.png`) |

Phase 3 additions (phone set completed + one tablet board; same pipeline):

| Board | File | Size / scroll | PNG |
|---|---|---|---|
| W01-Name-Phone | `W01-Name-Phone.dc.html` | 844, no scroll (656 in 656) | `W01-Name-Phone.png` |
| W03-Background-Phone | `W03-Background-Phone.dc.html` | 844, body scrolls 916 in 664 | `W03-Background-Phone.png` (+ `-scrolled`) |
| W05-Class-Phone | `W05-Class-Phone.dc.html` | 844, grid scrolls 1122 in 664, bottom sheet open (Paladin, `38 варіантів` chip) | `W05-Class-Phone.png` (+ `-scrolled`) |
| W06-Skills-Phone | `W06-Skills-Phone.dc.html` | 844, body scrolls 1062 in 664 | `W06-Skills-Phone.png` (+ `-scrolled`) |
| W07-Style-Masteries-Phone | `W07-Style-Masteries-Phone.dc.html` | 844, body scrolls 2606 in 664 (4 styles + 38 weapons as 48 px rows) | `W07-Style-Masteries-Phone.png` (+ `-scrolled`) |
| W08-Spells-Phone | `W08-Spells-Phone.dc.html` | 844, body scrolls 1563 in 664 | `W08-Spells-Phone.png` (+ `-scrolled`) |
| W09-Equipment-Phone | `W09-Equipment-Phone.dc.html` | 844, body scrolls 803 in 664 | `W09-Equipment-Phone.png` (+ `-scrolled`) |
| W02-Species-Tablet | `W02-Species-Tablet.dc.html` | 768 × 1024 fixed, body scrolls 1188 in 908 | `W02-Species-Tablet.png` (+ `-scrolled`) |

Phone rules kept: top bar (folio · "Новий герой" · monogram), leather step strip "Крок N з 9 · name" with the all-steps button and gauge, page-level scroll (no inner boxes), 44 px targets, strap Скасувати (icon, hint) · Назад | Далі (+ "Ще" filter button on pickers), descriptions as bottom sheets above the strap, every disabled control's reason on hover only, no legends or captions. Phone-specific choices: backgrounds and kits are single-column rows (the kit list is text, the gold row locked with the open hint); skills, styles, weapons and spells are 48 px rows with the tick seal / ring at the right and the info button for the description sheet; W05's sheet shows the three level-1 features with the brass `38 варіантів` chip (closed) on Weapon Mastery, "У бібліотеці" and "Обрати". Tablet: rail with the mark only (no wordmark), a 64 px seal rail for the stepper (done = seals, current = brass numeral + name, locked group = padlock with the open hint), the picker at two columns, the drawer as a 300 px right column with stacked actions; the strap keeps all three zones.

Every desktop board is ≤ 1400 px; `$preview` carries the measured height. 1200 px check: no overflow beyond the intentional ones (selected-card wax seal hangs 8 px over the card edge; the +2/+1 bonus plate hangs over the seal).

Tooling: `build.cjs` (macros `<i-icon>`, `<x-seal>`, `<x-tex>`, `<x-defs>` → literal SVG; inlines `ds/check/tokens.css` + `ds/project/components/bundle.css`; forbidden-token and emoji check), `boards.cjs` (all markup; reads the real SRD pack at build time for species, traits, classes, level-1 features, backgrounds, weapons with mastery, cleric and paladin spells, skills, gaming sets), `shoot.cjs` (Playwright: heights, overflow + overlap probes, PNGs, 1200 px re-check), `heights.json`, `icons-used.json` (131 game-icons glyphs).

## Fonts

Forum (display: titles, numerals, seal numerals, step names) + Alegreya 400/600/700 + italic (body, hints). One Google Fonts link per board.

## The hero and the data

- The wizard makes a new hero, **Maelis Thorne** (uk **Маеліс Торн**), feminine grammatical form, Elf · Soldier · Fighter, point buy 15/14/13/8/12/10 with Soldier +2 STR / +1 CON → 17/14/14/8/12/10. Derived: HP 12, AC 17 (Chain Mail 16 + Defense), proficiency +2, speed 30 ft, initiative +2, passive Perception 13. (CONTENT.md's Ilyana Vorn is a Human Paladin and the brief asks for Elf selected, so the wizard's hero is a second character; her name is the one invented string in English.)
- W08 shows the Cleric path of the same hero for variety (stepper hint "Cleric", step 7 = Spells): cantrips Guidance, Sacred Flame, Thaumaturgy known (3 of 3); Bless, Cure Wounds, Guiding Bolt prepared (3 of 4); Healing Word open in the drawer; 2 level-1 slots; Wisdom · DC 13 · +5.
- Every entity name, trait, feature, weapon (38 with a mastery), spell (7 cantrips + 15 level-1 cleric spells; 13 level-1 paladin spells for the W05 chip), skill, background text and gaming set is read from `apps/web/public/packs/srd-5e-2024/0.1.0/pack.json` at build time. Fighter starting equipment (A: Chain Mail, Greatsword, Flail, 8 Javelins, Dungeoneer's Pack, 4 GP; B: Studded Leather Armor, Scimitar, Shortsword, Longbow, 20 Arrows, Quiver, Dungeoneer's Pack, 11 GP; C: 155 GP) and the mastery-property texts (Sap, Slow, …) are the SRD 5.2.1 wording — the pack has no startingEquipment field and no mastery rule entities.
- Packs on W01: "SRD 5.2.1 (2024 rules)" v0.1.0 (core, always on), "My homebrew" v0.1.0 (the device pack), "SRD 5.2.1 — русский (образец)" v0.1.0 (the demo translation pack shipped under `public/packs/demo`).

## Step model (why "of 9" is honest before the class is chosen)

1 Name & concept · 2 Species · 3 Background · 4 Ability scores · 5 Class · 6 Skills & tools · 7 Class choices → "Fighting style & masteries" (Fighter) / "Spells" (Cleric) · 8 Equipment · 9 Review. Every class has a skill choice, so step 6 is always real; step 7 is the one locked "Class choices" row (padlock, hint "after class") that becomes a named step once the class is chosen. The count is therefore 9 on every board, and done steps keep their place with a wax seal (audit defect 4). The Soldier's gaming-set pick and the Elf's Keen Senses pick live on step 6 ("Skills & tools") instead of being separate generic "Choice" steps.

## Owner rules applied in revision 2 (whole-UI rules, drawn here)

1. **"N options" chip on choice-granting features** (W05): in the open Paladin drawer, Weapon Mastery carries a brass `38 options` chip (count = the pack's weapons with a mastery property; Paladin is proficient with all simple and martial weapons) whose parchment popover is drawn OPEN: title, "Paladin picks 2 at level 1", the 38 names as library links in three columns, footer "See all in library". Lay On Hands and Spellcasting stay plain. The drawer's "You would choose" rows carry closed chips: skills `6 options` (Paladin's skill list), prepared spells `13 options` (level-1 paladin spells in the pack). W07's "All 38" filter badge and W08's "All 22" are now computed from the same data, so the counts match.
2. **Disabled reasons are hover hints only.** Gone inline: "Nothing to go back to" (W01 Back), "Choose a background first" (W03 Next), "2 picks left…" (W06 Next), "Choose 1 more weapon mastery" (W07 Next), "Not allowed here" (W03 gated card), "Already proficient from Soldier" / "Already chosen as a Fighter skill" (W06 rows), "Firearms off" (W07 rows), "cap reached" (W08 cantrips), the core pack's "always on" chip (W01). Each becomes `title` + accessible name on the disabled control, plus a padlock glyph with the hint where the control itself has no label (gated cards, locked rows, the core pack's pin slot). One of them is drawn open per board as the tooltip.
3. **No legends.** Removed "Filled dot = proficient. The number is…" (W06; the Survival row's dot is drawn with its tooltip "Not proficient · pick it to add +2" and every dot has the hint "Proficient (+2)" / "Not proficient"), "The dot is the school; C = concentration, R = ritual" (W08; school dot, orb and R chip each carry their hint).
4. **Narrative captions stripped** (what a control will do): all step leads except the two rule statements on W03 and W05; W01 name-length and grammatical-form captions, portrait file-type line, packs hint, the empty row's second sentence; W02 drawer's "Keen Senses adds a skill choice…"; W03 "Gated cards stay listed…"; W04 "8 to 15 before bonuses…", the tray's drag instruction, the preview's "Updates as you change a score…", the dice tray's "fills when you switch to Roll"; W05 popover footer hint; W07 "Fighter: 3 at level 1 · change them after any long rest", "pre-filled from the kit" (now the seal's hint); W08 "You've learned every cantrip…", drawer "Preparing Healing Word fills the last slot…"; W09 Option C's "Buy everything from the library…", coins "from Option A · spend or earn them on the sheet"; W10 "Create hero writes the first event…"; W04-Phone "утримайте й перетягніть на печатку". Where the sentence carried a rule it survives as the control's `title`.
5. **One marker for chosen/prepared/known** (W08): the tick wax seal everywhere, hint "Prepared" on level-1 rows and "Known cantrip" on cantrips (always-prepared would read "Always prepared (…)"; none at Cleric 1). Concentration is the orb glyph on the row (arcane), ritual a small R chip; the open concentration tooltip is anchored on Shield of Faith's orb with the pointer on the orb.
6. **Starting gold is a house-rule-gated option** (W09): Option C is drawn disabled (padlock in the card head, dimmed well, disabled "Choose C") with the hover hint "Starting gold is off in The Emberfall Company — ask your DM", drawn open; kits A and B stay choosable. A solo hero would see it enabled.

## Coverage

### Audit screens → boards

| Audit screen id | Board |
|---|---|
| wizard-fighter-s01-name, s01-name-empty | W01-Name |
| wizard-fighter-s02-species, s02-species-expanded | W02-Species, W02-Species-Phone (drawer / bottom sheet = the "expanded" state) |
| wizard-fighter-s03-background | W03-Background |
| wizard-fighter-s04-improve (background +2/+1) | W04-Abilities (brass tags on the seals, placed live) |
| wizard-fighter-s05-class | W05-Class |
| wizard-fighter-s06-abilities-m1/m2/m3/m4, s06-abilities-filled | W04-Abilities (brass tabs Standard array · Point buy · Roll · Manual; point buy drawn; dice tray collapsed), W04-Abilities-Phone |
| wizard-fighter-s07-choose-2-skills-for-fighter | W06-Skills |
| wizard-fighter-s08-tool-proficiency-choose-one- | W06-Skills (Tool proficiency from Soldier section, chips) |
| wizard-fighter-s09-fighting-style | W07-Style-Masteries (cards with the full style text) |
| wizard-fighter-s10-weapon-masteries | W07-Style-Masteries (38 weapons, full height, filters, counter, pre-seeded seals, gated firearms) |
| wizard-fighter-s11-equipment, s11-equipment-filled | W09-Equipment |
| wizard-fighter-s12-review | W10-Review, W10-Review-Phone |
| wizard-caster-s09-spells, s09-spells-filled | W08-Spells |
| wizard-caster-s11-review | W10-Review (same template; the Cleric path would list Spells as step 7) |

### Audit defects → how fixed

| Defect | Fix on the boards |
|---|---|
| 4 — stepper chips overlap, done steps vanish, generic "Choice" chips | Vertical parchment stepper in the left column on every desktop step (DS `Stepper`): 9 rows, done = wax seal + the answer as hint, current raised, to-do numbered, one locked "Class choices" row; names are real ("Skills & tools", "Fighting style & masteries", "Spells"). Phone: leather strip "Крок 2 з 9 · Вид" with the all-steps button and a progress gauge; no chip row. |
| 5 — fixed-height picker scroll boxes, rows cut in half, two "Next" buttons, "Show description" expands nothing | Pickers are full-height responsive grids (3 columns beside the drawer, 4 without; phone 2 columns on the page scroll); search + filter chips on top; one primary Next in the strap only (the per-step ghost "Continue" is gone); the description opens in the right drawer (desktop) / bottom sheet (phone) with Choose/Chosen and "Open in library"; cards carry real content (traits, level-1 features, skills/tool/feat/equipment, damage + mastery). |
| 10 — inconsistent primary-action placement | The strap is identical on every step: zone 1 Cancel · Back, zone 2 Next (reads "Create hero" on review, same slot, wax-seal glyph), zone 3 Filter · Search on pickers, "Step N of 9 · name" at the right. No full-width create button above a lone Back. |
| auto-advance on the ability step / skills / masteries (s04, s06, s07, s10) | Counters "1 of 2 chosen", "2 of 3 chosen", "3 of 4 prepared"; Next disabled (reason on hover) while a step is incomplete (W03, W06, W07); the stepper's current row shows the DS "invalid" state ("needs 1 more skill"). |
| English headings and names in the uk UI (s02–s12) | Phone boards use uk step names, species names, sizes and strings (see the invented-strings list); desktop boards are English throughout. |
| Back enabled on step 1 (s01, P3) | Back disabled on W01, reason "Nothing to go back to" on hover. |
| "Далі" disabled without an explanation (s01-empty) | Disabled Next always carries its reason in `title` and its accessible name. |
| native 13 px radios/checkboxes, pack helper wrapping (s01) | Grammatical form = brass segmented control (real radios); packs = pin toggles at the row end (real checkboxes), lock for core with the reason on hover. |
| cards with no description or identical icons (s02, s03, s08, s09) | Species: trait list + size/speed tags + distinct glyphs; backgrounds: skills/tool/feat/equipment + ability chips + distinct glyphs; styles: full text; weapons: weapon glyphs, damage, mastery tag with hint. |
| +2/+1 rows unexplained, +1 row loses the +2 ability (s04) | Brass +2/+1 tags in a leather tray (hint names the source and where it may go); eligible seals ring-marked; Swap. |
| staircase inputs, repeated "Value" labels, no +/-, budget far away (s06-m2/m3) | Six identical seal blocks with −/+ steppers (8–15 enforced on the buttons), cost per block, total plate, budget gauge "27 / 27 points" next to the tabs. |
| empty Roll tab (s06-m4) | Dice tray strip "4d6, drop the lowest" with Roll all six, drawn collapsed under point buy. |
| no 0/2 counter, background skills not shown, Skillful absent (s07) | Counters on every choice group; granted proficiencies listed disabled with a padlock hint "Already proficient from Soldier"; Keen Senses (Elf) and the gaming set on the same step; "Granted without a choice" block. |
| whole step for a 4-item gaming set (s08) | Folded into W06 as a chip radio group. |
| no "0 / 3 selected", mastery not shown on the card (s10) | "2 of 3 chosen"; mastery tag on every row with the rule as hint. |
| 960-item catalogue first, quantity detached, no starting kit, no weight/AC consequence (s11) | Kit options A / B / C as cards (C house-rule-gated); the bag preview with quantity steppers per row, equip toggles, remove, details; weight and AC chips with hints; "Add from library" opens the library picker instead of listing 960 items inline. |
| review: mixed languages, squeezed value column, no edit links, Equipment never done, alphabetical abilities (s12, caster-s11) | Review groups per step with Edit links; 132 px label column; abilities in D&D order as seals; the stepper shows Equipment done; derived numbers in a leather strap. |
| raw-key toast "blob.resend-have" (crosscutting 3) | Not drawn; nothing floats over the strap. |

### actions.md controls → where they live

| Control (template / element) | Home on the boards |
|---|---|
| create-wizard__create "Create character" | Strap zone 2 on W10 reads "Create hero" (wax-seal glyph); uk "Створити героя" on W10-Phone |
| create-wizard__back / __next | Strap zone 1 Back (leather) · zone 2 Next (brass) on every board; phone strap Назад · Далі |
| (new) Cancel | Strap zone 1 first slot (ghost-leather); phone: icon button with hint "Скасувати" |
| ability-scores-step__roll-all "Roll all six" | W04 dice tray (disabled with reason under point buy; the Roll tab's primary) |
| hk-number-field "Value" (ability scores) | W04 −/+ steppers per seal (8–15), aria-labelled "<Ability> base score" |
| choice-step "Add" | Replaced by selecting rows (skills, masteries, spells) with counters; nothing to "add" |
| entity-picker__select | "Choose" brass button on each card and in the drawer; selected card shows "Details" + wax seal |
| entity-picker__expand "Show/Hide description" | The card body is a button that opens the DescriptionDrawer / bottom sheet; close button + Esc |
| hk-search-field "Search…" / "Clear search" | Search pill at the top of every picker (W02, W03, W05, W07, W08, W02-Phone); clear button drawn in the DS |
| equipment-step__equip-toggle "Equip / Equipped" | Toggle switch per bag row on W09 (role=switch) |
| equipment-step__continue "Continue" | Removed: the strap's Next is the only continue |
| equipment-step__qty "Quantity" | −/+ stepper per bag row on W09 |
| spells-step__prepared-toggle | Row checkbox + tick seal per level-1 spell on W08, "3 of 4 prepared" counter, Prepare in the drawer |
| spells-step__continue "Continue" | Removed (strap Next) |
| shared stepper hk-stepper__step | Vertical stepper rows are real links (desktop); phone "Усі кроки" button opens the list |
| shared tabs hk-tabs__tab (ability methods) | Brass tabs on W04; chip tabs on W04-Phone |
| (new) Filter · Search strap icons | Strap zone 3 on pickers; phone "Ще" collapses them into one button |
| (new) portrait upload / grammatical form / pack pins | W01 (DS PortraitFrame l + edit button, segmented control, pin toggles + lock) |
| (new) "N options" chip + options popover | W05 drawer (Weapon Mastery open; skills and spells closed) |

### States drawn

Disabled with reason on hover: Back on W01, Next on W03/W06/W07, the core pack lock, granted and blocked skill rows, capped cantrips, firearms rows, Option C (starting gold), the point-buy − at 8 and + at 15, Roll all six under point buy. Error: W01 portrait "This image is too large. Try a smaller photo." Empty: W01 "The Emberfall Company shares no packs yet." Loading: W01 "Checking for updates…" spinner on My homebrew. Focus ring: W01 name field, W06 Survival row, W10 Create hero. Open tooltips: W01 core lock, W02 pack filter, W03 gated padlock, W04 +1 tag, W05 Sorcerer d6 (+ the options popover), W06 Athletics padlock and Survival dot, W07 Sap and the Musket padlock, W08 concentration orb, W09 starting-gold padlock, W10 passive Perception.

## Invented Ukrainian strings (not in any uk.json)

Phase 3 (phone set) adds a uk table in `boards.cjs` (`UK`), all invented translations of pack names: classes (Варвар, Бард, Жрець, Друїд, Боєць, Монах, Паладин, Рейнджер, Пройдисвіт, Чаклун, Чорнокнижник, Чарівник), backgrounds (Аколіт, Злочинець, Мудрець, Солдат), the 18 skills, tools (Приладдя каліграфа, Злодійські інструменти, Ігровий набір), feats and styles (Посвячений у магію, Пильність, Лютий нападник, Стрільба, Захист, Бій великою зброєю, Бій двома видами зброї), the 8 mastery properties (Приголомшення, Сповільнення, Зачеплення, Розсічення, Повалення, Роздратування, Поріз, Відштовхування), the 38 weapons, the 22 cleric spells, the 6 schools, kit items (Клепана шкіра, Стріли, Сагайдак, Скімітар…), damage types (рубаючий/колючий/дробильний), level-1 class features (Друге дихання, Лють, Захист без обладунку, Натхнення барда, Божественний порядок, …), plus UI strings: Стартовий набір, Варіант A/B/C, "лише золото", "Стартове золото вимкнено в Компанії Емберфол — спитайте Майстра", "Заборонено в Компанії Емберфол (правило Майстра)", "Вогнепальну зброю вимкнено в Компанії Емберфол", "Уже є володіння від Солдата", "Уже обрано як навичку Бійця", "Відомий заговір", "Підготовлено", "Концентрація", "Ритуал", "Нема куди повертатися", "Спершу оберіть передісторію", "Оберіть ще 1 вид зброї", "Ще 2 вибори: навичка Бійця, Гострі чуття", "Уміння 1-го рівня", "N варіантів", "Інструмент від Солдата", "Гострі чуття від Ельфа", "Надано без вибору", "З бібліотеки", "Складність 13", "Атака заклинанням +5", "перевірка оновлень…", "Це зображення завелике. Спробуйте менше фото." (uk.json has it), "Завантажити портрет" (uk.json has it).

Новий герой (top bar title) · Герой поки що (monogram button) · Усі кроки · Вид (step name; the app's stepper key says "Раса", the packs/library keys say "Види") · Пошук видів… · Малий / Середній (size chips; "Розмір" exists) · Темний зір / Темний зір 60 фт · species names Драконороджений, Дварф, Ельф, Гном, Голіаф, Півмірок, Людина, Орк, Тифлінг · "5 особливостей" (count of traits; "Особливості" exists) · Elf traits Темний зір, Ельфійський родовід, Фейське походження, Гострі чуття, Транс and their one-line summaries · Обрано · У бібліотеці · базові правила · Ще (exists in the phone strap of A2) · Бонуси передісторії (exists) with "+2 Сила", "+1 Статура" · "від передісторії Солдат · утримайте й перетягніть на печатку" (hover hint) · Створити героя (the app says "Створити персонажа"; the design system's Button preview already uses "Створити героя") · review labels: Граматичний рід (exists), Жіночий (exists), Пакети вмісту (exists), Гострі чуття → Проникливість, Передісторія/Солдат, Навички, Атлетика, Залякування (CONTENT.md), Бонуси, Купівля очок (exists), СИЛ/СПР/СТА/ІНТ/МДР/ХАР (CONTENT.md), Клас, Боєць (Fighter), 1 рівень, Сприйняття (CONTENT.md), Виживання, Бойовий стиль (exists), Захист (CONTENT.md), Майстерність зброї (CONTENT.md), Дворучний меч, Ціп, Дротик (CONTENT.md), Спорядження (exists), Набір, Варіант A, Сумка (CONTENT.md), Кольчуга (CONTENT.md), Набір дослідника підземель, Монети, "4 зм" (CONTENT.md coin abbreviation), Змінити (packs/uk "homebrew.edit").

## Compromises

- **Fighter, not Paladin, is the chosen class.** The brief's W07 ("fighting style + pick 2 masteries") only works at level 1 for a Fighter (Paladin's style comes at level 2), and a Fighter gets 3 masteries, so W07 reads "2 of 3 chosen". W05 still opens the Paladin drawer with its level-1 features while Fighter is sealed, as asked.
- **The drawer is non-modal on desktop.** It is the third grid column (380 px) beside the picker instead of an overlay, so the grid stays readable and the user can keep comparing cards; the spec's "right-side drawer" semantics (same close control, Esc) hold. On the phone it is a modal bottom sheet over the grid, drawn above the strap so the strap never hides. On W05 the drawer is given `min-height:1030px` so the open options popover (≈ 400 px) does not cover "Choose Paladin"; the popover floats over the drawer's own text as a real popover would.
- **Gating reasons on W03, W07 and W09 are campaign house rules** ("Not allowed in The Emberfall Company", "Firearms are off…", "Starting gold is off…") because the SRD backgrounds and Fighter weapons have no real prerequisites; the wizard is drawn as entered from the campaign (rail chip), which is the Join → Link a hero → New hero path. The house-rule fields themselves do not exist yet (carry for Stage B, like the spec's conditions house rule).
- **"Chosen" in the W02 drawer** is the pressed state of the Choose button (Elf is already sealed on the card); the W05 drawer shows the live "Choose Paladin" because Fighter is the current choice.
- **Pre-seeded masteries** (Greatsword, Flail) are pre-seeded from the Fighter's default kit although Equipment is step 8; the source is in the seal's hint ("Chosen · pre-filled from the Fighter's kit"); the seeding rule is plan 13's.
- The "N options" count for a Paladin's Weapon Mastery is every weapon with a mastery property (38) because the class is proficient with all simple and martial weapons; a class with narrower proficiencies would show fewer. Links in the popover are `href="#"` placeholders for library routes.
- Open tooltips overlay neighbours as real tooltips do (the Sap tooltip covers the Whip row, the Firearms tooltip the Rapier row, the gold tooltip the "155 gp" well); anchors were chosen so nothing stateful is hidden.
- The card's "Choose" and its "open description" are two real buttons inside an `<article>` (the DS preview nests a span inside one button); the mapping for Stage B is PickerCard with two actions.
- Phone strap: Cancel is icon-only (hint "Скасувати") so "Назад · Створити героя" fit in 390 px; the "Ще" button appears only on pickers (Filter · Search) and is dropped where zone 3 is empty.
- W01/W03/W04/W06/W09 are shorter than the 960 px viewport; the page keeps `min-height:100vh`, so the strap sits at the bottom and the table shows below the leaf — a quiet table, not a defect.
- Hints are native `title` plus one or two static open tooltips per board; the 300 ms hover / 400 ms long-press timing is for the build.
- Species one-liners are the trait names from the pack (the pack carries no species or class description text); class one-liners are the level-1 feature names; feature excerpts in the W05 drawer are cut to ~125 characters so the popover fits above the actions.
