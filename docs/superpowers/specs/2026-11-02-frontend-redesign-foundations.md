# Frontend redesign — foundations (plan 17, Stage A, checkpoint 2)

Status: DRAFT for owner review, 2026-11-02. Supersedes nothing; feeds plan 17 Stage B.
Decided so far by the owner (2026-11-02): visual concept **A "Tavern Table"** is the primary look; game-UI level 4.5 of 5; devices desktop → tablet → phone; icon-first with hover hints; screens may be regrouped as long as no capability is removed; "Later" ideas stay light.
Owner fixes on concept A: (1) legends become hover hints on the glyph itself, a rule for the whole UI; (2) replace the concentration, spell-slot and javelin icons; (3) conditions carry a manually managed duration; (4) features are the things granted by class, subclass, species, background and feats, grouped by source.

Artifacts: canvas "Herokeep UI concepts" (concept A boards), design system "Herokeep" (tokens, components, icon vocabulary). Audit inputs: `scratchpad/audit/inventory.md` (111 screens, 10 worst defects) and `actions.md` (263 controls).

---

## 1. Principles (the why)

1. **At the table first.** The Play sheet shows the live reads (HP, AC, speed, saves, attacks, resources, conditions, spells, bag) without opening anything, on a 1440 desktop in one screen and on a 390 phone above the fold for the combat reads.
2. **Objects, not cards.** Panels are parchment leaves on a table; controls are brass, leather and wax. Body text always sits on a solid leaf; textures never run under paragraphs.
3. **Icon-first, hint-backed.** Repeated controls are icon buttons with a tooltip (hover/focus) or long-press hint (touch) and an `aria-label`. Primary flow actions keep icon + text. Destructive actions keep text.
4b. **No narrative captions.** Text that only narrates what a control will do ("Preparing Healing Word fills the last slot", "You've learned every cantrip you can know") is removed; counters ("3 of 3 known"), real content (descriptions) and hover hints carry that information. (Owner comments, 2026-11-03.)
4a. **A disabled control explains itself on hover, not inline.** The reason a control is disabled ("Nothing to go back to", "Choose 2 skills first") lives in its hint and `aria-describedby`, never as a caption beside it; a step's own progress counter stays because it is content. (Owner comment, 2026-11-03.)
4. **Meaning is never a legend.** Any glyph that encodes state (proficiency dot, save shield, oath mark, equipped tag, attuned gem, disadvantage mark, concentration eye, rarity tint) explains itself on hover/long-press. Inline legends are removed everywhere; a "?" help popover may repeat them.
5. **Stable action bar.** One strap at the bottom of every screen with fixed zones; a given action never changes slot between steps or tabs.
6. **Longest string wins.** Every label is designed at the Ukrainian length; icons carry the rest. Truncation is ellipsis plus a tooltip with the full text, never clipping.
7. **Nothing hides behind a giant scroll.** When a region grows past one screen, it becomes a tab or a drawer, never a 6,000 px page.

## 2. Information architecture

### 2.1 App map

```
Home
├─ Heroes (list) ─ Hero sheet ─ Play | Build | Timeline ─ Level up (flow) ─ New hero (wizard)
├─ Campaigns (list) ─ Campaign ─ Party | Table (log, rolls, chat, session) | Lobby (code, QR, members) | Settings (house rules, packs, export)
│                      └─ Join (code / QR deep link) ─ Link a hero
├─ Library (browse, search, filters) ─ Entry (description, "Add to hero" when opened from a sheet)
├─ Packs (installed, updates, import, trust dialog) ─ Pack ─ My homebrew (editor for item / spell / feat / species)
└─ Settings ─ Account (log in, register, recover, devices, quota) · Appearance (theme, density, motion, language) · Storage · About & licences
```

Changes versus today: About folds into Settings; Login/Register/Recover stay as deep-linkable routes but are reached from Settings → Account and from the account button on the rail; Homebrew stays under Packs; the roll log and notes become drawers on the sheet instead of inline sections.

### 2.2 Navigation by device

- **Desktop and tablet (≥ 768):** a top brass rail: wordmark left; six icon buttons (Home, Heroes, Campaigns, Library, Packs, Settings) with tooltips; right side: the current campaign chip (when a campaign is open or the hero is linked), the account button. The rail never wraps: at 768 the wordmark becomes the mark only.
- **Phone (< 768):** no top nav. A slim top bar: a folio button (opens the app drawer with the six sections, account, theme), the screen title or hero name, one context action. The bottom holds the current screen's tabs when it has tabs (sheet, campaign); the action strap sits above them.
- **Sheet tabs:** desktop and tablet: Play · Build · Timeline as brass tabs on the folio, plus "Level up" as a highlighted tab-shaped action when XP allows it. Phone: Combat · Spells · Bag · Hero · More. "Hero" holds abilities, saves, skills, proficiencies, languages and features (my call: the owner's "Features" tab widened so abilities and skills have a home; flag for review). "More" lists Build, Timeline, Notes, Roll log, Content packs, Export, Level up.
- **Campaign tabs:** Party · Table · Lobby · Settings on every device (phone: bottom tabs).

### 2.3 Navigation semantics (plan 17 ruling 4, made concrete)

- **Back** = the previous step or screen in the user's own path (history-aware). From level-up, Back returns to the sheet tab the user came from. From a deep link with no history, Back goes to the parent in the app map.
- **Next** = the next unanswered step, never skipping one. On the last step the same slot reads "Create hero" / "Finish level up".
- **Cancel** (flows only) = leave the flow; confirmation only if something was changed.
- **Deep links** restore the exact tab or step; the stepper and tabs reflect the URL.
- **Drawers** (notes, roll log, descriptions, app drawer) close with the same control that opened them and with Escape; they never change the URL.

## 3. The action strap (plan 17 ruling 3, made concrete)

A fixed strap at the bottom of every screen (desktop: full-width leather strap with brass rivets; phone: the same strap above the tab bar). Three zones, left to right:

| Zone | Content | Rule |
|---|---|---|
| 1 Exit | Cancel, Back (flows); nothing on the sheet | Always leftmost; Back is always the second slot when present. |
| 2 Primary | Screen-specific, fixed order: sheet → Damage · Heal · Roll · Short rest · Long rest; wizard/level-up → Next (becomes Create / Finish on the review step, same slot); campaign Party (DM) → Damage · Heal · Condition · XP · Item; lists → New · Import / Join | Same order on every tab and step of that screen. |
| 3 Secondary | Icon-only with tooltips: sheet → Add condition · Notes · Roll log · Export · Edit (override); campaign → Session start/end · Export; pickers → Filter · Search | On phone, zone 3 collapses into one "more" button that opens a sheet with the same order. |

The strap never scrolls away, never overlaps content (the page reserves its height), and shows the concentration note on the right on desktop when concentrating.

## 4. Flows

### 4.1 Hero creation wizard

Steps in order: 1 Name & concept (name, pronoun form for grammar, portrait, content packs) · 2 Species · 3 Background · 4 Ability scores (method, assignment, bonuses from background shown live) · 5 Class · 6… Class and background choices as discovered (skills, tools, fighting style, weapon masteries, subclass when level 1 has one, spells) · N−1 Equipment · N Review.

- **Stepper:** desktop and tablet: a vertical parchment stepper in the left column listing every step; undiscovered choice steps appear as one "Class choices" group that expands into real steps once the class is chosen; done steps keep their place and show a wax seal; the current step is raised. Phone: a compact top strip "Step 4 of 9 · Ability scores" with a drawer listing all steps. No chips row (the audit's overlapping chips are gone).
- **Pickers:** cards in a responsive grid that uses the full height (no inner scroll box). Search and filter chips at the top. Tapping a card opens the description in a right-side drawer on desktop and a bottom sheet on phone, with a "Choose" button there and on the card. Gated options stay listed, disabled, with the reason on hover and in the drawer. Selected cards show a wax seal.
- **Ability scores:** the six scores are always visible together; the step never auto-advances; bonuses from species and background are shown as brass "+1" tags on the seals.
- **Review:** every decision listed by step with an "Edit" link that jumps to that step and comes back on Next.
- **Descriptions everywhere:** species, class, background, feat, spell, item, condition, mastery, fighting style: all open in the same description drawer.

### 4.2 Level-up

Which class (own class or multiclass options with prerequisites shown) → Hit points (roll or average, with the result shown before confirming) → class choices as discovered → Review → Finish. Same stepper, same strap. Entered from the "Level up" tab-action on the sheet; Back and Cancel return to the tab the user came from.

### 4.3 Campaign

Create → Lobby (code, copy link, QR, rotate code, members with remove) → Party. Join: code or QR deep link → display name → pick or create a hero → Party. DM quick effects live on each party card (chip row: Damage · Heal · Temp HP · Condition · XP · Level · Item · Inspiration · Override) and open the member's sheet in a drawer. Table tab: session start/end, chat composer with visibility, roll feed. Settings: house rules, content packs (enable/disable/update), party-sheet visibility, export.

## 5. Visual direction: "Tavern Table" (concept A, decided)

- **Ground:** dark oak with procedural grain and a warm candle vignette. **Leaves:** parchment panels, slightly rotated, warm paper shadow. **Leather:** folio, straps, satchel, action strap. **Brass:** rails, frames, icon buttons, tabs, rivets. **Wax:** seals for pips, proficiency and selection.
- **Type:** Forum (display: names, section titles, big numbers) + Alegreya (body, italics for hints). Both verified Cyrillic (Google Fonts, 2026-11-02).
- **Semantic colour:** ember (HP, damage, danger), moss (healing, success), arcane violet (spell slots, magic, concentration), brass (accent, focus), coin metals (platinum, gold, silver, copper), rarity (common, uncommon, rare, very rare, legendary), damage types (13 hues used only on damage tags and spell school dots). Class colours exist as tokens but are used only to tint class icons (owner undecided; off by default).
- **Themes (token sets, runtime-switchable):** `tavern` (dark, the default), `scroll` (light: a vellum desk, the same leaves and brass, ink text), `plain` (high-contrast, no textures or ornaments, flat panels; for accessibility and weak devices). Textures and ornaments are decoration tokens whose intensity is 0 in `plain`.
- **Density:** `compact` (default) and `comfortable` as a spacing-scale preference.
- **Motion:** meaningful only (damage shake, seal spend, level-up flourish), all under reduced-motion and a user toggle.

## 6. Iconography

- **Set:** game-icons.net (CC BY 3.0, authors credited on the About screen), one style, inlined as an SVG sprite per route group. Custom ornaments (seals, satchel, strap, frames) are drawn by us.
- **The hint rule:** every icon-only control and every meaning-bearing glyph has `aria-label` and a tooltip (hover/focus, 300 ms) or long-press hint (touch, 400 ms). No inline legends anywhere.
- **Icon changes from concept A:** concentration keeps the original orb glyph (`concentration-orb`, violet; the owner tried an eye on 2026-11-02 and preferred the orb) with the hint "Concentrating on Bless, round 3"; spell slots → wax seals embossed with the level numeral (I, II, III…) with the hint "Spell slot, level 1 — 3 of 4 left"; javelin → a thrown spear glyph (`thrown-spear`), and in general weapons use weapon glyphs, never action glyphs. Individual icons are tuned in the final pass; an in-app icon picker is a Later idea.
- **Core vocabulary (icon → hint):** home `house`; heroes `person`; campaigns `three-friends`; library `open-book`; packs `chest`; settings `cog`; account `hood`; damage `broken-heart`; heal `healing`; temp HP `heart-armor`; roll `dice-twenty-faces-twenty`; short rest `campfire`; long rest `night-sleep`; level up `upgrade`; XP `laurels`; inspiration `inspiration`; concentration `third-eye`; condition `skull`; add `plus`; remove `minus`; edit `quill`; notes `scroll-unfurled`; export `share`; import `knapsack`; search `magnifying-glass`; filter `funnel`; pin `pin`; lock `padlock`; details `info`; equip `gauntlet`; unequip `gauntlet` (outlined state); attune `gem-pendant`; use `hand-ok`; spend `coins`; cast `fire-spell-cast`; prepare `spell-book`; AC `shield`; HP `heart`; speed `running-shoe`; initiative `stopwatch`; proficiency `medal`; save `checked-shield`; disadvantage `broken-arrow`; advantage `arrow-cluster`; coins `two-coins`; weight `weight`; bag `swap-bag`; attacks `crossed-swords`; spells `spell-book`; features `laurel-crown`; timeline `hourglass`; build `anvil`; play `crossed-swords`; DM `crown`; session `candle-flame`; join `entry-door`; leave `exit-door`; QR `treasure-map`; theme `sun`/`moon`; language `conversation`; abilities: STR `muscle-up`, DEX `acrobatic`, CON `heart-inside`, INT `brain`, WIS `owl`, CHA `charm`. Classes keep the existing sprite set (barbarian, lyre, holy-symbol, oak-leaf, crossed-swords, fist, templar-shield, bowman, hood, fire-spell-cast, pentacle, wizard-staff).

## 7. Components (the library the design system documents)

Shell: brass rail, nav icon button, app drawer (phone), top bar (phone), tab bar (phone), action strap (3 zones), tooltip, toast, banner (missing packs, campaign packs, update available).
Flow: stepper (vertical, compact), description drawer / bottom sheet, entity picker card (states: default, selected, gated with reason, disabled), search field, filter chip row, review list with edit links.
Sheet: parchment leaf (title, header actions, optional tabs inside), portrait frame, name plate, HP strap gauge (current, max, temp, damage/heal controls), shield badge (AC), stat tile, wax seal (sizes s/m/l; states filled, spent, disabled, selected; embossed glyph or numeral), pool bar (Lay on Hands), pip row, ability seal, saves row, skills list row (proficiency dot, expertise, disadvantage mark), attack row (roll button), spell row (level seal, cast button, always-prepared mark), feature row (source icon, level badge), condition chip (icon, name, duration badge, expand for −/+ and end), death-save tracker, inspiration toggle, XP bar.
Bag: satchel slot grid (slot with icon, qty plate, equipped tag, attuned gem, rarity rim), item ledger row (phone list variant), selected-item strip (Use, Attune, Equip, Details), coin pouch (4 metals, edit), weight strap, add-item sheet.
Dialogs: parchment dialog (title seal, body, strap of actions), bottom sheet (phone), confirm (destructive keeps text), number field (−/+), select, toggle, text field, textarea (notes).
Campaign: party card (portrait, HP strap, AC, conditions, concentration, quick-effect chips), roll feed row, chat composer with visibility, join-code plate with QR, member row.
Each component has states (hover, focus, active, disabled with reason, loading, error), both density presets, and all three themes.

## 8. Conditions with duration (owner fix 3)

A condition chip shows icon, name and a duration badge: "3 rounds", "1 min", "until short rest", "until long rest", or no badge when indefinite. Hover/long-press shows the full hint ("Poisoned, 3 rounds left, from Giant Spider"). Tapping the chip expands it: −/+ on rounds, "End" button, "Edit". The add-condition sheet asks: condition, level (when level-bearing, capped by the pack's levels), duration type and amount, optional source note.

**Round advance (owner decision 2026-11-02): in, DM-side.** In a campaign the DM has an "Advance round" control on the Party tab (and on the Table tab's session strip) that decrements every round-based duration of every party member by one; players see their chips update. A campaign house rule "Players manage their own conditions" (default on) lets a player end or edit their own conditions, for example after drinking a potion; when the DM turns it off, only the DM can end or edit conditions on linked heroes, and the player's chips show a lock hint "Managed by your DM". A solo hero (not linked) always has both the chip controls and its own "Advance round". This needs campaign-level events and a house-rule field; the Stage B rewrite records it as a carry for the engine/protocol, not a presentation-only change.

## 8a. Features that grant a choice show their options (owner comment, 2026-11-03)

Wherever a feature's text says "choose" (Weapon Mastery, Fighting Style, subclass, Channel Divinity options, Ability Score Improvement or feat, expertise, prepared spells), the feature carries a brass "N options" chip after its name. Hover, focus or long-press opens a parchment popover listing the options by name, each a link into the library, with a "See all in library" footer link that opens the library filtered to those entries. Applies to the library's class entries, the class picker's drawer, the description drawer and the Build tab alike; the count comes from the pack data for that character's pinned packs.

Truncated text never dead-ends (same comment thread): any feature, trait or spell summary cut with "…" is a link to that entity's own library entry, and hover, focus or long-press shows a popover with the full text and an "Open entry" link. Class features (Lay on Hands, Channel Divinity…) are entries of their own in the library's "Features" type, distinct from spells.

## 9. Features by source (owner fix 4)

The Features leaf lists everything granted automatically, grouped by source in this order: Class (with the level gained), Subclass, Species, Background, Feats, Chosen options (fighting style, masteries, expertise). Each row: source icon, name, level badge, details button; hover hint "From Paladin, level 3". Items and spells never appear here.

## 10. Home screen

Desktop: a "Continue" leaf (last opened hero: portrait, name, class and level, HP strap, campaign chip, Open button) and, when the hero is in a campaign with a live session, a "Tonight" note. Then a Heroes row (cards: portrait, name, class/level, HP, campaign), a Campaigns row (cards: name, role, members, session state), and a quick-actions strap: New hero, Join by code, Library, Import. Phone: the same, stacked. First run: the Continue leaf becomes an invitation with New hero and Join.

## 11. Owner calls (answered 2026-11-02)

1. Phone fourth tab named "Hero" (abilities, saves, skills, proficiencies, features) — **accepted**.
2. Class colours: tokens exist, used only to tint class icons — **off for now**.
3. "Advance round" — **in, DM-side**, with the "Players manage their own conditions" house rule (see §8).
4. Roll log and notes as drawers on the sheet — **provisionally yes**; the owner decides on the drawer designs in the screens phase.

## 11a. Later ideas (kept light; a separate board closes Stage A)

Companions and familiars with mini-sheets; Druid Wild Shape switcher; DM encounter board (enemy HP, initiative, conditions; UI only, last priority); DM session screen with quick effects; loot distribution and coin split; session journal with NPC tags; quest tracker; DM shop; level-up preview; death-save screen; party inventory; DM handouts over the image relay; NPC roster; whisper to DM; printable sheet; 3D dice; an in-app icon picker so the owner can swap any icon without code; other-TTRPG theme packs (space, Call of Cthulhu).

## 12. What the builder gets after approval

Design system (tokens.json → `packages/ui-tokens`, component guidelines, icon vocabulary), the canvas (concept A v2 boards, navigation model, home, shell), this spec, and the audit catalogue as the defect checklist. Stage B tasks in plan 17 are rewritten from these at the gate.
