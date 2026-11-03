Herokeep is the tabletop-RPG companion for one group: a character builder, a play sheet and a campaign table that the same people open on a 1440 desktop at home, a tablet and a 390 phone at the table, in English and Ukrainian. The look is **"Tavern Table"**: a leather folio and loose parchment leaves lying on a dark oak table at night, lit by candles, with brass, leather and wax for every control. Game-UI level 4.5 of 5: material and tactile, never glossy.

## Who it is for and the principles

Built for players and DMs mid-session, often one-handed on a phone, and for the owner's group first.

1. **At the table first.** The Play sheet shows the live reads (HP, AC, speed, saves, attacks, resources, conditions, spells, bag) without opening anything: one screen at 1440, the combat reads above the fold at 390.
2. **Objects, not cards.** Panels are parchment leaves on a table (`Leaf`); controls are brass, leather and wax. Body text always sits on a solid leaf; textures never run under paragraphs. No flat white cards, no generic drop-shadow cards, no neon, no blue, no gradient washes.
3. **Icon-first, hint-backed.** Repeated controls are `IconButton`s with a `Tooltip` (hover/focus, 300ms) or long-press hint (touch, 400ms) and an `aria-label`. Primary flow actions keep icon + text. Destructive actions keep text.
4. **Meaning is never a legend.** Any glyph that encodes state explains itself on hover/long-press. Inline legends are removed everywhere.
5. **Stable action bar.** One `ActionStrap` at the bottom of every screen with fixed zones; a given action never changes slot between steps or tabs.
6. **Longest string wins.** Design every label at the Ukrainian length; icons carry the rest. Truncate with an ellipsis plus a tooltip, never clip.
7. **Nothing hides behind a giant scroll.** A region that grows past one screen becomes `Tabs` or a `DescriptionDrawer`, never a 6,000px page.

## Foundations: the materials

Five materials carry the whole UI. Use them by role, never decoratively.

| Material | Role | Tokens |
| --- | --- | --- |
| Ground (oak) | the table under everything; never behind body text | `ground`, `texture-wood-tint`, `vignette-tint` |
| Leaf (parchment) | every panel that carries text: sheets, pickers, dialogs, tooltips, drawers | `leaf`, `leaf-glow`, `leaf-dark`, `leaf-sunken`, `leaf-edge`, `texture-parchment-tint` |
| Leather | folio, straps, satchel, action strap, tab bar, dark buttons | `leather`, `leather-highlight`, `leather-dark`, `leather-light`, `leather-edge`, `plate`, `slot`, `recess`, `stitch`, `texture-leather-tint` |
| Brass | rails, frames, rivets, buttons, tabs, icons on leather, proficiency dots | `brass`, `brass-top`, `brass-mid`, `brass-bottom`, `brass-shadow`, `rivet-*`, `border-brass` |
| Wax | seals for pips, spell slots, proficiency, selection, done-steps | `wax`, `wax-light`, `wax-dark`, `wax-rim*`, `wax-ink`, `wax-emboss`, `wax-spent*` |

Draw a brass fill as `linear-gradient(180deg, brass-top 0%, brass 45%, brass-mid 80%, brass-bottom 100%)` with `shadow-brass`; a leather fill as `leather-highlight` to `leather-dark`; a leaf as a radial `leaf-glow` 0% / `leaf` 55% / `leaf-dark` 100% with `shadow-leaf`. In the plain theme every gradient collapses to a flat fill because its stops share one value.

## Themes

Three runtime-switchable token sets on `<html data-theme>`; `tavern` is first and default.

- **tavern** (dark): oak ground, parchment leaves, candle vignette, textures and ornaments on.
- **scroll** (light): a vellum desk (`ground` #d6c6a0), lighter leaves, the same leather and brass, ink text everywhere; textures softer, vignette faint.
- **plain** (high contrast, flat): near-black ground, white leaves, 7:1 ink, solid borders at 3:1, textures, rivets, stitches, tilt and vignette off (`*-tint`, `rivet-*`, `stitch` are transparent; `ornament-level` 0). Use it for accessibility and weak devices.

Every text token's usage note names the grounds it reads on; every such pair holds 4.5:1 in all three themes (3:1 for 24px+ numerals, borders, focus rings, icons and marks). Set `ornament-level` and the texture intensities per theme in `ui-tokens` as the `decoration` notes say.

## Colour rules

- **Ink on parchment:** `text-1` for copy, `text-2` for headers and hints (italic), `text-3` for placeholders. Brass-coloured text on a leaf is `link` (never `brass`); brass icons and dividers on a leaf are `accent-strong`.
- **On leather:** `text-on-leather` for values and names, `text-on-leather-2` for gold labels, `text-on-leather-3` for muted sub-captions; glyphs in `brass` or `brass-top`.
- **On brass:** `text-on-brass` only.
- **Semantic:** `ember` = HP, damage, destructive, failure (`danger-strong` as text on leaf, `danger-on-leather` on leather, `danger-soft` tints). `moss` = healing, success, death-save success (`success-strong` text, `success-soft` tint). `arcane` = spell slots' ribbon, magic, concentration, attunement (`arcane-strong` text and chip fill, `arcane-light` on leather, `arcane-soft` tint). `warning` + `warning-soft` for banners.
- **Coins** `coin-platinum/gold/silver/copper` (+ `-shade`) only on coin discs and badges. **Rarity** `rarity-*` only as slot rims and item-name tints beside the word. **Damage types** `damage-*` only on damage tags and spell-school dots, always beside the word. **Class** `class-*` exist as tokens and may tint class icons; off by default.
- State colours always come with a shape or word: filled seal vs pale ring, filled vs hollow dot, a glyph on a chip, a word on a status chip. Never hue alone.
- Keep brass restrained: frames, rails, buttons and icons, not whole backgrounds.

## Typography

Two Google families, both with verified Cyrillic (2026-11-02): **Forum** (`display`) for names, section titles, tab labels and every number that matters; **Alegreya** (`body`) 400/600/700 with italics for hints. Load `Forum` and `Alegreya:ital,wght@0,400;0,600;0,700;1,400`.

- Scale: `display-xl` 48/52 (hero name), `display-l` 32/36 (screen titles), `display-m` 24/28 (wordmark, dialog and drawer titles, name plate), `display-s` 20/24 (leaf titles, picker titles); `numeral-xl` 56/56, `numeral-l` 40/40, `numeral-m` 24/24 with `font-variant-numeric: tabular-nums` for HP, AC, modifiers, to-hit and damage; `body` 16/24 (phone floor and descriptions), `body-s` 14/20 (desktop floor: rows, chips, tooltips), `caption` 13/18 (phone tab-bar labels and save abbreviations only), `hint` 12/16 italic (a tooltip's second line, a badge sub-label; never the only copy of a meaning), `button` 15/20 600 (phone buttons take 16px).
- HP and AC are the biggest glyphs on the board. Use a real minus sign (−) for negative modifiers and locale thousands separators.
- No ALL-CAPS labels. No letter-spaced small caps. Italics mean "hint".

## Spacing, radius, shadow, decoration

- **Spacing** on a 4px grid: `space-1` 4 (seal-to-label, chip inner gap), `space-2` 8 (rows in a leaf, chips, icon-to-label), `space-3` 12 (blocks in a leaf, phone leaf padding), `space-4` 16 (leaf padding 16/18), `space-5` 24 (gap between leaves), `space-6` 32, `space-7` 48, `space-8` 64.
- **Radius:** `radius-seal` 999 (pills, buttons, icon buttons, seals, gauges, dots), `radius-leaf` 6 (leaves, chips, tooltips, wells), `radius-slot` 8 (satchel slots, phone action tiles), `radius-frame` 12 (portrait frame, dialogs, picker cards), `radius-strap` 14 (straps, satchel top, bottom sheets). `radius-s/m/l` are aliases of leaf / frame / strap for the existing names. (The concept boards drew leaves at 2px; the system settles on 6px.)
- **Shadow:** `shadow-leaf` (paper on the table: hairline + warm drop down-right), `shadow-raised` (leather objects above the table: folio, satchel, rail, dialogs), `shadow-inset-slot` (recessed leather), `shadow-brass` (the bevel on every brass fill), `shadow-strap`, `shadow-tooltip`, `shadow-glow-brass` (selected), `shadow-focus` (the focus ring). Leaves never get a generic drop shadow; they are rotated by `leaf-tilt` (±0.2–0.35°, alternating) instead.
- **Decoration:** `texture-wood` / `texture-parchment` / `texture-leather` are feTurbulence overlays whose ink is the per-theme `texture-*-tint` (alpha = intensity; parchment stays at 7.5% so luminance under text varies under 8%); `ornament-level` 2 = rivets, stitches, tilt, vignette; 0 in plain. Draw rivets with `rivet-light/rivet/rivet-dark` and stitching as a 1px dashed `stitch` outline inset 5–8px.
- **Motion:** `duration-fast` 120ms (hover, press, tooltip), `duration-base` 240ms (drawers, sheets, tabs, seal spend), `duration-slow` 400ms (damage shake, level-up flourish). Meaningful only; all collapse to 0 under `prefers-reduced-motion` and the user's motion toggle. The candle flicker is decoration and obeys the same.

## Iconography

- **Set:** game-icons.net (CC BY 3.0; credit the authors on the About screen). One style, inlined as an SVG sprite per route group, `fill="currentColor"`, 512 box; the nine disc-style glyphs are used with their discs stripped. Custom ornaments (seals, satchel, straps, frames, shield, coin stacks) are drawn by us as inline SVG with token-bound classes. `IconVocabulary` lists every glyph with its hint.
- **The hint rule:** every icon-only control and every meaning-bearing glyph has `aria-label` and a tooltip (hover/focus, `hint-delay-hover`) or long-press hint (touch, `hint-delay-touch`). No inline legends anywhere; a "?" help popover may repeat them.
- **Changes from the concept:** concentration keeps the concept's orb glyph `concentration-orb` in `arcane-strong` ("Concentrating on Bless, round 3"; the owner reverted the spec's eye); spell slots = wax seals embossed with the level numeral I, II, III ("Spell slot, level 1 — 3 of 4 left"); javelin = `thrown-spear`, and weapons always use weapon glyphs, never action glyphs.
- **Core vocabulary:** home `house`, heroes `person`, campaigns `three-friends`, library `open-book`, packs `chest`, settings `cog`, account `hood`; damage `broken-heart`, heal `healing`, temp HP `heart-armor`, roll `dice-twenty-faces-twenty`, short rest `campfire`, long rest `night-sleep`, level up `upgrade`, XP `laurels`, inspiration `inspiration`, concentration `concentration-orb`, condition `skull`, add `plus`, remove `minus`, edit `quill`, notes `scroll-unfurled`, export `share`, import `knapsack`, search `magnifying-glass`, filter `funnel`, pin `pin`, lock `padlock`, details `info`, equip/unequip `gauntlet`, attune `gem-pendant`, use `hand-ok`, spend `coins`, cast `fire-spell-cast`, prepare/spells `spell-book`, AC `shield`, HP `heart`, speed `running-shoe`, initiative `stopwatch`, proficiency `medal`, save `checked-shield`, disadvantage `broken-arrow`, advantage `arrow-cluster`, coins `two-coins`, weight `weight`, bag `swap-bag`, attacks/play `crossed-swords`, features `laurel-crown`, timeline `hourglass`, build `anvil`, DM `crown`, session `candle-flame`, join `entry-door`, leave `exit-door`, QR `treasure-map`, theme `sun`/`moon`, language `conversation`; abilities STR `muscle-up`, DEX `acrobatic`, CON `heart-inside`, INT `brain`, WIS `owl`, CHA `charm`; classes `barbarian`, `lyre`, `holy-symbol`, `oak-leaf`, `crossed-swords`, `fist`, `templar-shield`, `bowman`, `hood`, `fire-spell-cast`, `pentacle`, `wizard-staff`.
- Glyph colour follows the surface: `accent-strong` on parchment, `brass`/`brass-top` on leather, `text-on-brass` on brass. Decorative glyphs are `aria-hidden`; standalone meaningful glyphs are `role="img"` with the hint as their label.

## Component rules (which tokens where)

- **Shell.** `NavRail` (desktop/tablet, 60px `rail-height`, leather + brass bar, six `IconButton`s, campaign chip, account); phone top bar + `Tabs` bar (60px `tab-bar-height`) + app drawer. `ActionStrap` on every screen: zone 1 Exit (ghost-leather Cancel, leather Back), zone 2 Primary (ember Damage, moss Heal, brass Roll, leather rests; brass Next → "Create hero"/"Finish level up"), zone 3 Secondary icon-only with hints; the page reserves `strap-height`. `Tooltip`, `Toast`, `Banner` are parchment slips (`leaf`, `shadow-tooltip`).
- **Flow.** `Stepper` (vertical leaf on desktop, wax seals for done steps; a leather strip on phone), `PickerCard` (parchment, `radius-frame`, selected = brass ring + wax seal, gated = listed, disabled, reason in `danger-strong` and in the hint), `SearchField` + `FilterChips` at the top of every picker, `DescriptionDrawer` (right drawer / bottom sheet) for every description, `Dialog` with a wax title seal and a leather strap of actions.
- **Sheet.** `Leaf` sections with `display-s` titles and header actions; `PortraitFrame` + brass name plate; `HpGauge` leather strap (`numeral-xl`, ember fill, brass temp hatch); `ShieldBadge` brass heater shield (`numeral-l`); `StatTile` sunken plates; `WaxSeal` for every pip and slot; `PoolBar` resource blocks on `leaf-sunken`; `AbilitySeal` (modifier embossed, score on brass, save on leather with a star); `SkillRow` (dot, expertise double ring, disadvantage mark, roll); `AttackRow` (weapon glyph, `numeral-m`, damage tag in `damage-*`); `SpellRow` (level seals with numerals, orb chip, fleur-de-lys always-prepared); `FeatureRow` grouped by source (class with level badge, subclass, species, background, feats, chosen options; items and spells never here); `ConditionChip` with a duration badge, expandable to −/+, Edit, End; `DeathSaves`, `InspirationToggle`, `XpBar`.
- **Bag.** `SatchelGrid` (desktop: open satchel, 4×4 slots with `hk-qty`, E tag, gem, rarity rim, selected ring, the selected-item strip Use · Attune · Equip · Details), `ItemRow` ledger on phones, `CoinPouch`, `WeightStrap`.
- **Campaign.** `PartyCard` (portrait, HP strap, AC, conditions, concentration orb, DM quick-effect chips), plus roll feed rows, chat composer and join-code plate built from `Leaf`, `Button`, `NumberField` and `SearchField`.
- Buttons: one brass primary per zone; parchment for secondary on leather; leather for secondary on parchment; ghost for tertiary; ember only for Damage and destructive verbs (text kept); moss only for Heal. Loading shows the spinner in place of the glyph; disabled explains itself beside the button and in `title`.

## Accessibility floor

- Contrast 4.5:1 for text against what is actually behind it (textures included); 3:1 for text ≥ 24px, borders, focus rings, icons and marks. All token pairs in `tokens.json` meet this in every theme; `plain` meets 7:1 for ink.
- Touch targets 44px on touch (`control-phone`, `touch-target`), 36px hit areas on desktop pointers (30px visual + 4px inset).
- Focus: `shadow-focus`, a two-tone ring (pale `focus-ring` inside, dark `focus-ring-outer` outside) on `:focus-visible` of every control, so it reads on leaf, leather and brass alike. Never remove it.
- Real elements: `<button>`, `<a href>`, `<input>` + `<label>`; never a clickable `<div>`. Dialogs and drawers trap focus and return it; Escape closes.
- Reduced motion: all durations to 0, no flicker, no tilt.
- Colours that encode state differ in lightness or carry a shape/word; blue/orange over red/green where a pair must be told apart (rarity rare vs legendary, cold vs fire).

## Density presets

`compact` (default) and `comfortable` as a spacing-scale preference: row heights `row-compact` 28px vs `row-comfortable` 36px, block gaps `space-2` vs `space-3`, picker cards 220×150 vs 240×170, two-column folio lists vs one column. Control heights do not change with density (30 desktop, 40 strap, 44 phone).

## Copy rules

Sentence case everywhere; verbs first on buttons ("Add condition", "Apply 7 damage", "Create hero"); no ALL-CAPS, no "→" in button text, no middle-dot meta strings as a styling tic (a single "·" between facts is fine). No legends: write the meaning into the hint ("Proficient (+3)", "Spell slot, level 1 — 3 of 4 left", "Poisoned, 3 rounds left, from Giant Spider", "From Paladin, level 3"). Disabled controls say why ("Choose a species first", "Level up: not available, 6,500 of 14,000 XP"). Numbers are the pack's numbers; names are the pack's names through the Localizer; every user-visible string goes through i18n. English and Ukrainian are first-class: design at the Ukrainian length.

## Mapping to `packages/ui-tokens`

Keep the existing names as primary or alias: `surface-0..3` → `ground`, `leaf`, `leaf-sunken`, `leaf-edge`; `text-1..3` unchanged (ink on leaf); `accent`/`accent-strong`/`accent-contrast` → `brass`/dark brass/`text-on-brass`; `border-1` → `leaf-edge`; `danger`/`success`/`warning`/`overlay` unchanged in meaning; `space-1..6` unchanged (+7, 8); `radius-s/m/l` = 6/12/14; `duration-s/m` = 120/240 (+ `duration-slow`); `focus-ring` is now a two-tone `shadow-focus`. Replace `font-body`/`font-display` (Inter / Philosopher) with `body` (Alegreya) and `display` (Forum). Add the new families beside them: leather, brass, wax, ember, moss, arcane, coins, rarity, damage, class, textures, decoration, size. Per-theme numbers the page cannot hold (texture intensities, `ornament-level`, `leaf-tilt`) go into the theme blocks as the decoration notes state.
