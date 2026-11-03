# Phase 5 Slice 1 — Frontend Redesign (Design-First) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Stage A runs as a design exercise (Claude Design artifacts via the Artifact tool, `quickstart` with `intent: "design"`), gated on explicit OWNER APPROVAL; Stage B then runs with superpowers:subagent-driven-development task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**STATUS: STAGE A IN PROGRESS since 2026-11-02 (owner: "Start plan 17"; Stage A runs as an interactive brainstorm with owner checkpoints, not under the zero-questions loop). Stage B starts only after the GATE line below exists.**

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

- Repo non-negotiables (CLAUDE.md): structural i18n — no user-visible string literals; every new UI string ×3 (en/ru/uk); icons never replace text without an accessible name (`aria-label`) and a visible hint on hover/long-press; rules are DATA (the redesign changes presentation only — no 5e logic moves into components); events immutable (no event or reducer changes in this plan); TDD red-first for every behavioural fix (navigation, wizard flow, description rendering) with captured RED; Conventional Commits with scope; every commit ends with the trailer `Claude-Session: https://claude.ai/code/session_01LmRHJ6gLUJsaj7fHYJkG4F`; each commit typechecks alone.
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

- [ ] The ledger records `GATE: Stage A approved <date>` with the artifact links; the controller rewrites the PROVISIONAL Stage B task texts from the approved designs and commits `docs(plans): stage B tasks from approved designs`. No Stage B dispatch before this line exists.

---

## Stage B — Implementation (PROVISIONAL until the gate; subagent-driven)

### Task B1: Tokens, themes, textures, icon set, tooltip

**Files:** `packages/ui-tokens` (token source per A3; theme packs; density presets; texture assets lazy-loaded), `apps/web/src/app/shared/components/` (`hk-icon` sprite component with the approved set + licence in the attribution screen, `hk-tooltip` directive: hover/focus/long-press, `aria-describedby`), theme switcher preference (settings + localStorage via the existing settings repository), per-theme axe e2e.
- [ ] RED: contrast spec per theme (token-level assertions) + tooltip directive spec; implement; GREEN; gzip check (textures lazy).

### Task B2: App shell, navigation, stable action bars, deep links

**Files:** shell/nav components, a shared `hk-action-bar` (ruling 3), router history handling for Back (ruling 4), the shared stepper used by wizard and level-up.
- [ ] RED: navigation specs for each defect from A1 (Back/Next misroutes incl. Review Focus 3); implement; GREEN; e2e selectors updated.

### Task B3: Character creation wizard rebuild

**Files:** `views/characters/create-wizard/**` on the shared stepper; description surfaces (ruling 5); mobile layout; icon/tooltip controls.
- [ ] RED: wizard flow spec (every step type, next-never-skips, descriptions openable, uk longest-string fit — Review Focus 1); implement; GREEN; `create-*` e2e updated.

### Task B4: Sheet tabs (play, build, timeline, level-up) redesign + mobile

**Files:** `views/characters/sheet/**`, `level-up/**`; play-tab density and above-the-fold layout (ruling 6); dialogs as bottom sheets on mobile; Packs/Options sections restyled.
- [ ] RED: layout specs at 360/390 px (no horizontal scroll, tooltips present — Review Focus 4) + behaviour specs unchanged; implement; GREEN; e2e updated.

### Task B5: Campaign screens

**Files:** `views/campaigns/**` (lobby, party, member sheet dialog, DM tools, log, settings incl. the plan-16 packs section).
- [ ] RED: specs for the redesigned layouts + unchanged behaviours; implement; GREEN; sync e2e updated.

### Task B6: Library, packs, homebrew, settings

**Files:** `views/library/**`, `views/packs/**` (incl. homebrew forms), `views/settings/**`, `views/about`.
- [ ] RED + implement + GREEN; e2e updated.

### Task B7: i18n text-fit harness and icon-hint coverage

**Files:** `apps/web/src/testing/text-fit/` (renders each screen with the longest string per key across locales at 360 and 1280 px, asserts no overflow/clipping via a DOM check), a lint-style spec asserting every icon-only control has `aria-label` + tooltip; `docs/02-architecture/06-i18n.md` section.
- [ ] RED (the harness fails on any remaining overflow) → fix → GREEN.

### Task B8: Mobile Playwright project + per-theme axe sweep

**Files:** `apps/web/playwright.mobile.config.ts` (390 × 844, touch), core flows (create, play, level-up, campaign join via the sync project), axe across every screen × every theme.
- [ ] RED/GREEN; add `pnpm --filter web e2e:mobile` to CI and `pnpm check` notes.

### Task B9: Docs, checklist, wrap

**Files:** doc-09 (new shell/components/themes), doc-06 (text-fit rule), `README.md` Phase 5 slice-1 section, `docs/manual-device-checklist.md` rewritten for the new UI, this plan's STATUS → EXECUTED with the approved artifact links.

---

## Self-review (performed at write time)

- **Owner request coverage:** redesign/reorder/regroup (A2, B2–B6), i18n-friendly icons + hover hints (rulings 2, 7; B1, B7), mobile version (A4, B4, B8), text-fit testing in detail (A4, B7), compact game-like fantasy theme with textures (A3, B1), UX defects — moving buttons, Back/Next misroutes, descriptions not showing, bad creation flow (A1, rulings 3–5, B2, B3), design first in Claude Design with approval before code (Stage A + GATE).
- **Step scan:** Stage B texts are intentionally PROVISIONAL (ruling 1) — they are rewritten with exact files, signatures and tests from the approved designs before dispatch; every current Stage B line still decides scope and the RED it must carry.
- **Type consistency:** one stepper component (B2) used by B3 and B4; one action bar (B2) used everywhere; one tooltip directive (B1) asserted by B7.
- **Review Focus:** five lines, each owned by a Stage B task (B3, B1, B2, B4, all).
- **Proportion:** ~190 lines; a design-first plan whose implementation detail is deferred to the gate by design.
