# S3 — Campaign screens in "Tavern Table" — build notes

Built from `*.src.html` by `build.cjs` (macro expander: game-icons SVGs incl. a few extra glyphs from the cloned repo, wax seals, the design-system textures, the brass rail, the campaign header band, the three-zone strap, the DS PartyCard from one data table, a generated QR grid, phone chrome). Every board inlines `ds/check/tokens.css` + `ds/project/components/bundle.css` + `extras.css` (page classes only) in its `<helmet><style>`; the markup uses the `hk-` component classes wherever a component exists. `shoot.cjs` renders every board with Playwright (1440 × 960, then the measured height, then a 1200 px overflow check; phones at 390 × 844 plus a scrolled capture), runs an overflow probe and a target-size probe, and writes `heights.json`, which `build.cjs` reads for `$preview`. Run: `node build.cjs && node shoot.cjs && node build.cjs`.

## Files and measured heights (Chromium, fonts loaded, `document.documentElement.scrollHeight` at 1440)

| Board | File | Frame (`$preview`) | PNG |
|---|---|---|---|
| C01 Campaigns list + empty variant | `C01-Campaigns-Desktop.dc.html` | 1440 × 960 (content 540 + strap; root is `min-height:100vh`) | `C01-Campaigns-Desktop.png` |
| C02 Create campaign dialog | `C02-Create-Desktop.dc.html` | 1440 × 960 | `C02-Create-Desktop.png` |
| C03 Join (prefilled) + not-found + joining variants | `C03-Join-Desktop.dc.html` | 1440 × 960 | `C03-Join-Desktop.png` |
| C04 Link a hero | `C04-Link-Desktop.dc.html` | 1440 × 960 | `C04-Link-Desktop.png` |
| C05 Lobby (DM) + member variant | `C05-Lobby-Desktop.dc.html` | 1440 × 1234 | `C05-Lobby-Desktop.png` |
| C06 Party (DM) with quick effects | `C06-Party-DM-Desktop.dc.html` | 1440 × 1162 | `C06-Party-DM-Desktop.png` |
| C07 Party (player) + lock variant | `C07-Party-Player-Desktop.dc.html` | 1440 × 960 | `C07-Party-Player-Desktop.png` |
| C08 Member sheet drawer (DM) | `C08-MemberSheet-Desktop.dc.html` | 1440 × 960 | `C08-MemberSheet-Desktop.png` |
| C09 Table (session, feed, composer) | `C09-Table-Desktop.dc.html` | 1440 × 1334 | `C09-Table-Desktop.png` |
| C10 Settings (DM) + member packs variant | `C10-Settings-Desktop.dc.html` | 1440 × 1376 | `C10-Settings-Desktop.png` |
| C11 Confirms, toasts, banners | `C11-Confirms-Desktop.dc.html` | 1440 × 1066 | `C11-Confirms-Desktop.png` |
| C06 Party (DM), phone uk | `C06-Party-DM-Phone.dc.html` | 390 × 844 fixed | `C06-Party-DM-Phone.png`, `-scrolled.png` |
| C09 Table, phone uk | `C09-Table-Phone.dc.html` | 390 × 844 fixed | `C09-Table-Phone.png`, `-scrolled.png` |
| C03 Join, phone uk | `C03-Join-Phone.dc.html` | 390 × 844 fixed | `C03-Join-Phone.png`, `-scrolled.png` |

All desktop boards are ≤ 1376 px tall (limit 1400). Overflow probe: 0 hits on every board at 1440 and at 1200 (grids wrap; C05's third column became a stacked left column so the members leaf keeps its row at 1200). Target probe: every control ≥ 36 px on desktop (30 px visuals carry a 4 px hit halo, as the system specifies) and ≥ 44 px on the phones; the only remaining hits are the four 18 px radio inputs in the hand-over dialog, whose 40 px label rows are the real targets.

## Fonts

Forum (display: names, titles, numerals, join code, tab labels) + Alegreya 400 / 600 / 700 + italics (body, buttons, hints). One Google Fonts link per board.

## Coverage: audit screen ids → boards

| Audit id | Board(s) |
|---|---|
| campaigns-empty | C01 (empty-state leaf drawn beside the list) |
| campaigns-list, campaigns-list-member | C01 (DM card + player card; role chips, member count, session state, last played, sync glyph, quick tab links) |
| dialog-create-campaign | C02 |
| join, join-prefilled, join-filled | C03 desktop (prefilled from the deep link, display name filled) + C03 phone; "code not found" and "Joining…" variants on C03 |
| campaign-link-character, campaign-link-character-eligible | C04 (eligible, not-synced with reason + Manage sync, already-elsewhere gated, handed-over pregen with Claim, Create a new hero, Skip for now) |
| campaign-lobby, campaign-lobby-dm | C05 (brass code plate, QR, copy link, new code, roster with roles/online/remove, pregens + Add pregen) |
| campaign-lobby-member | C05, member variant drawn small (no code, no rotate, no remove) |
| campaign-party, campaign-party-dm | C06 desktop + C06 phone |
| campaign-party-member | C07 |
| member sheet (behind "DM tools" in the audit) | C08 |
| campaign-log, campaign-log-member, campaign-log-session | C09 desktop + C09 phone (session strip, mixed feed, composer; the member view is the same minus the DM-only roll styling and the End session control) |
| campaign-settings | C10 |
| campaign-settings-member | C10, "as a member sees it" variant of the packs section; the read-only notice is the tooltip-less state of the same leaves (not drawn separately) |
| dialog-campaign-export | C11 (also reachable from the strap's Export on every campaign tab) |
| dialog-leave-campaign | C11 |
| dialog-remove-member | C11 |
| hand-over and unlink dialogs (actions.md, not captured by the audit) | C11 |

## Coverage: audit defects → how fixed

| Defect | Fix on the boards |
|---|---|
| Top-10 #3: raw "blob.resend-have" toast hiding controls | C11 designs the real notice: a quiet "Reconnected to the table · re-sharing the 3 images you hold" slip (info, once) and the strap status while it runs; toasts stack top-right under the rail, auto-hide, never sit over the strap or a form; every toast on C11 is a real string with a dismiss button. |
| Top-10 #8: long uk labels wrapping ghost buttons | Ghost/leather buttons are sized at the uk length: phone strap uses icon + short label (Шкода · Лікування · Стан · Досвід · Ще at 13 px / 54 px tiles), Lobby's "Скопіювати посилання-запрошення" / "Згенерувати новий код" become icon + text buttons in a 2-column grid (en: Copy invite link · New code) with the consequence as a hint line; the phone Join strap is Назад + a full-width Приєднатися; no label wraps on any uk board (probe: 0 overflow). |
| Composer wider than the viewport (1280 / 390) | C09: the textarea is `width:100%; box-sizing:border-box; max-width:100%` inside the leaf; the visibility picker is a segmented single-choice control (Everyone / DM only / Private) whose segments size to content, with the hint "Everyone at the table sees it" and a human counter "0 / 2048"; Send sits on the same row, disabled with a reason until there is text (phone: the same, 44 px). |
| Nav overflow at 390 (every screen) | Phone boards have no top nav: folio button + title + one context action, tabs at the bottom (Гурт · Стіл · Лобі · Налаштування). |
| campaigns-empty: no CTA inside the empty state | C01 empty leaf holds New campaign + Join with a code and the "ask your DM for a code / QR" hint. |
| campaigns-list: card lacks member count / session / last activity; crushed header at 390 | C01 cards carry role, members (+ pregens), session chip with round and elapsed, last played line, sync glyph with tooltip. |
| dialog-create-campaign: native input, no helper text | C02: parchment dialog, themed input with a counter and helper, starting level and party-sheet visibility with hints. |
| join: native inputs, blue link, left-hugging form, no explanation, no campaign preview | C03: themed fields (code in Forum, grouped), Back in strap zone 1, intro explains what joining does, a slip previews the campaign the code opens, Scan a QR affordance, error state with a concrete hint. |
| link-character: four competing primaries; wrapped buttons | C04: cards select, one brass "Link Bramble Underfoot" on the strap; gated cards keep a disabled button with the reason. |
| lobby: toast over roster, wrapped ghost buttons, small uncaptioned QR, monospace code | C05: 208 px QR with caption, Forum brass code plate, button grid, roster rows with Remove as a text button, pregens section. |
| lobby-member: empty, purpose unexplained | C05 member variant explains what players see and where Leave lives. |
| log: peer-looking visibility buttons, detached Send, "0/2048 байт", raw usernames | C09: segmented picker, Send on the row, "0 / 2048", display names with "plays …" hints, DM-only rolls on a dark leather slip with a crown badge and a tooltip. |
| party: cards with no stats, "Без персонажа" bare heading, squeezed title row | C06/C07: DS PartyCards with HP strap, AC, conditions with durations, concentration orb, passive perception, inspiration; members without a hero are shown in the Lobby roster and the "no hero" banner (C11). |
| party-member: own card has no stats or open action | C07: own card highlighted with "your hero" plate, its condition chip expandable, "Open my sheet" on the card and in strap zone 2. |
| settings: 1537 px tall, Save easy to miss, native checkboxes, chips not clearly single-select, "0 / 6" confusing | C10: two columns, 1263 px; autosave with a "Saved · just now" status (toast "Campaign settings saved."); brass toggles; segmented single-choice groups; quota gauge "1 / 6 packs enabled" with a tooltip; Enable / Disable / Update rows plus a busy row. |
| settings-member: disabled checkboxes look live | C10 member variant uses status chips (Installed / Installing…) instead of controls. |
| dialogs: fine in the audit | C11 keeps the pattern: title seal, consequence text, text labels on destructive verbs, leather strap of actions. |

## Coverage: actions.md controls → where they live

| Control (template) | Home on the boards |
|---|---|
| create-campaign-dialog cancel / confirm | C02 dialog strap: Cancel · Create campaign |
| join back / confirm (joining…) | C03 strap zone 1 Back, zone 2 Join (disabled with reason until a code; Joining… loading variant); phone strap Назад · Приєднатися |
| link-character pick / resume / resume-leave / claimed-action / retry / sync-cta / create-new / skip | C04: Link this hero on cards and on the strap (resume = same slot reads "Finish linking" after a retry); Claim on the handed-over pregen; Retry is the same button after a failure; Manage sync on the not-synced card; Create a new hero as the dashed card and strap zone 3 (+); Skip for now in strap zone 1 |
| campaigns-list join / create / open | C01 strap zone 2 New campaign · Join; dashed slots; Open on each card plus Party/Table/Lobby/Settings quick tabs |
| lobby copy-link / rotate (generating…) / member-remove | C05 Copy invite link, New code (loading = spinner in place of the glyph), Remove per row → C11 confirm |
| log-tab session-start / session-end / composer visibility / send | C09 session strip (End session, text, ember) and strap zone 3 candle (Start/End session with tooltip); composer segmented picker; Send |
| dm-effects-panel toggle, Damage / Heal / Add temp HP / Grant / Revoke inspiration / Add condition / Award XP / Grant a level / Grant item / Apply override, number fields | C06: chip row on every card (Damage · Heal · Temp HP · Condition · XP · Level · Item · Inspiration · Override) opens the quick-effects leaf (phone: bottom sheet) whose tabs hold each form; Damage form drawn with amount, type, source and "Apply 7 damage"; strap zone 2 Damage · Heal · Condition · XP · Item act on the selected card |
| handover-character-dialog member / cancel / confirm / retry | C11 Hand over dialog (member picker, consequence, Hand over to Taras); entry points: "Hand over to…" on pregen cards, the quick-effects leaf and the Lobby pregen row |
| member-sheet-dialog close, stat tiles, pips | C08 drawer: Close, Override, chips for AC/initiative/speed/passive perception, seals for slots and resources, Timeline |
| party-tab add-pregen / link-cta / view-sheet / unlink / handover | C06 Add pregen (header and Lobby), C11 "no hero" banner with Link a hero, C07 View sheet icon on cards (full-sheets setting), C06 quick-effects leaf footer Unlink hero → C11 confirm, Hand over to… |
| unlink-character-dialog cancel / confirm / retry | C11 Unlink dialog (Retry = the confirm after a failure) |
| campaign-export-dialog cancel / confirm (exporting…) | C11 Export dialog; opened from the strap's Export (zone 3) and the Settings Export leaf |
| campaign-packs update / disable / enable / retry | C10 pack rows (Update campaign version to 1.3.0, Disable, Enable, busy "Updating the campaign…"; Retry lives on the failure banner on C11) |
| campaign-settings save (saving…) / export, number fields attunement / starting level | C10 autosave with status chip (owner flag below); Export leaf; −/+ number fields |
| roles, removed toast, packs installed toast | C01/C05 role chips; C11 toasts |

## Owner comment applied (wizard starting-equipment step)

C10 House rules now has three more toggles directly under Starting level, in the same row style as "Players manage their own conditions": "Starting gold instead of equipment" (default on; "on: a new hero may take the class's starting gold and buy gear in the wizard instead of the equipment kit; off: the wizard offers the kit only"), "Multiclassing" (default on; "When off, level-ups skip the class choice and continue in the hero's class.") and "Players add items themselves" (default on; "off: only the DM grants items; players' Add item is locked"). Rebuilt in place; measured height 1376 px (was 1263), `$preview` updated, probes clean at 1440 and 1200.

Encounters (owner comment: a session holds several fights with dialogue between them). C06 and C09 replace the "Round 3 · started 20:12" plate with an encounter plate. During a fight it reads "Encounter 2 · Round 3 · since 20:04" next to the brass "Advance round" and a text "End encounter" (ghost-leather, state change; hover hint "Ends the fight; durations keep running", drawn open on C09). Between fights it reads "No encounter" with a brass "Start encounter" (drawn as a small variant on C09's right column). C09's feed gained the system lines "Encounter 1 started · 19:51", "Encounter 1 ended · 19:58" and "Encounter 2 started · 20:04" (before "Round 1 · 20:04"), with a DM dialogue line between the fights; Olena's last message was dropped to keep the board under 1400. The strap is unchanged. C06 stays 1162 px, C09 is now 1334 px. The phone boards still say "Сесія триває · раунд 3"; the uk encounter plate ("Сутичка 2 · раунд 3", "Завершити сутичку", "Почати сутичку") is a follow-up if wanted.

## Phone and tablet phase (second pass)

Fixed: `C06-Party-DM-Phone` and `C09-Table-Phone` now carry the encounter strip (`<x-enc>`: "Сутичка 2 · Раунд 3 · 1 год 12 хв · 4 онлайн", brass "Наступний раунд", ghost "Завершити сутичку" with the hint "Завершує бій; тривалості продовжують спливати"); C09's feed gained "Сутичка 2 почалася · 20:04". The phone party cards are now generated from one data table (`<x-pcardp>`, uk names in `UK`), so C06, C07 and C11 phones agree.

New boards (390 × 844, uk, fixed frames; strap via `<x-pstrap>`, tabs Гурт · Стіл · Лобі · Налаштування where inside a campaign):

| Board | File | Notes |
|---|---|---|
| C01 Campaigns | `C01-Campaigns-Phone.dc.html` | two campaign cards with role/members/session chips, quick tab links, join slot; strap Нова кампанія · Приєднатися; long-press hint on the live-session chip |
| C02 Create | `C02-Create-Phone.dc.html` | bottom sheet over the dimmed list: name + counter, starting level, party-sheet visibility (segmented), Скасувати · Створити кампанію |
| C04 Link a hero | `C04-Link-Phone.dc.html` | stacked cards: selected/synced (hint), not synced + Керування синхронізацією, already elsewhere (gated), handed-over pregen + Заявити права, create-new slot; strap Назад · Пропустити · Прив'язати Брембла |
| C05 Lobby | `C05-Lobby-Phone.dc.html` | code plate, 172 px QR, copy / new code (hint), roster with Видалити, pregens + Додати заготовку персонажа |
| C07 Party (player) | `C07-Party-Player-Phone.dc.html` | encounter strip without controls ("раунди та сутички веде майстер"), own card highlighted with the open condition chip and Мій лист, view-sheet icons, locked-chip variant; strap Мій лист · Кинути · Ще |
| C08 Member sheet | `C08-MemberSheet-Phone.dc.html` | full-screen sheet: head with HP/AC, read-only banner, abilities, attacks, resources, spells, conditions, skills, bag; strap Закрити · Перевизначити (the Override affordance) |
| C10 Settings | `C10-Settings-Phone.dc.html` | house rules incl. the three new toggles, packs with quota hint and Enable/Disable/Update/busy, visibility, joining, export, leave (disabled with reason) / delete |
| C11 Confirms | `C11-Confirms-Phone.dc.html` | hand-over bottom sheet with the member picker, the "Капітан варти тепер належить Тарасу." toast and the pin-campaign-packs banner |
| C11 Confirms (remove) | `C11-ConfirmsRemove-Phone.dc.html` | remove-member bottom sheet over the roster, the "Код запрошення оновлено." toast (a second file because one 390 × 844 frame holds one sheet) |
| C06 Party DM, tablet | `C06-Party-DM-Tablet.dc.html` | 768 × 1024 fixed frame, English: compact rail (mark only), wrapped campaign header with the tab row, encounter plate + Advance round (tooltip) + End encounter, 2-column DS party cards, the quick-effects bottom sheet over the grid above the compact DM strap (Damage · Heal · Condition · XP · Item · session · export) |

Probes: 0 overflow on every phone/tablet board; every control ≥ 44 px on phones (visual 32–40 px chips carry a 12 px halo) and ≥ 36 px on the tablet; the only hits are the 20 px radio inputs inside 48 px label rows. A bug found on the way: `.pgT > *{position:relative}` had overridden the bottom sheet's `position:absolute` (same specificity, later rule), pushing the strap out of the frame; the rule now names the in-flow children only.

More Ukrainian strings invented for this pass: Сутичка 2 · Раунд 3, Завершити сутичку, Почати сутичку, Немає сутички, раунди та сутички веде майстер, Сутичка 2 почалася; Створити кампанію; гравці бачать її на екрані приєднання; Листи групи · Приховані / Лише огляд / Повні листи (from the app); синхронізовано, без кампанії, обрано, Прив'язати Брембла; відкрита, Скануйте камерою…, Заготовки, не заявлено; Мій лист, Кинути, Ще, ваш герой, Керує ваш майстер; Перевизначити, Лише читання…, Клятва відданості, Солдат, бонус/майстерність chips, Споряджено, Налаштовано, рідкісний, легке навантаження; Стартове золото замість спорядження, Мультикласування, Гравці самі додають предмети (+ their explanations), Збережено · щойно, базовий, Оновити версію в кампанії до 1.3.0, Оновлення…, Експортувати кампанію…, Покинути кампанію…, Видалити кампанію…; Передати Капітана варти?, Передати цього персонажа:, Передати Тарасу, Капітан варти тепер належить Тарасу., Закріпити для Іляни, Пізніше, Кампанія ділиться пакетом…; Видалити Олену?, Видалити Олену, Код запрошення оновлено. (app) with its sub-line.

## Decisions the owner should look at

- Settings autosave (no Save button): the audit's "Зберегти" was easy to miss; the boards save each control on change and show "Saved · just now" plus the existing toast. If a Save button is preferred, it belongs in strap zone 2 as the only primary on that tab.
- Player strap zone 2 reads Open my sheet · Roll (the spec fixes only the DM's zone 2); zone 3 is empty for players with the note "session and export are the DM's".
- "Advance round" lives in the Party header (next to a Round 3 plate) and on the Table's session strip; on the phone it is a full-width brass button in the session strip (the top-bar action is Add pregen on Party, End session on Table).
- Campaign tabs are Party · Table · Lobby · Settings (the live app's "Log" became "Table" per the spec; uk Гурт · Стіл · Лобі · Налаштування per the group prompt, replacing Група · Журнал).
- The DM cannot leave a campaign (Leave campaign is disabled with the reason; Delete campaign is the destructive verb); the player's Leave dialog is on C11.

## Strings invented in Ukrainian (not in the existing uk.json files)

Гурт, Стіл (tab names from the prompt); Сесія триває · раунд 3; Наступний раунд; «Раунд 3 → 4: усі тривалості в раундах −1 для всіх»; швидкі ефекти; Застосувати 7 шкоди; Тип; Тимчасові ОЗ (5) поглинають першими: 31 → 29 ОЗ. Запис піде на Стіл.; обрано; станів немає; грає Міра / Тарас / Олена / Марко / Петро; заготовка · не заявлено; Передати…; Ще; Меню розділів; Додати заготовку персонажа (exists as "Додати заготовку персонажа" in the app, reused); Сканувати QR-код; Заповнено з посилання-запрошення; Цей код відкриває …; відкрита для приєднання; Ви приєднуєтеся як · Гравець; Крок 1 з 2: код. Далі ви оберете героя.; «У кодах цифра 0, а не літера О…»; Якщо код не знайдено; Повідомлення (exists), Напишіть столу або опишіть, що сталося…; Бачать усі; усі (roll badge); влучання / промах; Результат к20 / к8; Разом; Сесія почалася — Сесія 12; Іляна отримала 7 шкоди від Гігантського павука; Концентрація: Утримання особи / Мітка мисливця; Невидимий; Непритомний; Рятівні кидки від смерті: 1 успіх, 1 провал; Гробниці Соляного короля; Компанія Емберфол (from CONTENT.md). Class and species words without a uk pack: Півмірок, Пройдисвіт, Клірик, Ельф, Слідопит, Дварф, Воїн; hero names transliterated: Брембл Андерфут, Сестра Марен, Торн Ешвейл, Оскар Беллоу, Капітан варти.

## Compromises (all of them)

- Hero ownership is not consistent across boards: C04 (the player path, joining "Tombs of the Salt King") lists Bramble Underfoot and Sister Maren as your own heroes, while C05–C09 show them as other players' heroes in The Emberfall Company, because the prompt names only these five heroes. Player display names (Mira, Taras, Olena, Marko, Petro, you = Dana) are invented, as are the HP/AC/passive-perception numbers of every hero but Ilyana, the second campaign's member count (4) and history, the session title "Session 12", timestamps, the pack names "Emberfall Homebrew", "Salt King Bestiary", "Trinkets and Oddities" and their counts, and the join code 91PQ-S10Q (taken from the audit captures).
- The QR is a plausible version-3 grid (finder, timing and alignment patterns with deterministic noise), not an encodable code.
- Tooltips overlap neighbours as real tooltips do: Advance round's covers the header's session chip (C06), the Offline tooltip covers one roster row's controls (C05), the DM-only tooltip covers the slip above it (C09 desktop and phone), the pin tooltip covers the banner text (C11).
- C11 (dialogs, toasts, banners) has no rail or strap: it is a component board, not a screen.
- C08's drawer is 1000 px wide over a dimmed page; the member sheet is compressed to one screen (abilities as 46 px seals, skills in two columns, a single-column bag ledger); features and spells are name lists without level badges.
- C06 desktop shows the quick-effects leaf beside the grid (two columns of cards); the spec's "open the member's sheet in a drawer" is C08, reached from the leaf's Open full sheet and the card's book button.
- C07's locked-chip variant is a slip under the grid rather than a second full board; the whole player view with the house rule off differs only by those chips.
- The phone quick-effects sheet covers the strap but leaves the tab bar visible; its tab row scrolls sideways (three of nine chips visible).
- The "Reconnected" toast wording for `blob.resend-have` is a design proposal: in the API it is an info notice asking clients to re-announce the images they hold; the engineer should keep it silent unless images are actually re-sent.
- Hints are native `title` / SVG `<title>` plus the open tooltip drawn on each board; the 300 ms hover / 400 ms long-press timing is for the build.
- `extras.css` adds a few non-DS helpers (segmented control `.seg/.segb`, feed rows, roster rows, phone card, hit-area halos); they map onto FilterChips, rows and Leaf in the build.
