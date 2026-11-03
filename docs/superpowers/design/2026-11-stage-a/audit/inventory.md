# Herokeep web app — UX audit screenshot inventory (current build, main @ d35dd09)

Captured 207 screen states (111 ids) at 1280x800 and 390x844, full page, in en and uk, against the production build served exactly like the Playwright e2e (static dist + reverse proxy to the Node API adapter, so the account and campaign screens are real). Screenshots: `audit/shots/<id>__<locale>__<width>.png`; pages taller than ~1.2 viewports also have slices `__sN.png`. Driver: `audit/shoot.cjs`; raw per-capture checks: `audit/manifest.json`; automated-check appendix: `audit/inventory-auto.md`; action inventory: `audit/actions.md`. Step failures during the run: 0.

Severity used below: P1 = unusable/blocked, P2 = clearly broken layout, P3 = polish.

## The 10 worst defects (one line each; details and screenshots in the per-screen sections)

1. **Every screen scrolls sideways on a phone.** The 7-link top nav never wraps or scrolls: at 390 px the document is 540 px wide (en) / 572 px (uk) on all 182 non-dialog captures; "Персонажі/Кампанії" and "Бібліотека/Пакети" overprint each other, "Налаштування" and "Про застосунок" sit off-screen, and the header background stops at 390 px. (`home__uk__390.png`, any `*__uk__390.png`)
2. **Play-tab ability cards and skills grid collide at both widths.** Each card holds 284 px of content in a 138–156 px box: the "Значення | Мод" header is cut, the modifier and save values are not visible, and "Кинути перевірку" / "Кинути рятівний кидок" wrap to 3 lines, overlap and lose their first letters; at 1280 the three-column skills grid prints "Кинути" over the next column's names ("КинутиHistory", "ВолодінInvestigation") and cuts "Володіння" chips. (`sheet-play__uk__1280__s1.png`, `sheet-play__uk__390__s2.png`)
3. **A raw i18n key toast, "blob.resend-have", floats bottom-centre on most signed-in screens and hides controls** — the homebrew "Зберегти" button, the lobby "Видалити", the log "Надіслати", the link-character CTA, list rows. Visible on wizard, sheet, packs, campaign and settings captures at both widths. (`homebrew-new-item__uk__1280.png`, `campaign-lobby__uk__390.png`)
4. **Wizard stepper chips overlap on every step at both widths.** At 390 seven chips are squeezed into 372 px ("Ім'я | Ра | ередісто | Кла | Характе | Споряджен | Огляд"); at 1280 "Огляд" is cut at the right edge; resolved steps vanish from the stepper so it changes shape on each step, and every unresolved class choice is labelled "Вибір"/"Choice". Same component in the level-up wizard ("Очки / здоров'я" wrapping inside a 48 px chip). (`wizard-fighter-s01-name__uk__390.png`, `wizard-fighter-s10-weapon-masteries__uk__1280.png`)
5. **Picker steps are fixed-height inner scroll boxes.** At 390 only 3 of 9 species / 12 classes / 37 weapons / 60 items are visible (one card per row, the fourth cut); at 1280 the third row is sliced in half; the equipment and spells steps show two "Далі" buttons at once (the step's ghost one overlapping the clipped grid, the wizard's primary one in the footer); "Показати опис" is a 16 px link that expands nothing. (`wizard-fighter-s11-equipment-filled__uk__1280.png`, `wizard-fighter-s02-species-expanded__uk__390.png`)
6. **The Play tab is a single 6,100–6,500 px page on a phone (3,200–3,500 px on desktop).** Dice roller, six ability cards and 18 skill rows come first; HP, rest and attacks start ~3,500 px down at 390; nothing is tabbed or anchored; the attacks table is cut at 390 ("Майстерність" → "М", "sap" → "sa") and stat tiles truncate ("БОНУС МАЙСТЕРНОС", "ПАСИВНА УВАЖНІСТЬ"). (`sheet-play-l2__uk__390.png` and its 7 slices)
7. **Dialogs are inconsistent and several are broken.** "Додати з бібліотеки" is a full-width band whose third card row is sliced and whose cards are drawn under "Скасувати"; cast / condition / custom item / note are tiny unthemed panels pinned top-left with native white selects and inputs; the note body is a ~110x30 px monospaced textarea; create-campaign and join use native white inputs and a default-blue link; export, long rest, leave, remove-member and pack-trust are proper centred modals. (`dialog-add-item__uk__1280.png`, `dialog-note__uk__1280.png`, `dialog-cast__uk__390.png`)
8. **Ukrainian strings collide and wrap.** The timeline's Revert and the dialog's Cancel are both "Скасувати", so the revert confirmation shows two "Скасувати" buttons and every timeline row says "Скасувати"; long uk labels wrap ghost buttons to 2–3 lines ("Скопіювати посилання-запрошення", "Прив'язати цього персонажа", "Завантажити як .txt", "Додати з бібліотеки", inventory row actions) and crush the list headers ("Новий персонаж" beside "Імпорт" at 390). (`dialog-revert-confirm__uk__1280.png`, `campaign-lobby__uk__390.png`, `characters-list__uk__390.png`)
9. **Library rows overflow and the detail pages are thin.** The per-row "EN"/type pill is clipped at 1280 and entirely outside the viewport at 390; "Fireball" ranks 10th for the query "fire"; the selected type chip stays highlighted while search returns all types; the class detail page is an empty stub; detail pages have no back link. (`library-search__uk__390.png`, `library-detail-class__uk__1280.png`)
10. **Action hierarchy and placement are inconsistent.** The wizard's primary action is a right-aligned footer "Далі" on every step but a full-width "Створити персонажа" / "Завершити підвищення" above a lone "Назад" on the review; the only visible action on a character card is red "Видалити"; "Видалити предмет" is the largest control in every inventory row; the Build tab shows no build (no species/class/level/choices), only name, appearance and packs; the sheet tabs keep "Гра" highlighted during level-up with no cancel. (`wizard-fighter-s12-review__uk__390.png`, `characters-list__uk__1280.png`, `sheet-build__uk__1280.png`)

Close behind: the member sheet's campaign chip ("Shadows over Thornwall" + "Покинути кампанію") is drawn over the character name at 390 (`sheet-play-in-campaign__uk__390__s1.png`); the campaign log composer textarea is wider than the viewport even at 1280 (document 1282 px); the live-announcer text "Перевірка Strength: 13." renders as visible page text at the bottom of the sheet; proficiencies print raw tokens ("heavy (proficient)"); the ability-score step auto-advances the instant the sixth value is chosen, so the six scores are never seen together; the settings page prints the storage-usage line twice and gives the "Імпортувати демо-пакет російською" demo action the only filled-primary button.

## Cross-cutting findings (measured in the DOM on all 207 captures, confirmed on the screenshots)

- **Horizontal overflow:** 182/207 captures at 390 px (all non-dialog screens) have `scrollWidth` 540 (en) or 572 (uk) px; the 25 exceptions are dialog captures whose checks are scoped to the dialog. The overflowing elements are the seven `a.app-shell__link` nav items (348 measurements) and, on the sheet, `.play-tab__ability-stat`/`.play-tab__ability-value` (126) and `button.library-browse__row` (59). At 1280 px, 6 captures still overflow (1282 px): the campaign log composer.
- **Overlapping controls:** 207 `hk-stepper__step` chip pairs across the wizard/level-up captures; 72 `hk-button--ghost` pairs at 1280 (the skills-grid and ability-card roll buttons); 36 `entity-picker__select` vs footer/continue-button pairs (the equipment/spells steps' second "Далі" over the clipped grid).
- **Clipped text (overflow hidden with content wider than the box):** `hk-card.play-tab__ability` on all 108 sheet captures (284 px in 138–156 px), `hk-sheet-section` for skills at 1280 (696 in 616 px) and attacks at 390 (461 in 356 px), the About "Текст SRD" card at 390.
- **Touch targets under 32 px:** 253 "Показати опис" expand links (16 px), 34 `hk-pips__pip` (18 px), the "Доступне підвищення рівня" badge (28 px), the 24 px native selects on the standard-array step, back links ("До хоумбрю", "Назад до кампаній", 20 px), text links on login/register/settings.
- **Buttons taller than 56 px (wrapped labels):** 101 `hk-button--ghost` and 54 `hk-sheet-section__toggle` instances, concentrated at 390 in uk.
- **Tallest pages (uk, 390 / 1280):** sheet-play-l2 6523 / 3493, sheet-levelup-badge 6473 / 3493, sheet-play-l3 6471 / 3441, sheet-play-after 6437 / 3493, sheet-play-in-campaign 6228 / 3284, sheet-play-caster 6109 / 3316, sheet-build 2398 / 2293, campaign-settings 1829 / 1537, homebrew-new-spell 1714 / 1486, settings 1541 (1280).
- **Icon-only controls without an accessible name:** none found on any screen (every button/link has text or an aria-label); the header theme toggle is a bare 14 px purple dot whose only name is its aria-label.
- **Localization:** the uk UI chrome is fully translated (no raw keys except the "blob.resend-have" toast), but rules content has no uk translation pack, so species/class/item/spell/skill/condition names, choice prompts ("Choose 2 skills for Fighter", "Weapon Masteries", "Fighter Subclass"), library entries and the review-step labels stay English inside Ukrainian sentences; uk strings are 20–40% longer than en, which is what pushes the nav to 572 px and wraps the ghost buttons.
- **Theme:** the app starts in the dark theme with no stored preference (Playwright's default colour scheme is light), so every uk capture is dark; the captures named `*-dark` were taken after one toggle and therefore show the **light** theme. In the light theme the library row icons are nearly invisible and cards are beige-on-beige.

## What works well

- One consistent visual language (cards, chips, ghost/primary buttons, section headers) and a readable desktop grid on list, packs, settings and campaign screens.
- Every control has a text label; no icon-only buttons without an accessible name were found.
- The wizard auto-advances the moment a choice is valid, and the review step lists every decision plus HP/AC/proficiency before creating.
- The pack-trust dialog, campaign export, long rest, leave-campaign and remove-member dialogs are well-formed centred modals with consequence text and right-aligned actions.
- HP bar + Current/Max/Temporary tiles, hit dice, death saves and rest actions are grouped together; the short-rest dialog rolls the hit die and shows the healed amount before committing.
- The lobby shows join code, copy-link, QR and the member roster on one screen; the join deep link lands on a one-tap join.
- Timeline rows read as plain-language sentences with per-row revert and grouped sub-events; empty states have proper copy on most screens.
- Skills as a single column at 390 (name, modifier, Кинути) is clean; chips (abilities bump, skills) are large and wrap well on phones.

## Screen table

| # | Screen id | Route | How reached | Locales | Files (per locale: `<id>__<loc>__1280.png`, `<id>__<loc>__390.png`) | Height 1280 / 390 px (uk or en) | Sideways scroll at 390 |
|---|---|---|---|---|---|---|---|
| 1 | about | /about | nav "About" (/about) | en+uk | en: no slices; uk: no slices | 800 / 844 | en 540px, uk 572px |
| 2 | campaign-link-character | /g/01a19db3-78dc-754e-93fb-4edf39c2b63f/link-character | DM account: /g/:id/link-character (no eligible character) | en+uk | en: no slices; uk: no slices | 816 / 872 | en 540px, uk 572px |
| 3 | campaign-link-character-eligible | /g/01a19db3-78dc-754e-93fb-4edf39c2b63f/link-character | member account after Join confirm: /g/:id/link-character with a synced, unlinked character listed | en | en: no slices | 800 / 844 | en 540px |
| 4 | campaign-lobby | /g/01a19db3-78dc-754e-93fb-4edf39c2b63f/lobby | DM account right after "New campaign" confirm (lands on lobby) | en+uk | en: no slices; uk: no slices | 834 / 886 | en 540px, uk 572px |
| 5 | campaign-lobby-dm | /g/01a19db3-78dc-754e-93fb-4edf39c2b63f/lobby | DM account, campaign with one joined member: /g/:id/lobby | en+uk | en: no slices; uk: no slices | 834 / 886 | en 540px, uk 572px |
| 6 | campaign-lobby-member | /g/01a19db3-78dc-754e-93fb-4edf39c2b63f/lobby | member account: /g/:id/lobby | en+uk | en: no slices; uk: no slices | 800 / 844 | en 540px, uk 572px |
| 7 | campaign-log | /g/01a19db3-78dc-754e-93fb-4edf39c2b63f/log | DM account: /g/:id/log (empty) | en+uk | en: no slices; uk: no slices | 800 / 844 | en 540px, uk 572px |
| 8 | campaign-log-member | /g/01a19db3-78dc-754e-93fb-4edf39c2b63f/log | member account: /g/:id/log | en+uk | en: no slices; uk: no slices | 800 / 844 | en 540px, uk 572px |
| 9 | campaign-log-session | /g/01a19db3-78dc-754e-93fb-4edf39c2b63f/log | DM: log tab after starting a session and sending one message | en+uk | en: no slices; uk: no slices | 800 / 844 | en 540px, uk 572px |
| 10 | campaign-party | /g/01a19db3-78dc-754e-93fb-4edf39c2b63f/party | DM account, no members yet: /g/:id/party | en+uk | en: no slices; uk: no slices | 800 / 844 | en 540px, uk 572px |
| 11 | campaign-party-dm | /g/01a19db3-78dc-754e-93fb-4edf39c2b63f/party | DM account, one member linked: /g/:id/party | en+uk | en: no slices; uk: no slices | 800 / 844 | en 540px, uk 572px |
| 12 | campaign-party-member | /g/01a19db3-78dc-754e-93fb-4edf39c2b63f/party | member account: /g/:id/party | en+uk | en: no slices; uk: no slices | 800 / 844 | en 540px, uk 572px |
| 13 | campaign-settings | /g/01a19db3-78dc-754e-93fb-4edf39c2b63f/settings | DM account: /g/:id/settings | en+uk | en: +2 slices at 390, +0 at 1280; uk: +2 slices at 390, +0 at 1280 | 1537 / 1829 | en 540px, uk 572px |
| 14 | campaign-settings-member | /g/01a19db3-78dc-754e-93fb-4edf39c2b63f/settings | member account: /g/:id/settings (read-only) | en+uk | en: +2 slices at 390, +0 at 1280; uk: +2 slices at 390, +0 at 1280 | 1146 / 1262 | en 540px, uk 572px |
| 15 | campaigns-empty | /campaigns | logged in, no campaigns: nav "Campaigns" | en+uk | en: no slices; uk: no slices | 800 / 844 | en 540px, uk 572px |
| 16 | campaigns-list | /campaigns | DM account with one campaign: /campaigns | en+uk | en: no slices; uk: no slices | 800 / 844 | en 540px, uk 572px |
| 17 | campaigns-list-member | /campaigns | member account: /campaigns | en+uk | en: no slices; uk: no slices | 800 / 844 | en 540px, uk 572px |
| 18 | characters-empty | /characters | nav "Characters" with no characters | en+uk | en: no slices; uk: no slices | 800 / 844 | en 540px, uk 572px |
| 19 | characters-list | /characters | /characters with 2-4 characters | en+uk | en: no slices; uk: no slices | 800 / 1018 | en 540px, uk 572px |
| 20 | characters-list-dark | /characters | /characters after toggling the header theme button (shows the LIGHT theme; dark is the default) | en | en: no slices | 800 / 844 | en 540px |
| 21 | dialog-add-item | /c/char:01a19db0-9a73-782f-9884-6b378ddc834c/play | Play tab > inventory "Add from library" | en+uk | en: no slices; uk: no slices | 800 / 844 | en none, uk none |
| 22 | dialog-add-item-search | /c/char:01a19db0-9a73-782f-9884-6b378ddc834c/play | Play tab > "Add from library", "Potion" typed | en+uk | en: no slices; uk: no slices | 800 / 844 | en none, uk none |
| 23 | dialog-campaign-export | /g/01a19db3-78dc-754e-93fb-4edf39c2b63f/settings | campaign settings > Export | en+uk | en: no slices; uk: no slices | 800 / 844 | en none, uk none |
| 24 | dialog-cast | /c/char:01a19db2-bd1b-7f67-a673-70855d7f0b7c/play | caster Play tab > prepare Magic Missile > Cast | en+uk | en: no slices; uk: no slices | 800 / 844 | en none, uk none |
| 25 | dialog-condition | /c/char:01a19db0-9a73-782f-9884-6b378ddc834c/play | Play tab > conditions "Add condition" | en+uk | en: no slices; uk: no slices | 800 / 844 | en none, uk none |
| 26 | dialog-create-campaign | /campaigns | /campaigns > "New campaign" | en+uk | en: no slices; uk: no slices | 800 / 844 | en 540px, uk 572px |
| 27 | dialog-custom-item | /c/char:01a19db0-9a73-782f-9884-6b378ddc834c/play | Play tab > inventory "Add custom item" | en+uk | en: no slices; uk: no slices | 800 / 844 | en none, uk none |
| 28 | dialog-leave-campaign | /c/char:01a19db4-6561-7fd0-98e2-b21ad655b637/play | member sheet header campaign chip > leave | en+uk | en: no slices; uk: no slices | 800 / 844 | en none, uk none |
| 29 | dialog-long-rest | /c/char:01a19db0-9a73-782f-9884-6b378ddc834c/play | Play tab > "Long rest" | en+uk | en: no slices; uk: no slices | 800 / 844 | en none, uk none |
| 30 | dialog-note | /c/char:01a19db0-9a73-782f-9884-6b378ddc834c/play | Play tab > notes "Add note" (title/body typed) | en+uk | en: no slices; uk: no slices | 800 / 844 | en none, uk none |
| 31 | dialog-pack-trust | /packs | /packs > Import > sample-content.hkpack (en: v1 fresh install; uk: v2 update) | en+uk | en: no slices; uk: no slices | 800 / 844 | en 540px, uk 572px |
| 32 | dialog-remove-member | /g/01a19db3-78dc-754e-93fb-4edf39c2b63f/lobby | DM lobby > member row > Remove | en+uk | en: no slices; uk: no slices | 800 / 844 | en 540px, uk none |
| 33 | dialog-revert-confirm | /c/char:01a19db0-9a73-782f-9884-6b378ddc834c/timeline | Timeline tab > row "Revert" | en+uk | en: no slices; uk: no slices | 800 / 844 | en none, uk none |
| 34 | dialog-short-rest | /c/char:01a19db0-9a73-782f-9884-6b378ddc834c/play | Play tab > "Short rest" | en+uk | en: no slices; uk: no slices | 800 / 844 | en none, uk none |
| 35 | dialog-short-rest-rolled | /c/char:01a19db0-9a73-782f-9884-6b378ddc834c/play | short rest dialog after "Roll d10" | en+uk | en: no slices; uk: no slices | 800 / 844 | en none, uk none |
| 36 | home | / | app root / | en+uk | en: no slices; uk: no slices | 800 / 844 | en 540px, uk 572px |
| 37 | homebrew-edit-item | /packs/homebrew/edit/item/starlit-lantern | /packs/homebrew > row Edit | en+uk | en: no slices; uk: no slices | 814 / 844 | en 540px, uk 572px |
| 38 | homebrew-list | /packs/homebrew | /packs/homebrew with one item | en+uk | en: no slices; uk: no slices | 833 / 947 | en 540px, uk 572px |
| 39 | homebrew-list-empty | /packs/homebrew | /packs/homebrew before any homebrew | en | en: no slices | 800 / 852 | en 540px |
| 40 | homebrew-new-feat | /packs/homebrew/new/feat | /packs/homebrew > "New <type>" | en+uk | en: no slices; uk: no slices | 800 / 844 | en 540px, uk 572px |
| 41 | homebrew-new-item | /packs/homebrew/new/item | /packs/homebrew > "New <type>" | en+uk | en: no slices; uk: no slices | 814 / 844 | en 540px, uk 572px |
| 42 | homebrew-new-species | /packs/homebrew/new/species | /packs/homebrew > "New <type>" | en+uk | en: no slices; uk: no slices | 800 / 861 | en 540px, uk 572px |
| 43 | homebrew-new-spell | /packs/homebrew/new/spell | /packs/homebrew > "New <type>" | en+uk | en: +2 slices at 390, +0 at 1280; uk: +2 slices at 390, +0 at 1280 | 1486 / 1714 | en 540px, uk 572px |
| 44 | join | /join | /campaigns > Join (/join) | en+uk | en: no slices; uk: no slices | 800 / 844 | en 540px, uk 572px |
| 45 | join-filled | /join | member: /join with code + display name typed | en | en: no slices | 800 / 844 | en 540px |
| 46 | join-prefilled | /join/91PQ-S10Q | deep link /join/<CODE> (QR target) | en+uk | en: no slices; uk: no slices | 800 / 844 | en 540px, uk 572px |
| 47 | levelup-l3-s01-class-picker | /c/char:01a19db0-9a73-782f-9884-6b378ddc834c/level-up | level-2 fighter, +600 XP > "Level up available" > level 3 (subclass pick) | uk | uk: no slices | 800 / 844 | uk 572px |
| 48 | levelup-l3-s02-hp | /c/char:01a19db0-9a73-782f-9884-6b378ddc834c/level-up | level-2 fighter, +600 XP > "Level up available" > level 3 (subclass pick) | uk | uk: no slices | 800 / 844 | uk 572px |
| 49 | levelup-l3-s02-hp-chosen | /c/char:01a19db0-9a73-782f-9884-6b378ddc834c/level-up | level-2 fighter, +600 XP > "Level up available" > level 3 (subclass pick) | uk | uk: no slices | 800 / 844 | uk 572px |
| 50 | levelup-l3-s03-fighter-subclass | /c/char:01a19db0-9a73-782f-9884-6b378ddc834c/level-up | level-2 fighter, +600 XP > "Level up available" > level 3 (subclass pick) | uk | uk: no slices | 800 / 874 | uk 572px |
| 51 | levelup-l3-s04-review | /c/char:01a19db0-9a73-782f-9884-6b378ddc834c/level-up | level-2 fighter, +600 XP > "Level up available" > level 3 (subclass pick) | uk | uk: no slices | 800 / 844 | uk 572px |
| 52 | levelup-s01-class-picker | /c/char:01a19db0-9a73-782f-9884-6b378ddc834c/level-up | level-1 fighter, 300 XP > "Level up available" badge | en+uk | en: no slices; uk: no slices | 800 / 844 | en 540px, uk 572px |
| 53 | levelup-s02-hp | /c/char:01a19db0-9a73-782f-9884-6b378ddc834c/level-up | level-1 fighter, 300 XP > "Level up available" badge | en+uk | en: no slices; uk: no slices | 800 / 844 | en 540px, uk 572px |
| 54 | levelup-s02-hp-chosen | /c/char:01a19db0-9a73-782f-9884-6b378ddc834c/level-up | level-1 fighter, 300 XP > "Level up available" badge | en+uk | en: no slices; uk: no slices | 800 / 844 | en 540px, uk 572px |
| 55 | levelup-s03-review | /c/char:01a19db0-9a73-782f-9884-6b378ddc834c/level-up | level-1 fighter, 300 XP > "Level up available" badge | en+uk | en: no slices; uk: no slices | 800 / 844 | en 540px, uk 572px |
| 56 | library | /library | nav "Library" | en+uk | en: no slices; uk: no slices | 800 / 950 | en 540px, uk 572px |
| 57 | library-dark | /library | /library after the theme toggle (LIGHT theme; dark is the default) | en | en: no slices | 800 / 950 | en 540px |
| 58 | library-detail | /library/srd-5e-2024:spell%2Fdelayed-blast-fireball | /library search "fire" > Fireball row | en+uk | en: no slices; uk: no slices | 800 / 917 | en 540px, uk 572px |
| 59 | library-detail-class | /library/srd-5e-2024:class%2Ffighter | /library search "Fighter" > row | en+uk | en: no slices; uk: no slices | 800 / 844 | en 540px, uk 572px |
| 60 | library-filter | /library | /library > second filter chip | en+uk | en: no slices; uk: no slices | 800 / 950 | en 540px, uk 572px |
| 61 | library-search | /library | /library with "fire" typed | en+uk | en: no slices; uk: no slices | 800 / 979 | en 540px, uk 572px |
| 62 | login | /login | header "Log in" (/login) | en+uk | en: no slices; uk: no slices | 800 / 844 | en 540px, uk 572px |
| 63 | login-error | /login | /login with wrong credentials submitted | en+uk | en: no slices; uk: no slices | 800 / 844 | en 540px, uk 572px |
| 64 | login-redirected | /login?returnUrl=%2Fcampaigns | anon user opening /campaigns (redirect to /login?returnUrl=) | en+uk | en: no slices; uk: no slices | 800 / 844 | en 540px, uk 572px |
| 65 | pack-detail | /packs/sample-content@1.0.0 | /packs > "Sample content" row | en+uk | en: no slices; uk: no slices | 800 / 844 | en 540px, uk 572px |
| 66 | pack-detail-core | /packs/srd-5e-2024@0.1.0 | /packs > core pack row | en+uk | en: +2 slices at 390, +0 at 1280; uk: +2 slices at 390, +0 at 1280 | 946 / 1154 | en 540px, uk 572px |
| 67 | packs-list | /packs | nav "Packs" after installing Sample content | en+uk | en: no slices; uk: no slices | 800 / 844 | en 540px, uk 572px |
| 68 | packs-list-initial | /packs | nav "Packs" before any import | en | en: no slices | 800 / 844 | en 540px |
| 69 | recover | /recover | /login > "Recover" link | en+uk | en: no slices; uk: no slices | 800 / 844 | en 540px, uk 572px |
| 70 | register-codes | /register | /register submitted: recovery codes step | en+uk | en: no slices; uk: no slices | 800 / 844 | en 540px, uk 572px |
| 71 | register-form | /register | /login > "Register" link | en+uk | en: no slices; uk: no slices | 800 / 844 | en 540px, uk 572px |
| 72 | register-form-errors | /register | /register with invalid username/password typed | en+uk | en: no slices; uk: no slices | 800 / 844 | en 540px, uk 572px |
| 73 | settings | /settings | nav "Settings" logged in with packs installed | en+uk | en: +2 slices at 390, +0 at 1280; uk: +2 slices at 390, +0 at 1280 | 1541 / 1644 | en 540px, uk 572px |
| 74 | settings-anon | /settings | nav "Settings" logged out | en | en: +2 slices at 390, +0 at 1280 | 1149 / 1218 | en 540px |
| 75 | settings-fresh-account | /settings | nav "Settings" right after registering | uk | uk: +2 slices at 390, +0 at 1280 | 1445 / 1568 | uk 572px |
| 76 | sheet-build | /c/char:01a19db0-9a73-782f-9884-6b378ddc834c/build | fighter sheet > Build tab | en+uk | en: +3 slices at 390, +2 at 1280; uk: +3 slices at 390, +2 at 1280 | 2293 / 2398 | en 540px, uk 572px |
| 77 | sheet-build-caster | /c/char:01a19db2-bd1b-7f67-a673-70855d7f0b7c/build | caster sheet > Build tab | en+uk | en: +3 slices at 390, +2 at 1280; uk: +3 slices at 390, +2 at 1280 | 2293 / 2398 | en 540px, uk 572px |
| 78 | sheet-levelup-badge | /c/char:01a19db0-9a73-782f-9884-6b378ddc834c/play | fighter Play tab after awarding 300 XP | en+uk | en: +7 slices at 390, +3 at 1280; uk: +7 slices at 390, +3 at 1280 | 3493 / 6473 | en 540px, uk 572px |
| 79 | sheet-not-found | /c/does-not-exist/play | /c/<unknown id>/play | en+uk | en: no slices; uk: no slices | 800 / 844 | en 540px, uk 572px |
| 80 | sheet-play | /c/char:01a19db0-9a73-782f-9884-6b378ddc834c/play | fighter (Fighter 1) sheet right after creation | en+uk | en: +6 slices at 390, +3 at 1280; uk: +7 slices at 390, +3 at 1280 | 3230 / 6100 | en 540px, uk 572px |
| 81 | sheet-play-after | /c/char:01a19db0-9a73-782f-9884-6b378ddc834c/play | fighter Play tab after damage, condition, rest, item, note | en+uk | en: +7 slices at 390, +3 at 1280; uk: +7 slices at 390, +3 at 1280 | 3493 / 6437 | en 540px, uk 572px |
| 82 | sheet-play-caster | /c/char:01a19db2-bd1b-7f67-a673-70855d7f0b7c/play | caster (Wizard 1) sheet right after creation | en+uk | en: +6 slices at 390, +3 at 1280; uk: +7 slices at 390, +3 at 1280 | 3316 / 6109 | en 540px, uk 572px |
| 83 | sheet-play-caster-cast | /c/char:01a19db2-bd1b-7f67-a673-70855d7f0b7c/play | caster Play tab after casting Magic Missile | en+uk | en: +7 slices at 390, +3 at 1280; uk: +7 slices at 390, +3 at 1280 | 3344 / 6227 | en 540px, uk 572px |
| 84 | sheet-play-dark | /c/char:01a19db0-9a73-782f-9884-6b378ddc834c/play | fighter Play tab after the theme toggle (LIGHT theme; dark is the default) | en | en: +7 slices at 390, +3 at 1280 | 3305 / 6202 | en 540px |
| 85 | sheet-play-in-campaign | /c/char:01a19db4-6561-7fd0-98e2-b21ad655b637/play | member fighter Play tab while linked to a campaign | en+uk | en: +6 slices at 390, +3 at 1280; uk: +7 slices at 390, +3 at 1280 | 3284 / 6228 | en 540px, uk 572px |
| 86 | sheet-play-l2 | /c/char:01a19db0-9a73-782f-9884-6b378ddc834c/play | fighter Play tab after level-up to 2 | en+uk | en: +7 slices at 390, +3 at 1280; uk: +7 slices at 390, +3 at 1280 | 3493 / 6523 | en 540px, uk 572px |
| 87 | sheet-play-l3 | /c/char:01a19db0-9a73-782f-9884-6b378ddc834c/play | fighter Play tab after level-up to 3 | uk | uk: +7 slices at 390, +3 at 1280 | 3441 / 6471 | uk 572px |
| 88 | sheet-play-roll | /c/char:01a19db0-9a73-782f-9884-6b378ddc834c/play | fighter Play tab after clicking the first ability "Roll check" | en+uk | en: +6 slices at 390, +3 at 1280; uk: +7 slices at 390, +3 at 1280 | 3302 / 6172 | en 540px, uk 572px |
| 89 | sheet-timeline | /c/char:01a19db0-9a73-782f-9884-6b378ddc834c/timeline | fighter sheet > Timeline tab | en+uk | en: +2 slices at 390, +0 at 1280; uk: +2 slices at 390, +0 at 1280 | 1076 / 1194 | en 540px, uk 572px |
| 90 | wizard-caster-s09-spells | /characters/new | /characters/new as a Wizard (spells + review steps only) | en+uk | en: +2 slices at 390, +0 at 1280; uk: +2 slices at 390, +0 at 1280 | 1432 / 1493 | en 540px, uk 572px |
| 91 | wizard-caster-s09-spells-filled | /characters/new | /characters/new as a Wizard (spells + review steps only) | en+uk | en: +2 slices at 390, +0 at 1280; uk: +2 slices at 390, +0 at 1280 | 1552 / 1613 | en 540px, uk 572px |
| 92 | wizard-caster-s11-review | /characters/new | /characters/new as a Wizard (spells + review steps only) | en+uk | en: +2 slices at 390, +0 at 1280; uk: +2 slices at 390, +0 at 1280 | 926 / 1246 | en 540px, uk 572px |
| 93 | wizard-fighter-s01-name | /characters/new | /characters/new, fighter path, step by step | en+uk | en: no slices; uk: no slices | 800 / 844 | en 540px, uk 572px |
| 94 | wizard-fighter-s01-name-empty | /characters/new | /characters/new (step 1 before typing) | en+uk | en: no slices; uk: no slices | 800 / 844 | en 540px, uk 572px |
| 95 | wizard-fighter-s02-species | /characters/new | /characters/new, fighter path, step by step | en+uk | en: no slices; uk: no slices | 800 / 844 | en 540px, uk 572px |
| 96 | wizard-fighter-s02-species-expanded | /characters/new | /characters/new, fighter path, step by step | en+uk | en: no slices; uk: no slices | 800 / 844 | en 540px, uk 572px |
| 97 | wizard-fighter-s03-background | /characters/new | /characters/new, fighter path, step by step | en+uk | en: no slices; uk: no slices | 800 / 844 | en 540px, uk 572px |
| 98 | wizard-fighter-s04-improve | /characters/new | /characters/new, fighter path, step by step | en+uk | en: no slices; uk: no slices | 800 / 844 | en 540px, uk 572px |
| 99 | wizard-fighter-s05-class | /characters/new | /characters/new, fighter path, step by step | en+uk | en: no slices; uk: no slices | 800 / 844 | en 540px, uk 572px |
| 100 | wizard-fighter-s06-abilities-filled | /characters/new | /characters/new, fighter path, step by step | en+uk | en: no slices; uk: no slices | 800 / 844 | en 540px, uk 572px |
| 101 | wizard-fighter-s06-abilities-m1 | /characters/new | /characters/new, fighter path, step by step | en+uk | en: no slices; uk: no slices | 800 / 844 | en 540px, uk 572px |
| 102 | wizard-fighter-s06-abilities-m2 | /characters/new | /characters/new, fighter path, step by step | en+uk | en: no slices; uk: no slices | 856 / 856 | en 540px, uk 572px |
| 103 | wizard-fighter-s06-abilities-m3 | /characters/new | /characters/new, fighter path, step by step | en+uk | en: no slices; uk: no slices | 824 / 844 | en 540px, uk 572px |
| 104 | wizard-fighter-s06-abilities-m4 | /characters/new | /characters/new, fighter path, step by step | en+uk | en: no slices; uk: no slices | 800 / 844 | en 540px, uk 572px |
| 105 | wizard-fighter-s07-choose-2-skills-for-fighter | /characters/new | /characters/new, fighter path, step by step | en+uk | en: no slices; uk: no slices | 800 / 844 | en 540px, uk 572px |
| 106 | wizard-fighter-s08-tool-proficiency-choose-one- | /characters/new | /characters/new, fighter path, step by step | en+uk | en: no slices; uk: no slices | 800 / 844 | en 540px, uk 572px |
| 107 | wizard-fighter-s09-fighting-style | /characters/new | /characters/new, fighter path, step by step | en+uk | en: no slices; uk: no slices | 800 / 844 | en 540px, uk 572px |
| 108 | wizard-fighter-s10-weapon-masteries | /characters/new | /characters/new, fighter path, step by step | en+uk | en: no slices; uk: no slices | 800 / 844 | en 540px, uk 572px |
| 109 | wizard-fighter-s11-equipment | /characters/new | /characters/new, fighter path, step by step | en+uk | en: +2 slices at 390, +0 at 1280; uk: +2 slices at 390, +0 at 1280 | 1157 / 1401 | en 540px, uk 572px |
| 110 | wizard-fighter-s11-equipment-filled | /characters/new | /characters/new, fighter path, step by step | en+uk | en: +2 slices at 390, +0 at 1280; uk: +2 slices at 390, +0 at 1280 | 1370 / 1614 | en 540px, uk 572px |
| 111 | wizard-fighter-s12-review | /characters/new | /characters/new, fighter path, step by step | en+uk | en: +2 slices at 390, +0 at 1280; uk: +2 slices at 390, +0 at 1280 | 909 / 1289 | en 540px, uk 572px |

## Shared reviewer notes (chrome described once; defect codes P1-A … P3-Q used by the Play-tab entries)

### Reviewer group 1 shared notes

Global chrome note (applies to every screen below):
- [P1] 390: the top nav row overflows the viewport. Document is 572 px wide (540 in en) in a 390 px viewport, so every screen scrolls sideways. The header band (logo / username / "Вийти" / theme dot) stops at 390 px while the nav links "Головна Персонажі Кампанії Бібліотека Пакети Налаштування Про застосунок" run on to 572 px; "Про застосунок" wraps to two lines outside the band; neighbouring links overlap ("Персонажі"/"Кампанії", "Бібліотека"/"Пакети" unreadable). Same in en ("Characters/Campaigns/Library"). No hamburger / bottom bar / scrollable nav.
- [P1] Toast with raw i18n key "blob.resend-have" bottom-centre on almost every authed capture (en and uk, 1280 and 390); persistent, untranslated, overlaps controls.
- [P2] 390: header stacks "Herokeep auditmvzn1rm6a [Вийти] ●" on one line; raw login shown, no avatar/menu; en "Log out" wraps to two lines inside its button.
- [P3] Dark by default; theme toggle is an unlabeled purple dot (no icon, no text).

### Reviewer group 2 shared notes

Chrome observed on every screen (described once here, referenced below as "chrome"):
- 1280: header (wordmark, username + "Вийти" centred, theme dot at right), nav row of 7 links. Fine.
- 390: the document is 572 px wide (540 in en): the header background stops at 390 while the nav row keeps going to 572. "Персонажі" and "Кампанії" overlap each other ("ПерсонажКампанії"), "Бібліотека" and "Пакети" touch, "Налаштування" and "Про застосунок" sit off-screen to the right of the viewport, "Про застосунок" wraps onto two lines. Every page therefore scrolls sideways on a phone, and the two right-most nav items are unreachable without that sideways scroll. No hamburger/bottom bar. This is the single biggest defect in the group and it is on all 37 screens.
- A toast reading the raw i18n key "blob.resend-have" floats over the lower centre of most authenticated screens (both widths) and covers whatever is under it (form Save buttons, list rows, table rows). Raw key leak + toast placement over content.

### Reviewer group 3 shared notes

Chrome, described once (applies to every screen): at 390 px the document is 572 px wide (horizontal scroll). The nav row "Головна Персонажі Кампанії Бібліотека Пакети Налаштування Про застосунок" neither wraps nor scrolls: "Персонажі" overprints "Кампанії", "Бібліотека" overprints "Пакети", and "Налаштування"/"Про застосунок" sit beyond the viewport (the header background stops at 390 px; "Про застосунок" wraps out there). The header row (logo, username, "Вийти", theme dot) fits; "Log out" wraps to 2 lines in en. The 1280 chrome is fine. "chrome: same nav overflow" below refers to this.

Play-tab defects common to every sheet capture:
- P1-A Ability cards: content ~2x wider than the card (sw=284 vs cw=138 @1280, 156 @390). "Модифікатор" header cut to "Мод"/"Модифі"; the modifier value and save bonus are NOT visible; only "Значення 17" is readable. Buttons "Кинути перевірку"/"Кинути рятівний кидок" wrap 2–3 lines, overlap (16x62 px) and are clipped on the left ("еревірку"). Same in the en light theme ("Score / M", "Roll check/Roll save" wrapped, 16x46 overlap).
- P1-B Skills @1280: 3-column grid cells collide: "Кинути" overprints the next column's names ("Кинутиtion", "КинутиHistory", "Кинутиuasion"); "Володіння" chips cut to "Володі"; 3rd-column "Кинути" clipped to "Кинут"/"Ки" (caster rows Arcana/History/Investigation); "Sleight of Hand" on 3 lines. @390 one column, readable, but the modifier column misaligns when a chip is present.
- P1-C Attacks @390: the table overflows its card; "Майстерність"→"М", "sap"→"sa", "Бонус атаки" wraps; no inner scroll affordance. Fits @1280.
- P2-D Mixed language under uk: all content is English (Strength, Acrobatics, "Fighter 1", Chain Mail, Longsword, Potion of Healing, "Deafened", "Second Wind", "Action Surge", "Common", "walk"); the hit die is localized "к10" but damage reads "1d8"; roll log "Перевірка: Strength 10 +3 = 13".
- P2-E Proficiencies ("Володіння") render raw tokens: "heavy (proficient)", "light (proficient)", "medium (proficient)", "shields (proficient)", "martial (proficient)", "simple (proficient)"; only Інструменти/Чуття/Мови have headings.
- P2-F Length/order: 1280 page 3230–3493 px; 390 page 6100–6523 px. Order: Dice roller (open) + "Не вимикати екран", Ability cards, Skills (18 rows), stat tiles, then HP, Rest, Inspiration, Attacks, Spellcasting, Resources, Actions, Conditions, Proficiencies, Inventory, Notes. HP/attacks start ~1300 px down @1280, ~3500 px @390. Everything is expanded by default. Tab/accordion candidates: Skills, Proficiencies, Inventory+Currency, Notes, Dice roller.
- P2-G The two-column desktop grid leaves holes: "Відпочинок" (2 buttons) beside the 400 px HP card; "Заклинання: Немає заклинань." / "Дії: Немає дій." occupy whole cards; the left column ends ~600 px above the right one.
- P2-H Stat tiles: labels clipped @1280 ("БОНУС МАЙСТЕРНОС", "ПАСИВНА УВАЖНІСТ"), 97x94 px tiles with 3-line labels; @390 they wrap 3+2 with a hole.
- P2-I Header XP row: "Досвід: 300" + field ("Нарахувати досвід") + "Нарахувати" + pill "Доступне підвищення рівня" (a 240x28 px link styled as a chip) or "Скасувати підвищення рівня". @390 this stacks into 4–6 rows (~300–330 px) before the tab bar.
- P2-J Inventory rows: name + weight + "Споряджено" chip, "- 1 +" stepper + "Зняти/Спорядити", then a full-width red "Видалити предмет": the destructive button is the most prominent control per row; the stepper is shown even for armor; ~150 px per item @390.
- P2-K Death saves "Успіхи 0 / 3 Провали 0 / 3" and hit dice "Fighter: к10 × 1 / 1" are plain text with no visible control; resource/slot pips are 18x18 px.
- P2-L Condition chips ("Deafened") show no visible remove affordance and look identical to status chips ("Споряджено", "Володіння").
- P2-M A toast with the raw key "blob.resend-have" appears at the viewport bottom (sheet-not-found, sheet-play, light theme, in-campaign), overlapping content.
- P3-N Dice roller: the disabled "Записати кидок" looks like grey text; "Очистити журнал" appears only after a roll; unlabeled "Перевірка вручну" select; "Не вимикати екран" floats alone.
- P3-O "Натхнення: Немає натхнення" is a toggle that reads as a status, not an action.
- P3-P Currency: 5 inputs + "Застосувати", wraps 3+2 @390.
- P3-Q Only some cards show a collapse chevron (Кидок костей, Дії, Володіння, Інвентар, Нотатки); all start expanded.

### Reviewer group 4 shared notes

Chrome (header + nav), seen on every screen in this group, described once:
- [P1] 390: the top nav row does not wrap or scroll. The document is 572 px wide in a 390 px viewport (horizontal scroll on every page). "Персонажі" and "Кампанії" overlap ("ПерсонажіКампанії"), "Бібліотека" and "Пакети" touch, and "Налаштування" / "Про застосунок" are pushed past the right edge of the 390 px viewport (visible only after a sideways scroll, where "Про застосунок" wraps onto two lines). The header bar background stops at 390 px while the nav continues past it.
- [P2] A toast reading the raw i18n key `blob.resend-have` appears bottom-centre on several wizard screens (s01-name, s01-name-empty, s02-species, and on sheet-play-roll at 1280). Raw key leaking into visible text.
- [P3] Theme is dark by default in the capture; the nav has no current-section indicator beyond a slightly lighter chip ("Персонажі"), low contrast.
- [P3] Account row: "auditmvzn1rm6a" + "Вийти" and a bare purple dot (theme toggle, icon-only, no visible label).
Below, "chrome: same nav overflow" refers to this block.

## Per-screen findings (uk captures reviewed at both widths; en used for comparison)

### about

Route: /about | Reached: nav "Про застосунок" | Locale shown: uk
Shows: title, "Herokeep / Версія 0.1.0", three attribution cards.
Defects:
- [P1] chrome: nav overflow (doc 572) + toast.
- [P2] 390: "Текст SRD" card clips its body on the right — URL ".../licenses/by/4.0/legalc" cut mid-word (overflow hidden, URLs don't wrap).
- [P3] Attribution bodies English in uk UI (titles translated, bodies not).
Works well:
- Clean 1280 layout; version shown.

### campaign-link-character

Route: /g/:id/link-character | Reached: after joining, or Party "Прив'язати персонажа" | Locale shown: uk (DM)
Shows: campaign header + tabs, intro, one row per character with primary "Прив'язати цього персонажа", footer "Створити нового персонажа" / "Пропустити".
Defects:
- [P1] chrome: nav overflow + toast; toast covers "Створити нового пе…" at 1280 and 390.
- [P2] 390: every row's "Прив'язати цього персонажа" wraps to two lines (60+ px buttons); names wrap ("Мирослава / Зоряна").
- [P2] 390: campaign title wraps, "МАЙСТЕР" badge pushed to the edge; tabs "Група Журнал Налаштування Лобі" nearly touch.
- [P3] Four identical primary purple buttons compete; a single-select list with one CTA would scan better.
Works well:
- Intro explains the step; "Пропустити" escape hatch.

### campaign-link-character-eligible

Route: /g/:id/link-character | Reached: member right after /join | Locale shown: en
Shows: same with one eligible character ("Brannock Oakshield", "Link this character").
Defects:
- [P1] chrome: nav overflow (doc 540) + toast.
- [P2] 390: "Link this character" wraps to two lines next to a two-line name.
Works well:
- Primary action obvious at 1280.

### campaign-lobby

Route: /g/:id/lobby | Reached: tabs → "Лобі" | Locale shown: uk (DM)
Shows: join code "91PQ-S10Q", "Скопіювати посилання-запрошення" / "Згенерувати новий код", QR, member list with "Видалити" on the player row.
Defects:
- [P1] 1280 and 390: toast sits over the member row; at 390 it covers "ГРАВЕЦЬ" and half of red "Видалити".
- [P2] 390: ghost buttons wrap badly — "Скопіювати посилання-запрошення" three lines (62 px), "Згенерувати новий код" two.
- [P3] QR small (136 px), no caption; join code in a monospaced font matching nothing else.
- [P3] Red destructive "Видалити" in the member row with no other member actions.
Works well:
- Code, copy link and QR on one screen; roles + online dots.

### campaign-lobby-dm

Route: /g/:id/lobby | Reached: same, DM with joined member | Locale shown: uk
Shows: identical to campaign-lobby.
Defects: same as campaign-lobby.
Works well: same.

### campaign-lobby-member

Route: /g/:id/lobby | Reached: member → Лобі | Locale shown: uk
Shows: "Лобі / Учасники" only.
Defects:
- [P1] chrome: nav overflow + toast.
- [P3] Player lobby almost empty; nothing explains its purpose or how to leave.
Works well:
- Members, roles, online dots.

### campaign-log

Route: /g/:id/log | Reached: tabs → "Журнал" (DM, active session) | Locale shown: uk
Shows: "Журнал", red "Завершити сесію", log card with session divider + one message, composer textarea, "0/2048 байт", "Усі / Лише Майстер / Приватно", "Надіслати".
Defects:
- [P1] 1280: composer textarea wider than the viewport (doc 1282 px → desktop horizontal scrollbar); 390: runs past the content column (right edge ≈392 px while buttons stop at 374).
- [P2] 390: "Надіслати" wraps onto its own left-aligned row under the visibility buttons; looks disabled while empty.
- [P2] Visibility buttons look like three peer actions the same size as Send; nothing marks a segmented single-choice.
- [P3] "0/2048 байт" developer wording; author shown as raw username.
Works well:
- Session divider in the log is clear; "Завершити сесію" distinct.

### campaign-log-member

Route: /g/:id/log | Reached: member → Журнал | Locale shown: uk
Shows: empty log ("Тут поки що порожньо.") + composer.
Defects:
- [P1] same textarea overflow (1280 doc 1282; 390).
- [P2] same detached "Надіслати" / peer visibility buttons at 390.
Works well:
- Empty state has a sentence.

### campaign-log-session

Route: /g/:id/log | Reached: DM after posting | Locale shown: uk
Shows: log with two messages.
Defects:
- [P1] same composer overflow; [P1] 390: toast overlaps "Надіслати".
Works well:
- Messages readable, author bold.

### campaign-party

Route: /g/:id/party | Reached: tabs → "Група" (DM) | Locale shown: uk
Shows: "Група" + "Додати заготовку персонажа", banner "У вас ще немає персонажа в цій кампанії" + "Прив'язати персонажа", card "Brannock Oakshield — Огляд ще не надіслано." + "Інструменти майстра", "Без персонажа: auditmvzn1rm6a".
Defects:
- [P1] chrome: nav overflow + toast.
- [P2] Member card shows no stats ("Огляд ще не надіслано.") although member is linked and online.
- [P2] 390: title and "Додати заготовку персонажа" share one row, button squeezed.
- [P3] "Без персонажа" is a bare heading + raw username, no action.
Works well:
- Banner with clear CTA for a DM without a character.

### campaign-party-dm

Route: /g/:id/party | Reached: DM with joined member | Locale shown: uk
Shows: identical to campaign-party (member-sheet/handover/unlink sit behind "Інструменти майстра", not captured).
Defects: same as campaign-party.
Works well: same.

### campaign-party-member

Route: /g/:id/party | Reached: member → Група | Locale shown: uk
Shows: own card "Brannock Oakshield — Огляд ще не надіслано." and "Без персонажа auditmvzn1rm6a".
Defects:
- [P1] chrome: nav overflow + toast.
- [P2] Player's own card has no HP/AC/conditions and no "open my sheet" action.
Works well: nothing notable.

### campaign-settings

Route: /g/:id/settings | Reached: tabs → "Налаштування" (DM) | Locale shown: uk
Shows: long single column: Домашні правила (checkboxes + chip groups), Ліміт налаштування, Початковий рівень, Пакети вмісту (0/6, "Увімкнути"), Видимість chips, Приєднання checkboxes, "Зберегти", full-width "Експортувати кампанію".
Defects:
- [P2] 1280: 1537 px tall; "Зберегти" is a small left-aligned primary at the very bottom with a full-width ghost "Експортувати кампанію" under it — easy to miss, inconsistent with right-aligned "Увімкнути".
- [P2] 390: chip groups wrap into two rows ("Потребує схвалення майстра", "Варіативне (за рівнями)" alone), 1829 px tall; toast overlaps "На вибір гравця".
- [P3] Native unstyled checkboxes next to themed chips; chips not obviously single-select.
- [P3] "Увімкнено пакетів: 0 / 6" with one pack row listed is confusing.
Works well:
- Groups labelled; selected chip state visible.

### campaign-settings-member

Route: /g/:id/settings | Reached: member → Налаштування | Locale shown: uk
Shows: read-only values with "Змінювати налаштування кампанії може тільки майстер."
Defects:
- [P1] chrome: nav overflow + toast (over "Початковий рівень" at 390).
- [P3] Disabled checkboxes still look interactive; plain bold values without grouping; 1262 px tall at 390 for what could be one summary card.
Works well:
- Clear read-only notice.

### campaigns-empty

Route: /campaigns | Reached: nav "Кампанії" (fresh account) | Locale shown: uk
Shows: title, "Приєднатися до кампанії", "Нова кампанія", "Ви ще не створили жодної кампанії і не приєдналися до жодної."
Defects:
- [P1] chrome: nav overflow.
- [P2] 390: title + both header buttons on one row; both wrap to two lines, title crushed.
- [P3] Empty state has no CTA inside it.
Works well:
- Both entry points visible at 1280.

### campaigns-list

Route: /campaigns | Reached: nav (DM) | Locale shown: uk
Shows: one card "Shadows over Thornwall / МАЙСТЕР ●".
Defects:
- [P1] chrome: nav overflow + toast. [P2] 390: same crushed header row. [P3] Card lacks member count / session state / last activity.
Works well:
- Role badge and sync dot.

### campaigns-list-member

Route: /campaigns | Reached: nav (player) | Locale shown: uk
Shows: same card with "ГРАВЕЦЬ".
Defects: same as campaigns-list.
Works well: same.

### characters-empty

Route: /characters | Reached: nav "Персонажі" (anon, none) | Locale shown: uk
Shows: title, "Імпорт", "Новий персонаж", "У вас ще немає жодного персонажа."
Defects:
- [P1] chrome: nav overflow (doc 572).
- [P2] 390: header crushed — "Новий персонаж" wraps to two lines beside "Імпорт" and the title.
- [P3] Empty state has no CTA; header login is plain text "Увійти".
Works well:
- Primary action visible.

### characters-list

Route: /characters | Reached: nav "Персонажі" | Locale shown: uk
Shows: four cards: initials avatar, name, "srd-5e-2024", green dot, red "Видалити".
Defects:
- [P2] Only visible card action is red destructive "Видалити"; opening is the whole card with no affordance; subtitle is raw pack id "srd-5e-2024" instead of class/level/campaign; sync state is an unlabeled green dot.
- [P2] 390: header crushed, "Новий персонаж" on two lines; 109 px card buttons; toast over the third card's "Видалити".
- [P1] chrome: nav overflow + toast.
Works well:
- Responsive grid (4 → 1 column); coloured initial avatars.

### characters-list-dark

Route: /characters | Reached: theme toggle (light theme, en) | Locale shown: en
Shows: light-theme variant.
Defects:
- [P1] chrome: nav overflow (doc 540); "Log out" wraps to two lines at 390.
- [P2] same destructive-only action, raw pack id, unlabeled dot.
- [P3] Light theme: beige-on-beige cards low contrast; red "Delete" dominates.
Works well:
- Structurally consistent with dark.

### dialog-add-item

Route: /c/:id/play (dialog) | Reached: Play → Інвентар → "Додати з бібліотеки" | Locale shown: uk
Shows: sheet-style panel with "Кількість", search, 6-column item cards ("Показати опис" links), "Ще 900 варіантів — уточніть пошук", "Скасувати".
Defects:
- [P1] 1280: card grid cut off by the panel footer — third row sliced in half ("Ammunition of …"), grid overlaps "Скасувати"; panel is a fixed-height band pinned near the top, not a scrollable centred modal. 390: only three cards visible, the next drawn under "Скасувати" (overlap 102×44 px).
- [P2] "Показати опис" links 16 px tall on every card.
- [P2] Panel spans full width at 1280 with page visible above/below; quantity is a native number input with spinner.
- [P3] 900 unfiltered items before searching; names English only.
Works well:
- Hint "Ще 900 варіантів — уточніть пошук".

### dialog-add-item-search

Route: /c/:id/play (dialog) | Reached: same, after typing "Potion" | Locale shown: uk
Shows: filtered potions grid.
Defects:
- [P1] same clipped third row ("Potion of Poison", "Potion of Resist…" cut) and card-under-footer overlap at 390.
- [P2] Two clear controls on the search: native "×" inside the input plus a custom "X" button.
- [P2] 16 px "Показати опис" targets.
Works well:
- Search narrows instantly; names wrap, not truncate.

### dialog-campaign-export

Route: /g/:id/settings (dialog) | Reached: "Експортувати кампанію" | Locale shown: uk
Shows: centred modal "Експорт даних кампанії", explanatory paragraph, "Закрити" / "Експортувати".
Defects:
- [P3] none; fits 390.
Works well:
- Best-formed dialog in the app: title, copy on what is/isn't included, right-aligned actions.

### dialog-cast

Route: /c/:id/play (dialog) | Reached: Заклинання → prepared spell "Накласти" | Locale shown: uk
Shows: tiny panel "Накласти: Magic Missile", "Комірка заклинання" + native select "1 рівень (залишилось 2)", "Скасувати" / "Накласти".
Defects:
- [P2] ~215×80 px dialog pinned top-left (not centred); unstyled 19 px native select glued to its label; 390 same, in the corner over the skills list.
- [P3] No spell summary (level/range/upcast effect).
Works well:
- Remaining-slot count in the option text.

### dialog-condition

Route: /c/:id/play (dialog) | Reached: Стани → "Додати стан" | Locale shown: uk
Shows: tiny panel "Додати стан", "Стан" + native select "Blinded", "Скасувати" / "Додати".
Defects:
- [P2] Same unstyled 102×19 px native select glued to label; ~150×80 px dialog near top-left; 390 identical.
- [P2] Condition names English ("Blinded, Charmed, Deafened…") in uk.
- [P3] No description of the condition's effect.
Works well: nothing notable.

### dialog-create-campaign

Route: /campaigns (dialog) | Reached: "Нова кампанія" | Locale shown: uk
Shows: centred modal "Нова кампанія", "Назва" + native white input, "Скасувати" / "Створити" (disabled until named).
Defects:
- [P2] Unstyled native input (white, blue focus ring, 177×21 px) glued to its label, foreign next to themed buttons, 1280 and 390.
- [P3] No helper text.
Works well:
- Centred; primary disabled until valid.

### dialog-custom-item

Route: /c/:id/play (dialog) | Reached: Інвентар → "Додати свій предмет" | Locale shown: uk
Shows: tiny panel: "Назва" white native input, "Кількість" themed number field, "Нотатки" white native textarea, "Скасувати" / "Додати".
Defects:
- [P2] ~165 px-wide panel pinned top-left with mixed control styling (two white native fields, one themed); notes textarea ~90×25 px; 390 same in the corner.
- [P3] No weight/category; disabled "Додати" barely distinguishable.
Works well: nothing notable.

### dialog-leave-campaign

Route: /c/:id/play (dialog) | Reached: sheet header campaign chip → "Покинути кампанію" | Locale shown: uk
Shows: centred modal "Покинути цю кампанію?" with explanation, "Скасувати" / red "Покинути".
Defects:
- [P3] none in the dialog. (Behind it at 1280 the Play tab shows ability-card buttons "Кинути перевірку"/"Кинути рятівний кидок" clipped by their cards and skill rows whose "Кинути" buttons overlap skill names — see the Play-tab group.)
Works well:
- Clear consequence text, destructive in red, fits 390.

### dialog-long-rest

Route: /c/:id/play (dialog) | Reached: Відпочинок → "Тривалий відпочинок" | Locale shown: uk
Shows: centred modal with rest explanation, "Скасувати" / "Взяти тривалий відпочинок".
Defects: [P3] none; fits 390.
Works well:
- One-paragraph explanation before confirming.

### dialog-note

Route: /c/:id/play (dialog) | Reached: Нотатки → "Додати нотатку" | Locale shown: uk
Shows: panel "Додати нотатку": "Заголовок" white native input and "Текст" label on one line, ~110×30 px monospaced white textarea, "Скасувати" / "Зберегти".
Defects:
- [P1] Note body is a three-line ~110 px-wide monospaced native textarea — unusable for session notes; "Текст" label sits beside the title input instead of above the textarea.
- [P2] ~280×100 px dialog, unthemed fields; 390 pinned top-left.
Works well: nothing notable.

### dialog-pack-trust

Route: /packs (dialog) | Reached: "Імпортувати пакет" → choose .hkpack | Locale shown: uk
Shows: centred modal "Встановити «Sample content»?" with version, authors, licence, images, dependency, attribution, content counts, "Зміни наявного вмісту", "Скасувати" / "Встановити".
Defects:
- [P3] "Потребує srd-5e-2024 ^0.1.0" exposes a semver range; otherwise none; 390 fits, title wraps cleanly.
Works well:
- Thorough, well-structured trust screen; model for other dialogs.

### dialog-remove-member

Route: /g/:id/lobby (dialog) | Reached: member row "Видалити" | Locale shown: uk
Shows: "Видалити Bran?" with consequence, "Скасувати" / red "Видалити".
Defects: [P3] none in the dialog; toast still visible underneath at 390.
Works well:
- Names the member, warns it cannot be undone.

### dialog-revert-confirm

Route: /c/:id/timeline (dialog) | Reached: Хроніка → row "Скасувати" | Locale shown: uk
Shows: "Скасувати це?" with warning, two buttons both labelled "Скасувати".
Defects:
- [P1] Both buttons read "Скасувати" (cancel and revert share the uk string); only colour differs. Timeline rows also use "Скасувати" for revert, so the word means two things on one screen (en: "Cancel"/"Revert").
- [P2] 390: filter chips "Особистість / Рішення / Рівні / Бій / Предмети / Інше" wrap into two rows and all look selected; rows become 3-line text beside a wide button.
- [P3] "+" expand button for grouped events is a bare square with no label.
Works well:
- Rows read as sentences ("Отримано -5 шкоди.", "Обрано: Human. (+15 подій)").

### dialog-short-rest

Route: /c/:id/play (dialog) | Reached: Відпочинок → "Короткий відпочинок" | Locale shown: uk
Shows: panel with a bullet row "Fighter Залишилось 1 кістку хітів [Кинути к10]", "Скасувати" / "Взяти короткий відпочинок".
Defects:
- [P2] Panel pinned near top-left (1280 ≈ x250,y190) rather than centred; the single hit-die row is a bulleted list item with class, count and roll button jammed on one line.
- [P3] 390: fits (≈370 px) but sits in the corner over the skills list.
Works well:
- Roll inside the dialog with explicit confirm.

### dialog-short-rest-rolled

Route: /c/:id/play (dialog) | Reached: after "Кинути к10" | Locale shown: uk
Shows: "Залишилось 0 кісток хітів", disabled roll, result "[3] Fighter: відновлено 5 ОЗ."
Defects:
- [P2] Rolled value is a 12 px badge "3" before the sentence; easy to miss.
- [P3] Same positioning as dialog-short-rest.
Works well:
- Shows healed amount and spent die before committing.

### home

Route: / | Reached: logo / nav "Головна" | Locale shown: uk
Shows: "Herokeep" title and tagline "Ваш супутник по D&D — Бібліотека готова; конструктор персонажів попереду."
Defects:
- [P1] chrome: nav overflow + toast.
- [P2] No content or actions at all; tagline is stale placeholder copy ("character builder ahead").
Works well: nothing notable.

### homebrew-edit-item

Route: /packs/homebrew/edit/item/:slug | Reached: Хоумбрю → "Змінити" | Locale shown: uk
Shows: "До хоумбрю" link, "Змінити предмет" form (Назва, Категорія, Рідкісність + "Вага (фнт.)", "Потребує налаштування", "Опис (Markdown)"), "Скасувати" / "Зберегти".
Defects:
- [P1] 1280: toast covers the "Зберегти" button entirely; 390: covers "Скасувати".
- [P3] "Вага (фнт.)" label differs in style/size/offset from "Рідкісність" beside it; back link 20 px tall; form fixed ~660 px with empty right half.
Works well:
- Themed selects/textarea; Markdown with hint.

### homebrew-list

Route: /packs/homebrew | Reached: /packs → "Хоумбрю" | Locale shown: uk
Shows: intro, "Версія пакета 0.1.0", four "Новий …" link-buttons, cards per type ("Starlit Lantern — Змінити / Видалити").
Defects:
- [P1] chrome: nav overflow + toast (over "Риси" card at 390).
- [P2] Row actions mix underlined link "Змінити" with boxed button "Видалити"; "Новий предмет/заклинання/риса/вид" are underlined links inside button borders.
- [P3] 390: new-links wrap into two rows; "До пакетів" back link 84×20 px.
Works well:
- Intro explains where homebrew shows up ("вкладка «Білд» → «Пакети вмісту»").

### homebrew-list-empty

Route: /packs/homebrew | Reached: first visit | Locale shown: en
Shows: same with "Nothing here yet." in all four cards.
Defects:
- [P1] chrome: nav overflow (doc 540).
- [P3] Four empty cards fill the screen; link-in-a-box "New …" controls.
Works well:
- Clear intro copy.

### homebrew-new-feat

Route: /packs/homebrew/new/feat | Reached: Хоумбрю → "Нова риса" | Locale shown: uk
Shows: form: Назва, Категорія, "Можна взяти кілька разів", "Перевага (Markdown)" + hint, "Скасувати" / "Зберегти".
Defects:
- [P1] 1280: toast covers "Зберегти"; 390: covers "Скасувати".
- [P3] Half-width form; unstyled checkbox.
Works well:
- Helper text under the textarea ("Аркуш персонажа показує цей текст як перевагу риси.").

# Review group 2 (37 screens: homebrew-new-item .. sheet-build-caster)

Chrome observed on every screen (described once here, referenced below as "chrome"):
- 1280: header (wordmark, username + "Вийти" centred, theme dot at right), nav row of 7 links. Fine.
- 390: the document is 572 px wide (540 in en): the header background stops at 390 while the nav row keeps going to 572. "Персонажі" and "Кампанії" overlap each other ("ПерсонажКампанії"), "Бібліотека" and "Пакети" touch, "Налаштування" and "Про застосунок" sit off-screen to the right of the viewport, "Про застосунок" wraps onto two lines. Every page therefore scrolls sideways on a phone, and the two right-most nav items are unreachable without that sideways scroll. No hamburger/bottom bar. This is the single biggest defect in the group and it is on all 37 screens.
- A toast reading the raw i18n key "blob.resend-have" floats over the lower centre of most authenticated screens (both widths) and covers whatever is under it (form Save buttons, list rows, table rows). Raw key leak + toast placement over content.

### homebrew-new-item

Route: /packs/homebrew/new/item | Reached: Packs -> Хоумбрю -> new item | Locale shown: uk
Shows: Form: Назва, Категорія (select), Рідкість (select) + Вага (фнт.) side by side, "Потребує налаштування" checkbox, Опис (Markdown) textarea, Скасувати / Зберегти.
Defects:
- [P1] 1280 and 390: the "blob.resend-have" toast (raw i18n key) sits exactly over the primary "Зберегти" button at 1280 (button is hidden behind it) and over "Скасувати" at 390.
- [P1] 390: chrome nav overflow (doc 572 px, sideways scroll, "Налаштування"/"Про застосунок" off-screen).
- [P2] "Рідкість"/"Вага (фнт.)" pair: labels sit at different heights (Вага label is smaller and raised) and the two fields have different heights (56 vs 46 px), so the row looks broken.
- [P2] Form occupies only the left 660 px at 1280; the right half of the page is empty.
- [P3] Back link "До хоумбрю" is a 20 px-tall text link above the title, not a proper back control; "хоумбрю" transliteration reads oddly in uk (vs "Домашні правила").
- [P3] No helper text on what a "category" or "rarity" affects; no required-field marker on Назва.
Works well:
- Fields are labelled, the Markdown hint on Опис is clear, Cancel/Save pair is where you expect it.

### homebrew-new-species

Route: /packs/homebrew/new/species | Reached: Packs -> Хоумбрю -> new species | Locale shown: uk
Shows: Назва; Розмір / Швидкість ходьби (фт.) / Тип істоти in one row; "Особливості" fieldset with "Додати особливість"; Опис; Скасувати / Зберегти.
Defects:
- [P1] 390: the toast "blob.resend-have" covers the "Скасувати" button; at 1280 it sits just under Save (partially covering the row).
- [P1] 390: chrome nav overflow.
- [P2] Select option values are untranslated lowercase English ("medium", "humanoid") inside a uk form.
- [P2] 1280: the three-up row has mismatched control heights and label baselines (Швидкість input is shorter and its label smaller than the two selects).
- [P3] "Особливості" fieldset is an empty box with a single button; no explanation of what a trait is or an example.
Works well:
- The three short numeric/enumeration fields in one row is a sensible grouping at 1280.

### homebrew-new-spell

Route: /packs/homebrew/new/spell | Reached: Packs -> Хоумбрю -> new spell | Locale shown: uk
Shows: Long single-column form (1486 px at 1280, 1714 at 390): Назва, Рівень + Школа, Час накладання + Одиниця, Дальність, Компоненти checkboxes, Тривалість, Концентрація, Ритуал, class list checkboxes (12), Опис, На вищому рівні комірки, Скасувати/Зберегти.
Defects:
- [P1] 390: chrome nav overflow; the first 390 slice shows the right edge of "Школа"/"Одиниця часу накладання" selects and the Дальність select running past the viewport edge.
- [P2] 1280 and 390: the "blob.resend-have" toast overlaps the Тривалість field (1280) / Тривалість label (390).
- [P2] "Школа" select options are untranslated English ("abjuration"); the class checkbox list is English ("Barbarian", ...), inconsistent with the uk labels around them.
- [P2] Paired fields (Рівень/Школа, Час накладання/Одиниця) again have mismatched heights and label sizes; at 390 "Одиниця часу накладання" wraps to two lines and pushes its select down so the pair is no longer aligned.
- [P3] 14 fields with no grouping/sections or a sticky save; the Save button is only reachable after scrolling the whole form (1.7 k px on phone).
Works well:
- Component and class checkbox groups are legible and have enough spacing; the "Рівень (0 — замовляння)" hint is helpful.

### join

Route: /join | Reached: Campaigns -> join, or deep link | Locale shown: uk
Shows: Centered narrow form "Приєднатися до кампанії": Код запрошення (hint "Запитайте у майстра 8-символьний код"), Відображуване ім'я (необов'язково), link "Назад до кампаній", disabled "Приєднатися".
Defects:
- [P1] 390: chrome nav overflow.
- [P2] Both inputs are unstyled native controls: white boxes 21 px tall with black text on the dark theme, no border radius, visibly different from every other input in the app.
- [P2] "Назад до кампаній" is a default blue underlined browser link (#0000EE) on a dark background: off-palette, low contrast, 20 px tall.
- [P2] 390: the title wraps to two lines and the whole form hugs the left edge while the desktop version is centred; the primary button sits far right of a left-aligned link, leaving an awkward gap.
- [P3] The toast "blob.resend-have" at the bottom again (both widths).
- [P3] No explanation of what joining does (link a character, roles) before pressing the button.
Works well:
- The hint under the code field tells the player where the code comes from; the button stays disabled until a code is entered.

### join-filled

Route: /join | Reached: /join with code and display name typed (member account) | Locale shown: en
Shows: Same form filled: "91PQ-S10Q", "Bran", enabled "Join".
Defects:
- [P1] 390: chrome nav overflow (doc 540 px).
- [P2] Same native unstyled inputs (white, 21 px) and default-blue "Back to campaigns" link.
- [P2] 390: the "Log out" header button wraps to two lines ("Log / out") because the username crowds it.
- [P3] The focused display-name field shows a purple outline on a white native input: two visual systems on one control.
Works well:
- Code is accepted in the grouped XXXX-XXXX form as displayed in the lobby; the Join button enables correctly.

### join-prefilled

Route: /join/91PQ-S10Q | Reached: QR / deep link with code | Locale shown: uk
Shows: Same form with the code pre-filled and the display-name field empty; "Приєднатися" enabled.
Defects:
- [P1] 390: chrome nav overflow.
- [P2] Same unstyled inputs and default-blue link as `join`.
- [P3] Nothing tells the user the code came from the link and is valid/invalid (no campaign name preview before joining).
Works well:
- Deep link lands on a one-tap join; the primary action is enabled immediately.

### levelup-l3-s01-class-picker

Route: /c/:id/level-up | Reached: sheet -> "Доступне підвищення рівня" badge (level 2 -> 3) | Locale shown: uk
Shows: Sheet header (portrait, name, "Fighter 2", Експорт, XP row, Гра/Білд/Хроніка tabs) then "Який клас?" with three full-width purple buttons: "Підвищити Fighter до 3 рівня", "Мультиклас: Barbarian", "Мультиклас: Rogue".
Defects:
- [P1] 390: chrome nav overflow.
- [P2] The sheet tab bar stays visible with "Гра" highlighted while the level-up wizard is open, so the user appears to be on the Play tab; no title/breadcrumb says "level up" and there is no Cancel/close.
- [P2] All three options are identical primary (filled purple) buttons; the recommended "continue my class" choice is not visually distinguished from the two multiclass options.
- [P2] Class names stay English ("Fighter", "Barbarian") inside uk sentences, giving mixed-language labels "Підвищити Fighter до 3 рівня".
- [P3] 390: the XP block wraps into three rows (Досвід: 900 / input, Нарахувати on its own line, badge on its own line) and the "Нарахувати досвід" label floats above the input at a different size from "Досвід: 900".
- [P3] "Доступне підвищення рівня" badge is a 28 px-tall pill used as a link (small target) and remains visible while already inside the level-up flow.
Works well:
- The question is short and the three options are large, easy targets at both widths.

### levelup-l3-s02-hp

Route: /c/:id/level-up | Reached: class picker -> own class | Locale shown: uk
Shows: "Підвищення до 3 рівня", stepper "Очки здоров'я | Вибір | Огляд", heading "Очки здоров'я", hint "Киньте 1d10 або візьміть середнє значення.", buttons "Кинути" (primary) / "Взяти середнє", footer Назад / Далі (disabled).
Defects:
- [P1] 390: chrome nav overflow.
- [P2] Stepper chips overlap each other by 6 px (auto-check confirms: "Очки здоров'я" <> "Вибір" 6x48, "Вибір" <> "Огляд"), and at 390 the current chip's label wraps to two lines ("Очки / здоров'я") inside a 48 px chip.
- [P2] The middle step is labelled just "Вибір" (generic "Choice") although it is the subclass pick; the user cannot tell what is coming.
- [P2] "Кинути" is styled as the primary action and "Взяти середнє" as secondary, yet "Далі" is disabled until one is pressed and nothing says a choice is required.
- [P3] Page is otherwise mostly empty at 1280; the whole sheet header + tabs (~210 px) is repeated above the wizard and competes with it.
Works well:
- Hint sentence explains the two options in one line; the chosen result is echoed ("Взято середнє значення.") on the next state.

### levelup-l3-s02-hp-chosen

Route: /c/:id/level-up | Reached: HP step after "Взяти середнє" | Locale shown: uk
Shows: Same step with the result line "Взято середнє значення." and "Далі" now enabled.
Defects:
- [P1] 390: chrome nav overflow.
- [P2] Same stepper overlap/wrapping as the previous step.
- [P3] After choosing average, "Кинути" stays rendered as the primary (filled) button and "Взяти середнє" still looks unselected; there is no selected state on the option that was taken, only the text line below.
- [P3] The result shows no number ("Взято середнє значення." but not "+6 HP"), so the user has to wait for the review to see the effect.
Works well:
- "Далі" becomes enabled exactly when the step is complete.

### levelup-l3-s03-fighter-subclass

Route: /c/:id/level-up | Reached: HP step -> Далі | Locale shown: uk
Shows: Stepper with "Вибір" current, heading "Fighter Subclass", search box, one picker card "Champion" with "Показати опис".
Defects:
- [P1] 390: chrome nav overflow.
- [P2] Stepper chips overlap (6 px) and the done chip wraps "Очки / здоров'я" at 390.
- [P2] Heading "Fighter Subclass" and the only option "Champion" are English on a uk screen (content not localised), and the stepper calls the step "Вибір".
- [P2] A search field is rendered for a list of exactly one card; the card grid (one 200 px card) leaves the rest of the row empty.
- [P3] "Показати опис" is a 16 px-tall underlined text button inside the card (small target); the card has no description visible by default, so the only subclass is offered with no information.
Works well:
- Selecting the card auto-advances, so there is no double "pick then Next".

### levelup-l3-s04-review

Route: /c/:id/level-up | Reached: subclass pick | Locale shown: uk
Shows: Stepper "Очки здоров'я | Огляд" (the Вибір chip has disappeared), heading "Огляд", two rows "Новий рівень 3" / "Очки здоров'я 28", full-width primary "Завершити підвищення", then a lone "Назад" button right-aligned below it.
Defects:
- [P1] 390: chrome nav overflow.
- [P2] The review omits the subclass just chosen (Champion) and the HP method; a 2-row summary for a level with a subclass pick is incomplete.
- [P2] Action placement differs from the previous steps: the primary action is a full-width button in the content area while "Назад" is alone in the footer where "Далі" used to be, so the primary button moves between steps.
- [P2] The completed "Вибір" step vanishes from the stepper once resolved, so the stepper shrinks from 3 to 2 chips mid-flow (same behaviour as the creation wizard).
- [P3] Stepper chips still overlap by 6 px.
Works well:
- The final action label is explicit ("Завершити підвищення") and large.

### levelup-s01-class-picker

Route: /c/:id/level-up | Reached: new uk fighter at 300 XP -> badge | Locale shown: uk
Shows: "Який клас?" with "Підвищити Fighter до 2 рівня", "Мультиклас: Barbarian", "Мультиклас: Rogue".
Defects:
- [P1] 390: chrome nav overflow.
- [P2] Same as levelup-l3-s01: three identical primary buttons, mixed-language labels, sheet tab bar still highlighting "Гра", no cancel.
- [P3] Auto-check reports a hidden element "Перевірка Strength: 13." (the roll-log/live region clipped to 1 px) - invisible here but indicates the roll announcer markup is on the page.
Works well:
- Same as above; the badge-to-wizard path is one click.

### levelup-s02-hp

Route: /c/:id/level-up | Reached: class picker | Locale shown: uk
Shows: "Підвищення до 2 рівня", stepper "Очки здоров'я | Огляд" (two chips), HP step.
Defects:
- [P1] 390: chrome nav overflow.
- [P2] Stepper chips overlap by 6 px; at 390 "Очки здоров'я" chip is 185 px wide next to a 185 px "Огляд" chip, both only half used.
- [P2] "Кинути"/"Взяти середнє" primary/secondary styling with "Далі" disabled and no required-choice hint (same as l3).
Works well:
- Fits in one phone screen without scrolling (footer visible at 390).

### levelup-s02-hp-chosen

Route: /c/:id/level-up | Reached: HP step after "Взяти середнє" | Locale shown: uk
Shows: Result line "Взято середнє значення.", Далі enabled.
Defects:
- [P1] 390: chrome nav overflow.
- [P3] No selected state on the pressed option; no HP number shown.
Works well:
- Nothing new beyond the previous step.

### levelup-s03-review

Route: /c/:id/level-up | Reached: HP -> Далі | Locale shown: uk
Shows: "Огляд": Новий рівень 2, Очки здоров'я 20, "Завершити підвищення" full width, "Назад" below.
Defects:
- [P1] 390: chrome nav overflow.
- [P2] Primary action jumps from the footer (Далі) to a full-width content button; Назад remains in the footer alone.
- [P3] Summary does not say what else the level grants (e.g. the fighter's level-2 feature), only level and HP.
Works well:
- Clear, single confirm button.

### library

Route: /library | Reached: nav "Бібліотека" | Locale shown: uk
Shows: 12 type chips (Класи ... Правила, "Заклинання" selected), search box "Пошук у бібліотеці", list of spells with icon, name and an "EN" tag at the right.
Defects:
- [P1] 390: chrome nav overflow (doc 572 px); the list rows end at 374 px but the type chips wrap into 4 rows, pushing the first result below the fold.
- [P2] 1280: the "EN" language tag on every row is cut off at the right edge of the viewport (only "EN" visible with the pill's right side clipped); the row is wider than its container.
- [P2] 390: the same "EN" pill is clipped to "EN|" at x=374 on every row.
- [P2] All entity names and the content are English under the uk UI with an "EN" badge on each row; there is no uk content translation, so the library reads as English with uk chrome.
- [P3] Rows show only an icon and a name: no level/school/type hint, no chevron, no result count until a search is typed; 11 rows fill 800 px so browsing 339 spells is a long scroll with no letter index.
- [P3] Toast "blob.resend-have" overlaps the list at the bottom (1280) and the "Animate Dead" row at 390.
Works well:
- Chip filter + search is an obvious model; row height (45 px) is a good touch target; icons per spell school are a nice touch.

### library-dark

Route: /library | Reached: theme toggle (this capture is the LIGHT theme, the default is dark) | Locale shown: en
Shows: Same library in the light theme (cream background).
Defects:
- [P1] 390: chrome nav overflow (doc 540 px), "Characters/Campaigns/Library" overlap, "Log out" wraps to two lines.
- [P2] 1280 and 390: in the light theme the row icons are almost invisible (very light grey on cream, roughly 1.2:1 contrast).
- [P3] The theme toggle is an unlabeled 14 px purple dot at the far right of the header (no icon, no text); it is the only control that reveals the two themes.
Works well:
- Light theme keeps the same layout and the selected chip is clearly distinguishable.

### library-detail

Route: /library/srd-5e-2024:spell%2Fdelayed-blast-fireball | Reached: library search "fire" -> first "Fireball" row | Locale shown: uk
Shows: Spell header (icon, name, "EN" badge, "Заклинання"), key/value stats (Рівень, Школа, Час накладання, Дистанція, Тривалість, Компоненти), a second "EN" badge, then the English description paragraph.
Defects:
- [P1] 390: chrome nav overflow.
- [P2] No back link / breadcrumb to the library; the browser back button is the only way out.
- [P2] Searching "Fireball" opened "Delayed Blast Fireball" because the list is alphabetical and the exact match "Fireball" is ranked 10th; the search has no ranking of exact/prefix matches.
- [P2] Mixed languages: labels uk, values half uk ("1 дія", "150 футів"), half English ("Evocation", "V, S, M (a ball of bat guano and sulfur)"), description English with an "EN" badge.
- [P3] Description is one unbroken 7-line paragraph at full 1280 width (~190 characters per line), hard to read; the lower half of the page is empty.
- [P3] Toast "blob.resend-have" at the bottom.
Works well:
- The stat table at the top is compact and scannable; wraps correctly to a two-column list at 390.

### library-detail-class

Route: /library/srd-5e-2024:class%2Ffighter | Reached: library search "Fighter" -> row | Locale shown: uk
Shows: "Fighter" header with "EN" badge and "Класи", three stats (Кістка Хітів d10, Рятівні кидки STR, CON, Основна характеристика STR, DEX), an orphan "EN" badge, nothing else.
Defects:
- [P1] 390: chrome nav overflow.
- [P2] The class page is effectively empty: no description, no features by level, no subclasses, no proficiencies; the "EN" badge under the stats precedes nothing (the description block rendered empty).
- [P2] No back navigation.
- [P3] Stat labels use inconsistent casing ("Кістка Хітів" title case vs "Рятівні кидки" sentence case); values are untranslated ability abbreviations.
Works well:
- Nothing notable (the page is a stub).

### library-filter

Route: /library | Reached: click the "Підкласи" chip | Locale shown: uk
Shows: Subclass list (Champion, Circle of the Land, ...), chips with "Підкласи" selected.
Defects:
- [P1] 390: chrome nav overflow; 4 rows of chips before any content.
- [P2] "EN" tags clipped at the right edge of each row at both widths (as in `library`).
- [P3] Subclass rows give no parent class (e.g. "Champion" without "Fighter"), which is the one piece of information a subclass list needs.
- [P3] Toast over the list.
Works well:
- Switching the chip is instant and the selected chip is clear.

### library-search

Route: /library | Reached: type "fire" in the search box | Locale shown: uk
Shows: "15 результатів" and a mixed-type result list (Alchemist's Fire, Brazier..., Bullets, Firearm (10), Damage type: Fire, Delayed Blast Fireball, Faerie Fire, Fire Bolt, ..., Fireball, Necklace of Fireballs) with a type pill per row (Предмети, Правила, Заклинання).
Defects:
- [P1] 390: the per-row type pills ("Заклинання", "Предмети") are entirely outside the 390 px viewport (they sit at x>374 in the 572 px document), so the user cannot see what type a result is.
- [P2] 1280: the type pills are clipped at the right edge (only "Предмети"/"Заклиннн"/"Правила" partially visible, right half cut).
- [P2] The "Заклинання" chip stays highlighted while the results include items and rules; the filter chip and the search act independently and the UI does not say so.
- [P2] Ranking: "Fireball" is 10th for the query "fire"; exact/prefix matches are not promoted.
- [P2] Two clear controls: the native browser "×" inside the input plus the custom X button to its right.
- [P3] The search box stretches to 1150 px at 1280, far wider than needed.
Works well:
- Result count line "15 результатів" is useful; results appear immediately while typing.

### login

Route: /login | Reached: header "Увійти" / nav | Locale shown: uk
Shows: "Вхід" form: Ім'я користувача, Пароль, Назва пристрою (prefilled "HeadlessChrome on Windows"), "Увійти" button, links "Створити акаунт" / "Забули пароль?".
Defects:
- [P1] 390: chrome nav overflow.
- [P2] The header's "Увійти" is plain small grey text centred in the header with no button/link affordance (it is the login link).
- [P3] 1280: the form is a 384 px-wide block pinned to the top-left; the remaining 900 px are empty (the join screen centres its form, this one does not: inconsistent).
- [P3] "Назва пристрою" is prefilled with a browser user-agent string the user will not recognise; no explanation of why a device name is needed.
- [P3] Links are 20 px-tall text (small targets, auto-check).
Works well:
- Only three fields; the primary button and the two secondary links are in the expected order.

### login-error

Route: /login | Reached: submit wrong credentials | Locale shown: uk
Shows: Same form with red "Неправильне ім'я користувача або пароль." between the device field and the button.
Defects:
- [P1] 390: chrome nav overflow.
- [P3] The error appears under the third (device) field rather than near the fields it concerns; no field is highlighted.
Works well:
- Error message is specific and keeps the typed username.

### login-redirected

Route: /login?returnUrl=%2Fcampaigns | Reached: open /campaigns while signed out | Locale shown: uk
Shows: Identical to `login`.
Defects:
- [P1] 390: chrome nav overflow.
- [P2] No notice that the user was redirected or where they will return to ("sign in to open Campaigns"); the screen is indistinguishable from a plain login.
Works well:
- The return URL is preserved in the address.

### pack-detail

Route: /packs/sample-content@1.0.0 | Reached: Packs list -> "Sample content" row | Locale shown: uk
Shows: "До пакетів" link, title, "Не використовується жодним персонажем", Версія, Автори/Ліцензія/Зображення/Потребує table, Атрибуція, Вміст counts (Види 1, Риси 1, Заклинання 1, Предмети 1), "Зміни наявного вмісту", red "Видалити пакет".
Defects:
- [P1] 390: chrome nav overflow.
- [P2] 1280: the content counts are right-aligned at the far edge of a 1250 px row ("Види ............ 1"), so label and number are 1200 px apart.
- [P2] "Видалити пакет" is a full-strength red button with no confirmation hint, placed directly in the flow with no separation from the info above.
- [P3] "Потребує srd-5e-2024 ^0.1.0" shows a raw semver range in monospace; "34 Б" for the image size.
- [P3] Toast "Пакет встановлено" (ok) at the bottom, but it overlays content at 390.
Works well:
- All trust information (authors, licence, dependency, counts, "does not modify existing content") is on one screen and translated.

### pack-detail-core

Route: /packs/srd-5e-2024@0.1.0 | Reached: Packs -> core rules row | Locale shown: uk
Shows: "SRD 5.2.1 (2024 rules)", "Використовується 4 персонажами", meta, attribution with two links, 14 content counts, note "Базовий пакет правил вбудовано в застосунок, його не можна видалити."
Defects:
- [P1] 390: chrome nav overflow; the long licence URL "https://creativecommons.org/licenses/by/4.0/legalcode" breaks mid-word ("l / egalcode").
- [P2] 1280: counts right-aligned 1200 px away from their labels (same as pack-detail); the "blob.resend-have" toast sits over the "Навички 18" row.
- [P3] Attribution paragraph is English (legal text) inside the uk page without a language badge; the "Автори" row wraps the two-author string onto two lines at 390 while the other rows stay two-column.
Works well:
- The "cannot be removed" note replaces the remove button instead of showing a disabled one.

### packs-list

Route: /packs | Reached: nav "Пакети" (after installing sample v1.0.0, v1.1.0 and a homebrew pack) | Locale shown: uk
Shows: Title, "Хоумбрю" (ghost, underlined) + "Імпортувати пакет" (primary), intro sentence, three cards: Базові правила (SRD row), Пакети вмісту (My homebrew 0.1.0, Sample content 1.0.0, Sample content 1.1.0), Переклади (empty text).
Defects:
- [P1] 390: chrome nav overflow.
- [P2] Two toasts stacked at the bottom ("blob.resend-have" raw key above "Пакет встановлено"); at 390 they cover the Переклади card.
- [P2] The two "Sample content" versions are two indistinguishable rows (no "update available"/"newer version" badge visible, no "installed/active" state), so the user cannot tell which one characters use.
- [P2] Rows are links but have no affordance (no chevron, no hover state visible, plain bold text).
- [P3] "Хоумбрю" is an underlined link styled as an outlined button (two idioms in one control); "Переклади: Пакети перекладів не встановлено." gives no way to add one (the import button is for content).
Works well:
- Grouping into core / content / translations is clear; the intro sentence explains the install model.

### packs-list-initial

Route: /packs | Reached: nav "Packs" on a fresh profile | Locale shown: en
Shows: Same screen with "No content packs installed yet." / "No translation packs installed."
Defects:
- [P1] 390: chrome nav overflow (540 px), "Log out" wraps to two lines in the header.
- [P3] Empty states are one sentence with no call to action inside the card (the Import button is in the page header only).
Works well:
- The core rules row shows name + version + role compactly; the page is short and fits one phone screen.

### recover

Route: /recover | Reached: login -> "Забули пароль?" | Locale shown: uk
Shows: "Відновлення акаунта", warning line "Скидання пароля виконає вихід з усіх інших пристроїв.", fields Ім'я користувача, Код відновлення (hint), Новий пароль, disabled "Скинути пароль", link "Повернутися до входу".
Defects:
- [P1] 390: chrome nav overflow.
- [P3] Form pinned top-left in a 384 px column at 1280 (as login), inconsistent with the centred join form.
- [P3] The hint "Введіть один із шести кодів відновлення..." is small grey text; the new-password field has no rule hint (10+ chars) until submit.
Works well:
- The consequence of resetting (logs out other devices) is stated up front; button disabled until valid.

### register-codes

Route: /register | Reached: register form -> submit | Locale shown: uk
Shows: "Збережіть коди відновлення", explanatory paragraph, 6 codes in a two-column monospace box, "Скопіювати коди" / "Завантажити як .txt", checkbox "Я зберіг(ла) коди відновлення", disabled "Продовжити".
Defects:
- [P1] 390: chrome nav overflow.
- [P2] 390: both secondary buttons wrap to two lines ("Скопіювати / коди", "Завантажити як / .txt") inside 180 px buttons.
- [P3] The confirmation checkbox is a 13 px native control (small target) with the label not visibly clickable.
- [P3] The code box is 470 px wide at 1280 while the paragraph above is 500 px: misaligned column widths; the page is otherwise empty.
Works well:
- The one-time nature of the codes is explained clearly; copy and download are offered; "Продовжити" is gated on the checkbox.

### register-form

Route: /register | Reached: login -> "Створити акаунт" | Locale shown: uk
Shows: "Створити акаунт", Ім'я користувача, Пароль, Назва пристрою (prefilled UA string), disabled "Створити акаунт", link "Вже є акаунт? Увійти".
Defects:
- [P1] 390: chrome nav overflow.
- [P2] No password/username rules shown before the user types (the rules only appear as errors afterwards, see register-form-errors).
- [P3] Same top-left narrow layout as login; device name prefilled with "HeadlessChrome on Windows".
Works well:
- Minimal form; the link to login is right under the button.

### register-form-errors

Route: /register | Reached: type "a" / "short" / "x" | Locale shown: uk
Shows: Inline red errors: "Ім'я користувача — від 3 до 32 літер, цифр, символів підкреслення або дефісів." and "Пароль має містити щонайменше 10 символів."; the username field has a purple focus ring.
Defects:
- [P1] 390: chrome nav overflow.
- [P3] Error text is small (13 px) and red-on-near-black; fields themselves are not outlined in red, only the focused one shows a purple ring.
- [P3] The device-name field accepts "x" with no validation feedback.
Works well:
- Validation is live (shown before submit) and the messages state the exact rule.

### settings

Route: /settings | Reached: nav "Налаштування" (signed-in account with 4 characters) | Locale shown: uk
Shows: Cards: Мова (English/Русский/Українська chips), Оформлення (Темна/Світла), Сховище (usage line, "Зберігати дані на цьому пристрої", campaign image cache slider "Ліміт кешу: 500 МБ", usage line again), Пакети контенту (Базовий пакет правил srd-5e-2024@0.1.0, "Імпортувати демо-пакет російською", "Керувати пакетами"), Обліковий запис (username, Вийти, red "Вийти всюди"), Пристрої (Audit laptop, "Цей пристрій", last activity), Квота сховища (4 characters, "7,2 КБ з 2 МБ").
Defects:
- [P1] 390: chrome nav overflow; the toast "blob.resend-have" covers the storage usage line under the slider.
- [P2] The storage usage sentence "Використано 7,8 МБ з 4 103,8 МБ" is printed twice in the same card (above the persist button and under the slider).
- [P2] The cache slider is a native blue browser range control (16 px tall, off-palette) on the dark theme.
- [P2] 390: "Базовий пакет правил | srd-5e-2024@0.1.0" splits into two wrapped columns ("Базовий пакет / правил" next to "srd-5e- / 2024@0.1.0").
- [P2] "Імпортувати демо-пакет російською" is a filled primary button in the uk UI: a demo action gets the strongest emphasis on the page, next to a text-link "Керувати пакетами" which is the real action.
- [P3] "Зберігати дані на цьому пристрої" (persist storage) is a primary button with no explanation of what it does or whether it is already granted.
- [P3] "Квота сховища" lists characters with "7,2 КБ з 2 МБ" but no bar; the "Пристрої" card has no "other devices" explanation.
- [P3] Page is 1541 px tall with 7 cards and no section navigation.
Works well:
- Language and theme chips are large, instantly applied, and show the selected state clearly; cards have consistent headers.

### settings-anon

Route: /settings | Reached: nav "Settings" while signed out | Locale shown: en
Shows: Same cards minus devices/quota; Account card says "Sign in to sync your characters across devices." with "Log in" / "Create an account" links.
Defects:
- [P1] 390: chrome nav overflow (540 px).
- [P2] Duplicate "6.8 MB used of 3,078.8 MB" line; native blue slider.
- [P2] "Import the Russian sample pack" is the only filled primary button in the content-packs card.
- [P3] "Log in" / "Create an account" are 20 px text links while every other action on the page is a button.
Works well:
- The signed-out Account card explains the benefit of signing in in one sentence.

### settings-fresh-account

Route: /settings | Reached: new account "Телефон" device, no characters | Locale shown: uk
Shows: Same as `settings` with Пристрої = "Телефон / Цей пристрій / Остання активність зараз" and Квота сховища = "Синхронізованих персонажів поки немає."
Defects:
- [P1] 390: chrome nav overflow.
- [P2] Same duplicate storage line, native slider, wrapped pack row at 390, primary demo-pack button.
Works well:
- Empty quota state has a proper sentence; the current-device tag is clear.

### sheet-build

Route: /c/:id/build | Reached: sheet tab "Білд" (uk fighter, level 1) | Locale shown: uk
Shows: Sheet header + XP row + tabs, then cards: "Незавершені вибори" (Усе готово...), "Ім'я" (input + Зберегти), "Зовнішність" (portrait + "Завантажити портрет", Вік, Зріст, Вага, Очі, Волосся, Шкіра, Опис textarea, Зберегти), "Граматичний рід" (3 native radios), "Опції правил" (Перевантаження select), "Пакети вмісту" (SRD checked+disabled, My homebrew, Sample content checkboxes). 2293 px tall at 1280, 2398 at 390.
Defects:
- [P1] 390: chrome nav overflow; the XP row wraps to three rows (label, input, "Нарахувати" alone) above the tabs.
- [P2] The Build tab never shows the build: species, background, class, subclass, level, chosen skills/feats/fighting style are absent; the tab is only name/appearance/gender/options/packs. "Усе готово — вирішувати більше нічого." is the only reference to decisions.
- [P2] Appearance fields (Вік, Зріст, Вага, Очі, Волосся, Шкіра) are six full-width 56 px inputs stacked (1280 px wide each for a value like "25"), making a 2.3 k px page of empty boxes; these belong in a 2-3 column grid.
- [P2] Two separate "Зберегти" buttons (name card and appearance card) with no indication of unsaved state; the gender radios and the rule-option select apply with no save at all: three different save models on one tab.
- [P2] Gender radios and pack checkboxes are native browser controls (blue radio, grey checkbox), unlike the chips/buttons elsewhere.
- [P3] "Нарахувати досвід" label is a small bold caption above the input while "Досвід: 0" is body text to its left: mismatched hierarchy; "Білд" is a transliteration, the en counterpart is "Build".
- [P3] "Пакети вмісту" explanation sentence is helpful but the "Sample content v1.0.0" row does not mention that v1.1.0 is installed.
Works well:
- Card headers give the page structure; the "Основні правила завжди увімкнені" disabled checkbox is honest; the portrait upload is next to the current avatar.

### sheet-build-caster

Route: /c/:id/build | Reached: "Білд" tab on the uk wizard character | Locale shown: uk
Shows: Identical structure to `sheet-build` for "Мирослава Зоряна / Wizard 1".
Defects:
- [P1] 390: chrome nav overflow; XP row wraps to three rows.
- [P2] Same as sheet-build: no build summary (no species/class/spellbook info for a wizard), oversized stacked appearance inputs, three save models, native radios/checkboxes.
- [P3] Class line "Wizard 1" is English in the uk header.
Works well:
- Same as sheet-build; nothing caster-specific is shown on this tab (which is itself a gap).

# Review group 3 (character sheet, Play tab: 9 screens, 82 images)

Chrome, described once (applies to every screen): at 390 px the document is 572 px wide (horizontal scroll). The nav row "Головна Персонажі Кампанії Бібліотека Пакети Налаштування Про застосунок" neither wraps nor scrolls: "Персонажі" overprints "Кампанії", "Бібліотека" overprints "Пакети", and "Налаштування"/"Про застосунок" sit beyond the viewport (the header background stops at 390 px; "Про застосунок" wraps out there). The header row (logo, username, "Вийти", theme dot) fits; "Log out" wraps to 2 lines in en. The 1280 chrome is fine. "chrome: same nav overflow" below refers to this.

Play-tab defects common to every sheet capture:
- P1-A Ability cards: content ~2x wider than the card (sw=284 vs cw=138 @1280, 156 @390). "Модифікатор" header cut to "Мод"/"Модифі"; the modifier value and save bonus are NOT visible; only "Значення 17" is readable. Buttons "Кинути перевірку"/"Кинути рятівний кидок" wrap 2–3 lines, overlap (16x62 px) and are clipped on the left ("еревірку"). Same in the en light theme ("Score / M", "Roll check/Roll save" wrapped, 16x46 overlap).
- P1-B Skills @1280: 3-column grid cells collide: "Кинути" overprints the next column's names ("Кинутиtion", "КинутиHistory", "Кинутиuasion"); "Володіння" chips cut to "Володі"; 3rd-column "Кинути" clipped to "Кинут"/"Ки" (caster rows Arcana/History/Investigation); "Sleight of Hand" on 3 lines. @390 one column, readable, but the modifier column misaligns when a chip is present.
- P1-C Attacks @390: the table overflows its card; "Майстерність"→"М", "sap"→"sa", "Бонус атаки" wraps; no inner scroll affordance. Fits @1280.
- P2-D Mixed language under uk: all content is English (Strength, Acrobatics, "Fighter 1", Chain Mail, Longsword, Potion of Healing, "Deafened", "Second Wind", "Action Surge", "Common", "walk"); the hit die is localized "к10" but damage reads "1d8"; roll log "Перевірка: Strength 10 +3 = 13".
- P2-E Proficiencies ("Володіння") render raw tokens: "heavy (proficient)", "light (proficient)", "medium (proficient)", "shields (proficient)", "martial (proficient)", "simple (proficient)"; only Інструменти/Чуття/Мови have headings.
- P2-F Length/order: 1280 page 3230–3493 px; 390 page 6100–6523 px. Order: Dice roller (open) + "Не вимикати екран", Ability cards, Skills (18 rows), stat tiles, then HP, Rest, Inspiration, Attacks, Spellcasting, Resources, Actions, Conditions, Proficiencies, Inventory, Notes. HP/attacks start ~1300 px down @1280, ~3500 px @390. Everything is expanded by default. Tab/accordion candidates: Skills, Proficiencies, Inventory+Currency, Notes, Dice roller.
- P2-G The two-column desktop grid leaves holes: "Відпочинок" (2 buttons) beside the 400 px HP card; "Заклинання: Немає заклинань." / "Дії: Немає дій." occupy whole cards; the left column ends ~600 px above the right one.
- P2-H Stat tiles: labels clipped @1280 ("БОНУС МАЙСТЕРНОС", "ПАСИВНА УВАЖНІСТ"), 97x94 px tiles with 3-line labels; @390 they wrap 3+2 with a hole.
- P2-I Header XP row: "Досвід: 300" + field ("Нарахувати досвід") + "Нарахувати" + pill "Доступне підвищення рівня" (a 240x28 px link styled as a chip) or "Скасувати підвищення рівня". @390 this stacks into 4–6 rows (~300–330 px) before the tab bar.
- P2-J Inventory rows: name + weight + "Споряджено" chip, "- 1 +" stepper + "Зняти/Спорядити", then a full-width red "Видалити предмет": the destructive button is the most prominent control per row; the stepper is shown even for armor; ~150 px per item @390.
- P2-K Death saves "Успіхи 0 / 3 Провали 0 / 3" and hit dice "Fighter: к10 × 1 / 1" are plain text with no visible control; resource/slot pips are 18x18 px.
- P2-L Condition chips ("Deafened") show no visible remove affordance and look identical to status chips ("Споряджено", "Володіння").
- P2-M A toast with the raw key "blob.resend-have" appears at the viewport bottom (sheet-not-found, sheet-play, light theme, in-campaign), overlapping content.
- P3-N Dice roller: the disabled "Записати кидок" looks like grey text; "Очистити журнал" appears only after a roll; unlabeled "Перевірка вручну" select; "Не вимикати екран" floats alone.
- P3-O "Натхнення: Немає натхнення" is a toggle that reads as a status, not an action.
- P3-P Currency: 5 inputs + "Застосувати", wraps 3+2 @390.
- P3-Q Only some cards show a collapse chevron (Кидок костей, Дії, Володіння, Інвентар, Нотатки); all start expanded.

### sheet-levelup-badge

Route: /c/:id/play | Reached: Play tab after awarding 300 XP ("Нарахувати") | Locale shown: uk
Shows: Level-1 fighter Play tab with the "Доступне підвищення рівня" pill, a logged roll, HP 12/12, "Deafened", 4 items, 1 note.
Defects:
- [P1] 390: chrome: same nav overflow; P1-A, P1-B, P1-C.
- [P2] The level-up CTA is a 28 px lilac pill at the end of the XP row; @390 it is the 5th header row and reads as a status chip; nothing else on the page changes.
- [P2] P2-D..P2-L; length 1280: 3493 px, 390: 6473 px.
- [P3] Roll feedback "Перевірка: Strength 10 +3 = 13" lives inside the dice roller at the top, far from the Skills button that was pressed.
Works well:
- The roll-log line (die, bonus, total) is compact; the HP bar and three HP tiles read at a glance; the "Споряджено" state is clear.

### sheet-not-found

Route: /c/does-not-exist/play | Reached: deep link to a missing character | Locale shown: uk
Shows: "Персонажа не знайдено" + "Цей персонаж не існує або не вдалося завантажити його на цьому пристрої."
Defects:
- [P1] 390: chrome: same nav overflow.
- [P2] Raw-key toast "blob.resend-have" at both widths.
- [P3] No link back to the list or home.
Works well:
- Clear, fully translated message.

### sheet-play

Route: /c/:id/play | Reached: Characters list -> character | Locale shown: uk
Shows: Fresh level-1 fighter (XP 0): dice roller, ability cards, skills, stat tiles, HP, rest, inspiration, attacks (Longsword), spellcasting (none), resources (Second Wind), actions (none), conditions (none), proficiencies, inventory (3 items), notes (none).
Defects:
- [P1] 390: chrome: same nav overflow; P1-A, P1-B, P1-C.
- [P2] P2-D..P2-M; length 1280: 3230 px, 390: 6100 px.
- [P2] "Додати з бібліотеки" (primary) and "Додати свій предмет" sit above the list while every row's red "Видалити предмет" is equally large: inverted action hierarchy.
- [P3] P3-N..P3-Q.
Works well:
- Empty states are worded ("Ще немає кидків.", "Немає заклинань.", "Немає станів.", "Поки що немає нотаток."); the phone layout keeps every control reachable except the attacks table and the nav.

### sheet-play-after

Route: /c/:id/play | Reached: same sheet after a check roll, 5 damage, a short rest (die rolled), adding a condition, an item and a note | Locale shown: uk
Shows: As sheet-play plus a roll-log entry, hit dice "к10 × 0 / 1", "Очистити журнал", the "Deafened" chip, a Potion of Healing row, note "Session 1".
Defects:
- [P1] 390: chrome: same nav overflow; P1-A, P1-B, P1-C.
- [P2] The short rest healed to 12/12 but only the hit-dice count records it; the roll log omits the hit-die roll.
- [P2] Note card: serif title, sans body, "Редагувати"/"Видалити" of equal weight; "Додати нотатку" primary above the list (same pattern as inventory).
- [P2] P2-D..P2-M; length 1280: 3493 px, 390: 6437 px.
- [P3] P3-N..P3-Q.
Works well:
- State changes are reflected consistently (hit-die count, condition chip, new item, note).

### sheet-play-caster

Route: /c/:id/play | Reached: freshly created level-1 wizard, 2 known spells, none prepared | Locale shown: uk
Shows: Wizard Play tab with the Spellcasting card: save-DC tile, attack-bonus tile, "Кинути атаку заклинанням", cantrips tile, level-1 slot pips, "0 / 4 підготовлено", known spells Magic Missile/Sleep with "Підготувати".
Defects:
- [P1] 390: chrome: same nav overflow; P1-A; P1-B (worst case @1280: Arcana/History proficient rows, 3rd-column "Кинути" clipped to "Ки"); P1-C ("Бонус атаки" wraps, "М" cut).
- [P1] Spellcasting tiles: "БОНУС АТАКИ ЗАКЛИНАННЯМ" overflows its tile border at both widths; "СКЛАДНІСТЬ РЯТІВНОГО КИДКА" is 3 lines; the button "Кинути атаку заклинанням" is rendered as a 4th stat tile; @390 "ВІДОМО ЗАГОВОРІВ 3" wraps alone to a 2nd row.
- [P2] "ВІДОМО ЗАГОВОРІВ 3" although no cantrips were chosen (cap vs known) — misleading.
- [P2] Slot pips (18 px) beside "Комірки 1 рівня" are the only slot control; "0 / 4 підготовлено" is plain text.
- [P2] P2-D..P2-M; attacks "Quarterstaff +1 / 1d6 -1" with an empty "Майстерність" cell; length 1280: 3316 px, 390: 6109 px.
- [P3] Resources says "Немає ресурсів." while the slot pips live in Spellcasting; P3-N..P3-Q.
Works well:
- Spell rows are simple (name + one button); slot pips clearly show the spent state after a cast.

### sheet-play-caster-cast

Route: /c/:id/play | Reached: after "Підготувати" Magic Missile and casting it via the cast dialog | Locale shown: uk
Shows: As the caster sheet with one pip filled, "1 / 4 підготовлено", the known list (Magic Missile + "Скасувати підготовку", Sleep + "Підготувати") and a second list "Підготовлені заклинання" (Magic Missile + "Накласти").
Defects:
- [P1] 390: chrome: same nav overflow; P1-A, P1-B, P1-C; spellcasting tile overflow.
- [P2] "Скасувати підготовку" no longer fits beside the name and drops under "Magic Missile" (1280 and 390) while "Sleep / Підготувати" stays on one line: rows in one list have different shapes.
- [P2] The same spell is listed twice with different actions; @1280 the two lists are side-by-side columns, @390 stacked so "Накласти" is ~200 px below "Скасувати підготовку".
- [P2] P2-D..P2-M; length 1280: 3344 px, 390: 6227 px.
- [P3] After casting, no feedback apart from the pip; no entry in the dice log.
Works well:
- The filled pip is clearly visible; the prepared count updates; "Накласти" is one obvious action.

### sheet-play-dark

Route: /c/:id/play | Reached: header theme toggle on the level-2 en fighter. NOTE: the default theme is dark, so this capture is actually the LIGHT theme | Locale shown: en
Shows: Light-theme Play tab of "Aldric Stormborn, Fighter 2": "Undo level up", HP 12/20, hit dice "d10 × 1 / 2", Actions "Action Surge", "Deafened", 4 items, a note.
Defects:
- [P1] 390: chrome: same nav overflow (doc 540 px: "Characters" overprints "Campaigns", "Library" overprints "Packs"); "Log out" wraps.
- [P1] P1-A in en: header "Score / M", modifier/save invisible, "Roll check"/"Roll save" wrap and overlap.
- [P1] P1-B @1280: "Roll" overprints "Deception" ("Deltion"), "Persuasion" ("RolPersuasion"), "Investigation"; "Proficient" chips cut to "Proficie".
- [P1] P1-C @390: "Mastery"→"Ma", "sap"→"sa".
- [P2] Toast "blob.resend-have" over the Intelligence card @1280 and over the dice roller @390.
- [P2] Light theme: tiles, section headers and cards are near-identical beige surfaces with faint borders; "Keep screen awake" does not read as interactive.
- [P2] "Action Surge" is plain text with no use/description control; P2-F..P2-M (length 1280: 3305 px, 390: 6202 px).
- [P3] "Undo level up" is a ghost button beside "Award", easy to hit, no confirmation visible.
Works well:
- Same layout, nothing new breaks; the purple accent stays readable on beige.

### sheet-play-in-campaign

Route: /c/:id/play | Reached: a member's character linked to a campaign (second account) | Locale shown: uk
Shows: "Brannock Oakshield, Fighter 1" with the campaign chip in the header ("Shadows over Thornwall" link + "Покинути кампанію") and a roll-visibility row ("Усі / Лише Майстер / Приватно") inside the dice roller.
Defects:
- [P1] 390: the campaign chip is drawn over the identity block: the underlined link and the "Покинути кампанію" button overprint "Brannock Oakshield" and "Fighter 1" — unreadable; portrait, name, chip and "Експорт" are squeezed into one row.
- [P1] 390: chrome: same nav overflow; P1-A, P1-B, P1-C.
- [P2] @1280 the chip is a bordered box with a 16 px underlined link and a button between the name and "Експорт": the destructive "Покинути кампанію" has the same weight as Export.
- [P2] The visibility row "Усі / Лише Майстер / Приватно" has no label and sits between the advantage toggles and "Підсумок", reading as a third roll mode.
- [P2] Toast "blob.resend-have" at both widths; P2-D..P2-M (length 1280: 3284 px, 390: 6228 px).
Works well:
- The campaign name is visible on the sheet; roll visibility is set where rolls are made.

### sheet-play-l2

Route: /c/:id/play | Reached: after the level-up wizard (average HP) on the uk fighter | Locale shown: uk
Shows: "Орест Громовий, Fighter 2": "Скасувати підвищення рівня" in the XP row, HP 12/20, hit dice "к10 × 1 / 2", Actions "Action Surge", condition chip, 4 items, a note.
Defects:
- [P1] 390: chrome: same nav overflow; P1-A, P1-B, P1-C.
- [P2] "Скасувати підвищення рівня" adds a full header row @390 (six rows, ~330 px before the tabs) and is a plain ghost button with no confirmation hint.
- [P2] "Action Surge" appears as plain text with no use/count control; "Second Wind 0 / 2" still uses 18 px pips.
- [P2] HP 12/20 with no hint that current HP was not raised; nothing marks what changed at level 2.
- [P2] P2-D..P2-M (length 1280: 3493 px, 390: 6523 px — the longest in this group).
- [P3] P3-N..P3-Q.
Works well:
- The HP bar shows the 12/20 gap at once; the hit-dice count updates; "Fighter 2" plus the undo action make the level change discoverable.

# Review group 4 (sheet-play-l3 .. wizard-fighter-s12-review)

Chrome (header + nav), seen on every screen in this group, described once:
- [P1] 390: the top nav row does not wrap or scroll. The document is 572 px wide in a 390 px viewport (horizontal scroll on every page). "Персонажі" and "Кампанії" overlap ("ПерсонажіКампанії"), "Бібліотека" and "Пакети" touch, and "Налаштування" / "Про застосунок" are pushed past the right edge of the 390 px viewport (visible only after a sideways scroll, where "Про застосунок" wraps onto two lines). The header bar background stops at 390 px while the nav continues past it.
- [P2] A toast reading the raw i18n key `blob.resend-have` appears bottom-centre on several wizard screens (s01-name, s01-name-empty, s02-species, and on sheet-play-roll at 1280). Raw key leaking into visible text.
- [P3] Theme is dark by default in the capture; the nav has no current-section indicator beyond a slightly lighter chip ("Персонажі"), low contrast.
- [P3] Account row: "auditmvzn1rm6a" + "Вийти" and a bare purple dot (theme toggle, icon-only, no visible label).
Below, "chrome: same nav overflow" refers to this block.

### sheet-play-l3

Route: /c/:id/play | Reached: characters list → open the level-3 fighter (after two level-ups) | Locale shown: uk
Shows: sheet header (portrait initials, name, "Fighter 3", Експорт, XP field + Нарахувати + "Скасувати підвищення рівня"), tabs Гра/Білд/Хроніка, then the Play tab: dice roller card, ability cards, skills list, stat tiles, HP block, rest, inspiration, attacks table, spells (empty), resources, actions, conditions, proficiencies, inventory with currency, notes.
Defects:
- [P1] 1280 and 390: in every ability card the two buttons "Кинути перевірку" / "Кинути рятівний кидок" are wider than the card: each label wraps to 2–3 lines inside a 78 px button and the first glyphs are clipped ("еревірку", "рятівни"); the two buttons overlap each other (auto-check: 16×62 px overlap). The "Значення / Мод" header row is clipped to "Мод" / "Модифі" and the modifier value is not shown in the card body.
- [P1] 1280: the skills list is a 3-column grid whose cells collide: "Кинути" buttons overprint the next column's name ("Кинути Animal Handling", "КинутиHistory", "ВолодінInvestigation", "КинутиPersuasion", "КинутиReligion"), the "Володіння" proficiency chips are cut ("Володі"), and the last column's "Кинут" button is clipped at the card edge. Unreadable and mis-clickable.
- [P1] 390: page is 6471 px tall (about 8 screens of scrolling) with every section expanded and no tabbing/anchors; HP controls are only reached after the dice roller, 6 ability cards and 18 skill rows. chrome: same nav overflow.
- [P2] 1280: stat tiles "КЛАС БРОНІ", "БОНУС МАЙСТЕРНОС(ТІ)", "ПАСИВНА УВАЖНІСТЬ" are truncated at the tile edge ("МАЙСТЕРНОС", "УВАЖНІСТЬ" cut); at 390 the tiles wrap to a second row with unequal widths.
- [P2] 1280: the sheet header actions stack awkwardly: "Досвід: 900" label, a wide empty XP input, "Нарахувати", and "Скасувати підвищення рівня" on one line while "Експорт" floats far right; at 390 the XP input and both buttons stack as three full rows above the tabs.
- [P2] Attacks table at 390 overflows: the "Майстерність" column is cut to "М" / "sa" (value "sap" clipped) and the two roll buttons wrap to 2 lines.
- [P2] Mixed language in uk: ability names (Strength, Dexterity…), skill names, class line "Fighter 3", "Second Wind", "Action Surge", "Deafened", proficiency list ("heavy (proficient)"…), "Common", "walk" are English in the uk UI (pack content has no uk translation); section titles are uk. Reads as half-translated.
- [P2] Inventory rows: each item uses 2–3 rows of controls (– 1 +, Зняти/Спорядити, red "Видалити предмет" full-width danger button repeated per item); a destructive action is the most prominent control in the list.
- [P3] "Кидок костей" collapsible card is open by default and occupies the first screen (mode chips Звичайно/Перевага/Завада, an empty "Підсумок" field, a select "Перевірка вручну", a disabled "Записати кидок", "Ще немає кидків.") — a tool rarely needed first.
- [P3] "Не вимикати екран" (wake-lock) is a lone button placed in the right column top with empty space around it at 1280.
- [P3] Death saves "Успіхи 0 / 3 — Провали 0 / 3" rendered as plain text with no pips/controls visible; hit dice shown as text "Fighter: к10 × 2 / 3".
- [P3] Rest card: "Тривалий відпочинок" is purple (primary) while "Короткий відпочинок" is ghost; primary emphasis on the rarer action.
Works well:
- Section cards with consistent headers, collapsible "Дії / Володіння / Інвентар / Нотатки"; the HP bar + three stat tiles (Поточні/Максимум/Тимчасові) are readable at both widths; the skills list at 390 as a single column (name, modifier, Кинути) is clean; notes card with Редагувати/Видалити reads fine.

### sheet-play-roll

Route: /c/:id/play | Reached: Play tab, after pressing the first ability card's "Кинути перевірку" | Locale shown: uk
Shows: same Play tab as above (level-1 fighter) with the dice roller showing one log entry "Перевірка: Strength 10 +3 = 13" and an "Очистити журнал" button; toast "blob.resend-have".
Defects:
- [P2] 1280: toast "blob.resend-have" (raw i18n key) shown over the content right after a roll.
- [P2] 1280 and 390: the roll result also appears as plain page text "Перевірка Strength: 13." at the very bottom of the document, below the last card (the live-announcer region is visible instead of visually hidden).
- [P2] The roll result only appears inside the "Кидок костей" card at the top of the page; at 390 the ability cards are a full screen below the roller, so the user rolls at the bottom and the result lands off-screen above.
- [P1]/[P2] All ability-card, skills-grid, stat-tile, attacks-table and page-length defects of sheet-play-l3 apply unchanged (same template). chrome: same nav overflow.
Works well:
- The roll log line is compact and shows die, modifier and total ("10 +3 = 13") with the mode chips directly above it.

### sheet-timeline

Route: /c/:id/timeline | Reached: sheet → tab "Хроніка" | Locale shown: uk
Shows: title "Хронологія", six filter chips (Особистість, Рішення, Рівні, Бій, Предмети, Інше, all purple), event cards newest first with "Скасувати" and a "+" expander on grouped rows ("+2 події", "+15 подій").
Defects:
- [P2] Filter chips are all rendered in the selected (purple) state with no visual difference between on/off, so the filter state is unreadable; at 390 they wrap into two rows.
- [P2] 390: event text wraps to 2–3 lines beside a fixed-width "Скасувати" button; the "+" expander is an unlabeled 32 px square with no hint of what it expands ("+2 події" is in the sentence, not on the button).
- [P2] Mixed language: "Додано Potion of Healing ×1.", "Отримано стан Deafened.", "Обрано: Human." — entity names untranslated in uk sentences; "Отримано -5 шкоди." reads as negative damage.
- [P2] The hidden live-announcer text ("Перевірка Strength: 13.") is still in the DOM at the page bottom on this tab too (auto-check clipped div), i.e. the sheet shell carries it across tabs.
- [P3] "Скасувати" (revert) is shown for every event including the character-creation group; no date/time on the cards, no grouping by session.
- chrome: same nav overflow.
Works well:
- Plain-language event sentences ("Витрачено 1 кістку хітів (Fighter).") are readable; the revert action is consistently placed on the right of every card at 1280.

### wizard-caster-s09-spells

Route: /characters/new | Reached: creation wizard after class Wizard, skills and tool pick | Locale shown: uk
Shows: stepper "Ім'я · Заклинання · Спорядження · Огляд"; "Заговори" (0 / 3 заговорів вивчено) with search + card grid of 15 cantrips; "Книга заклинань" with a recommendation line, search and a card grid of level-1 spells; a lone "Далі" button bottom-left; footer "Назад / Далі".
Defects:
- [P1] 390: both spell grids are fixed-height scroll boxes inside the page showing ~3 cards (one card per row, 140 px each) with the fourth card cut; the user must scroll a box inside the page to see 15 cantrips and 30+ spells.
- [P1] Two buttons labelled "Далі" are on screen at once: the step's own "Далі" (ghost, bottom-left, the spells-step continue) and the wizard footer "Далі" (purple, bottom-right). At 390 they sit one above the other. Same text, different behaviour.
- [P2] 1280: the spellbook grid is clipped at the bottom row ("Floating Disk / Fog Cloud …" cards cut in half, their "Показати опис" link cut) because the inner box has a fixed height.
- [P2] Stepper chips overlap by 6 px (auto-check) and the stepper changed shape: the completed Species/Background/Class/Skills steps have vanished; only Ім'я/Заклинання/Спорядження/Огляд remain.
- [P2] "Показати опис" expand links are 16 px tall text links (below touch-target size) under every card.
- [P3] Headings "Заговори"/"Книга заклинань" use a serif display face at body size; the hint "Рекомендуємо близько 6 заклинань для початкової книги — можна обрати більше." is the only guidance; no prepared count until a spell is picked.
- chrome: same nav overflow.
Works well:
- Card grid at 1280 (6 per row, icon + name) scans quickly; the cantrip counter "0 / 3 заговорів вивчено" is clear.

### wizard-caster-s09-spells-filled

Route: /characters/new | Reached: same step after choosing Magic Missile and Sleep | Locale shown: uk
Shows: as above with the two chosen cards outlined purple, plus a new "Підготовлені заклинання" block ("0 / 4 заклинань підготовлено") with two chips "Magic Missile", "Sleep".
Defects:
- [P1] Same double "Далі" and inner-scroll-box problems as the unfilled step; at 390 the prepared block sits between the clipped grid and the two "Далі" buttons.
- [P2] 1280: the spellbook search field shows a focus ring while the inner list has scrolled so that the first visible row is cut at the top ("Floating Disk…" cards half visible above "Illusory Script"); selection outlines on "Magic Missile" and "Sleep" are thin 2 px borders, easy to miss.
- [P2] The "Підготовлені заклинання" chips look identical to unselected chips elsewhere in the wizard; it is not clear they are toggles for preparing.
- chrome: same nav overflow.
Works well:
- The prepared counter "0 / 4" appears immediately after learning spells, so the next action is discoverable at 1280.

### wizard-caster-s11-review

Route: /characters/new | Reached: Equipment → Далі | Locale shown: uk
Shows: "Огляд": name/gender, "Зроблені вибори" table (Species/Background/Ability score improvement/Class/Ability scores/Навички/Tool proficiency…), "Спорядження" list, "Вивчені заклинання" list, derived stats, full-width "Створити персонажа", footer with only "Назад".
Defects:
- [P2] Mixed-language labels in the review: "Species", "Background", "Ability score improvement", "Class", "Ability scores", "Tool proficiency: choose one kind of Gaming Set" are English while "Навички", "Спорядження", "Вивчені заклинання", "Характеристики" are uk.
- [P2] 390: the value column is squeezed to ~100 px so "Strength 8 , Dexterity 13 , Constitution 14 , Intelligence 15 , Wisdom 12 , Charisma 10" wraps into 10 lines with stray " , " separators at line starts; the label column keeps 60% of the width for short labels.
- [P2] Action placement inconsistent with other steps: "Створити персонажа" is full-width purple above the footer, while the footer holds only "Назад" at the far right; on every other step the primary action is the right-aligned footer "Далі".
- [P2] Stepper shows "Заклинання" as done but "Спорядження" as not done although equipment was added (equipment never gets a done state).
- [P3] Gender "Чоловічий" shown for a character named Мирослава (the default radio was accepted) — the review does not flag it; "Рід" label for grammatical gender is unclear.
- [P3] Derived stats line "CHA 10 · CON 15 · DEX 15 · INT 15 · STR 8 · WIS 12" is alphabetical by English abbreviation, not in the D&D order used two rows above.
- chrome: same nav overflow.
Works well:
- Everything the user chose is listed on one page before creating; the create button cannot be missed at 1280.

### wizard-fighter-s01-name

Route: /characters/new | Reached: Characters → "Новий персонаж", name typed | Locale shown: uk
Shows: stepper (Ім'я · Раса · Передісторія · Клас · Характеристики · Спорядження · Огляд), "Назвіть персонажа", name input, "Граматичний рід" radios (Чоловічий/Жіночий/Середній), "Пакети вмісту" checkboxes (My homebrew v0.1.0, Sample content v1.0.0), footer Назад/Далі; toast "blob.resend-have".
Defects:
- [P1] 390: the stepper squeezes seven chips into 372 px: "Ім'я | Ра | ередісто | Кла | Характе | Споряджен | Огляд" — labels truncated on both sides and overlapping (auto-check 6 px overlaps), not scrollable.
- [P2] 1280: the last stepper chip "Огляд" is cut at the right edge of the viewport.
- [P2] Toast "blob.resend-have" (raw key) overlapping the bottom of the form at both widths.
- [P2] Footer "Назад / Далі" floats directly under the form (centered at 390, right at 1280) rather than at a fixed position; its vertical position changes on every step.
- [P3] "Назад" is enabled on the first step though there is nothing to go back to; the species step is labelled "Раса" in the stepper but the step heading says "Species".
- [P3] Native radio buttons and checkboxes, 13 px, unstyled; "Пакети вмісту" helper text wraps to 3 lines at 390.
- chrome: same nav overflow.
Works well:
- The name field is large and full-width; the pack opt-in is explained ("Це можна змінити пізніше на вкладці «Білд»").

### wizard-fighter-s01-name-empty

Route: /characters/new | Reached: fresh wizard | Locale shown: uk
Shows: the same name step before typing; stepper shows only "Ім'я" and "Огляд"; "Далі" disabled; "Середній" (neuter) pre-selected.
Defects:
- [P2] The stepper shows two steps (Ім'я, Огляд) before the name is entered and seven once it is: the progress indicator changes its shape on the first keystroke.
- [P2] "Далі" disabled state is a dimmer purple with no explanation that a name is required.
- [P3] Default grammatical gender is "Середній" (neuter), which is rarely the intended value.
- [P2] Toast "blob.resend-have" visible. chrome: same nav overflow.
Works well:
- Empty state is uncluttered; the required field is obvious.

### wizard-fighter-s02-species

Route: /characters/new | Reached: name step → Далі | Locale shown: uk
Shows: heading "Species" (English), search "Пошук…", 9 species cards (icon, name, "Показати опис"), footer Назад/Далі.
Defects:
- [P1] 390: the card list is an inner scroll box ~400 px tall showing 3 of 9 cards (one per row, ~130 px each); the fourth is cut; the footer sits below the box, so the user scrolls inside a box within the page.
- [P2] Step heading "Species" is English while the stepper chip is "Раса" (two different words for the step in two languages).
- [P2] Cards carry no description, cost or hint; the only content is an icon and the English name; "Показати опис" is a 16 px underlined text link.
- [P2] 390 stepper: "Ім'я | Раса | ередісто | Кла | Характе | Споряджен | Огляд" truncated/overlapping.
- [P3] 1280: "Огляд" chip cut at the right edge; "Далі" is enabled before a species is chosen (clicking it would skip the step).
- [P2] Toast "blob.resend-have" at both widths. chrome: same nav overflow.
Works well:
- At 1280 the 6-per-row grid with distinct icons is quick to scan; search is present.

### wizard-fighter-s02-species-expanded

Route: /characters/new | Reached: species step → "Показати опис" on Dragonborn | Locale shown: uk
Shows: identical to the species step except the first card's link now reads "Сховати опис".
Defects:
- [P1] Expanding a card shows no description at all at either width: the link toggles to "Сховати опис" but no text appears (card keeps its fixed height; the description is either clipped inside the card or not rendered).
- [P2] All defects of wizard-fighter-s02-species apply. chrome: same nav overflow.
Works well:
- nothing notable beyond the species step.

### wizard-fighter-s03-background

Route: /characters/new | Reached: species chosen (auto-advance) | Locale shown: uk
Shows: heading "Background" (English), search, four cards Acolyte/Criminal/Sage/Soldier with identical generic dice icons, footer.
Defects:
- [P1] 390: inner scroll box shows 3 of 4 cards, fourth cut; stepper "Ім'я | ередісто | Кла | Характер | Споряджен | Огляд" overlapping/truncated.
- [P2] Heading "Background" is English; stepper chip says "Передісторія".
- [P2] All four cards share one placeholder icon, so the cards carry no information besides the name.
- [P2] Completed "Раса" step has disappeared from the stepper (done steps vanish, so the user cannot go back to a specific completed choice through the stepper).
- [P3] 1280: large empty area below four cards; footer floats mid-page.
- chrome: same nav overflow.
Works well:
- Short list, no scrolling at 1280.

### wizard-fighter-s04-improve

Route: /characters/new | Reached: background chosen (auto-advance) | Locale shown: uk
Shows: heading "Ability score improvement" (English), "+2" row of three chips (Strength/Dexterity/Constitution), "+1" row of the same three chips, footer.
Defects:
- [P1] 390: stepper chip "Бонуси передісторії" wraps to two lines inside a 56 px chip and overprints its neighbours ("Бонуси передісто | Кла | актерис | Вибір | рядже | Огляд").
- [P2] Heading "Ability score improvement" is English; the chip label "Бонуси передісторії" is uk; the "+2" / "+1" rows have no explanation of what they are or that the +1 cannot repeat the +2 ability.
- [P2] "Далі" is enabled before any chip is chosen; the step auto-advances on the second chip click, so the "Далі" button is never needed (inconsistent interaction model with the name/equipment steps that require Далі).
- [P2] After choosing the +2 ability the +1 row silently loses that ability (the chip disappears instead of being disabled), so the row changes width under the finger.
- [P3] Generic "Вибір" chips appear in the stepper for the upcoming class choices.
- chrome: same nav overflow.
Works well:
- Chips are large (46 px) and readable at both widths; the step fits one screen.

### wizard-fighter-s05-class

Route: /characters/new | Reached: ability bump chosen | Locale shown: uk
Shows: heading "Class" (English), search, 12 class cards with distinct icons, footer.
Defects:
- [P1] 390: inner scroll box shows 3 of 12 class cards; stepper "Ім'я | Клас | актерис | Виб | рядже | Огляд" overlapping.
- [P2] Heading "Class" English vs stepper "Клас"; no description/role summary on the cards.
- [P2] Stepper now contains a generic "Вибір" chip for the class-dependent choices before a class is chosen.
- [P3] 1280: "Огляд" chip cut at the right edge; "Далі" enabled without a selection.
- chrome: same nav overflow.
Works well:
- Twelve distinct class icons; at 1280 all classes visible without scrolling.

### wizard-fighter-s06-abilities-filled

Route: /characters/new | Reached: all six standard-array values assigned (the step auto-advanced; this capture shows the next step, "Оберіть 2 навички для класу Fighter") | Locale shown: uk
Shows: stepper "Ім'я · Навички · Вибір · Вибір · Вибір · Спорядження · Огляд", skills prompt and nine skill chips, footer.
Defects:
- [P2] The ability-scores step auto-advances the instant the sixth value is assigned, giving no chance to review the six numbers together (the capture meant to show filled scores shows the skills step instead).
- [P2] Stepper now shows three consecutive chips all labelled "Вибір" (generic), so the remaining steps are indistinguishable; at 390 they read "Вибір | Вибір | Виб | рядже".
- [P2] Mixed language: "Оберіть 2 навички для класу Fighter" (uk sentence with English class name) and English skill names.
- chrome: same nav overflow.
Works well:
- Chips are 46 px tall and wrap cleanly into four rows at 390.

### wizard-fighter-s06-abilities-m1

Route: /characters/new | Reached: class chosen; tab "Стандартний масив" | Locale shown: uk
Shows: heading "Ability scores" (English), method tabs (Стандартний масив / Купівля очок / Вручну / Кидок), six rows "Strength … Charisma" each with a 24 px native select "Не обрано ▾" (15/14/13/12/10/8).
Defects:
- [P1] 390: stepper "Ха'актери | Навичк | Вибір | Вибір | Виб | ряджен | Огляд": the current chip's own label is cut on both sides; chips overlap by 12 px.
- [P2] Six native selects are 24 px tall (below touch size) with mixed widths because they sit after labels of different lengths; no indication which values are still unused.
- [P2] Heading "Ability scores" and all six ability names are English in the uk UI; tabs are uk.
- [P2] 390: the method tabs wrap into two-line tabs ("Стандартний / масив", "Купівля / очок") with no scroll.
- [P3] "Далі" is enabled with nothing assigned; the step auto-advances on the sixth selection, so Далі is redundant here.
- chrome: same nav overflow.
Works well:
- The standard array is a single clear list of six rows; method tabs are the right model for the methods.

### wizard-fighter-s06-abilities-m2

Route: /characters/new | Reached: tab "Купівля очок" | Locale shown: uk
Shows: "0 / 27 очок" budget, six rows each with label, a "Значення" number input (8) and "Вартість: 0".
Defects:
- [P2] Each row's input is offset by the label width so the six inputs form a staircase (Strength input starts at 95 px, Constitution at 123 px); the "Значення" field label is repeated six times.
- [P2] Point buy uses free-text number inputs with no +/- steppers and no min/max hint (8–15); the budget line "0 / 27 очок" is plain text far from the inputs; 390 page grows to 856 px.
- [P2] English ability names; "Ability scores" heading English.
- chrome: same nav overflow.
Works well:
- Cost per ability is shown inline ("Вартість: 0"), budget is visible.

### wizard-fighter-s06-abilities-m3

Route: /characters/new | Reached: tab "Вручну" | Locale shown: uk
Shows: six empty "Значення" inputs in a staircase, footer.
Defects:
- [P2] Same staircase alignment and repeated "Значення" labels; empty inputs have no placeholder or allowed range.
- [P2] Nothing distinguishes this tab from point buy except the missing cost text and budget; "Вручну" is the only cue.
- chrome: same nav overflow.
Works well:
- nothing notable.

### wizard-fighter-s06-abilities-m4

Route: /characters/new | Reached: tab "Кидок" | Locale shown: uk
Shows: a single button "Кинути всі шість" and nothing else; footer.
Defects:
- [P2] Empty tab: no explanation of the method (4d6 drop lowest), no place where results will appear, no per-ability roll; the footer "Далі" is enabled with no scores.
- [P3] 390: the method tab strip still wraps to two lines.
- chrome: same nav overflow.
Works well:
- One obvious action.

### wizard-fighter-s07-choose-2-skills-for-fighter

Route: /characters/new | Reached: ability scores complete (auto-advance) | Locale shown: uk
Shows: stepper "Ім'я · Навички · Вибір · Вибір · Вибір · Спорядження · Огляд", "Оберіть 2 навички для класу Fighter", nine skill chips, footer.
Defects:
- [P2] No count of how many are selected (0/2); the step auto-advances on the second chip, so a mis-tap on the second chip moves the user to the next step before they see it.
- [P2] Three identical "Вибір" chips in the stepper; at 390 "Навички | Вибір | Вибір | Виб | рядже | Огляд" overlap.
- [P2] English skill names and class name inside a uk sentence.
- [P3] Background-granted skills (Athletics, Intimidation for Soldier) are not shown as already-proficient here, and the Human "Skillful" pick is absent, so the user cannot see the full skill picture while choosing.
- chrome: same nav overflow.
Works well:
- Chips wrap cleanly at 390; the prompt states the count.

### wizard-fighter-s08-tool-proficiency-choose-one-

Route: /characters/new | Reached: skills chosen (auto-advance) | Locale shown: uk
Shows: heading "Tool proficiency: choose one kind of Gaming Set" (English), search, four "Gaming Set, …" cards with one shared icon, footer.
Defects:
- [P1] 390: inner scroll box shows 3 of 4 cards with the fourth cut; stepper "Ім'я | Вибір | Вибір | Виб | ядже | Огляд".
- [P2] English prompt and card names in the uk UI; the stepper chip for this step is the generic "Вибір" (the current chip gives no hint that this is the tool pick).
- [P2] A whole step with a search box for a four-item, low-impact choice; identical icons on all four cards.
- [P3] Card names wrap to two lines at 1280 ("Gaming Set, Three-Dragon Ante"), making card heights uneven.
- chrome: same nav overflow.
Works well:
- nothing notable.

### wizard-fighter-s09-fighting-style

Route: /characters/new | Reached: tool pick (auto-advance) | Locale shown: uk
Shows: heading "Fighting Style" (English), search, four cards Archery/Defense/Great Weapon Fighting/Two-Weapon Fighting (shared icon), footer.
Defects:
- [P1] 390: inner scroll box shows 3 of 4 cards (Two-Weapon Fighting cut); stepper "Ім'я | Вибір | Вибір | Спорядженн | Огляд".
- [P2] The most consequential level-1 fighter choice has no description visible; "Показати опис" (16 px link) is the only way to read what a style does, and the expand did not show text on the species step.
- [P2] English heading/card names; generic "Вибір" stepper chip is the current step.
- [P3] Shared placeholder icons; names wrap at 1280.
- chrome: same nav overflow.
Works well:
- Short list, fits one screen at 1280.

### wizard-fighter-s10-weapon-masteries

Route: /characters/new | Reached: fighting style chosen (auto-advance) | Locale shown: uk
Shows: heading "Weapon Masteries" (English), search, a grid of weapon cards (Battleaxe … Light Hammer visible, 3 rows of 6 at 1280), footer.
Defects:
- [P1] 1280 and 390: the grid is an inner scroll box: at 1280 only 18 of ~37 weapons are visible and the box ends abruptly above the footer; at 390 only 3 cards (Battleaxe, Blowgun, Club) are visible with the fourth cut, so choosing Longsword means scrolling a box inside the page past ~20 one-per-row cards.
- [P2] No "0 / 3 selected" counter anywhere; the step auto-advances on the third pick.
- [P2] Stepper for this step: "Ім'я · Вибір · Спорядження · Огляд" — the current step is just "Вибір"; previous "Вибір" chips vanished.
- [P2] English heading and names; the mastery property of each weapon (the thing being chosen) is not shown on the card.
- chrome: same nav overflow.
Works well:
- Weapon icons distinguish melee/ranged; search exists for a long list.

### wizard-fighter-s11-equipment

Route: /characters/new | Reached: masteries chosen (auto-advance) | Locale shown: uk
Shows: stepper "Ім'я · Спорядження · Огляд"; "Додати спорядження" with a "Кількість" input (1), search, an inner scroll grid of item cards (Acid, Adamantine Armor (Breastplate)… 60 of ~960) and the line "Ще 900 варіантів — уточніть пошук"; "Валюта" with five inputs; a ghost "Далі" (equipment continue) bottom-left; footer Назад/Далі.
Defects:
- [P1] 1280: the item grid is a fixed-height box whose third row is cut in half ("Ammunition of Alignment Slaying" etc. truncated) and the step's ghost "Далі" overlaps the picker's last card row (auto-check 61×46 px overlap at 1280, 61×15 px at 390).
- [P1] Two "Далі" buttons (step continue + wizard footer) on screen; at 390 they are stacked 60 px apart.
- [P1] 390: inner box shows 3 of 60 cards; "Ще 900 варіантів" hint sits below; currency becomes five stacked full-width inputs; total page 1401 px.
- [P2] Starting equipment is not proposed: the user must search a 960-item catalogue (first items are "Acid", "Adamantine Armor (Breastplate)", "Airship") to find Chain Mail/Longsword; no class starting-kit option.
- [P2] "Кількість" input is detached from the cards (set quantity first, then click a card) and nothing says so.
- [P2] 390 stepper "Ім'я | Спорядження | Огляд" chips overlap by 6 px.
- [P3] Currency inputs ("Мідь / Срібло / Електрум / Золото / Платина") are oversized full-width fields for small numbers; "Платина" alone on a second row at 1280.
- chrome: same nav overflow.
Works well:
- The overflow hint "Ще 900 варіантів — уточніть пошук" is honest; search placement is good.

### wizard-fighter-s11-equipment-filled

Route: /characters/new | Reached: three items added and equipped | Locale shown: uk
Shows: same step plus an "Інвентар" list: "Chain Mail × 1 [Споряджено]", "Longsword × 1 [Споряджено]", "Shield × 1 [Спорядити]"; currency; two "Далі".
Defects:
- [P1] Same clipped picker grid, overlapping ghost "Далі" over the picker (auto-check: "Ammunition of Giant Slaying" card <> "Споряджено" toggle overlap 126×26 at 1280; "Показати опис" <> "Споряджено" 126×14 at 390) and the double "Далі".
- [P2] Inventory rows have no remove or quantity control; the Споряджено/Спорядити toggle is an outlined chip that looks like a status badge rather than a button.
- [P2] The inventory list appears below the 60-card picker, so after adding an item the confirmation is off-screen at both widths.
- [P2] Weight, cost or AC consequences of the chosen gear are not shown; the review step later shows AC 17 with no link to why.
- chrome: same nav overflow.
Works well:
- Equipped state is visually distinct (purple outline) and the list is compact.

### wizard-fighter-s12-review

Route: /characters/new | Reached: equipment → Далі | Locale shown: uk
Shows: "Огляд" with name/gender, "Зроблені вибори" (10 rows), "Спорядження" list, derived "Характеристики / Очки здоров'я / Клас броні / Бонус майстерності", full-width "Створити персонажа", footer "Назад".
Defects:
- [P2] Mixed-language labels: "Species / Background / Ability score improvement / Class / Ability scores / Tool proficiency: choose one kind of Gaming Set / Fighting Style / Weapon Masteries" English vs "Навички / Спорядження / Характеристики" uk.
- [P2] 390: value column too narrow; "Strength +2 , Constitution +1" and the six ability scores wrap into 3–8 lines with " , " separators starting lines; "Dagger , Longsword , Shortsword" likewise.
- [P2] Primary action placement differs from all other steps (full-width button above the footer; footer has only "Назад" right-aligned); no way to jump back to a specific step from the review rows (not links).
- [P2] Stepper "Ім'я · Спорядження · Огляд": the stepper never showed "Спорядження" as done; at 390 chips overlap.
- [P3] Species/background/class names and all values are English; "Рід: Чоловічий" label unclear; alphabetical "CHA · CON · DEX · INT · STR · WIS" order.
- chrome: same nav overflow.
Works well:
- The summary is complete and compact at 1280; HP/AC/proficiency are surfaced before creation; the create button is unmissable.

