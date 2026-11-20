# Plan 20 — UX review proposals

Status: proposals only. Nothing here is implemented. The owner picks rows for a later plan.

Method: screenshots of Home, Library list and entry, Create wizard, Sheet Play/Spells/Build/Timeline and Settings at desktop 1280×800 and phone 390×844, en and uk, tavern theme, taken at the end of plan 20 (after Tasks 1–10). Two `visual-check` reviews judged them against: one primary action per block, repeated buttons that could be one menu, rows wider than their content, missing hints, touch targets under 44 px. Campaign party and log were not captured (they need a signed-in sync server). The uk wizard was captured at its first step only.

Note: Task 10 added hover/long-press hints for most rules terms on the sheet (initiative, AC, speed, proficiency, passive Perception, hit dice, temp HP, spell DC/attack, concentration, inspiration, death saves, ability names, check vs save). Screenshots cannot show tooltips, so the reviews' "no hints" remarks mean the hints are not *discoverable*, not that they are missing. P19 is the proposal that follows from that.

## Bug candidates found during the review

| id | screen | problem | next step |
|----|--------|---------|-----------|
| B1 | Library list + entry | Several rows are titled "1st", "2nd" with a "Features" chip, and opening one shows "[Column data]". Looks like class-table column rows indexed as library entries. | Investigate in the content transform / library index; hide or attach them to their class. Fix before any library layout work. |
| B2 | Settings → Storage (phone) | Empty storage bar renders solid black. | Check the empty-bar token in the tavern theme. |
| B3 | Sheet Play, attack row | A level-1 wizard's Longsword shows +0 to hit. Probably correct (no weapon proficiency, Str 10), but confirm. | Verify against the derived sheet. |

## Proposals

Effort: S = a few hours, M = a day or two, L = more.

| id | screen | problem | proposal | effort |
|----|--------|---------|----------|--------|
| P1 | Sheet Play — spells (seed) | Spell rows carry a cast glyph, a key icon and a loud gold Prepare/Unprepare pill (~28 px tall on phone); the same spell is listed under Known and Prepared. | One list. Each row: name + level + a prepared dot/checkbox; one dice/cast menu button (Cast, Upcast at level N, Prepare/Unprepare, Details) and the same items on a row context menu. | M |
| P2 | Strap (seed) | Short rest and Long rest are two wide buttons; in uk they lose their labels and the two icons are hard to tell apart. | One split action "Rest" (remembers last), menu Short / Long with a one-line hint of what each restores. Reuses `hk-split-action`. | S |
| P3 | Sheet Play — HP (seed) | Adding a condition lives on a separate card's button. | Add "Add condition" to a context menu on the HP block (and keep the conditions card's button). | S |
| P4 | Roll log (seed) | The roll log is a full panel/sheet. | Open it in the peek panel (non-modal) so the sheet stays usable while reading rolls. | M |
| P5 | Build — saves (seed) | Saving throws appear on Play (seals) and Build. | Make the Build tab's saves block the only full saves view; Play keeps the per-ability dice menu from Task 8. | S |
| P6 | Strap | The strap still has a "Hit points" button that only focuses the HP field; the HP block already has the split action. | Drop the strap HP action on desktop; keep it on phone only if the HP block is off-screen on the active tab. | S |
| P7 | Sheet header (all tabs) | XP block (bar, "XP: 0", stepper, amount field, Award) is ~120–140 px tall; in uk it wraps to more rows. On phone it repeats on every tab. | One line "XP 0/300 [+]"; [+] opens a small popover with the amount field. On phone show it on the Hero tab only. | S |
| P8 | Sheet Play — Conditions / Resources | Two equally loud pills (Add condition, Advance round) in a mostly empty card; Resources card says only "No resources." | Merge into one "Status" card: "+ Add" in the header, Advance round in its ⋯ menu shown only when conditions exist; hide empty Resources. | M |
| P9 | Sheet Play — Spellcasting header | Three large stat tiles + a separate "Roll spell attack" button (~200 px on phone); uk labels wrap the tiles unevenly. | One compact stat strip "DC 12 · +4 · 3 cantrips", tapping the attack bonus rolls; slots as one row "L1 ●●". | M |
| P10 | Inventory header | "Add from library" and "Add custom item" are equal buttons. | One split action "Add item" (library default, custom in the menu). | S |
| P11 | Phone chrome | Quick-action bar + tab bar + XP header use ~270 px of 844 px. | Keep only the tab bar fixed; quick actions become one "Roll / Rest" split action; XP as in P7. | M |
| P12 | HP / XP amount fields | Empty dark input with no visible label or placeholder. | Placeholder "amount" (i18n) and a visible label for screen-reader parity. | S |
| P13 | Build tab | Full-width "Outstanding choices — All caught up" card; lock chips ("fixed at creation", "via Level up") on their own line double row height; Rule options and Content packs sit above Ability scores. | Collapse the empty state into a badge on the Build tab; lock chip → inline 🔒 icon with tooltip; move Ability scores up; Rule options + Content packs into an "Advanced" section. | M |
| P14 | Timeline | A full-width outlined Revert on every row (~100 px rows on phone); filters take ~150 px; "+27 more events" expander is confusing. | Revert into a row ⋯ menu with a confirm hint ("Undo this change and what depends on it"); filters behind one Filter button; group creation events as one "Character creation" row. | M |
| P15 | Create wizard — class step | 12 cards each with a "Choose" button; cryptic chips ("d10", "CON, STR", "STR"); die-size filter chips mean nothing to a beginner. | Whole card is the click target; one plain line "Fighter · d10 hit die · Strength" plus a short role blurb (pack data); a "?" explaining hit die and primary ability; role filters instead of die filters. | M |
| P16 | Create wizard — name step (uk) | Grammatical-gender control is full-width with no explanation; "Середній" preselected; Next looks disabled-grey. | Cap control and field width (~400 px); hint "affects only wording in uk/ru text"; Next visibly primary once a name is typed. | S |
| P17 | Library list | Intro, help, Sort and chips push the first result to ~390 px; rows span full width with the type chip far right on every row; duplicate search/filter in the bottom bar. | Collapse intro/help; Sort as an icon menu in the search field; hide the type chip when a type filter is active; compact multi-column grid on desktop; one search entry point. | M |
| P18 | Library entry | Three back routes (top button, bottom Back, header); licence block ~200 px. | Drop the top Back button; licence into a collapsed "Source and licence" row. | S |
| P19 | Hints discoverability | Task 10's hints exist but nothing signals them. | Dotted underline (or a small ⓘ on first visit) on hinted terms; one-time "long-press or hover any term for an explanation" tip on the sheet. | S |
| P20 | Home | One 400 px hero card on an empty page; "Open" + ⋯ (~30 px ⋯); Import is an equal second button; no first-run guidance. | Whole card opens; card shows level, class, HP; responsive grid; Import into a split action under New hero; empty-state hint "New hero starts a guided wizard". | S |
| P21 | Settings | Log in and Create account equally loud; tall "Keep data on this device" card; "Changes apply immediately" repeated; uk tab chips overflow. | Log in primary, Create account as a link; persist-storage as one toggle row; one "changes apply" note; scroll/wrap the uk tab chips. | S |
| P22 | uk text on the sheet | Spell stat labels and rest labels are long; XP header wraps; Build table headers nearly touch. | Shorter uk labels where a standard short form exists (agree terms in plan 22), plus P2/P7/P9 remove most of the pressure. | S |

## Touch targets seen under 44 px

Most `hk-menu-button` / `hk-icon-button` uses already have a 44 px invisible hit area on coarse pointers (verified for the HP caret by an e2e check in plan 20). Still to check: the home card ⋯, the spell Prepare pill, Timeline Revert buttons and the spell-slot seals.

## Out of scope here

ru/uk content names (classes, feats, skills) still show in English; plan 22 translates content.
