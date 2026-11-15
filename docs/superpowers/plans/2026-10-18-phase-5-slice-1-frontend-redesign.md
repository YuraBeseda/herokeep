# Phase 5 Slice 1 — Frontend Redesign (Design-First) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Stage A runs as a design exercise (Claude Design artifacts via the Artifact tool, `quickstart` with `intent: "design"`), gated on explicit OWNER APPROVAL; Stage B then runs with superpowers:subagent-driven-development task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**STATUS: EXECUTED 2026-11-15 (Stage A approved 2026-11-03; Stage B tasks B1-B16 built on branch `worktree-phase-5-plan17-redesign`, awaiting merge). Deviations: one icon sprite, not one per route group (R11; 168 kB raw, 72.4 kB gzip, async); fonts load on use and are not preloaded; the bundle gate now follows static imports, so the initial bundle measures 371.3 kB gzip (the earlier 368.4 was not like-for-like). Owner-flags and follow-ups: `docs/03-roadmap/phases.md`, "Phase 5 follow-ups". Gate numbers: `docs/README.md`. The approved additions that need engine/protocol/API work are the separate plan `docs/superpowers/plans/2026-11-03-phase-5-slice-2-approved-additions.md`.**

**Stage A progress (2026-11-02):**

- Owner brief captured (batched questions, 18 answers): game-UI level 4.5/5 with textures; desktop → tablet → phone priority; icon-first with hints; screens may be regrouped; "Later" ideas kept light; the DM encounter board is UI-only and last priority.
- A1 UX audit DONE: 111 screen states × en/uk × 1280/390 captured against the production build with the e2e sync setup; `inventory.md` (10 worst defects, cross-cutting DOM measurements, per-screen findings) and `actions.md` (263 controls with i18n keys) — kept in the session scratchpad `audit/`, summarised in the foundations spec and in the Stage B task rewrite at the gate.
- A3 visual direction DECIDED: six genuinely different concepts (A Tavern Table, B Illuminated Codex, C Arcane HUD, D Woodcut Chapbook, E Pixel Tavern, F Card Table) were built on the same two pages (desktop Play sheet in en, phone Combat tab in uk) in the canvas "Herokeep UI concepts" (https://claude.ai/artifact/E4qnyAx7vou6m9xSiBbD1Y); **owner chose A** with four fixes (hover-hint rule instead of legends; eye glyph for concentration, level-numeral wax seals for spell slots, weapon glyphs for weapons; condition durations; features grouped by source). B–F were removed from the canvas.
- A2 + A5 CHECKPOINT 2 delivered for review: foundations spec `docs/superpowers/specs/2026-11-02-frontend-redesign-foundations.md` (app map, navigation by device, Back/Next/Cancel semantics, the three-zone action strap, wizard and level-up flows, themes tavern/scroll/plain, icon vocabulary and the hint rule, component inventory, condition duration, features by source, home; four open calls in §11); canvas boards: A v2 (fixes applied), app map and navigation model, action-strap contract, home desktop/phone, phone drawer, tablet sheet; the design system artifact "Herokeep" (https://claude.ai/artifact/NQqWVahejkKzMnQV34PRWy: `tokens.json` with 141 colour tokens across tavern/scroll/plain, Forum + Alegreya type scale, spacing/radius/shadow/decoration/duration families with the current `ui-tokens` names kept as aliases; 37 components with guidelines and live previews; the icon vocabulary with its hint text; 561 contrast pairs checked).
- Checkpoint 2 APPROVED 2026-11-02 (concentration glyph stays the orb; phone fourth tab "Hero"; class colours off; round advance in as a DM control with the house rule "Players manage their own conditions"; notes and roll log as drawers, judged on the screen boards).
- A4 CHECKPOINT 3 delivered 2026-11-02 for review: every remaining screen designed on desktop (1440, en) with phone boards (390 × 844, uk) for the core flows — 61 new boards on five canvas pages: new-hero wizard (W01–W10 + 3 phone), Build/Timeline/level-up/drawers/dialogs (B01, T01, L01–L04, D01–D03, DL01–DL05 + 4 phone), campaigns (C01–C11 + 3 phone), library/packs/homebrew/heroes/settings/auth/states (LB01–03, PK01–05, H01, ST01, AU01, X01 + 3 phone). Every board reuses the design system's `tokens.css` + `bundle.css` and the concept-A materials; each group's `notes.md` carries a coverage table (audit screen ids → boards, audit defects → fixes, every `actions.md` control → its new home) and the invented uk strings for the i18n pass. Tablet variants beyond the sheet, the remaining phone screens and the "Later" ideas board follow checkpoint 3 approval.
- Checkpoint 4 (2026-11-03): the remaining phone boards for every screen (wizard 10, sheet 16 incl. the Hero tab, campaigns 12 with the encounter plate, library/packs/settings/auth/states 12), tablet boards for the species picker, DM party, library and home, and a sixth canvas page of ten "Later ideas" sketches (companion mini-sheet, Wild Shape switcher, DM encounter board, loot split, journal, shop, death saves, printable sheet, 3D dice, theme packs incl. other games) with a per-idea cost note (UI only / campaign events / engine + pack format). Canvas: 119 boards on six pages. Awaiting the owner's final Stage A review.
- Checkpoint 3 comment pass 1 (2026-11-03): the owner left 14 anchored comments on the canvas; each was applied, republished and resolved, and the rules they establish were added to the foundations spec (§1 4a/4b, §4.3 house rules, §8a): features that grant a choice show their options in a popover; truncated summaries link to their entry; no inline disabled reasons and no narrative captions; one tick marker for chosen spells; concentration tooltip on the orb; house rules for starting gold, multiclassing (level-up skips the class step when off) and player-added items; encounters inside a session carry the round counter; custom and homebrew items get an icon picker with upload. Stage B carries: the three new house-rule fields, encounter events, item icon storage with pack images.

**Goal:** Replace the current "testing UI" with a complete, coherent frontend: redesigned information architecture and navigation, a compact game-like fantasy visual theme with textures, icon-first controls with hover hints so the UI works equally well in en/ru/uk, a real mobile version, verified text fit in every locale, and the accumulated UX defects fixed (buttons that move between pages, Back/Next landing on wrong pages, descriptions that do not show, the poor character-creation flow) — designed first in Claude Design and moved to code only after the owner's approval.

**Architecture:** Two stages with a hard gate. **Stage A (design)** produces reviewable artifacts in Claude Design: a UX audit of every screen and flow with the known defects catalogued, the target information architecture and navigation model, the visual direction (tokens, textures, icon system, typography that fits Cyrillic), per-screen desktop and mobile designs with longest-string text-fit checks, and a component library spec. **Gate:** the owner approves (or iterates) each artifact; nothing in Stage B starts until the approval is recorded in the ledger. **Stage B (code)** rebuilds the Angular frontend on the approved designs: design tokens and theme packs in `packages/ui-tokens`, an icon + tooltip system, the app shell and stable action bars, the creation wizard, the sheet tabs, campaigns, library/packs/homebrew/settings, an automated text-fit harness per locale, a mobile Playwright project, axe across every screen. Engine, protocol and API are untouched; the event model and all existing behaviours (gates: specs, e2e, goldens) stay green throughout.

**Tech Stack:** Angular 22 zoneless, SCSS + `packages/ui-tokens` (typed token source → `tokens.css`/`tokens.scss`), Transloco i18n (en/ru/uk), Playwright (+ a mobile project), axe. Claude Design for Stage A. No new runtime dependencies without a ruling (an icon set may be vendored as SVG sprites — licence recorded in the attribution screen).

**Spec:** `docs/02-architecture/09-frontend-architecture.md`, `06-i18n.md`, `docs/00-vision-and-scope.md`, the roadmap Phase 5 row (`docs/03-roadmap/phases.md:15`), `docs/manual-device-checklist.md` (the manual pass that found most of the UX defects), the Stage A artifacts once approved (their links are recorded in the ledger and in this file's "Approved designs" section at the gate).

## Global Constraints

- Repo non-negotiables (CLAUDE.md): structural i18n — no user-visible string literals; every new UI string ×3 (en/ru/uk); icons never replace text without an accessible name (`aria-label`) and a visible hint on hover/long-press; rules are DATA (the redesign changes presentation only — no 5e logic moves into components); events immutable (no event or reducer changes in this plan); TDD red-first for every behavioural fix (navigation, wizard flow, description rendering) with captured RED; Conventional Commits with scope; a commit ends with the attribution trailer the running session prescribes, if any; each commit typechecks alone.
- Design tokens are the single source of visual truth: colours, spacing, radii, typography, textures and motion live in `packages/ui-tokens` and are consumed through `tokens.scss`/CSS variables; components never hard-code colours. Theme packs (parchment, arcane, plus the existing default) are token sets, switchable at runtime.
- Accessibility floor: WCAG AA contrast (4.5:1 text, 3:1 UI) on EVERY theme and texture (the axe e2e gate runs per theme); focus visible; touch targets ≥ 44 px on mobile; reduced-motion respected; every icon-only control has `aria-label` + tooltip; keyboard reachable.
- Text fit: the longest translated string per key (across en/ru/uk) must render without overflow/clipping at the smallest supported viewport (360 × 640) and the default desktop width; an automated harness (Stage B) asserts it for every screen.
- Mobile: supported viewports 360–430 px wide (phone) and 768+ (tablet/desktop); layouts are designed for both in Stage A; the mobile Playwright project runs the core flows (create, play, level-up, campaign join) at 390 × 844.
- Behaviour preservation: existing offline e2e (31), sync e2e (8 → 9 after plan 16), web specs and goldens stay green; selectors may change (update tests in the same task), behaviours may not — except the UX defects this plan fixes, each with a RED test.
- Baselines at plan start (main @ de2a541): root 145 / 2102; web 147 / 1749; api CF 8 / 40 + 1; offline e2e 31/31; sync 8/8; gzip 344.8 / 600 kB (textures and icons must keep the initial bundle under budget — lazy-load theme assets; SVG sprite per route group).
- Execution notes: PowerShell FOREGROUND for pnpm; known web flakes retry once; worktree deletion needs the robocopy /MIR trick.

## Design rulings (baked in — verify cited data, do not re-litigate)

1. **Design before code, with an owner gate.** Stage A artifacts are produced in Claude Design and reviewed by the owner; the ledger records `GATE: Stage A approved <date> <artifact links>` before any Stage B dispatch. Stage B task texts marked PROVISIONAL below are rewritten from the approved designs before dispatch (the controller edits this plan file in the branch and commits the revision as `docs(plans): stage B tasks from approved designs`).
2. **Icon-first, text-backed.** Controls that repeat across screens (save, back, next, add, remove, equip, attune, cast, rest, roll, edit, pin) become icon buttons with a tooltip (hover/focus, and long-press on touch) and `aria-label`; destructive actions keep a text label; primary flow actions (Create, Confirm, Level up) keep text + icon. The icon vocabulary is one set, documented in the component spec.
3. **Stable action bars.** Every screen has one action bar with fixed positions for Back/Next/Save/primary actions; the same action never changes position between steps or tabs (the current "buttons move between pages" defect). Mobile: a bottom bar; desktop: a right-aligned bar in the same order.
4. **Navigation semantics fixed once.** Back = previous step/screen in the user's path (history-aware), Next = the next unanswered step, Cancel = leave the flow with confirmation if dirty; deep links restore the right tab/step. The wizard and level-up share one stepper component and one step-ordering rule (plan 13's sorted choice steps), and "Next" never skips an unanswered step.
5. **Descriptions always available.** Every entity shown anywhere (species, class, background, feat, spell, item, condition, mastery) has a description surface: inline expandable on desktop, a bottom sheet on mobile; Markdown through the existing sanitizing renderer with the character's scoped localizer; the "descriptions don't show" defect gets a RED test per surface.
6. **Compact, game-like, textured — but data-dense first.** Density presets (compact default, comfortable) are a token preference; textures are low-contrast backgrounds that never sit behind body text without a solid panel; the sheet's play tab fits the common at-the-table reads (HP, AC, speeds, saves, attacks, spells, resources) above the fold on a 390 px phone.
7. **i18n-fit by construction.** Labels that cannot be iconised are designed at the longest locale string; Cyrillic typography (ru/uk) is chosen in Stage A with the same metrics; truncation uses ellipsis + full text in a tooltip, never clipping.
8. **No feature additions.** New capabilities (new rules, new sync features) are out of scope; a UX defect fix that needs engine/protocol work is recorded as a carry.
9. **Owner decisions stay the owner's:** home screen contents, the final theme look, which text becomes icons, the mobile tab order — all decided in Stage A review, not by the executor.

## Review Focus

1. Creating a character on a 390 px phone in uk (longest strings): every step readable, no clipped labels, Back/Next always in the same place, every choice step reached in order, descriptions openable for every option (Stage B wizard task).
2. A user switching theme to the textured parchment on desktop: every screen passes axe AA (text and UI contrast) — the per-theme axe gate (Stage B theme task).
3. Deep link to `/c/:id/level-up` mid-flow then Back: returns to the sheet tab the user came from, never to a wrong step (Stage B shell task).
4. The spell list, inventory and attacks on the play tab at 360 px: no horizontal scroll, icon controls have tooltips and labels, long item names ellipsise with a tooltip (Stage B sheet task).
5. Existing flows (31 offline e2e, sync e2e) keep passing after every Stage B task — selectors updated, behaviours unchanged (every Stage B task).

---

## Stage A — Design in Claude Design (owner-gated)

Each artifact is a Claude Design (or Claude Docs for text) artifact created with the Artifact tool (`quickstart` → `intent: "design"` for screens, `intent: "document"` for the audit), linked in the ledger, iterated with the owner's comments until approved.

### Task A1: UX audit and defect catalogue

- [x] Step 1: Inventory every route/screen/dialog (from `app.routes.ts` and the views folders) with a screenshot at desktop and 390 px in en and uk (Playwright script, scratch — not committed). (2026-11-02: 111 screen states, 207 captures.)
- [x] Step 2: Catalogue defects with reproduction paths: moving buttons, Back/Next misroutes (incl. the plan-13 wizard step-order history), descriptions not shown, text overflow per locale, mobile breakage, discoverability gaps (gated options, pack features), a11y findings from the existing axe runs and the manual checklist. (2026-11-02: `audit/inventory.md`.)
- [x] Step 3: Publish the audit document; owner review. (Summarised to the owner 2026-11-02; the owner had already reported the UI as unusable — overlapping buttons, hidden text, no room for information — which the audit confirmed in detail.)

### Task A2: Information architecture and navigation model

- [ ] Step 1: Propose the home screen, primary navigation (solo characters, campaigns, library, packs, settings), the sheet's tab set and order, campaign screen grouping, and where homebrew/packs live; define the stable action-bar contract (ruling 3) and navigation semantics (ruling 4) as a one-page spec; wizard and level-up flow maps (steps, review, where descriptions appear).
- [ ] Step 2: Publish; owner review.

### Task A3: Visual direction and token system

- [x] Step 1: Two or three visual directions (compact fantasy: parchment, arcane, dark-slate) as Claude Design boards: palette, textures, typography (Latin + Cyrillic), iconography style, density presets, motion principles; contrast tables per direction. (2026-11-02: six directions A–F, each a full desktop sheet + uk phone board; Cyrillic coverage of every candidate font verified against Google Fonts the same day.)
- [x] Step 2: Owner picks the direction and theme set; publish the token specification (names, scales, semantic roles) mapped onto `packages/ui-tokens`. (2026-11-02: A "Tavern Table" chosen; themes tavern / scroll / plain; token spec = the "Herokeep" design system artifact's `tokens.json`, pending owner review at checkpoint 2.)

### Task A4: Screen designs (desktop + mobile, longest-string text fit)

- [x] Step 1: Design every screen from A1's inventory in the chosen direction: characters list/home, creation wizard (every step type: abilities, species, class, background, choice/picker, equipment, review), play tab, build tab (incl. Packs/Options sections), timeline, level-up, campaign lobby/party/member sheet/DM tools/log/settings, library browse/detail, packs list/trust dialog/detail/homebrew forms, settings, dialogs (cast, rest, add item, rebase report). (2026-11-02: desktop for every screen, canvas pages 2–5.)
- [ ] Step 2: Each screen at desktop and 390 px with the longest uk/ru strings filled in; annotate icon/tooltip usage and the action bar. (Phone boards exist for the core flows: wizard species/abilities/review, build, level-up class, roll log, add condition, party DM, table, join, library, packs, settings; the rest of the phone set and tablet variants follow checkpoint 3.)
- [ ] Step 3: Owner review (iterate until approved).

### Task A5: Component library spec

- [x] Step 1: Buttons (icon/text/primary/destructive), action bar, stepper, cards, lists/tables, pickers (entity picker with gating/reason), forms and fields, dialogs/bottom sheets, chips/badges, tooltips, banners/toasts, tabs; states (hover, focus, disabled with reason, loading, error); density variants; a11y notes per component. (2026-11-02: the "Herokeep" design system artifact — 37 components with guidelines and live previews in three themes.)
- [x] Step 2: Publish; owner review. (Published 2026-11-02 at checkpoint 2; approved with the orb-icon correction.)

### GATE — Owner approval

- [x] **GATE: Stage A approved 2026-11-03** by the owner. Artifacts: canvas "Herokeep UI concepts" https://claude.ai/artifact/E4qnyAx7vou6m9xSiBbD1Y (slug `69d01a76-ac1e-4d11-949c-895b1401e21f`, 119 boards on 6 pages, version `1793677666-9355`); design system "Herokeep" https://claude.ai/artifact/NQqWVahejkKzMnQV34PRWy (slug `ad63e9b9-e393-463e-bade-c16875a70d8a`); repo handoff `docs/superpowers/design/2026-11-stage-a/` (tokens, component CSS and guidelines, board sources, audit, notes, icon list); spec `docs/superpowers/specs/2026-11-02-frontend-redesign-foundations.md`. The Stage B tasks below were rewritten from these on 2026-11-03 (`docs(plans): stage B tasks from approved designs`).

---

## Stage B — Implementation (rewritten from the approved designs 2026-11-03; subagent-driven)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development, one task per fresh subagent with a reviewer gate, on a worktree branch `phase-5-plan17-redesign`. Before dispatching, read `docs/superpowers/design/2026-11-stage-a/README.md` (the handoff) and the spec. Every task brief must carry: the board names it implements (read them from the canvas with the claude-artifacts MCP `read_file` or from `boards/<group>/*.src.html`), the design-system component READMEs it uses (`design-system/components/<Comp>/`), and the audit ids it fixes (`audit/inventory.md`).

**Stage B architecture (decided 2026-11-03):**

- **New component library, rebuilt views, untouched stores.** The new components live in a NEW folder `apps/web/src/app/ui/<component>/` (one folder per component, selector `hk-<name>` matching the design-system component name in kebab case, SCSS on tokens only). Views are rebuilt in place under `apps/web/src/app/views/` route by route; `shared/stores`, `shared/services`, the engine facade, the routes' paths and every behaviour stay. The old `shared/components/*` are retired in the last task once nothing imports them.
- **Tokens:** `docs/superpowers/design/2026-11-stage-a/design-system/tokens.json` is copied to `packages/ui-tokens/src/tokens.json` and becomes the single source; `tokens.ts` validates it with a Zod schema and exports the typed `TOKENS`; `build.ts` emits `tokens.css` and `tokens.scss`. Legacy names stay as aliases until the last task.
- **Presentation only.** Plan 17 changes no event, reducer, schema or API. Everything the approved designs add to the rules or the protocol (condition durations, encounters and round advance, four house rules, item icons) is plan `2026-11-03-phase-5-slice-2-approved-additions.md`. Where a board shows one of those (the condition duration badge, the encounter plate, the gold-option lock, the icon field), this plan builds the component with the data slot EMPTY or the control absent, and plan slice 2 fills it.
- **Order:** B1 tokens → B2 icons and hints → B3/B4 components → B5 shell → B6 overlays → B7 home/heroes/states → B8 wizard → B9 sheet → B10 build/timeline/level-up → B11 campaigns → B12 library/packs/settings/auth → B13 options and features-by-source → B14 i18n + text fit → B15 mobile + per-theme axe → B16 docs and retirement. B3 and B4 may run in parallel; B7, B8, B11, B12 only after B6.
- **Commands:** web unit `pnpm --filter web test --watch=false`; tokens `pnpm vitest run --project ui-tokens`; lint incl. the i18n key check `pnpm --filter web lint`; offline e2e `pnpm --filter web e2e` (31 tests today); sync e2e `pnpm --filter web e2e:sync` (9); everything `pnpm check`. Run pnpm in a PowerShell FOREGROUND call.

### Task B1: Tokens and themes from the design system

**Files:**

- Create: `packages/ui-tokens/src/tokens.json` (copy of the handoff `design-system/tokens.json`), `packages/ui-tokens/src/schema.ts` (Zod schema for the token file: `color.themes[]`, `color.tokens[] {name,value:{[themeId]:string}|string,usage}`, `type.{fonts,families,groups[].styles[]}`, `spacing|radius|shadow|decoration|duration|size .tokens[]`)
- Modify: `packages/ui-tokens/src/tokens.ts` (export `TOKENS` parsed from the JSON; export `THEME_IDS = ['tavern','scroll','plain'] as const` and `type ThemeId`), `packages/ui-tokens/src/build.ts` (`emitCss()` emits `:root, [data-theme='tavern'] {…}`, `[data-theme='scroll'] {…}`, `[data-theme='plain'] {…}` with one `--<name>` per colour and shadow token, `:root` with spacing/radius/decoration/duration/size and `--font-display`/`--font-body`, and a `.hk-type-<style>` class per type style; `emitScss()` emits the same as a `$hk-tokens` map keyed by theme), `apps/web/src/app/shared/services/theme/theme.service.ts` (`Theme = ThemeId`; stored value migration `dark → tavern`, `light → scroll`; `setTheme` sets `data-theme` on `<html>`), `apps/web/src/styles/typography.scss` (font-face for Forum and Alegreya from `apps/web/src/assets/fonts/` — vendor the woff2 subsets Latin + Cyrillic, OFL files beside them, as `fonts/inter` is vendored today)
- Test: `packages/ui-tokens/test/tokens.test.ts`, `packages/ui-tokens/test/build.test.ts`, `apps/web/src/app/shared/services/theme/theme.service.spec.ts`

**Interfaces:**

- Produces: CSS variables named exactly as `tokens.json` names (`--leaf`, `--ink-1`, `--brass`, `--ember`, `--moss`, `--arcane`, `--coin-gold`, `--rarity-rare`, `--space-4`, `--radius-leaf`, `--shadow-leaf`, `--texture-wood`, `--duration-base`, …) plus the legacy aliases (`--surface-0..3`, `--text-1..3`, `--accent`, `--accent-strong`, `--accent-contrast`, `--border-1`, `--danger`, `--success`, `--warning`, `--overlay`, `--space-1..6`, `--radius-s/m/l`, `--duration-s/m`, `--focus-ring`); `ThemeId`; `ThemeService.theme: Signal<ThemeId>`, `setTheme(t: ThemeId)`.

- [ ] **Step 1: Failing token tests** — `tokens.json` parses against the schema; every colour token has a value for every theme after inheritance; every legacy alias name exists; a contrast helper (WCAG relative luminance, in the test file) asserts `ink-1` on `leaf`, `ink-2` on `leaf`, `text-on-leather` on `leather`, `text-on-brass` on `brass` ≥ 4.5 in all three themes.
- [ ] **Step 2: Run** `pnpm vitest run --project ui-tokens`; expected FAIL (no JSON, no schema).
- [ ] **Step 3: Implement** the schema, `tokens.ts`, `build.ts`; copy the JSON; run `pnpm --filter @hk/ui-tokens build:tokens`.
- [ ] **Step 4: Run the tests and `pnpm --filter web build`**; expected PASS and a green build (the legacy aliases keep every existing SCSS compiling).
- [ ] **Step 5: Failing theme-service spec** — default theme is `tavern`; stored `'dark'` migrates to `tavern` and `'light'` to `scroll`; `setTheme('plain')` writes `data-theme="plain"`.
- [ ] **Step 6: Implement; run `pnpm --filter web test --watch=false`; PASS.**
- [ ] **Step 7: Commit** — `feat(ui-tokens): design-system tokens with tavern, scroll and plain themes`.

### Task B2: Icon vocabulary, tooltip directive, icon button, hint lint

**Files:**

- Create: `apps/web/vendor/game-icons/<author>/<name>.svg` for every name in the union of `docs/superpowers/design/2026-11-stage-a/icons/*-icons-used.json` and the spec §6 vocabulary (fetch from a `--depth 1` clone of https://github.com/game-icons/icons; licence CC BY 3.0; authors land in `assets/icons/authors.json` through the existing tool), `apps/web/src/app/ui/tooltip/tooltip.directive.ts` (`[hkTooltip]`), `apps/web/src/app/ui/icon-button/icon-button.component.ts` (`button[hk-icon-button]`, required input `hint: string` (i18n key) → `aria-label` + tooltip; inputs `icon`, `variant: 'brass' | 'ghost' | 'ember' | 'moss'`, `size: 's' | 'm' | 'l'`), `apps/web/src/app/ui/icons/vocabulary.ts` (`UI_ICONS: Record<UiIconName, { gi: string; hint: string }>` — the spec §6 table, `hint` an i18n key under `shell.icon.*`)
- Modify: `apps/web/tools/build-sprite.ts` (a `ui` map section from `vocabulary.ts`), `apps/web/src/app/shared/icons/icon.component.ts` (accepts `ui:<name>` ids)
- Test: `tooltip.directive.spec.ts`, `icon-button.component.spec.ts`, `apps/web/src/testing/icon-hints.spec.ts` (reads every `*.html` under `src/app`, fails on any `hk-icon-button` without a `hint` attribute or any `<button>` whose only child is `hk-icon` without `aria-label`), `apps/web/tools/build-sprite.spec.ts` (ui map symbols present)

**Interfaces:**

- Produces: `HkTooltipDirective` (input `hkTooltip: string` text, optional `hkTooltipDelay` default 300 ms, long-press 400 ms on touch, sets `aria-describedby` to a generated id, closes on Escape and blur); `HkIconButtonComponent`; `UiIconName` union; sprite ids `ui:<name>`.

- [ ] **Step 1: Failing specs** — tooltip appears 300 ms after `mouseenter`, immediately on `focus`, after 400 ms `pointerdown` on touch, is removed on `mouseleave`/`blur`/Escape, and the host carries `aria-describedby`; icon button renders `aria-label` from the translated hint and the tooltip; the hint lint fails on a fixture template without `hint`.
- [ ] **Step 2: Run** the three specs; FAIL.
- [ ] **Step 3: Vendor the SVGs, extend the sprite tool, implement the directive, the button and the vocabulary**; run `pnpm --filter web build:sprite`.
- [ ] **Step 4: Run the specs and the sprite spec; PASS.** `pnpm --filter web lint` green (the new `shell.icon.*` keys exist in en/ru/uk).
- [ ] **Step 5: Commit** — `feat(web): icon vocabulary, tooltip directive and icon button with the hint rule`.

### Task B3: Core components I — surfaces and vitals

**Files:**

- Create under `apps/web/src/app/ui/`: `leaf/` (`hk-leaf`: inputs `title`, `icon`, optional header actions slot, optional `tabs`), `button/` (`button[hk-button]`: `variant: 'primary' | 'parchment' | 'ghost' | 'ember'`, `loading`, `disabledReason` → `aria-describedby` + tooltip, never an inline caption), `wax-seal/` (`hk-wax-seal`: `state: 'filled' | 'spent' | 'disabled' | 'selected'`, `size: 's' | 'm' | 'l'`, `glyph?: string`, `numeral?: 1..9`, `hint` required), `stat-tile/`, `shield-badge/` (`hk-shield-badge` AC), `hp-gauge/` (`hk-hp-gauge`: inputs `current`, `max`, `temp`; outputs `damage`, `heal`, `setTemp`; `role="meter"` with `aria-valuenow/min/max` and a text alternative), `pool-bar/` (`hk-pool-bar`: `value`, `max`, `label`, `recharge`), `xp-bar/`, `portrait-frame/` (monogram fallback, `size`), `ability-seal/` (`hk-ability-seal`: `ability`, `score`, `modifier`, `save`, `saveProficient` → star glyph with hint "Proficient saving throw", shield glyph hint "Saving throw +N")
- Styles: each component's SCSS uses tokens only; textures (wood, parchment fibre, leather) are SVG `feTurbulence` filters defined once in `apps/web/src/styles/textures.scss` as data-free inline SVG in `apps/web/src/app/ui/textures/textures.component.ts` rendered once by the shell, with intensity from `--texture-*` (0 in `plain`)
- Test: one spec per component asserting states, outputs and the accessibility contract (hint present, no legend text)

**Interfaces:**

- Produces: the selectors and inputs above; `HkWaxSealComponent` is the only pip renderer used by B4, B9, B10.

- [ ] **Step 1: Failing specs** for every component (states render, `hk-hp-gauge` emits `damage` with the typed amount, `hk-wax-seal` with `numeral=2` shows "II", `disabledReason` renders no visible text but an `aria-describedby` target).
- [ ] **Step 2: Run; FAIL.**
- [ ] **Step 3: Implement** from `design-system/components/{Leaf,Button,WaxSeal,StatTile,ShieldBadge,HpGauge,PoolBar,XpBar,PortraitFrame,AbilitySeal}/preview.html` markup and `bundle.css` values (copy exact paddings, radii, sizes; do not round).
- [ ] **Step 4: Run; PASS.** Visual check: render each in a scratch route at the three themes with Playwright screenshots (not committed).
- [ ] **Step 5: Commit** — `feat(web): tavern-table surfaces and vital components`.

### Task B4: Core components II — rows, chips, fields

**Files:**

- Create under `apps/web/src/app/ui/`: `condition-chip/` (`hk-condition-chip`: `name`, `icon`, `level?`, `duration?` badge slot (empty in this plan), `removable`, `locked?` with hint; output `remove`), `filter-chips/`, `tag-chip/`, `skill-row/` (proficient dot with hint, expertise, disadvantage glyph with hint, roll button), `attack-row/`, `spell-row/` (level seal, cast button, always-prepared glyph with hint, concentration orb glyph `ui:concentration`), `feature-row/` (source icon, level badge, details button), `death-saves/`, `inspiration-toggle/`, `options-chip/` (`hk-options-chip`: `count`, `options: { id; name; href }[]`, popover with "See all in library" link — data wired in B13), `number-field/` (−/+ with 44 px targets), `search-field/`, `select/`, `toggle/`, `text-field/`, `textarea/`, `coin-pouch/`, `weight-strap/`, `satchel-grid/` (`hk-satchel-grid`: slots with icon, qty plate, equipped tag hint "Equipped", attuned gem hint "Attuned", rarity rim, selected; output `select`) and `item-row/` (phone list variant), `party-card/` (campaign: portrait, name, class/level, HP strap, AC, conditions, concentration, quick-effect chips slot)
- Test: one spec per component

- [ ] **Step 1: Failing specs** (states, outputs, hints; `hk-condition-chip` with `locked` renders the lock glyph and the hint, never text).
- [ ] **Step 2: Run; FAIL.** **Step 3: Implement from the matching `design-system/components/*/preview.html`.** **Step 4: Run; PASS.**
- [ ] **Step 5: Commit** — `feat(web): rows, chips, fields and bag components`.

### Task B5: App shell — rail, top bar, drawer, action strap, tab bar, navigation history

**Files:**

- Create: `apps/web/src/app/ui/shell/nav-rail.component.ts` (`hk-nav-rail`: six sections with `ui:` icons, tooltips, campaign chip, account button; mark-only below 1024 px), `top-bar.component.ts` (phone: folio button, title, context action), `app-drawer.component.ts` (phone: six sections, account, theme, language), `action-strap/action-strap.component.ts` + `action-strap.service.ts`, `tab-bar/tab-bar.component.ts` + `tab-bar.service.ts`, `nav/nav-history.service.ts`, `toast/`, `banner/`, `theme-menu/`
- Modify: `apps/web/src/app/app.html`, `app.ts`, `app.scss` (rail or top bar; `<router-outlet>`; `<hk-action-strap>` once; `<hk-tab-bar>` once; toasts; banners; textures), `apps/web/src/app/app.routes.ts` (`/about` → redirect to `/settings` with fragment `about`; everything else unchanged), `apps/web/src/assets/i18n/shell/*.json`
- Test: `action-strap.component.spec.ts`, `action-strap.service.spec.ts`, `nav-history.service.spec.ts`, `app.routes.spec.ts`, `app.spec.ts`; e2e: `offline.spec.ts`, `locale.spec.ts`, `a11y.spec.ts` selectors

**Interfaces:**

- Produces: `ActionStrapService.set(config: StrapConfig): void` / `clear(): void` where `StrapConfig = { exit?: StrapAction[]; primary: StrapAction[]; secondary?: StrapAction[]; status?: string }`, `StrapAction = { id: string; label: string (i18n key); icon: UiIconName; kind: 'primary' | 'parchment' | 'ghost' | 'ember' | 'icon'; disabled?: boolean; disabledReason?: string (i18n key); run: () => void }`; zone order is fixed and rendered left to right; on phones (`< 768`) zone 3 collapses into one "More" icon button opening a bottom sheet with the same order. `TabBarService.set(tabs: TabItem[] | null)` with `TabItem = { id; label; icon: UiIconName; route: string[] }`. `NavHistoryService.back(fallback: string[]): void` (returns to the previous in-app path if there is one, else navigates to `fallback`), `push(url)` called from a router events subscription in `app.ts`.

- [ ] **Step 1: Failing specs** — the strap renders zones in order and keeps DOM order across two `set` calls with the same ids; phone width collapses zone 3; `NavHistoryService.back` after `/c/1/play → /c/1/level-up` goes to `/c/1/play` and with no history goes to the fallback (Review Focus 3 pin); `/about` redirects; the rail has `aria-label` from `shell.nav.landmark`.
- [ ] **Step 2: Run; FAIL.** **Step 3: Implement** from boards `IA-ActionStrap`, `IA-Phone-Drawer`, `IA-Home-Phone` (top bar) and `design-system/components/{NavRail,ActionStrap,Tabs,Toast,Banner}`.
- [ ] **Step 4: Run unit specs; PASS. Run `pnpm --filter web e2e`**; update selectors in `offline`, `locale`, `a11y` specs until green (31/31).
- [ ] **Step 5: Commit** — `feat(web): tavern-table app shell with the action strap and tab bar`.

### Task B6: Overlays — parchment dialog, bottom sheet, drawer, description drawer

**Files:**

- Modify: `apps/web/src/app/shared/components/dialog/dialog.component.*` → move to `apps/web/src/app/ui/dialog/` keeping the focus trap, `data-dialog-title` contract and the `sheet` input (phone bottom sheet), restyled as the parchment dialog with the title seal and a leather action row
- Create: `apps/web/src/app/ui/drawer/drawer.component.ts` (`hk-drawer`: right-side on ≥ 768, full-height sheet below; closes with its opener, Escape; never changes the URL), `apps/web/src/app/ui/description-drawer/description-drawer.component.ts` (`hk-description-drawer`: input `entity` (any pack entity id), renders name, tags, markdown body through the existing sanitizing markdown service with the character's scoped localizer, an "Open entry" link to `/library/:id`, an optional primary action slot)
- Test: `dialog.component.spec.ts` (moved), `drawer.component.spec.ts`, `description-drawer.component.spec.ts` (ruling 5 RED: a species, a class feature, a spell, an item and a condition each render their description text)

- [ ] **Step 1: Failing specs** (the five description renders; drawer close semantics; dialog sheet variant at phone width).
- [ ] **Step 2: Run; FAIL.** **Step 3: Implement** from `design-system/components/{Dialog,DescriptionDrawer}` and boards `D03`, `DL01` (dialog chrome).
- [ ] **Step 4: Run; PASS.** **Step 5: Commit** — `feat(web): parchment dialog, drawer and description drawer`.

### Task B7: Home, heroes list, system states

**Files:**

- Modify: `apps/web/src/app/views/home/home.component.*` (board `IA-Home-Desktop/-Phone/-Tablet`: Continue leaf for the last opened hero, Tonight slip when a linked campaign has a live session, heroes row, campaigns row, quick actions; strap zone 2 = New hero · Import · Join by code), `apps/web/src/app/views/characters/list/characters-list.component.*` (board `H01`: cards with HP strap, campaign chip, last played, Open + more menu; install banner; empty state), `apps/web/src/app/shared/services/storage/` (persist `lastOpenedCharacterId` and `lastOpenedAt` in the settings repository — UI state, not an event), a `views/not-found` component (board `X01`), banners (offline, update available, missing packs, campaign packs) on `hk-banner`
- Test: `home.component.spec.ts` (Continue card shows the last opened hero; first run shows the invitation), `characters-list.component.spec.ts`; e2e `export-import.spec.ts` (Import moved to the strap)

- [ ] **Step 1: Failing specs.** **Step 2: Run; FAIL.** **Step 3: Implement.** **Step 4: Run unit + `pnpm --filter web e2e`; PASS.**
- [ ] **Step 5: Commit** — `feat(web): home, heroes list and system states on the new shell`.

### Task B8: Hero creation wizard rebuild

**Files:**

- Create: `apps/web/src/app/ui/stepper/stepper.component.ts` (`hk-stepper`: `steps: StepItem[]`, `current: string`, `variant: 'vertical' | 'strip'`; `StepItem = { id; label; state: 'done' | 'current' | 'todo' | 'locked'; summary?: string; hint?: string }`; done = wax seal; locked = padlock with hint; the strip variant shows "Step N of M · name" and an all-steps sheet), `apps/web/src/app/ui/flow/flow-controller.ts` (`FlowController<TStep>`: `next()` → first unanswered step after the current, never skipping; `back()`; `cancel()` with a dirty check; the step list builder is the existing plan-13 sorted-choice-steps logic lifted out of `create-wizard.component.ts` into `apps/web/src/app/views/characters/flow/steps.ts` and shared with level-up), `apps/web/src/app/ui/picker-card/picker-card.component.ts` (`hk-picker-card`: `selected`, `gated` with `reason` hint, `choose` output, `details` output)
- Modify: `apps/web/src/app/views/characters/create-wizard/**` — every step on boards `W01`…`W10` desktop and phone: name & concept (grammatical form segment, portrait, packs with pins; core lock hint), species/background/class pickers as full-height responsive grids with search + filter chips and the description drawer (no inner scroll boxes), ability scores with four method tabs and all six seals visible (no auto-advance), skills/tools and style/masteries with counters, spells (tick seals, orb glyph, no captions), equipment (kit A/B; the gold alternative rendered but its house-rule lock arrives in slice 2), review by step with Edit links; the strap: Cancel · Back | Next → "Create hero" on review, pickers add Filter · Search in zone 3, status "Step N of M · name"
- Test: `create-wizard.component.spec.ts` (RED: next never skips an unanswered step; Back returns to the previous step; the ability step does not auto-advance; every picker option opens its description; the review Edit link jumps to the step and Next returns to review), `stepper.component.spec.ts`, `flow-controller.spec.ts`; e2e `create-fighter`, `create-monk`, `create-rogue`, `create-soldier-options` + `e2e/helpers/create-wizard.ts` updated

- [ ] **Step 1: Failing specs** (the five RED behaviours above as named tests).
- [ ] **Step 2: Run; FAIL.** **Step 3: Implement** step by step, phone strip variant included.
- [ ] **Step 4: Run unit; PASS. Run `pnpm --filter web e2e`; update the four create specs and the helper; PASS.**
- [ ] **Step 5: Commit** — `feat(web): creation wizard on the shared stepper with full-height pickers`.

### Task B9: Sheet shell and Play tab — desktop leaves, phone tabs, drawers, play dialogs

**Files:**

- Modify: `apps/web/src/app/views/characters/sheet/sheet-shell.component.*` (board `Main`: folio column with portrait, name plate, tabs Play · Build · Timeline + the Level up tab-action with the XP hint, HP strap, AC shield, vitals tiles, ability seals, skills; banners; the strap: Damage · Heal · Roll · Short rest · Long rest | Add condition · Notes · Roll log · Export · Edit; concentration note in the status slot), `play/play-tab.component.*` split into leaves: `play/attacks-leaf`, `play/resources-leaf`, `play/conditions-leaf` (chips + death saves + inspiration), `play/features-leaf` (grouped by source — data in B13), `play/spells-leaf` (slot seals with numerals and the "Level N slots" label, prepared rows, cast), `play/bag-leaf` (satchel grid, selected-item strip, coin pouch, weight strap)
- Create: phone tab routing under `/c/:id/` — `combat`, `spells`, `bag`, `hero`, `more` children that compose the same leaves (board `A-Phone`, `H-Hero-Phone`); `TabBarService` set by the sheet shell; `more` lists Build, Timeline, Notes, Roll log, Content packs, Export, Level up
- Move drawers: `play/notes-drawer.component.*` (board `D01`), `play/roll-log-drawer.component.*` (board `D02`: advantage segment, visibility picker when linked, feed, log a roll, clear) opened from the strap through `hk-drawer`
- Restyle dialogs on `hk-dialog`: `cast-dialog` (board `DL01`: slot seals by level, free-cast lane, pact slot, concentration warning), `rest-dialog` (board `DL02`), `condition-dialog` (board `DL03`: picker, level stepper capped by the pack's levels — the duration fields arrive in slice 2), `add-item-dialog` + `custom-item-dialog` (board `DL04`; the icon field arrives in slice 2), `note-dialog` becomes the drawer editor
- Test: `sheet-shell.component.spec.ts`, one spec per leaf, `play-tab` phone route specs (each tab renders only its leaves; the Combat tab's DOM order is HP, AC/initiative/speed, saves, attacks, resources, conditions, death saves, inspiration); `roll-log-drawer.component.spec.ts`; e2e `play-actions.spec.ts`, `multiclass.spec.ts` (pact slot) + `e2e/helpers/sheet.ts`

- [ ] **Step 1: Failing specs** (leaf composition per tab; the strap config of the sheet; every existing play behaviour spec moved to its leaf and still green: damage, heal, temp HP, death saves, rests, cast, prepare, equip, attune, currency, wake lock).
- [ ] **Step 2: Run; FAIL on the new structure.** **Step 3: Implement.** **Step 4: Run unit; PASS. Run e2e; update `play-actions`, `multiclass`, `a11y` (sheet tabs, short-rest, cast, roll log); PASS.**
- [ ] **Step 5: Commit** — `feat(web): play sheet as leaves with phone tabs, drawers and parchment dialogs`.

### Task B10: Build tab, Timeline, Level-up on the shared stepper

**Files:**

- Modify: `views/characters/sheet/build/build-tab.component.*` (board `B01`: origin and class, ability table with method, choices made with Re-pick or a lock hint, proficiencies and languages, rule options with the campaign-locked tooltip, content packs with pins and updates, identity fields with one Save), `views/characters/sheet/timeline/timeline-tab.component.*` (board `T01`: sentences grouped by day/session, kind icon, expanders, per-row Revert opening the confirm dialog, filter chips), `views/characters/level-up/level-up.component.*` (boards `L01`…`L04` on `hk-stepper` + `FlowController` from B8: which class, hit points with the rolled result shown before confirming, choices with gated feats and their reasons as hints, review with "Finish level up" in the Next slot; Play/Build/Timeline dimmed and the Level up tab active; Cancel in zone 1), `views/characters/sheet/play/revert-dialog` (board `DL05`), i18n: `characters.timeline.revert` = "Revert" / "Отменить изменение" / "Відкотити" (distinct from Cancel)
- Test: `level-up.component.spec.ts` (RED: deep link to `/c/:id/level-up` then Back returns to the tab the user came from — Review Focus 3; Next never skips an unanswered choice step; the HP step shows the roll before confirming), `build-tab.component.spec.ts` (the build is shown: species, class levels, subclass, background, each choice), `timeline-tab.component.spec.ts` (Revert and Cancel labels differ in uk); e2e `level-up.spec.ts`, `multiclass.spec.ts`, `custom-packs.spec.ts` (Build → packs) + `e2e/helpers/level-up.ts`

- [ ] **Step 1: Failing specs.** **Step 2: Run; FAIL.** **Step 3: Implement.** **Step 4: Run unit + e2e; PASS.**
- [ ] **Step 5: Commit** — `feat(web): build and timeline tabs, level-up on the shared stepper`.

### Task B11: Campaign screens

**Files:**

- Modify: `views/campaigns/list/` (board `C01`), `create/` (`C02` on `hk-dialog`), `join/` (`C03`), `link-character/` (`C04`), `lobby/` (`C05`: code plate, QR, copy, rotate, roster), `party/party-tab` (`C06` DM: `hk-party-card` grid with the quick-effects leaf for the selected member — Damage, Heal, Temp HP, Condition, XP, Level, Item, Inspiration, Override; `C07` player view; the encounter plate slot stays empty until slice 2), `party/member-sheet-dialog` → drawer (`C08`), `log/log-tab` (board `C09`, label "Table", route path `log` unchanged: session strip with Start/End session, feed with visibility badges and system lines, composer that fits the width), `settings/campaign-settings` (`C10`: house rules — the existing three; packs with quota and Enable/Disable/Update; party sheets; export; leave/delete), the confirms on `hk-dialog` (`C11`), the campaign tab bar Party · Table · Lobby · Settings on phones, the DM strap zone 2 = Damage · Heal · Condition · XP · Item, zone 3 = Session · Export
- Test: specs per screen (layout + unchanged behaviours: join by code, link, remove member, DM effects land on the member, roll visibility, chat, packs enable/disable/update); sync e2e `campaign-table`, `campaign-claim`, `campaign-portrait`, `campaign-session-lock`, `campaign-packs` + `e2e/sync/campaign-helpers.ts` updated

- [ ] **Step 1: Failing specs.** **Step 2: Run; FAIL.** **Step 3: Implement.** **Step 4: Run unit; PASS. Run `pnpm --filter web e2e:sync`; update selectors; 9/9.**
- [ ] **Step 5: Commit** — `feat(web): campaign screens on the new shell`.

### Task B12: Library, packs, homebrew, settings, auth

**Files:**

- Modify: `views/library/browse/` (board `LB01`: search with ranking exact → prefix → word so "fire" ranks Fireball first — the ranking function moves to `apps/web/src/app/shared/services/library/library-search.ts` with its own spec; type chips with per-query counts; rows whose type and language pills never overflow), `views/library/detail/` (`LB02` spell entry with "Add to hero" when opened from a sheet via a `?for=<characterId>` query; `LB03` class entry: core traits, level-1 features, features-by-level table from the pack's progression data, subclasses, spell list — a `class-entry.component` renderer; Back to library), `views/packs/` (`PK01`…`PK05`: list, detail, trust dialog, homebrew list, item/spell/feat/species forms on the new fields — the icon field arrives in slice 2), `views/settings/` (`ST01`: left index; Account with devices and quota; Appearance with the three theme cards, density, motion, language; Storage; Content packs; About & licences — the former `/about` content with the game-icons authors from `assets/icons/authors.json`), `views/auth/` (`AU01`: log in, create account, recovery codes, recover as centred leaves; the primary button lives in the form's own strap, the page strap keeps Back and Help)
- Test: `library-search.spec.ts` (ranking), `browse.component.spec.ts`, `class-entry.component.spec.ts` (renders levels 1–20 from pack data), `settings.component.spec.ts` (about section present; `/about` redirect lands on it), auth specs; e2e `library.spec.ts`, `custom-packs.spec.ts`, sync `auth.spec.ts` + `e2e/helpers/packs.ts`

- [ ] **Step 1: Failing specs** (ranking RED with "fire"; class entry table; about folded).
- [ ] **Step 2: Run; FAIL.** **Step 3: Implement.** **Step 4: Run unit + e2e + e2e:sync; PASS.**
- [ ] **Step 5: Commit** — `feat(web): library, packs, homebrew, settings and auth on the new shell`.

### Task B13: Features by source, choice options, entry links

**Files:**

- Create: `apps/web/src/app/shared/services/engine/feature-groups.ts` (`groupFeaturesBySource(views: FeatureView[]): FeatureGroup[]` in the order Class (with level gained), Subclass, Species, Background, Feats, Chosen options — from each feature view's existing provenance `source`), `apps/web/src/app/shared/services/engine/choice-options.ts` (`optionsForChoice(choice: ChoiceOffer, index: LibraryIndex): { count: number; options: { id; name; href }[] }` — the same candidate evaluation the wizard pickers already use, exposed for the options chip)
- Modify: `play/features-leaf` (groups + level badges + hover hint "From <source>, level N"), the class picker drawer in the wizard and the library class entry (options chip on every choice feature with the popover and "See all in library"), every feature/spell/item summary that truncates (`hk-description-drawer` link + popover with the full text)
- Test: `feature-groups.spec.ts` (order and level badges), `choice-options.spec.ts` (Paladin Weapon Mastery counts the pack's mastery-property weapons; Fighting Style lists its options), `features-leaf.component.spec.ts`, `class-entry.component.spec.ts` (chips present on choice rows)

- [ ] **Step 1: Failing specs.** **Step 2: Run; FAIL.** **Step 3: Implement.** **Step 4: Run; PASS.**
- [ ] **Step 5: Commit** — `feat(web): features by source and options popovers for choice features`.

### Task B14: i18n strings pass and the text-fit harness

**Files:**

- Modify: every `apps/web/src/assets/i18n/**/{en,ru,uk}.json` touched by B2–B13 — every new key ×3; uk proposals come from `docs/superpowers/design/2026-11-stage-a/notes/*-notes.md` ("invented uk strings"), ru written consistently with the existing ru files; `apps/web/scripts/check-i18n-keys.mjs` (ru/uk missing keys now FAIL, not warn), `docs/02-architecture/06-i18n.md` (the hint rule and the text-fit rule)
- Create: `apps/web/scripts/build-fit-locale.mjs` (writes `src/assets/i18n/fit/**` — per key the longest of en/ru/uk — gitignored, generated before the text-fit run), `apps/web/playwright.textfit.config.ts` + `apps/web/e2e/textfit/*.spec.ts` (loads every route of the audit's screen table at 360 × 640 and 1280 × 800 with `lang=fit`, asserts `document.scrollWidth <= clientWidth`, and for every element with `overflow: hidden` that `scrollWidth <= clientWidth` unless it carries `data-truncate` (ellipsis + tooltip)); `package.json` scripts `e2e:textfit`
- Test: the harness itself (RED on a fixture template with a 600 px string)

- [ ] **Step 1: Fill the strings; run `pnpm --filter web lint`; PASS with the stricter check.**
- [ ] **Step 2: Failing harness run** on the current state; fix every overflow it finds in the views (never by clipping).
- [ ] **Step 3: `pnpm --filter web e2e:textfit` green at both widths.**
- [ ] **Step 4: Commit** — `feat(web): three-locale strings and the text-fit harness`.

### Task B15: Mobile Playwright project, per-theme axe, bundle budget

**Files:**

- Create: `apps/web/playwright.mobile.config.ts` (390 × 844, `hasTouch`, `isMobile`, same static webServer) running `e2e/create-fighter.spec.ts`, `e2e/play-actions.spec.ts`, `e2e/level-up.spec.ts` through the phone tabs (helpers switch on viewport), and `e2e/mobile/tabs.spec.ts` (Combat tab shows HP, AC, speed, saves and attacks above the fold at 390 × 844 — Review Focus 4; long-press on an icon button shows its hint); `package.json` script `e2e:mobile`
- Modify: `apps/web/e2e/a11y.spec.ts` (the 14 scans × the three themes by setting the stored theme before load — Review Focus 2), `apps/web/tools/check-bundle-budget.ts` thresholds unchanged (gzip ≤ 600 kB; fonts and textures must not push the initial bundle over: fonts preloaded as assets, sprite per route group)
- Test: the new specs; `pnpm --filter web build` passes the budget gate

- [ ] **Step 1: Write the mobile and per-theme specs; run; FAIL where the UI misses.** **Step 2: Fix; `pnpm --filter web e2e:mobile` and `e2e` green.** **Step 3: Build; budget green; record gzip in the commit body.**
- [ ] **Step 4: Commit** — `test(web): mobile playwright project and per-theme axe gate`.

### Task B16: Docs, checklist, retirement, wrap

**Files:**

- Modify: `docs/02-architecture/09-frontend-architecture.md` (the `ui/` library, the shell, the strap and tab-bar services, navigation history, themes and textures, phone tab routing), `docs/02-architecture/06-i18n.md` (already in B14; cross-check), `docs/README.md` (Phase 5 slice 1 section with the gates' numbers), `docs/03-roadmap/phases.md` (Phase 5 row), `docs/manual-device-checklist.md` (rewritten for the new UI: install, offline create → play → reload through the phone tabs, theme switch, long-press hints), `apps/web/src/app/shared/components/**` (delete every component nothing imports; `rg` proves it), `packages/ui-tokens` (drop the legacy alias block only if no SCSS references remain), this plan's STATUS → EXECUTED
- Test: `pnpm check` green; `pnpm --filter web e2e`, `e2e:sync`, `e2e:mobile`, `e2e:textfit` green; bundle budget green

- [ ] **Step 1: Delete dead components; run `pnpm check`; PASS.** **Step 2: Update the docs; `pnpm format`.** **Step 3: Full gates green; record the numbers in `docs/README.md`.**
- [ ] **Step 4: Commit** — `docs(repo): phase 5 slice 1 wrap and old component retirement`.

---

## Self-review (rewritten 2026-11-03)

- **Spec coverage:** principles 1–7 (B5 strap and B14 text fit, B9 play reads above the fold, B2/B3/B4 hint rule, B5 navigation, B8 no-skip Next), app map and navigation by device (B5, B9 phone tabs, B11 campaign tabs), navigation semantics (B5 `NavHistoryService`, B8/B10 `FlowController`), the strap contract (B5), wizard and level-up flows (B8, B10), campaign flows (B11), visual direction and themes (B1, B3 textures), iconography and the hint rule (B2, lint in B2), components (B3, B4, B6), features by source and choice options (B13), home (B7), the owner comment rules (no inline reasons: `disabledReason` in B3; no narrative captions: B8/B9 tests assert absence; one tick marker: B4 `hk-spell-row`; truncated text links: B13). Conditions with duration, encounters, house rules and item icons are plan slice 2 by design.
- **Step scan:** every task names its RED tests as behaviours, the files and selectors, and the board/design-system sources; implementation bodies are left to the implementer.
- **Type consistency:** `StrapConfig`/`StrapAction` (B5) used by B7–B12; `hk-stepper` + `FlowController` (B8) reused by B10; `hk-wax-seal` (B3) is the only pip; `hk-description-drawer` (B6) is the only description surface (B8, B9, B13); `UiIconName` (B2) everywhere.
- **Review Focus:** 1 → B8 + B14 + B15; 2 → B15; 3 → B5 + B10; 4 → B9 + B15; 5 → every task's e2e step.
- **Proportion:** ~330 lines of Stage B for a frontend rebuild of ~70 view files; code bodies are absent, interfaces and tests are named.
