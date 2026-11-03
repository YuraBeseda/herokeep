# S4 — Library, Packs & Homebrew, Settings, Auth, Heroes list, System states

Group S4 of the screens phase, in the approved "Tavern Table" language (concept A v2 materials + the Herokeep design system). Twelve desktop boards (1440, English) and three phone boards (390 × 844, Ukrainian).

## Files

| Board | File | Measured height at 1440 (`$preview`) |
|---|---|---|
| LB01-Library | `LB01-Library-Desktop.dc.html` | 1182 |
| LB01-Library (phone, uk) | `LB01-Library-Phone.dc.html` | 390 × 844, no sideways overflow |
| LB02-Library-Spell | `LB02-Library-Spell-Desktop.dc.html` | 960 |
| LB03-Library-Class | `LB03-Library-Class-Desktop.dc.html` | 1222 (after the owner's two comments, see below) |
| PK01-Packs | `PK01-Packs-Desktop.dc.html` | 1146 |
| PK01-Packs (phone, uk) | `PK01-Packs-Phone.dc.html` | 390 × 844, no sideways overflow |
| PK02-Pack-Detail | `PK02-Pack-Detail-Desktop.dc.html` | 960 |
| PK03-Trust | `PK03-Trust-Desktop.dc.html` | 960 |
| PK04-Homebrew | `PK04-Homebrew-Desktop.dc.html` | 1000 |
| PK05-Homebrew-Item | `PK05-Homebrew-Item-Desktop.dc.html` | 1160 (after the owner's icon comment, see below) |
| H01-Heroes | `H01-Heroes-Desktop.dc.html` | 960 |
| ST01-Settings | `ST01-Settings-Desktop.dc.html` | 1126 |
| ST01-Settings (phone, uk) | `ST01-Settings-Phone.dc.html` | 390 × 844, no sideways overflow |
| AU01-Auth | `AU01-Auth-Desktop.dc.html` | 1114 |
| X01-States | `X01-States-Desktop.dc.html` | 960 |

Every board is at most 1222 px tall (limit 1400); none overflows sideways at 1200 px.

## Owner comments applied after the first delivery

**LB03 — choices and feature text (two comments).** Rule applied: every class feature that grants a choice carries a small brass chip "N options" right after its name, counted from the pack's choice queries with prerequisites applied; hover/focus opens a parchment popover listing the options as library links with a "See all in library" footer. Counts: Weapon Mastery 38 (every weapon with a mastery property; Paladins have simple + martial proficiency), Spellcasting 13 (the level-1 Paladin spells; the feature says "choose two level 1 Paladin spells"), Fighting Style 4 (Archery, Defense, Great Weapon Fighting, Two-Weapon Fighting — the pack's `fighting-style` feats; the feature text also offers Blessed Warrior, which is not a pack entity, so it is named in the hint, not counted), Channel Divinity 2 (Divine Sense from the feature text + the Oath's Sacred Weapon, chosen at use time), Paladin Subclass 1 (Oath of Devotion), Ability Score Improvement at 4/8/12/16 → 10 (the feats a level-4 Paladin qualifies for; the 7 epic boons are gated to level 19), Epic Boon at 19 → 17. Chips sit on the level-1 feature list, on the features-by-level rows (1, 2, 3, 4, 8, 12, 16, 19) and on the "Choices along the way" leaf. Every feature name in the list and the table is now a link to its Features entry (`title="Open the entry: …"`), and each truncated "…" summary has a full-text popover with an "Open entry" button. Drawn open: the Lay On Hands full-text popover (to the left of its row, over the Core traits block) and the Weapon Mastery options popover (below its focused chip, over the top of the table); they do not overlap each other. The previous open tooltip on "Paladin Subclass" was replaced by that row's "1 option" chip hint. Height 1206 → 1222 (chips make table rows a few px taller).

**PK05 — item icon (one comment).** An "Icon" field sits under the name: a brass row with the current glyph, its source line and a "Change icon" button; the picker is drawn open as an inline parchment panel (a popover would have hidden either the name/validation or the weapon fields the brief needs visible): a search field over the 365 kit glyphs, "Used in this pack" (the five glyphs of My homebrew's entries plus one uploaded image, `emberfall-sigil.svg`, drawn as a hand-made sigil since no image files are allowed), a grid of 30 common item glyphs with name + author hints, an "Upload your own" dashed slot with a real file input (PNG/SVG, resized to 128 px on the device, stored with the pack's images so it travels with .hkpack exports and campaign shares), and a Cancel / "Use flask" footer. To stay under 1400 px the form's right column now reads Type · Rarity → Weapon section → Weight/Cost/Coin · Attunement · Charges, and the Armor inset moved to the right column. Height 1144 → 1160. A PNG per board sits beside it (`<Id>-Desktop.png` full page, `<Id>-Phone.png` viewport).

Authoring: `*.src.html` are the sources; `node build.cjs` expands the macros (`<i-icon>`, `<x-seal>`, `<x-tex>` exactly as in `out/A2/build.cjs`, plus `<x-rail>`, `<x-topbar>`, `<x-strap>`, `<x-pstrap>` for the shared chrome), inlines `ds/check/tokens.css` + `ds/project/components/bundle.css` + `s4.css` (page-specific classes, prefix `s4-`) into each `<helmet><style>`, stamps `$preview` from `heights.json`, and asserts there is no template syntax, `data:` URI, emoji or `!important` in the output. `node shoot.cjs` renders every `.dc.html` in Chromium, records desktop heights into `heights.json`, screenshots, checks the 1200 px width and probes for clipped `nowrap` text. Run build → shoot → build so the stamped heights are the measured ones.

## Phase 2: remaining phone boards and two tablet boards

| Board | File | Frame |
|---|---|---|
| LB02-Library-Spell (phone, uk) | `LB02-Library-Spell-Phone.dc.html` | 390 × 844 |
| LB03-Library-Class (phone, uk) | `LB03-Library-Class-Phone.dc.html` | 390 × 844 — options chips on the level-1 features; the Lay On Hands full-text popover as a bottom sheet, drawn open |
| PK02-Pack-Detail (phone, uk) | `PK02-Pack-Detail-Phone.dc.html` | 390 × 844 |
| PK03-Trust (phone, uk) | `PK03-Trust-Phone.dc.html` | 390 × 844 — the trust dialog as a bottom sheet over the dimmed packs list |
| PK04-Homebrew (phone, uk) | `PK04-Homebrew-Phone.dc.html` | 390 × 844 |
| PK05-Homebrew-Item (phone, uk) | `PK05-Homebrew-Item-Phone.dc.html` | 390 × 844 — the icon field opens the picker as a bottom sheet, drawn open |
| H01-Heroes (phone, uk) | `H01-Heroes-Phone.dc.html` | 390 × 844 — stacked cards, install banner |
| AU01-Auth (phone, uk) | `AU01-Auth-Phone.dc.html` | 390 × 844 — the recovery-codes step (the login leaf follows the same leaf + strap pattern) |
| X01-States (phone, uk) | `X01-States-Phone.dc.html` | 390 × 844 — not found + offline banner + two toasts, as one real screen state (no captions) |
| LB01-Library (tablet, en) | `LB01-Library-Tablet.dc.html` | 768 × 1024, mark-only rail; chips wrap; strap in three zones |
| IA-Home (tablet, en) | `IA-Home-Tablet.dc.html` | 768 × 1024, mark-only rail; Continue full width, heroes 2 × 2 (3 heroes + New hero), campaigns 2 + Join, quick actions 2 × 2, strap; `IA-Home-Tablet-scrolled.png` shows the part below the fold |

Phone chrome: `hk-topbar` (folio button, title, one context action), scrolling body, strap per §3 with zone 3 collapsed into "Ще"; bottom sheets are `s4-sheet` (parchment, grip, head, scrolling body, leather strap) over `s4-overlay`. Tablet chrome: the brass rail with the mark only (`<x-rail mark="only">`), the desktop strap. Probes: scrollWidth 390 / 768 everywhere, no clipped text; every touch target ≥ 44 px on the phones. The IA home reuses the IA group's content (Ilyana Vorn, Bramble Underfoot, Sister Maren; The Emberfall Company live, Tombs of the Salt King) so the two home boards agree.

Ukrainian strings invented for this phase (not in the app's uk.json): "Додати герою", "Скопіювати посилання", "З аркуша", "Рятівний кидок: Спритність", "Джерело", "Id запису", "без концентрації", "Основні риси", "З 1 рівня", "Особливості за рівнями", "N варіантів / варіанти / варіант", "підготовлено", "особливість підкласу", "Рівні 11–20", "Відкрити запис", "Від класу Paladin, рівень 1 · особливість класу, не заклинання", "Експортувати як .hkpack", "актуально", "є" (installed chip), "Цілісність", "sha256 збігається із записом кампанії / підтверджено", "закріплено 1.2.0", "Компанія Емберфол (ведучий)", "Оновити пакет", "Лише на цьому пристрої", "Додає 2 предмети порівняно з 1.2.0; 2 персонажі залишаються на 1.2.0", "Перевірка не знайшла помилок чи попереджень", "Файл", "Ця назва вже використовується в «Мій хоумбрю». Оберіть іншу або змініть той предмет.", "(з назви)", "Іконка", "Змінити", "Оберіть іконку", "Пошук серед 365 гліфів", "Використано в цьому пакеті", "Поширені гліфи предметів", "Власна іконка", the upload hint, "Використати flask", "Довідка з Markdown", "Встановити Herokeep" (banner title), "4 герої · 3 у Компанії Емберфол · усі синхронізовано", "Сьогодні, 20:14 / 2 дні тому / Тиждень тому", "2 зміни" (+ the existing pending tooltip), "Соло", "Ще: …" hints, hero labels "Брат Олдрік / Дварф · Клірик 4 / Домен Життя · Аколіт", "Нім Квікфут / Гафлінг · Пройдисвіт 3 / Злодій · Злочинець", "Серра Торнвуд / Ельф · Рейнджер 5", "Крок 2 з 2 · акаунт … створено", "Завантажити .txt" (shortened from "Завантажити як .txt" so it never wraps), "Кожен код працює один раз", "Довідка про акаунти", the offline banner body, the not-found second sentence, "Посилання:", "До героїв", "зміни збережено на цьому пристрої", "Emberfall Homebrew 1.3.0 · щойно".

## Fonts

Forum (display: titles, numerals, plates, seals) + Alegreya 400/600/700 with italics (body, hints). AU01 adds JetBrains Mono for the recovery codes (verified Cyrillic, same single Google Fonts link). Body text is 15–16 px on desktop, 16 px on the phone.

## Materials and components

Ground wood, candle vignette, parchment leaves (alternating ±0.15–0.3° tilt), leather straps and rail, brass icon buttons/plates/tabs, wax seals: the A2 textures (`x-tex`) and the design-system classes (`hk-rail`, `hk-astrap`, `hk-leaf`, `hk-search`, `hk-chip`, `hk-dialog`, `hk-banner`, `hk-toast`, `hk-toggle`, `hk-numfield`, `hk-frame`, `hk-strap`/`hk-gauge`, `hk-tip`, `hk-item`, `hk-arow`, `hk-card`, `hk-topbar`). Icons: game-icons only; the kit's `icons.json` plus 20 glyphs taken from the cloned repo the same way A2 did (`hand-ok`, `smartphone`, `laptop`, `tablet`, `cloud-download`, `cloud-upload`, `radio-tower`, `expand`, `contract`, `id-card`, `database`, `clockwise-rotation`, `checklist`, `paint-roller`, `hazard-sign`, `tied-scroll`, `sunbeams`, `network-bars`, `third-eye`, `thrown-spear`). Authors used: badges, carl-olsen, darkzaitzev, delapouite, lorc, lucasms, sbed, skoll, willdabeast — the About leaf credits them.

## Coverage: audit screen ids → boards

| Audit id | Board |
|---|---|
| library | LB01 (desktop + phone) |
| library-search | LB01: query "fire" typed, 15 results, Fireball first |
| library-filter | LB01: type chips with per-type counts; zero-count chips disabled with the reason |
| library-dark | ST01 Appearance: the light look is the `scroll` theme card; icons are `accent-strong` on parchment in every theme (no near-invisible icons) |
| library-detail | LB02 (Fireball) |
| library-detail-class | LB03 (Paladin, done properly) |
| packs-list, packs-list-initial | PK01 (+ the initial-state inset) and PK01 phone |
| pack-detail, pack-detail-core | PK02 (content pack); the core pack's "built in, can't be removed" lock is on PK01's core row with its hint, and PK02's Remove block is replaced by that note for the core pack |
| dialog-pack-trust | PK03 (+ the already-installed inset) |
| homebrew-list, homebrew-list-empty | PK04 (+ empty inset) |
| homebrew-new-item, homebrew-edit-item | PK05 (editor leaf; "Edit item" is the same form with the title changed) |
| homebrew-new-spell, homebrew-new-feat, homebrew-new-species | PK04's "What a homebrew entry can be" leaf lists their fields; the forms reuse PK05's field vocabulary (select, segmented, chips, number field, toggle, markdown textarea) — not drawn as separate boards (not in the S4 board list) |
| settings, settings-fresh-account | ST01 desktop (signed-in, 3 devices, quota) and ST01 phone |
| settings-anon | ST01: the signed-out Account inset |
| about | ST01: About & licences leaf (About folds into Settings, spec §2.1) |
| login, login-error, login-redirected | AU01 leaf 1 (error state + the "Log in to open Campaigns" notice) |
| register-form, register-form-errors | AU01 leaf 2 (rules shown before typing, live availability and strength) |
| register-codes | AU01 leaf 3 |
| recover | AU01 leaf 4 |
| characters-empty, characters-list, characters-list-dark | H01 (+ empty inset; theme is a setting) |
| sheet-not-found | X01 "Hero not found" with links back |
| install banner (characters list) | H01 (Android variant on the page, iOS variant inset) |
| app shell: offline, update-available, core-error | X01 |
| sheet banners: missing packs, campaign packs pin | X01 |
| toasts | X01 (success / warning / error) |

## Coverage: audit defects → how they are fixed

| Defect | Fix on the boards |
|---|---|
| Top-10 #1 sideways scroll on phones (nav never wraps) | Phone boards use the top bar (folio button, title, one context action) and the strap; no top nav. Probe: scrollWidth 390 on all three. |
| Top-10 #3 raw "blob.resend-have" toast over controls | Toasts are parchment slips bottom-right (X01), never over the strap; copy is real text. |
| Top-10 #8 uk strings collide and wrap | Every control is designed at the uk length; phone tiles use icon + short label; chips scroll with a fade; probe finds no clipped text except the intentional scrollers. |
| Top-10 #9 library row pills clipped | Rows are a grid `34px / 1fr / auto / auto / 24px`: the name column ellipsises, the type and EN pills never leave the row (LB01 desktop and phone). |
| Top-10 #9 "Fireball" ranked 10th for "fire" | Best-match ranking: exact match first, then prefix, then word matches; the hint under the field says so; sort select offers Name/Type/Level. |
| Top-10 #9 selected chip stays highlighted while search returns all types | Chips carry per-type counts for the current query; "All" is selected while nothing narrows; zero-count chips are disabled with the reason. |
| Top-10 #9 class detail is an empty stub | LB03: core traits, level-1 features with real first sentences, features-by-level table 1–20 from the pack (prof., CD uses, prepared, slots), subclass card, spell-list leaf, choices leaf. |
| Top-10 #9 no back links on detail pages | "Back to library" ghost button + breadcrumb hint on LB02/LB03; strap zone 1 Back (history-aware). Same on PK02, PK04, PK05. |
| Top-10 #10 only visible card action is red Delete; raw pack id as subtitle; unlabeled green dot | H01 cards: Open (brass) + a "more" button (export, duplicate, delete behind it); species · class level, subclass, background, XP, HP strap, campaign chip, last played; sync state is a chip with a word and a hint. |
| library-detail: mixed languages, 190-char lines | Facts are tags with icons and hints; body at 16/1.5 in a 72ch measure; pack text language shown as the EN pill with a hint. |
| library-filter: subclass rows give no parent class | Row sub-line pattern carries the parent (e.g. "Level 3 evocation · …"; subclass rows would read "Paladin · level 3"). |
| library-search: two clear controls; 1150 px search box | One clear button inside the pill; the field is 520 px. |
| library rows: no level/school hint, no count until typing | Every row has a sub-line; the count line is always present. |
| packs-list: two Sample content versions indistinguishable; rows without affordance; "Хоумбрю" link-in-a-box | One row per installed pack with a version plate and a state chip (Update available / This device / From another device / Campaign); chevron open button + hover; Edit/Update as real buttons; Homebrew is a leather button. |
| packs-list-initial: empty state without CTA | Inset: "No content packs yet…" with Import pack / New homebrew inside the card. |
| pack-detail: counts 1200 px from labels; red Remove in the flow; raw semver; "34 Б" | Contents as a tile grid; Remove in a danger block with consequence text + confirm dialog inset; "0.1.0 or newer" + "installed"; "9 images · 1.1 MB". |
| pack-detail-core: URL breaks mid-word; English attribution unflagged | `overflow-wrap:anywhere` on attribution/links (PK02, LB02, ST01). |
| dialog-pack-trust: semver range | "SRD 5.2.1 (2024 rules) 0.1.0 or newer · installed". |
| homebrew-list: mixed link/button idioms; wrapped "New…" links | Edit is a brass icon button with a hint, Delete keeps its text; New is one brass strap button with a menu. |
| homebrew-new-item: toast over Save; half-width form; mismatched paired fields; no required markers; 20 px back link | Save/Cancel live in the strap; two-column form inside a full leaf; all paired fields share the `hk-field` label + 36 px control; required marks; Back is a ghost button. |
| homebrew-new-species: untranslated enums | Enums go through i18n (`packs.homebrew.enum.*` exist); PK05 shows English enums on the English board. |
| homebrew-new-spell: 1.7 k px form, no sections | Pattern: sections side by side in one leaf, Save in the strap (PK05); the spell form follows it. |
| settings: duplicated storage line; native blue slider; demo-pack primary button; persist button unexplained; no section navigation; 1541 px | One storage line with a segmented bar; cache limit is a select; the demo import is a quiet link; "Keep data on this device" is explained with a "granted" chip; left index leaf; 1126 px. |
| settings: "Базовий пакет правил | srd-5e-2024@0.1.0" wraps | Content packs leaf: name + version plate on one row. |
| login/register/recover: top-left 384 px forms; device name unexplained; 20 px links; no rules before typing; errors far from fields | Centred parchment leaves with a leather action strap; device-name hint; rules and strength shown live; error under the field it concerns with the field outlined; links are 16 px underlined and spaced. |
| register-codes: buttons wrap at 390; 13 px checkbox | Leather buttons with icons; 20 px brass checkbox; codes in a monospace block. |
| characters-list: header crushed at 390 | Strap carries New · Import; the page header is title + count only. |
| about: SRD card clips the URL | Links wrap; the About leaf lists SRD, Open5e, icon authors, fonts, version. |
| sheet-not-found: no link back | "Go to heroes" + "Home". |
| cross-cutting: light theme beige-on-beige | Themes are token sets; the Appearance cards preview tavern / scroll / plain. |

## Coverage: actions.md controls → where they live

| Template / control | Placement |
|---|---|
| Library browse: row button, EN tag, search field (placeholder, clear) | LB01 rows (link rows with type + EN pills), `hk-search` with clear; strap zone 3 Filter · Search (focus the field / toggle chips) |
| Library detail: Back to library | LB02/LB03 ghost button; strap zone 1 Back; Add to hero in zone 2 (enabled with a hero context, disabled with the reason otherwise); Copy link / Open the pack in zone 3 |
| Packs list: Homebrew, Import pack, import-details dismiss, core row (core rules), update-available, other-device-homebrew | PK01: Homebrew leaf button; Import pack (strap brass + Choose a file); chips "core rules", "Update available: 1.1.0", "From another device"; the import-details slip is the PK03 dialog's "Validation found no errors" block (a failed import shows the reason there with Dismiss) |
| Pack detail: Back to packs, Remove pack | PK02 ghost button + strap Back; Remove pack ember button in the danger block + confirm dialog |
| Pack trust: Cancel, Install | PK03 dialog strap (Install disabled with reason when already installed) |
| Homebrew list: back, new-link ×4, edit (+ label), delete (+ label) | PK04: Back; New menu (item / spell / feat / species); Edit icon button with hint; Delete text button with hint |
| Homebrew editor: back-to-list, cancel, save, weight, range-normal, range-long, ac, dex-cap, strength, shield-ac, species add/remove trait, speed, spell level/casting/range/duration | PK05: Back to homebrew; Cancel (strap zone 1), Save item (zone 2); Weight, Normal/Long range; Armor class, Dexterity bonus cap, Strength required (Armor inset; shield-ac noted in its hint); species/spell fields reuse the same controls (listed on PK04's "What a homebrew entry can be") |
| Settings: persist, import-demo, manage packs, logout, logout-all, login link, register link, devices retry, revoke | ST01: Keep data on this device (explained, "granted"); Import the sample pack (demo link); Manage packs (strap brass) + Open packs; Log out (leather); Log out everywhere (text, danger, confirm hint); Log in / Create an account (signed-out inset); Revoke per device with a hint; "Try again" uses the X01 retry pattern |
| Characters list: import, create, open (portrait), delete, install banner install / how-to / dismiss | H01: Import + New hero (strap); Open per card; Delete behind the card's "more" button (keeps text in its menu); install banner with Install / How to install / Dismiss |
| App shell: update reload, logout, login link, theme toggle, core-error retry | X01 update banner Reload; ST01 Log out / Log in; theme is the Appearance cards; X01 core-error Try again |
| Auth: login submit, register link, recover link, register submit, login link, codes copy / download / continue, confirm-leave stay / leave, recover submit, back to log in | AU01: all four leaves; confirm-leave is the dialog pattern (text noted under Continue) |
| Shared: chip remove, search clear, tabs | `hk-chip` close, `hk-search` clear, chip-tabs (ST01 phone index) |

## Ukrainian strings not in the app's uk.json (invented for the phone boards)

- "Усі" (type chip "All"), "за збігом" (sort hint "by match")
- "Новий хоумбрю" (strap tile), "Ще" (phone "more", from A2)
- "Текст пакета англійською", "пакет перекладу не встановлено" (EN pill hint)
- "Пакет нічого не змінює, доки ви його не встановите, а персонаж не закріпить." (intro, extended from `packs.list.intro`)
- "Цей пристрій" (reused from settings.devices.current for the homebrew pack chip), "Кампанія Емберфол" (from CONTENT.md)
- "Вбудовано в застосунок / його не можна видалити" (split from `packs.detail.core-note`)
- "Це теж файли .hkpack." (translations hint)
- Appearance: "Тема", "Таверна", "Сувій", "Простий", "Щільність", "Компактна", "Простора", "Рядки 28 або 36 пікселів; кнопки не змінюються.", "Анімація", "Струс від шкоди, витрата печаток, спалах при підвищенні рівня.", "Увімк.", "Текст пакетів лишається своєю мовою, доки не встановлено пакет перекладу.", "Високий контраст, без текстур / для слабких пристроїв і читання"
- "увійшли" (signed-in chip), "4 персонажі · 3 пристрої", "Остання активність зараз / 2 год тому" (from `settings.devices.lastSeen`), "Керувати пакетами" (existing), "Вийти" (existing)
- Library sub-lines: "Рівень 3, evocation · 1 дія · 150 футів" use `library.fact.unit.*`; school names stay English (no uk content pack), "Замовляння" for cantrip (from `packs.homebrew.field.spell.level`), "концентрація", "на себе" (`library.fact.rangeKind.self`), "Спорядження", "Магічний предмет · рідкісний / дуже рідкісний" (`packs.homebrew.enum.*`), "налаштування" (attunement)

## Invented content (flagged)

- Extra heroes on H01/PK02/PK04: Brother Aldric (Dwarf Cleric 4, Life Domain, Acolyte), Nim Quickfoot (Halfling Rogue 3, Thief, Criminal), Serra Thornwood (Elf Ranger 5, Hunter, Sage). Species, classes, subclasses and backgrounds are real SRD names; the names, HP and XP are made up for the list.
- Custom packs: "Emberfall Homebrew 1.2.0 / 1.3.0" (campaign pack of The Emberfall Company), "Sample content 1.0.0 → 1.1.0" (the test fixture pack from the audit), "My homebrew 0.1.0" on two devices. Entry counts, image counts and sizes are illustrative.
- Homebrew entries on PK04/PK05: Starlit Lantern (from the audit fixtures), Emberfall Signet, Traveller's Firepot, Candlelight Ward, Shieldwall Veteran, and the Ukrainian item name "Ліхтар зоряного світла" (slug `likhtar-zorianoho-svitla`).
- Devices: "Yura's laptop", "Pixel 8", "Workshop tablet"; account "yura"; recovery codes are random-looking placeholders.
- Everything about Fireball, the Paladin (traits, features by level, slots, Channel Divinity uses, prepared spells, multiclass prerequisites), Oath of Devotion, the "fire" result set (15 entries) and the Paladin spell list (38) is read from `apps/web/public/packs/srd-5e-2024/0.1.0/pack.json`.

## Design calls worth flagging

- Library strap (lists → New · Import): zone 2 is "New homebrew" and "Import pack"; zone 3 is Filter · Search. "Add to hero" takes zone 2 on an entry; without a hero context it is drawn disabled with the reason beside it so the slot stays stable.
- Auth: the four forms are centred parchment leaves with their own leather action strap (the Dialog pattern), because each form's primary action belongs with its fields; the page strap keeps Back (to Settings) and Help, with the primary slot reserved. Flag for review if the owner prefers the primary in the page strap.
- Settings: the demo "Import the Russian sample pack" survives as a quiet link under Content packs (no capability removed) instead of the only filled button on the page; "Keep data on this device" shows its granted state instead of a bare button.
- Pack detail strap: "Update pack" is drawn disabled with the reason (pack is current); Remove stays in-page with text and a confirm dialog.
- The sync state on hero cards is a chip with a word (synced / 2 pending / not syncing / quota full) and a hint, replacing the unlabeled green dot.
- Round-advance, DM tools and the sheet itself are other groups; X01 only borrows the sheet strap to show its offline note.

## Compromises

- Tooltips are static open `hk-tip` slips plus native `title` / SVG `<title>` hints; the 300 ms hover / 400 ms long-press timing is for the build. Open tooltips overlay neighbours as real ones would (LB01's row hint covers part of the Fire Bolt row; ST01's Revoke hint covers part of the Workshop tablet line; the phone padlock hint covers the group label).
- The brief asks to inline `bundle.css`, whose selectors are not all flat (`.hk-leaf > *`, `[data-theme] …`) and which carries one `!important` on `.hk-focus-demo`; the build strips the `!important` and keeps the selectors as the design system defines them.
- Phone chip rows (type filter, settings index) scroll sideways with a fade; the probe reports them as "parent clips" by design — nothing else is clipped.
- The English boards still show the "EN" pack-language pill (the brief asks for it in each row); in an English UI it would only appear when the pack language differs from the UI language.
- Class entry: the pack has no class description, so LB03's summary uses the real first sentences of the three level-1 features instead of invented prose. Subclass-only levels (7, 15, 20) read "Subclass feature".
- Tavern is the only theme drawn; the Appearance cards preview scroll and plain with hand-drawn miniatures, not full renders.
- Board captions ("Initial state…", "Empty state…", "Confirm dialog…") are brass tags on the wood so the insets read as states, not as parts of the page.
- The sticky strap is captured at the page bottom by resizing the viewport to the measured height before the screenshot (Playwright's full-page capture otherwise keeps a 960 px viewport and draws the strap mid-page).
