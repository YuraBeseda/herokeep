# S2 — hero sheet: Build and Timeline tabs, level-up flow, drawers, every sheet dialog

Built on A2 (concept A v2 "Tavern Table"): `parts.cjs` holds A2's rail, folio, Play columns, straps and phone shell verbatim (parametrised); `shared.css` = A2's helmet classes + S2 additions; `build.cjs` inlines `tokens.css` (tavern + base block) and the design-system `bundle.css` (minus `body`/stage rules; nested `}}` rewritten as `} }` because the canvas forbids that token) and expands the same authoring macros as A2 (`<i-icon>`, `<x-seal>`, `<x-tex>`, plus `<x-part>`, `<x-dlg>`, `<x-drawer>`). Design-system markup is used for dialogs (`hk-dialog`, `hk-dialog__head/__strap`), drawers (`hk-drawer`), search fields (`hk-search`) and chips; the sheet itself keeps A2's classes so every material is pixel-identical to the approved Play board.

Rebuild: `node build.cjs` (all) or `node build.cjs L01` (prefix). Render: `node shoot.cjs` (writes PNGs + `heights.json`; a second `node build.cjs` embeds the measured heights in `$preview`).

## Boards and measured heights (1440 wide, `document.documentElement.scrollHeight`; phones 390 × 844 viewport)

| Board | File | Height | Notes |
|---|---|---|---|
| B01 Build tab | `B01-Build-Desktop.dc.html` | 1380 | two columns, no sub-tabs needed |
| T01 Timeline tab | `T01-Timeline-Desktop.dc.html` | 1283 | 4 day/session groups, 17 rows |
| L01 Level up · class | `L01-LevelUp-Class-Desktop.dc.html` | 1394 | main board (Emberfall allows multiclassing) + the house-rule-OFF variant drawn below: step 1 done-and-locked with the hover hint "Multiclassing is off in The Emberfall Company — ask your DM" (drawn open), flow opening on Hit points for Paladin 6, no picker, no inline caption |
| L02 Level up · hit points | `L02-LevelUp-HP-Desktop.dc.html` | 1097 | |
| L03 Level up · feat or ASI | `L03-LevelUp-Choices-Desktop.dc.html` | 1097 | drawn at Paladin 7 → 8 (see compromises) |
| L04 Level up · review | `L04-LevelUp-Review-Desktop.dc.html` | 1097 | the "Finish level up writes 3 events…" caption was removed on the owner's comment (no narrative captions) |
| D01 Notes drawer | `D01-Notes-Drawer-Desktop.dc.html` | 1000 | Play sheet behind, clipped at 1000 |
| D02 Roll log drawer | `D02-RollLog-Drawer-Desktop.dc.html` | 1000 | |
| D03 Description drawer (Bless) | `D03-Description-Drawer-Desktop.dc.html` | 1000 | |
| DL01 Cast | `DL01-Cast-Desktop.dc.html` | 1000 | two dialogs: slot spell replacing concentration · free-cast lane |
| DL02 Rest | `DL02-Rest-Desktop.dc.html` | 1000 | short rest (rolled) · long rest |
| DL03 Add condition | `DL03-AddCondition-Desktop.dc.html` | 1000 | picker + the DM-managed locked variant |
| DL04 Add item | `DL04-AddItem-Desktop.dc.html` | 1000 | library (loading state) · custom (validation error, with the Icon row and its picker drawn open: glyphs used by this hero's items, common item glyphs, search, "Upload your own" PNG/SVG slot resized on-device) · small bag cut-out for the house rule "Players add items themselves" OFF: "Add item" disabled with the hover hint "Only your DM adds items in The Emberfall Company" + sub-line "The DM grants items with “Item” on your party card." (C06's quick-effect chip wording) |
| DL05 Confirms | `DL05-Confirms-Desktop.dc.html` | 1000 | revert (en + uk twin), pack update report, export, delete hero |
| B01 Build (phone, uk) | `B01-Build-Phone.dc.html` | 844 | under Ще → Білд |
| L01 Level up · class (phone, uk) | `L01-LevelUp-Class-Phone.dc.html` | 844 | compact step strip, flow strap |
| D02 Roll log (phone, uk) | `D02-RollLog-Phone.dc.html` | 844 | bottom sheet over the Combat tab |
| DL03 Add condition (phone, uk) | `DL03-AddCondition-Phone.dc.html` | 844 | bottom sheet over the Combat tab |
| T01 Timeline (phone, uk) | `T01-Timeline-Phone.dc.html` | 844 | under Ще → Хроніка; icon-only "Відкотити" buttons with hints; expanders "+ N події"; reverted row crossed out with "Відкочено 20:14" |
| L02 Level up · hit points (phone, uk) | `L02-LevelUp-HP-Phone.dc.html` | 844 | rolled 7 → +9 chosen, average +8, summary strap |
| L03 Level up · feat or ASI (phone, uk) | `L03-LevelUp-Choices-Phone.dc.html` | 844 | Paladin 7 → 8 like the desktop board; ASI leaf chosen (+2 Сила), feat rows with gated/already-chosen states |
| L04 Level up · review (phone, uk) | `L04-LevelUp-Review-Phone.dc.html` | 844 | "Завершити підвищення" in the strap's primary slot |
| D01 Notes (phone, uk) | `D01-Notes-Phone.dc.html` | 844 | full-height sheet, inline parchment editor, 44 px edit/remove |
| D03 Description (phone, uk) | `D03-Description-Phone.dc.html` | 844 | Благословення sheet with "Скасувати підготовку" · "Накласти" |
| DL01 Cast (phone, uk) | `DL01-Cast-Phone.dc.html` | 844 | Божественна кара: free-cast lane chosen, slot seals by level with the upcast chip, pact lane disabled with reason |
| DL02 Short rest (phone, uk) | `DL02-Rest-Phone.dc.html` | 844 | hit-dice seals, spend stepper, rolled 6 → +8, HP preview |
| DL04 Add from library (phone, uk) | `DL04-AddItem-Phone.dc.html` | 844 | search in progress (spinner + skeleton rows), type chips, quantity stepper |
| DL04 Custom item (phone, uk) | `DL04-CustomItem-Phone.dc.html` | 844 | validation error, Іконка row collapsed with the picker hint; split from the library sheet because a phone shows one sheet at a time |
| DL05 Revert confirm (phone, uk) | `DL05-Confirms-Phone.dc.html` | 844 | bottom sheet over the Timeline tab; "Скасувати" vs "Відкотити" |
| H Hero tab (phone, uk) | `H-Hero-Phone.dc.html` | 844 | the fourth tab: ability seals with score plate + save, skills list with 44 px roll buttons, proficiencies, languages, features by source |

Phone flow straps (L01–L04) use 44 px icon buttons for Скасувати/Назад (hints) and a wide brass primary, so "Завершити підвищення" never wraps; phone sheets pin their action strap to the sheet's bottom edge. Every phone board has at least one hint drawn open.

Every desktop board is ≤ 1400 px, has no horizontal overflow at 1440 or 1200 (grids wrap: the multiclass grid goes 4 → 3 columns), phones have scrollWidth 390. The drawer/dialog boards clip the Play sheet at 1000 px (`height:1000px; overflow:hidden` on the root) because the sheet behind is context, not content; their straps are absolutely pinned to the bottom. The tab/flow boards keep A2's in-flow strap (not sticky, so a full-page capture doesn't stitch it mid-page; the page reserves its height as §3 asks).

Fonts: Forum (display, numerals, seal numerals) + Alegreya 400/600/700 + italics (one Google Fonts link). Icons: game-icons only; the kit's `icons.json` plus `gi/icons` for vocabulary glyphs the kit lacks (`upgrade`, `anvil`, `hourglass`, `scroll-unfurled`, `rolling-dices`, `arrow-cluster`, `checked-shield`, `three-friends`, `two-coins`, `fire-spell-cast`, condition glyphs `blindfold`, `hearing-disabled`, `tired-eye`, `grab`, `knocked-out-stars`, `invisible`, `knockout`, `stone-block`, `falling`, `manacles`, `star-swirl`, `sleepy`). Concentration is the orb everywhere.

## Coverage — audit screen ids → boards

| Audit id | Board(s) |
|---|---|
| sheet-build, sheet-build-caster | B01 desktop + phone (caster-specific: the "Prepared spells (5 of 6)" choice row and the outstanding-choice banner cover the spellbook gap) |
| sheet-timeline | T01 |
| levelup-s01-class-picker, levelup-l3-s01-class-picker | L01 desktop + phone |
| levelup-s02-hp, levelup-s02-hp-chosen, levelup-l3-s02-hp, levelup-l3-s02-hp-chosen | L02 |
| levelup-l3-s03-fighter-subclass (the "class choices" step) | L03 (drawn as the feat / ASI step; a subclass pick uses the same picker leaf with cards) |
| levelup-s03-review, levelup-l3-s04-review | L04 |
| dialog-cast | DL01 |
| dialog-condition | DL03 desktop + phone |
| dialog-add-item, dialog-add-item-search | DL04 (library dialog, search in progress) |
| dialog-custom-item | DL04 (custom item) |
| dialog-note | D01 (notes are a drawer with an inline parchment editor; no separate dialog) |
| dialog-short-rest, dialog-short-rest-rolled | DL02 (short rest, rolled state) |
| dialog-long-rest | DL02 (long rest) |
| dialog-revert-confirm | DL05 (en + uk twin) |
| sheet-levelup-badge (the XP-row pill) | the folio's "Level up" tab-action (L01–L04 show it active; B01/T01 show it locked with "Level up at 14,000 XP") |

## Coverage — top-10 defects in scope → how fixed

| Defect | Fix on the boards |
|---|---|
| 6 (Play tab is one 6,000 px page; notes/log inline) | Notes, roll log and descriptions are drawers (D01–D03, D02/DL03 phone sheets); the Play sheet never grows. |
| 7 (dialogs unthemed, tiny, top-left; add-item band sliced; note textarea 110×30) | Every dialog is a centred parchment `hk-dialog` with a wax title seal, close button and a leather strap of actions (DL01–DL05); add-item is a list with weight/cost, type chips and a quantity stepper in the strap; the note editor is a full-width ruled parchment textarea (D01). No native white selects: selects are drawn parchment with a brass chevron (`.selIn`). |
| 8 (uk "Скасувати" collision) | Revert is "Відкотити" everywhere (timeline rows use "Revert"/"Відкотити", the confirm pairs "Скасувати" with "Відкотити" — DL05 uk twin); no ghost button wraps: phone buttons are 44 px with short labels, uk tooltips wrap inside 390. |
| 10 (Build tab shows no build; level-up keeps Play highlighted, no cancel; primary action moves) | B01 shows species/lineage, class levels + subclass, background, ability scores with method/bonuses/finals, every choice with Re-pick or a lock reason, proficiencies, languages, rule options, packs with pins + update row, identity fields with one Save. L01–L04: Play/Build/Timeline dimmed and inert, the "Level up" tab active, the strap holds Cancel · Back · Next with Next becoming "Finish level up" in the same slot. |
| sheet-build P2 (appearance fields stacked 1280 px wide; three save models; native radios/checkboxes) | 3-column appearance grid; one Save with an "unsaved changes" chip; gender as chips, packs as toggles. |
| sheet-timeline P2/P3 (filters all look selected; "+" expander unlabeled; no date/session grouping; every event revertable) | Filter chips with one selected state; expanders carry "Show 3 events" hints and the count beside them; rows grouped by session/day with times; locked rows explain why ("revert level 5 first", "can’t revert"); reverted rows stay crossed out with a "Reverted 20:14" chip and a "Show reverted" toggle. |
| levelup P2 (stepper chips overlap/shrink; three identical purple options; HP step has no selected state or number; review omits the subclass/feature) | Vertical parchment stepper that never changes shape (done = wax seal + result hint; the class-choices group is listed from the start); own class is a wide recommended card, multiclass options are cards with met/unmet prerequisite tags; the rolled die and the +9 are shown with a chosen seal before confirming; the review lists everything gained with Edit links. |
| dialog-cast P2/P3 (no spell summary, native select) | Summary chips, slot lanes as wax seals by level with the upcast effect, free-cast lane, pact lane with a reason, concentration warning. |
| dialog-condition P2/P3 (native select, no description, no duration/level) | Searchable chip picker, level stepper capped at 6 with a seal meter, duration type + amount, source note, the condition's effect text; DM-locked variant. |
| dialog-add-item P1/P2 (grid clipped under Cancel, 16 px targets) | Full-height list, 36 px details buttons, strap never overlaps rows; loading state shown. |

## Coverage — actions.md controls → where they live

| Template / control | Placement |
|---|---|
| level-up: class option buttons, Roll, Take average, Back, Next, Finish | L01 cards (own class + multiclass), L02 cards, strap zones 1–2 (Cancel · Back / Next → "Finish level up") |
| build: packs Update ("Update {name} to v{to}"), rename Name + Save, portrait upload/change/remove, appearance Save, outstanding empty text | B01 packs row (Update button + "Update available v1.0.0 → v1.1.0"), Identity leaf (Name field, Change/Remove portrait, one Save), outstanding banner (the empty text appears when nothing is left) |
| sheet shell: Export, xp Award field/button, Level-up badge link, Undo level up, Manage packs link, Pin campaign packs | Export = strap zone 3 icon → DL05 Export; XP award = DM-side on the party card (spec §4.3) so the folio keeps only the XP bar; level-up badge = the folio's "Level up" tab; Undo = the Timeline "Revert" on "Reached level 6"; Manage packs = link on the not-installed pack row (B01); Pin campaign packs = banner (S-group of the campaign builder) |
| add-item dialog: Cancel, Quantity | DL04 strap (Cancel, quantity stepper, "Add 2 × …") |
| cast dialog: Cancel, Cast | DL01 strap |
| condition dialog: Cancel, Add, Level | DL03 strap + level stepper |
| custom-item dialog: Cancel, Add, Quantity | DL04 custom strap, quantity stepper |
| note dialog: Cancel, Save | D01 inline editor (Cancel, Save note, Remove note) |
| rest dialog: Roll d{die}, Cancel, Take short rest, Take long rest | DL02 |
| timeline: expand, revert | T01 `.exp` buttons with "Show N events", "Revert" buttons (uk "Відкотити") |
| roll-log panel: Normal/Advantage/Disadvantage, visibility, Log roll, Clear log, Total | D02 drawer + phone sheet (segmented control, visibility chips, Log a roll block, Clear log) |
| play-tab: Add condition, Notes add/edit/remove, add from library / add custom item, Export | strap zone 3 (Add condition → DL03; Notes → D01; Roll log → D02; Export → DL05; Edit/override), Bag "Add item" → DL04 (library + custom) |

States drawn: disabled-with-reason (DL04 "Add item", DL01 lanes, B01 encumbrance select + core-pack toggle, L01/L03 gated cards, Next disabled pattern available in `flowstrap nextoff=`), validation error (DL04 custom item name), empty (B01 "No lineage" / "Expertise — none for Paladin", L04 "nothing to choose at level 6"), loading (DL04 library search). A focus ring is shown on DL01's Cancel, DL05's Keep.

## Ukrainian strings reused vs invented

Reused from `apps/web/src/assets/i18n/**/uk.json`: Білд, Хроніка, Гра, Підвищення до {level} рівня, Який клас?, Назад, Далі, Скасувати, Підсумок, Тип кидка, Записати кидок, Очистити журнал, Перевага / Звичайно / Завада, Усі / Лише Майстер / Приватно, Перевірка вручну (and the other manual labels), Додати стан, Рівень, Додати, Пошук…, Характеристики, Зроблені вибори, Володіння, Пакети вмісту, Опції правил, Перевантаження, Варіативне (за рівнями), Визначається домашніми правилами кампанії, Шкода / Лікування / Кинути, Бій / Заклинання / Сумка / Ще, Очки здоров'я, Тимчасові ОЗ, Клас броні, nav names.

Invented (not in uk.json; listed for the i18n pass): Відкотити (revert; replaces the colliding "Скасувати"), Журнал кидків, Хто бачить, Відпочинок (strap short label), Герой (phone 4th tab, per spec §11 call 1; A2 phone used "Здібності"), Походження та клас, Вид, Клас, Підклас, Передісторія, Мови, Обладунки, Зброя, Обрати / Обрати знову, Триває, Раунди, Хвилини, До короткого відпочинку, До довгого відпочинку, Без терміну, Джерело, Крок {n} з {m}, Усі кроки, рекомендовано, Або другий клас, Для мультикласу потрібна …, у вас {n}, Заблоковано після 3 рівня, Передісторію зафіксовано при створенні, природна 20 / природна 1, вручну, записано вручну, Незавершений вибір (singular form of the existing title), Аура захисту, class names (Варвар, Бард, Клірик, Друїд, Воїн, Монах, Чаклун), condition names (Осліплений, Зачарований, Оглухлий, Виснаження, Наляканий, Схоплений, Недієздатний, Невидимий, Паралізований, Скам’янілий, Лежачий, Скутий, Приголомшений, Непритомний; Отруєний already in CONTENT.md), spell names on the phone (Лікування ран, Щит віри, Допомога, Мале відновлення from CONTENT.md; others not needed), ability names in uk (CONTENT.md). Content names assume a uk translation pack; the audit's mixed-language rows are therefore not reproduced.

Added by the second phone batch (also invented): Відкочено (reverted badge; replaces "Скасовано"), Показувати відкочені, Сьогодні · Сесія N, Створення та рівні, Отримано на N рівні, Максимум ОЗ, Поточні ОЗ, Вибори класу, Підготовлені заклинання, Комірки заклинань, нове уміння, без змін, Покращення характеристик, +2 до однієї / +1 до двох, Або риса, риса бойового стилю, feat names (Пильний, Лютий нападник; Захист already in CONTENT.md), Викликання, бонусна дія після влучання, на себе, підвищена (upcast chip), Комірка заклинання lanes reuse castDialog strings (Без комірки: …, N рівень (залишилось N), Комірка Угоди), Витратити (hit dice), відновлено, повний, Усе/Зброя/Обладунки/Спорядження/Магічні/Витратні type chips, обрано, Іконка, гліф на комірці сумки, Змінити (reused from packs.homebrew.edit), Потребує налаштування, Можна спорядити, Введіть назву (до 200 символів), Ще N навичок, пасивне сприйняття, skill names Акробатика/Виживання, Human trait names (Винахідливість, Вправність, Універсальність), feature names in uk from CONTENT.md, the Bless description text in uk (content translation, not in any pack), Заповіді клятви / Борги та послуги / Сесія 7 — сховище Емберфол (note titles).

## Compromises

- **L03 is drawn at Paladin 7 → 8**, not 5 → 6: a level-6 Paladin has no choice step, and the brief asked for the ASI-vs-feat design. Its folio reads "Human · Paladin 7 · 34,300 / 34,000 XP · 52 / 62 HP · 6 / 7 d10" so the board is internally consistent; L01, L02 and L04 stay at 5 → 6 as the brief specifies ("to level 6"). The stepper's third step is the discovered-choice slot ("Class choices" until the class is chosen, then its real name).
- The Build tab's ability scores use the **rolled** method (base 14/10/13/8/12/14 + Soldier +2 STR +1 CON + level-4 ASI +2 CHA) because CONTENT.md's 16/10/14/8/12/16 cannot come from the standard array or point buy with Soldier's bonuses; the level-4 ASI is therefore shown as the chosen option on B01 and T01 (both still match the Play sheet's numbers).
- The cast dialog shows the **free-cast lane and the pact lane on every spell**, disabled with a reason when they do not apply (so the lane vocabulary is visible on one board); DL01 therefore shows two dialogs: Shield of Faith (slot lanes + concentration warning) and Divine Smite (free cast selected, upcast chip).
- The DM-locked add-condition variant is a separate small dialog beside the picker (the real app would show only that one).
- Open tooltips overlay neighbours as real tooltips would: the Cleric gate tooltip covers part of the Bard card (L01), the Defense gate tooltip covers part of the Skilled card (L03), the spent-slot tooltip covers the "On the Timeline" block title (D03), the "Poisoned already active" tooltip covers two picker chips (DL03). Tooltips that would have hidden a sentence were moved onto controls that sit next to empty space (timeline "Reverted" chip, roll-log "Clear log", Build-tab background lock with leaf padding).
- The pack-update report uses placeholder campaign-pack content ("Protection (revised)", "Emberfall cant") because the campaign pack is not SRD; every SRD name on the boards is real (feats, conditions, spells, classes, items and their weight/cost come from `pack.json`).
- Dialog/drawer boards fix the root at 1000 px (the Play sheet behind is cropped); the board rules' "fluid root" is kept (`width:100%; min-height:100vh`) with an explicit height.
- `bundle.css` is inlined whole (minus body/stage rules) per the brief, so each dc.html is 130–525 KB; the Play-sheet boards are the largest because they carry A2's full markup plus a drawer or dialogs.
- Hints are native `title`/SVG `<title>` plus static open tooltips; hover/long-press timing is for the build.
