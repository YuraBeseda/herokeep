# Plan 20 — Owner Bug List and Compact Play UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**STATUS: WRITTEN 2026-11-19, not started. Runs first; plans 21 (2014 ruleset + book packs) and 22 (full ru/uk content) follow.**

**Goal:** Fix every bug the owner found in the library and the hero sheet, make the Play tab compact and friendly to new players (context menus, merged roll buttons, skills grouped under abilities, hints that explain the rules), and close the plan-18 carries — so the owner can run a test session with friends and QA it.

**Architecture:** Web-only, on the plan-17 `ui/` library. One new shared primitive family — a context menu (`@angular/cdk/menu`, already a dependency) with a long-press trigger for touch, and a split action button built on it — then each sheet leaf adopts it. One app-wide "peek" drawer replaces the per-component description drawers. Engine untouched except the carries that name it; no new events, no pack schema change.

**Tech Stack:** Angular 22 zoneless (signals), `@angular/cdk/menu` ~22.1, SCSS with `@hk/ui-tokens`, Vitest unit specs (co-located `*.spec.ts`), Playwright (`apps/web/e2e/`, `e2e/mobile/`, `e2e/textfit/`, axe helper `e2e/helpers/axe.ts`).

**Spec:** the owner's bug list of 2026-11-19 (quoted per task below) + memory `plans-20-22-owner-decisions` + plan-18 carries in `docs/03-roadmap/phases.md` and this plan's Task 12. Design language: `docs/superpowers/design/2026-11-stage-a/` (concept "Tavern Table"; icon-first controls with hover hints).

## Global Constraints

- i18n is structural: every new UI string in en/ru/uk (`apps/web/src/assets/i18n/<namespace>/{en,ru,uk}.json`); the text-fit suite must stay green for all three locales.
- Game rules are data: hint texts explain *what a stat is for* (UI strings); they never compute or hard-code a rule value. Values shown in hints come from the derived sheet.
- Every action moved into a context menu stays reachable without a mouse: right-click (desktop), long-press 500 ms (touch), the `ContextMenu` key / Shift+F10 (keyboard), and one visible `⋯` icon button per row or block for discoverability. Never a right-click-only action.
- Icon-only buttons carry an accessible name and a `[hkTooltip]` hint (existing directive `ui/tooltip/tooltip.directive.ts`).
- No layout shift on opening any overlay (drawer, menu, popover).
- Per-viewer UI memory (last HP action) uses `localStorage` wrapped in try/catch with a working default.
- Each task: TDD red first, Conventional Commit with scope (`fix(web): …`, `feat(web): …`), commit typechecks alone. Gates per task: `pnpm --filter web lint`, `pnpm --filter web test --watch=false`, `pnpm --filter web build` (gzip ≤ 600 kB). Final task: root `pnpm check`, `pnpm --filter web e2e`, `e2e:sync`, the text-fit and mobile projects.
- Visual changes: screenshot before/after (desktop 1280 and phone 390, tavern theme + one other) and send to a `visual-check` agent; record the verdict in the task report. Do not read screenshots in the main thread.
- Subagents hit turn caps on multi-file web tasks: commit in green slices; a task with "a/b" parts is two dispatches.

## Review Focus

1. A keyboard-only or touch-only player can still do every action that moved into a context menu (equip, attune, remove an item, damage roll, saving throw, inspiration) — Tasks 4, 6, 7, 9 each carry an e2e that does it without a right-click.
2. Opening the peek drawer on a long library page: the page under it does not jump, the drawer scrolls on its own, and the page still scrolls and stays readable beside it on desktop (Task 2 e2e measures it).
3. The last-used HP action survives a reload, but a fresh device (or storage that throws) defaults to Damage and never applies the wrong action silently — the button always shows which action it will apply (Task 7 test).
4. A long ru/uk label inside a context menu or split button fits at phone width (Task 4 and 7 add their surfaces to the text-fit suite).
5. A DM who links their own hero is not locked out by their own house rules (Task 12 test).

---

### Task 1: Themed scrollbars

Owner: "Scrollbar is not stylized at all, including global and the one inside containers."

**Files:**
- Modify: `packages/ui-tokens/src/tokens.json` (per-theme `scrollbar-thumb`, `scrollbar-thumb-hover`, `scrollbar-track` in tavern/scroll/plain), regenerate `packages/ui-tokens/dist/*` with the package's build script
- Modify: `apps/web/src/styles/base.scss` (global rule)
- Test: `packages/ui-tokens/test/` (existing token spec — add the three tokens to the per-theme completeness check), `apps/web/e2e/a11y.spec.ts` unaffected

- [ ] **Step 1: Failing test** — every theme defines `scrollbar-thumb`, `scrollbar-thumb-hover`, `scrollbar-track`, and thumb-vs-track contrast ≥ 3:1 (use the existing contrast helper).
- [ ] **Step 2: Run** the ui-tokens tests — FAIL.
- [ ] **Step 3: Add tokens** (tavern: leather-brown thumb on a dark-wood track; scroll: ink-brown on parchment; plain: neutral grey) **and the global rule** in `base.scss`: `* { scrollbar-width: thin; scrollbar-color: var(--scrollbar-thumb) var(--scrollbar-track); }` plus `::-webkit-scrollbar` (10 px, rounded thumb, hover colour) inside `@supports not (scrollbar-color: auto)` for Safari. Remove nothing else; `settings.component.scss:420` `scrollbar-width: none` stays.
- [ ] **Step 4: Run** tests — PASS; visual-check on the library list, a drawer and the sheet in all three themes.
- [ ] **Step 5: Commit** — `feat(web): themed scrollbars`.

### Task 2: One peek drawer, no jump, own scroll

Owner: the "Full text" drawer (`class.fullText`, `views/library/detail/class-entry/class-entry.component.html:61-68,161-168`) jumps while it animates, hides behind other containers, and makes the whole page longer instead of scrolling itself; the page under it should keep scrolling so the reader can follow the original text.

**Files:**
- Create: `apps/web/src/app/ui/description-drawer/peek.service.ts`
- Modify: `apps/web/src/app/ui/drawer/drawer.component.{ts,scss}` (layout + animation), `apps/web/src/app/ui/description-drawer/description-drawer.component.ts`, `apps/web/src/app/app.html` (one host), `apps/web/src/styles/layers.scss` (z-index), every current `<hk-description-drawer>` user (class-entry, `bag-leaf.component.html:203`, `features-leaf.component.html:73`, others found by grep) switches to the service
- Test: `ui/description-drawer/peek.service.spec.ts`, `ui/drawer/drawer.component.spec.ts`, `apps/web/e2e/library.spec.ts`

**Interfaces:**
- Produces: `PeekService` (root) — `open(entityId: EntityId, opener?: HTMLElement): void`, `close(): void`, `readonly current: Signal<{ entityId: EntityId; opener?: HTMLElement } | null>`. Opening another entity while open replaces the content (no second drawer). The drawer header gets an "Open page" icon link to the entity's library route.

- [ ] **Step 1: Reproduce the jump first** (superpowers:systematic-debugging): record the main column's `getBoundingClientRect().x` and `document.scrollingElement.scrollTop` every animation frame while the drawer opens; name the cause (likely `overflow:hidden` on body removing the scrollbar, or the drawer taking layout space during `hk-drawer-in`) in the commit body.
- [ ] **Step 2: Failing e2e** `library.spec.ts › peek drawer opens without layout shift and scrolls itself`: open a class entry, scroll 600 px, press Full text; assert the main column x and the scrollTop never change while opening; the drawer's content box has `overflow-y: auto` and `scrollHeight > clientHeight` for a long feature; scrolling the drawer does not move the page; on desktop (1280) wheel over the page still scrolls the page while the drawer stays open (non-modal: no backdrop on ≥ 900 px); the drawer is above the action strap and nav (`elementFromPoint` at its centre is inside it).
- [ ] **Step 3: Implement**: desktop = fixed right panel, full viewport height, width `min(28rem, 40vw)`, `overflow-y: auto` on the body, no backdrop and no scroll lock, animation on `transform` only with the panel out of flow from frame one; phone (< 900 px) = bottom sheet, `max-height: 85dvh`, own scroll, backdrop kept. Escape and the close button close it; focus returns to the opener. Move all users to `PeekService`; delete their local `drawerOpen/drawerEntity/drawerOpener` signals.
- [ ] **Step 4: Unit spec** for `PeekService` (open replaces, close clears, opener restored) — PASS; e2e — PASS.
- [ ] **Step 5: Commit** — `fix(web): the description drawer is one non-modal peek panel that scrolls itself`.

### Task 3: Peek from any reference

Owner: be able to read any description in the side panel without leaving the page — the links in "Features by level", spells and features on the hero page.

**Files:**
- Create: `apps/web/src/app/ui/description-drawer/peek-link.directive.ts`
- Modify: entity-reference links in `class-entry.component.html:75-139`, `spells-leaf.component.html:165-238` (`hk-spell-row` name), `ui/feature-row/feature-row.component.html`, other in-app entity links found by `grep -rn "routerLink" apps/web/src/app/views` pointing at `/library/`
- Test: `peek-link.directive.spec.ts`, `apps/web/e2e/library.spec.ts`

**Interfaces:**
- Consumes: `PeekService` (Task 2).
- Produces: `[hkPeek]="entityId"` directive on an `<a routerLink>`: plain left click → `preventDefault()` + `peek.open(id, el)`; Ctrl/Meta/Shift/middle click → native navigation untouched; right-click is left to the browser here (the context menus of Task 4 cover rows).

- [ ] **Step 1: Failing test** — plain click calls `open` and does not navigate; ctrl-click navigates; Enter key on the link peeks.
- [ ] **Step 2: Implement, apply to the listed links. Step 3: e2e** — clicking a subclass name in Features by level opens the panel with that subclass; the URL is unchanged.
- [ ] **Step 4: Commit** — `feat(web): entity links open in the side panel`.

### Task 4: Context menu primitive and hover bridge

Owner: actions belong in right-click menus so the UI stays compact; the option-chip hint under "Features by level" closes before the pointer reaches it when it opens below (`ui/options-chip/options-chip.component.ts:47-48` closes on `mouseleave` with no grace; `popover-placement.ts:20-35`; same risk in `ui/tooltip/tooltip.directive.ts:31,161`).

**Files:**
- Create: `apps/web/src/app/ui/context-menu/context-menu.directive.ts`, `context-menu.component.{ts,html,scss}`, `context-menu.types.ts`, `ui/hover-bridge/hover-bridge.ts`
- Modify: `ui/options-chip/options-chip.component.ts`, `ui/tooltip/tooltip.directive.ts`
- Test: co-located specs; `apps/web/e2e/play-actions.spec.ts` (menu by keyboard and long-press), `e2e/textfit/kits.spec.ts` (menu surface)

**Interfaces:**
- Produces:
  ```ts
  export interface HkMenuItem {
    id: string;
    labelKey: string;                 // i18n key
    icon?: string;                    // sprite id
    detail?: string;                  // right-aligned value, e.g. "+5"
    hintKey?: string;                 // one-line explanation under the label
    disabledReasonKey?: string;       // disabled when set; shown as the hint
    run: () => void;
  }
  ```
  `[hkContextMenu]="items"` (items: `HkMenuItem[] | (() => HkMenuItem[])`) built on `CdkContextMenuTrigger` + `CdkMenu`/`CdkMenuItem`; adds a 500 ms long-press opener for touch (cancels on 10 px move, suppresses the native callout), and opens on `ContextMenu` key / Shift+F10. `<hk-menu-button [items]>` = the visible `⋯` icon button opening the same menu via `CdkMenuTrigger`.
  `hoverBridge(host: HTMLElement, panel: () => HTMLElement | null, close: () => void, graceMs = 150)` — close is deferred `graceMs` and cancelled when the pointer enters the panel.

- [ ] **Step 1: Failing tests** — context-menu: right-click opens at the pointer; long-press 500 ms opens, 300 ms does not; Shift+F10 opens and focuses the first item; disabled item shows its reason; Escape restores focus. Options-chip: `mouseleave` then `mouseenter` on the popover within 150 ms keeps it open, 200 ms without closes it — for placement below and above.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement**; apply `hoverBridge` in options-chip and tooltip.
- [ ] **Step 4: Run** unit + the e2e (open a menu on a bag row by keyboard; by long-press in the phone project) — PASS.
- [ ] **Step 5: Commit** — `feat(web): context menu with long-press and keyboard, hover bridge for popovers`.

### Task 5: Sheet header — inspiration icon, level-up icon, wake lock in the strap

Owner: inspiration takes a whole row above the features; it becomes an icon in the header. Level Up becomes an icon (arrow up). Keep Screen Awake moves to the bottom toolbar as an icon.

**Files:**
- Modify: `views/characters/sheet/sheet-shell.component.html:88-109` (level-up badge → icon button), header area of the same file (inspiration), `views/characters/sheet/play/conditions-leaf/conditions-leaf.component.html:136` (remove the toggle row), `ui/inspiration-toggle/` (icon variant, raw `rgb()` shadow → token), `views/characters/sheet/sheet-strap.ts:35-80` (add wake-lock toggle), `views/characters/sheet/play/tabs/phone-tabs.ts:148` (remove wake lock from the More list), `apps/web/tools/build-sprite.ts` + `sprite.svg` + `assets/icons/authors.json` if a new game-icons glyph is added (an "upgrade" arrow for level-up; attribution entry required)
- Test: `sheet-shell.component.spec.ts`, `inspiration-toggle.component.spec.ts`, `sheet-strap.spec.ts`, `e2e/level-up.spec.ts`

- [ ] **Step 1: Failing specs** — header has an inspiration icon toggle (accessible name "Heroic inspiration", pressed state, hint explaining it); conditions leaf has no inspiration row; level-up is an icon button with name + hint "Level up" and still routes to the wizard (and keeps its gate reason when disabled); the strap holds a wake-lock toggle (pressed state, hidden when the Wake Lock API is unavailable) and the phone More list no longer does.
- [ ] **Step 2: Implement. Step 3: Run** specs + `e2e/level-up.spec.ts` — PASS; visual-check desktop + phone.
- [ ] **Step 4: Commit** — `feat(web): inspiration, level-up and wake lock become header and strap icons`.

### Task 6: Attack row — one dice button

Owner: attack roll and damage roll become one dice icon that offers the choice.

**Files:**
- Modify: `ui/attack-row/attack-row.component.{ts,html,scss}` (`:54` `roll` output keeps its payload), `views/characters/sheet/play/attacks-leaf/attacks-leaf.component.html:18,25-28`
- Test: `attack-row.component.spec.ts`, `e2e/play-actions.spec.ts`

- [ ] **Step 1: Failing spec** — one dice button per row; activating it opens a menu with "Attack roll  +N" and "Damage  1d8+3 slashing" (values from the derived attack, `detail` field); choosing emits the same `roll` event as the old buttons; the whole row also carries `[hkContextMenu]` with the same items.
- [ ] **Step 2: Implement. Step 3: Run** spec + e2e (roll damage by keyboard) — PASS.
- [ ] **Step 4: Commit** — `feat(web): attack rolls share one dice menu`.

### Task 7: HP — temp HP visible, one split action

Owner: temp HP is not shown as a number; group Damage, Heal and Temp HP into one action whose main part repeats the last-used action, with a dropdown to switch.

**Files:**
- Create: `apps/web/src/app/ui/split-action/split-action.component.{ts,html,scss}`
- Modify: `ui/hp-gauge/hp-gauge.component.{ts,html,scss}` (`:43-69`), `views/characters/sheet/play/vitals-leaf/vitals-leaf.component.html:5-12`, `views/characters/sheet/sheet-strap.ts` (strap Damage/Heal become the same split action)
- Test: `split-action.component.spec.ts`, `hp-gauge.component.spec.ts`, `e2e/play-actions.spec.ts`, `e2e/textfit/kits.spec.ts`

**Interfaces:**
- Produces: `<hk-split-action [items]="HkMenuItem[]" [storageKey]="string" [defaultId]="string">` — main button runs and labels the remembered item (icon + text, e.g. "Damage"); the caret opens the menu (Task 4 types); choosing an item runs it and remembers its id under `hk.split.<storageKey>` in `localStorage` (try/catch; unknown or throwing → `defaultId`).

- [ ] **Step 1: Failing specs** — gauge shows `current / max` and, when temp > 0, a separate shield chip with the temp number (e.g. "23 / 31" and "+5 temp"), and the bar draws the temp segment; accessible text reads "23 of 31 hit points, 5 temporary". Split action: default Damage; choosing Heal runs Heal and the main button then reads Heal after re-render and after a new component instance; `localStorage` that throws → Damage.
- [ ] **Step 2: Implement** (Temp HP item gets its own icon; `pool-bar` negative-max "0 of -3" carry fixed here: clamp max ≥ 0). **Step 3: Run** — PASS; visual-check.
- [ ] **Step 4: Commit** — `feat(web): HP shows temporary HP and one remembered damage/heal/temp action`.

### Task 8: Abilities with their skills; check or save from one dice

Owner: group skills under their ability so a new player sees why Acrobatics is +4 (Dexterity +2 plus proficiency); check and save rolls share one dice with a hint saying which to use. Owner decision: saves stay on Play, merged into the ability block (not hidden in Build).

**Files:**
- Modify: `views/characters/sheet/play/abilities-leaf/abilities-leaf.component.{ts,html,scss}` (`:24`, `:52-69`), `views/characters/sheet/play/skills-leaf/` (its rows move into the ability blocks; the leaf is removed from Play and from the phone tabs list), `phone-tabs.ts`
- Test: `abilities-leaf.component.spec.ts`, `e2e/play-actions.spec.ts`, `e2e/mobile/tabs.spec.ts`, text-fit routes

- [ ] **Step 1: Failing spec** — six ability blocks in pack order (from the system entity, not hard-coded); each shows score, modifier, and its skills (skill → ability from the pack's skill entities) with their bonuses and proficiency/expertise marks; the ability's dice opens "Ability check +2 — when you try something that might fail" and "Saving throw +5 — when an effect such as a spell or a trap asks you to resist it", proficient save marked; skill rows roll their skill on click; skill-row breakdown hint shows "Dexterity +2, proficiency +2".
- [ ] **Step 2: Implement** (proficiency dots stop being tab stops: roving focus per block — closes the plan-17 carry). **Step 3: Run** — PASS; visual-check desktop + phone in en and uk.
- [ ] **Step 4: Commit** — `feat(web): skills sit under their ability; check and save share one dice`.

### Task 9: Compact rows — features, inventory

Owner: the one-line feature description is useless, remove it (the info button opens the text). Inventory management moves into the context menu.

**Files:**
- Modify: `ui/feature-row/feature-row.component.html` (drop the summary line; info button opens `PeekService`), `views/characters/sheet/play/bag-leaf/bag-leaf.component.html` (use `:23`, equip `:35`, attune `:47`, details `:58`, qty `:71/:83`, remove `:94` → row keeps name, quantity, equipped/attuned state icons, one `hk-menu-button`; same items on `[hkContextMenu]`; add-from-library `:109` and add-custom `:119` stay as the leaf's two buttons), satchel roving-focus carry
- Test: `feature-row.component.spec.ts`, `bag-leaf.component.spec.ts`, `e2e/play-actions.spec.ts`

- [ ] **Step 1: Failing specs** — feature row has no summary text node; bag row exposes Use/Equip/Unequip/Attune/Quantity +1/−1/Details/Remove through the menu with correct disabled reasons (e.g. attunement full), and Remove keeps its existing confirmation.
- [ ] **Step 2: Implement. Step 3: Run** + e2e (equip and remove by keyboard menu; on phone by long-press) — PASS.
- [ ] **Step 4: Commit** — `feat(web): compact feature and inventory rows with item menus`.

### Task 10: Rules hints for new players

Owner: hover hints that explain what a stat is for (e.g. Initiative: rolled at the start of a fight to set the turn order).

**Files:**
- Create: `apps/web/src/assets/i18n/characters/{en,ru,uk}.json` keys under `sheet.explain.*`
- Modify: the sheet components showing: Armor Class, Initiative, Speed, Proficiency bonus, Passive Perception, Hit Dice, Death saves, Spell save DC, Spell attack bonus, Concentration, Exhaustion, Heroic Inspiration, Temporary HP, each ability, Ability check vs Saving throw (Task 8 reuses these)
- Test: `apps/web/src/app/views/characters/sheet/explain-hints.spec.ts`, text-fit

- [ ] **Step 1: Failing spec** — each listed stat has a `[hkTooltip]` whose text is the `sheet.explain.<stat>` string followed by the live breakdown when one exists (R40 contributions); all keys exist in en/ru/uk; no hint text contains a number literal (values come from the sheet).
- [ ] **Step 2: Write the strings** — one or two plain sentences each, rules-edition-neutral (they must read right for 2014 and 2024, plan 21). **Step 3: Implement. Step 4: Run** — PASS.
- [ ] **Step 5: Commit** — `feat(web): rules hints for new players`.

### Task 11: UX review pass (proposals, not code)

Owner: review the UI/UX again for more compaction (context menus, combined buttons) and new-player help.

**Files:**
- Create: `docs/superpowers/design/2026-11-plan20-ux-review.md`

- [ ] **Step 1:** Screenshot Home, Library list + entry, Create wizard, Play (desktop + phone), Build, Timeline, Campaign party/log, Settings in tavern theme, en + uk; `visual-check` agents review against: one primary action per block, repeated buttons that could be one menu, rows wider than their content, missing hints, touch targets < 44 px.
- [ ] **Step 2:** Write the proposals table (id, screen, problem, proposal, effort S/M/L). Seed it with: spell row actions (cast / upcast / prepare) into a dice menu + context menu; Short/Long rest as one split action in the strap; Add condition from a context menu on the HP block; the roll log as a peek panel; the Build tab saves block as the only full saves view.
- [ ] **Step 3:** Implement nothing from it. Commit — `docs(web): plan 20 UX review proposals`. The owner picks rows for a later plan.

### Task 12: Plan-18 and Phase-4 carries

From `plan18-status` and `docs/03-roadmap/phases.md` Phase 4 flag (11). Each bullet is its own red-green commit.

**Files:** found per bullet; named where known.

- [ ] **12.1 House rules lock the DM's own hero** — `apps/web/src/app/shared/services/campaigns/house-rules.ts` `houseRuleAllows` has no role check. Test (`house-rules.spec.ts`): the campaign DM editing their own linked hero is allowed every action a house rule would block for players. `fix(web): house rules do not bind the DM`.
- [ ] **12.2 A failed condition refresh drops it silently** — conditions-leaf `refresh()` rejection: test that the condition is kept and an error toast shows (existing toast service). `fix(web): a failed condition save is reported, not dropped`.
- [ ] **12.3 Add-condition dialog reads a stale clock** — the dialog's gate reads the polled clock captured before opening; read it fresh on submit. Test with a clock advanced while the dialog is open.
- [ ] **12.4 Encounter lines missing from the log feed** — encounter start/round/end events render as log lines (i18n ×3). Test in the log-tab spec.
- [ ] **12.5 DM party view does not fetch member item icons** — test that member icon hashes from events are requested over the blob relay.
- [ ] **12.6 Condition glyph accessible names are English slugs** — use the localized condition name. Test in ru.
- [ ] **12.7 Campaign stream polled twice per linked sheet; full event-stream read per hero on pin refresh** — share one poll per campaign; refresh pins from the snapshot plus tail. Tests count calls (1 poll; no full read).
- [ ] **12.8 Cold deep-link level-up treats multiclass as allowed** — test: opening `/…/level-up` directly on a hero whose campaign forbids multiclassing offers no other class.
- [ ] **12.9 Party-sheets default mismatch (Phase 4 flag 11)** — server defaults `full` (`apps/api/src/core/streams/campaign-actor.ts:143`), web treats unsaved as Overview (`party-tab.component.ts:95`, `campaign-settings.component.ts:44`). Make the web read the server default (`full`). Test both components with never-saved settings.
- [ ] **12.10 Mojibake em dashes** in `conditions-leaf.component.spec.ts:23,299,332` — fix the characters. `test(web): …`.

### Task 13: QA gate and handoff

- [ ] **Step 1:** Root `pnpm check`; `pnpm --filter web e2e`, `e2e:sync`, the text-fit and mobile projects; axe per theme — all green; record numbers.
- [ ] **Step 2:** Run `docs/manual-device-checklist.md` sections that touch the changed screens on a real phone if available; note what was not run.
- [ ] **Step 3:** Update `docs/03-roadmap/phases.md` (Phase 5 row: "slice 3 executed …"; mark the closed carries), write the release note if any client behaviour changed for older builds (none expected).
- [ ] **Step 4:** Commit — `docs(repo): plan 20 wrap`. Owner reviews screenshots before merge.
