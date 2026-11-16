# Phase 5 — Owner Decisions (plan 19, runs before plan 18) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**STATUS: WRITTEN 2026-11-16 — awaiting owner approval. Runs before plan 18 (`2026-11-03-phase-5-slice-2-approved-additions.md`).**

**Goal:** Build every "Build" row of the owner's 2026-11-16 decisions so the default SRD content can be tested at a real table: correct icons, a library that remembers where you were, in-app Back that keeps your place, a one-time HP roll, honest breakdowns, named prerequisites, spell higher-level text and dice, starting equipment kits, a restorable export-all backup, fresh recovery codes, and no prerelease pack updates.

**Architecture:** Mostly web fixes on the plan 17 `ui/` library and views. Three items reach lower layers: the engine exposes data it already computes (breakdown bases, unmet prerequisites); the pack format gains two optional fields filled by the SRD transform (`higherLevelDice` on spells, `startingEquipment` on classes and backgrounds); the API gains one authenticated route (regenerate recovery codes). No new events: kits use the existing `item.added@1` / `currency.changed@1`, the HP roll still commits through `level.gained@1`.

**Tech Stack:** Angular 22 zoneless (signals, `Router`, `ViewportScroller`), Vitest + Playwright, Zod pack schemas with the JSON-schema drift gate, `@hk/engine` with goldens, `@hk/content` transforms + overlays, Hono API core with the Node and Cloudflare adapters, fflate.

**Spec:** `docs/03-roadmap/phases.md` → "Owner decisions on the open flags (2026-11-16)" (rows 2–9, 12, 19 and the icon row). Boards: `docs/superpowers/design/2026-11-stage-a/boards/S1/boards.cjs:486-520` (W09 kit cards) + `notes/S1-notes.md:64-66,108`; `boards/S4/LB02-Library-Spell-Desktop.src.html:55-57` (higher-level chips).

## Global Constraints

- Game rules are data (CLAUDE.md rule 1): kit contents and higher-level dice come from the SRD transform into the pack; the web renders them and never hard-codes a class, background or spell.
- i18n is structural: every new UI string ×3 (en/ru/uk); content text through the engine Localizer.
- Events are immutable: this plan adds NO event type or version. Pack schema additions are `.optional()` only, so every existing pack parses byte-identically.
- `packages/engine/src` stays deterministic (no `Date.now`, `Math.random`, locale ops).
- After any pack schema change: `pnpm --filter @hk/protocol build:schema` (CI drift gate). After any transform/overlay change: `pnpm --filter @hk/content build:pack` (never edit dist by hand).
- API: core logic only under `apps/api/src/core`; both adapters proven through `apps/api/test/conformance/` (+ `pnpm --filter api test:cloudflare`).
- TDD red first; each task ends with a Conventional Commit with a scope; each commit typechecks alone.
- Gates per task: `pnpm --filter web lint`, `pnpm --filter web test --watch=false` (no `--`), `pnpm --filter web build` (gzip ≤ 600 kB), root `pnpm typecheck`, root `pnpm vitest run`. Final task also runs `e2e`, `e2e:sync`, `e2e:textfit`, `e2e:mobile`.

## Review Focus

1. A person picks the Monsters chip, searches "dragon", scrolls down, opens an entry and presses the in-app Back: the chip, search text, sort and scroll position all come back — and the same holds for the browser Back (Tasks 2 and 3 tests).
2. An export-all zip holding one hero already on this device, one synced hero and one new hero: the new hero imports, the existing one merges, the synced one is reported as skipped — one bad entry never aborts the rest (Task 9 test).
3. A `.zip` that is not an export-all (a `.hkpack`, a zip of photos, an entry whose declared size is huge): a clear error, nothing imported, no long freeze (Task 9 test).
4. In the wizard a person picks Fighter kit A, then changes class to Wizard: Fighter's kit items and gold leave the bag, the background kit and hand-added items stay (Task 8b test).
5. A stolen session cookie without the password cannot mint recovery codes; after a regeneration the old codes no longer reset the password (Task 10 conformance test).

---

### Task 1: Badge icons render at full size

The 11 `ui-*` symbols that wrap a 216-unit badge source (`ui-settings`, `ui-add`, `ui-remove`, `ui-build`, `ui-condition`, `ui-dm`, `ui-hp`, `ui-proficient-save`, `ui-spend`, `ui-theme-scroll`, `ui-theme-tavern`) copy the source's `viewBox="20 20 216 216"`. The nested `<use>` resolves to a 216-unit viewport at the origin, so the glyph shifts up-left by 20 units, its top and left edges clip and the bottom/right band is empty.

**Files:**
- Modify: `apps/web/tools/build-sprite.ts` (the `ui-*` wrapper push: wrapper viewBox is `0 0 <w> <h>` of the source box — `0 0 216 216` for `BADGE_VIEWBOX` sources, unchanged `0 0 512 512` for standard ones), `apps/web/src/assets/icons/sprite.svg` (regenerated with `pnpm --filter web build:sprite`)
- Test: `apps/web/tools/build-sprite.spec.ts`

- [ ] **Step 1: Failing test** — `it('wraps a badge source in a viewBox that starts at the origin')`: for every `ui-*` symbol in the generated sprite, the wrapper viewBox starts with `0 0 ` and its width/height equal the referenced `gi-*` symbol's viewBox width/height; `ui-settings` is `0 0 216 216`.
- [ ] **Step 2: Run** `pnpm --filter web test --watch=false --include tools/build-sprite.spec.ts` — FAIL on `ui-settings` (`20 20 216 216`).
- [ ] **Step 3: Fix the wrapper viewBox in `build-sprite.ts`; regenerate `sprite.svg`.**
- [ ] **Step 4: Run the spec** — PASS, including the existing byte-for-byte drift gate (`build-sprite.spec.ts:139`).
- [ ] **Step 5: Visual proof** — screenshot the desktop nav rail (settings next to home/library) and the sheet HP badge in the tavern theme before and after; a `visual-check` agent confirms the cog fills the button like its neighbours and nothing is clipped. Record the verdict in the report.
- [ ] **Step 6: Commit** — `fix(web): badge icons fill their frame`.

### Task 2: Library opens on All and remembers the chip

`browse.component.ts` holds `chosenTypes`, `query` and `sort` as component signals and defaults to `['spell']` (`:65`), so leaving for an entry destroys the choice.

**Files:**
- Modify: `apps/web/src/app/views/library/browse/browse.component.ts` (state from the URL), `.html` if bindings change
- Test: `apps/web/src/app/views/library/browse/browse.component.spec.ts` (`:403` "default Spells chip" becomes "default All"), `apps/web/e2e/library.spec.ts`

**Interfaces:**
- Produces: library list URL `/library?type=<entity type>&q=<text>&sort=<LibrarySort>`; every param optional; no `type` = All. Writing state uses `router.navigate([], { queryParams, queryParamsHandling: 'merge', replaceUrl: true })`; reading uses `toSignal(route.queryParamMap)`.

- [ ] **Step 1: Failing unit tests** — (a) untouched browse shows every type (All chip pressed); (b) pressing the Monsters chip writes `?type=monster` with `replaceUrl: true`; (c) creating the component with `?type=monster&q=dragon&sort=name` shows the Monsters chip pressed, "dragon" in the field and name sort; (d) typing in search writes `q` (debounced as the field already is) and clearing it removes `q`; (e) an unknown `type` value falls back to All.
- [ ] **Step 2: Run** the browse spec — FAIL.
- [ ] **Step 3: Implement** — drop `DEFAULT_BROWSE_TYPES`; `chosenTypes`/`query`/`sort` derive from the query params; the chip, field and sort handlers write the params. A search with no chip pressed still searches every type (unchanged).
- [ ] **Step 4: Check the history stack** — confirm in `ui/nav/nav-history.service.spec.ts` that a `replaceUrl` navigation replaces the stack top instead of pushing (add the spec case if missing), so one Back leaves the library rather than stepping through every keystroke.
- [ ] **Step 5: e2e** — `library.spec.ts`: press Monsters, type "dragon", open the first row, press the in-app Back → Monsters pressed, "dragon" in the field; the same after `page.goBack()`.
- [ ] **Step 6: Gates; commit** — `fix(web): library opens on all types and keeps the chip, search and sort in the url`.

### Task 3: In-app Back restores the scroll position (R74)

`NavHistoryService.back()` (`apps/web/src/app/ui/nav/nav-history.service.ts`) pops the stack and calls `router.navigateByUrl(top)`; that is not a popstate navigation, so `withInMemoryScrolling` scrolls to the top.

**Files:**
- Modify: `apps/web/src/app/ui/nav/nav-history.service.ts`
- Test: `apps/web/src/app/ui/nav/nav-history.service.spec.ts`, `apps/web/e2e/library.spec.ts` (extend the Task 2 case)

**Interfaces:**
- Consumes: Task 2's URL state (the restored list must be the same length before scrolling).
- Produces: unchanged public API `back(fallback)`.

- [ ] **Step 1: Failing tests** — (a) navigate A → B with A scrolled to `[0, 640]`, call `back()`: after the navigation's router `Scroll` event, `ViewportScroller.scrollToPosition` was last called with `[0, 640]`; (b) a forward in-app navigation still lands at `[0, 0]`; (c) `back()` with an empty stack (fallback route) lands at `[0, 0]`; (d) browser Back is untouched (existing `app-router-scrolling.spec.ts` stays green).
- [ ] **Step 2: Run** — FAIL on (a).
- [ ] **Step 3: Implement** — on `NavigationStart` record `viewportScroller.getScrollPosition()` against the stack entry being left; in `back()` remember the navigation id it starts, and when the router emits `Scroll` for that id, call `scrollToPosition(saved)` (subscribing after the router's own scroller means this call runs last). Positions live only in memory.
- [ ] **Step 4: e2e** — the Task 2 case also scrolls the list before opening the entry and asserts `window.scrollY` is within 50 px of the earlier value after the in-app Back.
- [ ] **Step 5: Gates; commit** — `feat(web): in-app back returns to the previous scroll position`.

### Task 4: One HP roll per level (R43)

`LevelUpState.rollHp()` (`apps/web/src/app/views/characters/level-up/level-up.state.ts:446-455`) overwrites on every press and lives only in signals; leaving and re-entering the flow starts fresh. The campaign `hpOnLevelUp` house rule stays out of scope (plan 18 / later).

**Files:**
- Modify: `level-up.state.ts`, `level-up.component.ts`/`.html` (`.level-up__hp-roll` at `:112-127`), `apps/web/src/assets/i18n/characters/{en,ru,uk}.json`
- Test: `level-up.state.spec.ts`, `level-up.component.spec.ts`, `apps/web/e2e/level-up.spec.ts`

**Interfaces:**
- Produces: a device-local pending roll stored in the existing Dexie `settings` table under `levelup.hpRoll:<streamId>:<newCharacterLevel>:<classId>` → `{ roll: number; dice: number[] }`; deleted for the stream when `level.gained` commits.

- [ ] **Step 1: Failing state tests** — (a) after `rollHp(scriptedRng)`, a second `rollHp` keeps the first value; (b) after a roll, `chooseAverageHp()` is refused (value unchanged); (c) a new `LevelUpState` for the same stream, level and class loads the stored roll as already rolled; (d) a stored roll for level 4 is not used for level 5, nor for a different class's hit die; (e) `buildTransaction` still emits `level.gained@1` with `hpRoll: <roll>`, and finishing deletes the stored key.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** — guard `rollHp`/`chooseAverageHp` on an existing roll; persist on roll, load on state init, delete on finish.
- [ ] **Step 4: Failing component test, then make it pass** — after Roll, both Roll and "Take average" are disabled with the hint `levelUp.hp.rolledOnce` ("Rolled — one roll per level", ru/uk too) through the existing disabled-reason path; the rolled dice stay shown.
- [ ] **Step 5: e2e** — roll, leave level-up, return: the same roll is shown and Roll is disabled; finish; the sheet's max HP includes the roll.
- [ ] **Step 6: Gates; commit** — `feat(web): one hit point roll per level`.

### Task 5: Breakdowns show the ability modifier and proficiency (R40)

`ModifierTable.resolve(target, base, …)` (`packages/engine/src/derive/modifiers.ts:49-93`) never lists `base`; saves (`abilities.ts:385`), skills (`:410`), attack to-hit (`attacks.ts:392`) and damage (`:393`) fold ability modifier and proficiency into `base`, so the popover (`derived-popover.directive.ts:31-47`) says "No modifiers." for a proficient skill.

**Files:**
- Modify: `packages/engine/src/derive/modifiers.ts` (`resolve` accepts base parts), `packages/engine/src/derive/abilities.ts`, `packages/engine/src/derive/attacks.ts`; goldens under `packages/engine/test/golden/` that store `contributions` (9 files: campaign-pack-member, charged-items, homebrew-pinned, mastery-sum-rule, multi-fighter5-barbarian3-mastery, pack-updated-v2, slippers-attuned, slippers-worn, thief-3-climb)
- Modify: `apps/web/src/app/views/characters/sheet/play/derived-popover.directive.ts` (`sourceName`/`amountText` for the new kinds), `apps/web/src/assets/i18n/characters/{en,ru,uk}.json`
- Test: `packages/engine/test/derive/abilities.test.ts`, `packages/engine/test/derive/attacks.test.ts`, `apps/web/src/app/views/characters/sheet/play/derived-breakdowns.spec.ts`

**Interfaces:**
- Produces: two `Contribution.kind` values — `'abilityModifier'` (`key`: the ability id, `amount`: the modifier) and `'proficiency'` (`key`: `'proficient' | 'expertise' | 'half'`, `amount`: the amount `proficiencyAmount` returns). Listed first, before modifier-table entries; zero amounts are omitted except an ability modifier of 0 on a proficient value. `Derived.value` is unchanged everywhere.

- [ ] **Step 1: Failing engine tests** — fighter-1 Athletics (proficient): contributions start `[{kind:'abilityModifier', key:'str', amount:<mod>}, {kind:'proficiency', key:'proficient', amount:2}]`; a non-proficient skill lists only the ability modifier; an expertise skill shows `key:'expertise'`; Jack of All Trades shows `key:'half'`; a save and a weapon to-hit/damage likewise (damage: ability modifier only); every `value` equals the old value.
- [ ] **Step 2: Run** `pnpm vitest run --project engine` — FAIL.
- [ ] **Step 3: Implement** — pass the base parts into `resolve`; the sum is unchanged.
- [ ] **Step 4: Re-pin goldens** — regenerate; `git diff packages/engine/test/golden` must touch only `contributions` arrays (no `value` changes); state that check in the report. Grep the web for code that sums `contributions` to recompute a value and make sure none does.
- [ ] **Step 5: Web** — the popover names "Strength modifier", "Proficiency", "Expertise", "Half proficiency" (×3 locales); `derived-breakdowns.spec.ts` asserts the fighter-1 popover lists them instead of "No modifiers.".
- [ ] **Step 6: Gates; commit** — `feat(engine): breakdowns list the ability modifier and proficiency`.

### Task 6: Prerequisite gates name the requirement (B10a)

`evaluatePredicate` (`packages/engine/src/predicate/evaluate.ts:14`) returns a boolean; `checkPrerequisites` (`derive/validation.ts:32-50`) emits `selection.prerequisiteFailed` with `{path, entityId}`; the web maps it to "Prerequisites not met" (`choice-step.component.ts:54,64`, `level-up.component.html:61`). The SRD uses only `ability`, `level`, `spellcaster` (plus `any`/`all` in multiclass prerequisites).

**Files:**
- Create: `packages/engine/src/predicate/unmet.ts`
- Modify: `packages/engine/src/derive/validation.ts` (diagnostic carries `unmet`), the engine index export
- Create: `apps/web/src/app/shared/services/engine/prerequisite-text.ts` (pure function)
- Modify: `choice-step.component.ts`, `level-up.component.ts`/`.html` (and whatever computes `card.gated` — find with `rg "gated" apps/web/src/app/views/characters`), `apps/web/src/assets/i18n/characters/{en,ru,uk}.json`
- Test: `packages/engine/test/predicate/unmet.test.ts`, `apps/web/src/app/shared/services/engine/prerequisite-text.spec.ts`, `choice-step.component.spec.ts` (`:424`, `:493-508`), `level-up.component.spec.ts` (`:1042`)

**Interfaces:**
- Produces: `unmetPrerequisites(predicates: Predicate[], ctx: PredicateContext): Predicate[]` — the smallest failing sub-predicates: a failing `all` yields its failing children; a failing `any` yields the `any` itself (so it reads "one of …"); a failing leaf yields itself. `selection.prerequisiteFailed` diagnostics gain `unmet: Predicate[]`.
- Produces: `prerequisiteText(unmet: Predicate[], t: TranslateFn, name: (id: EntityId) => string): string` — renders `ability` ("Strength 13+"; `lte`/`eq` too), `level` ("Character level 4+"), `classLevel` ("Fighter level 3+"), `spellcaster` ("Ability to cast spells"), `any` ("One of: Strength 13+ or Dexterity 13+"), several unmet joined with the locale's list joiner; any other kind falls back to the existing "Prerequisites not met".

- [ ] **Step 1: Failing engine tests** — STR 12 vs `{ability:{str:{gte:13}}}` → that leaf; a passing set → `[]`; `all` with one failing child → that child; `any` with both failing → the `any`; level gate on a level-3 character → the level leaf.
- [ ] **Step 2: Run** `pnpm vitest run --project engine -t unmet` — FAIL; implement; PASS.
- [ ] **Step 3: Failing web tests** — `prerequisiteText` for each case above in en (ru/uk keys exist; the i18n key check passes); choice-step and level-up cards show e.g. "Requires Strength 13+" as the gate reason.
- [ ] **Step 4: Implement and wire**; the generic text stays the fallback.
- [ ] **Step 5: Gates; commit** — `feat(engine): name the unmet prerequisite`.

### Task 7: Spell higher-level text and dice

122 SRD spells carry `higherLevels` text (transform `packages/content/src/transform/spells.ts:214`, vendored `higher_level`), but no screen renders it. Survey: 35 follow "The damage increases by XdY for each spell slot level above N", 14 cantrips follow "increases by 1dX when you reach levels 5 (…), 11 (…), and 17 (…)"; the rest are irregular and stay text only.

**Files:**
- Modify: `packages/protocol/src/pack/entities-content.ts` (spell schema), `packages/protocol/schema/*.json` (regenerated)
- Modify: `packages/content/src/transform/spells.ts`
- Modify: `apps/web/src/app/views/library/detail/detail.component.html`/`.ts` (after the description, `:62-76`), `apps/web/src/app/ui/description-drawer/description-drawer.component.ts` (a spell section after the description, `:180-196`), `apps/web/src/assets/i18n/{library,characters}/{en,ru,uk}.json` (whichever scopes those views use)
- Test: `packages/protocol/test/pack/*.test.ts` (spell schema case), `packages/content/test/spells.test.ts`, `detail.component.spec.ts`, `description-drawer.component.spec.ts`

**Interfaces:**
- Produces: optional spell field `higherLevelDice?: { perSlot: { dice: Dice; aboveLevel: 1..8 } } | { cantrip: { level: 5 | 11 | 17; dice: Dice }[] }` (`Dice` = `DiceSchema` from `packages/protocol/src/pack/common.ts:14`, e.g. `"1d6"`).
- Produces: web text — heading "At higher levels"; per-slot chips "Slot N: <total>" for slots `aboveLevel + 1 … 9` when the spell's `damage.dice` uses the same die (total = base count + (N − aboveLevel) × per-slot count, e.g. Fireball "Slot 4: 9d6" … "Slot 9: 14d6"), otherwise one chip "+XdY per slot above N"; cantrip chips "Level 5: 2d6", "Level 11: 3d6", "Level 17: 4d6".

- [ ] **Step 1: Failing protocol test** — a spell with each `higherLevelDice` shape parses; one without parses; `aboveLevel: 9` is refused. Run, FAIL, add the schema, `build:schema`, PASS.
- [ ] **Step 2: Failing transform tests** — Fireball → `{perSlot:{dice:'1d6', aboveLevel:3}}`; Acid Splash → cantrip `[{5,'2d6'},{11,'3d6'},{17,'4d6'}]`; Aid (hit points, not damage) → no `higherLevelDice`; a whole-pack test pins the counts the parser finds (expected near 35 per-slot and 14 cantrip — pin the real numbers and list any spell the survey counted that the parser skips, in the report).
- [ ] **Step 3: Implement the parser in `spells.ts`**; `pnpm --filter @hk/content build:pack`; PASS.
- [ ] **Step 4: Failing web tests** — library detail for Fireball shows "At higher levels", the rendered `higherLevels` text and chips "Slot 4: 9d6" … "Slot 9: 14d6"; Aid shows the text and no chips; a spell without `higherLevels` shows no section; the description drawer for a spell on the sheet shows the same section.
- [ ] **Step 5: Implement** — render `higherLevels` with `MarkdownService.render(localizer.text(id, 'higherLevels'), localizer)` (same path as `description`); chips with the existing `hk-tag-chip`; text-fit e2e (`e2e:textfit`) stays green in ru/uk.
- [ ] **Step 6: Gates; commit** — `feat(web): spells show their higher-level text and dice`.

### Task 8a: Starting equipment in the pack

The 2024 SRD starting equipment is prose: classes in `packages/content/upstream/open5e-srd-2024/ClassFeature.json` (`srd-2024_<class>_core-traits`, row "Starting Equipment": "Choose A or B: (A) Greataxe, 4 Handaxes, Explorer's Pack, and 15 GP; or (B) 75 GP"; Fighter has A, B, C), backgrounds in `BackgroundBenefit.json` (`srd-2024_<bg>_equipment`). Most names resolve to the pack's 960 `item/*` ids; some do not (e.g. "Arcane Focus", "Spellbook", "Holy Symbol" has three variants, tool or instrument "of your choice").

**Files:**
- Modify: `packages/protocol/src/pack/entities-progression.ts:32-58` (`ClassEntitySchema`), `packages/protocol/src/pack/entities-simple.ts:174-179` (`BackgroundEntitySchema`), `packages/protocol/schema/*.json`
- Create: `packages/content/src/transform/starting-equipment.ts`, `packages/content/src/overlays/starting-equipment-names.json`
- Modify: `packages/content/src/transform/classes.ts:235`, `packages/content/src/transform/backgrounds.ts:73`
- Test: protocol schema test, `packages/content/test/starting-equipment.test.ts`

**Interfaces:**
- Produces: optional `startingEquipment?: { label: 'A' | 'B' | 'C'; items: { item: EntityId; qty: number }[]; notes: string[]; gp: number }[]` (1–3 options; `items` ≤ 30; `notes` are short texts for "of your choice" items the player adds themselves) on class and background entities.
- Produces: `parseStartingEquipment(text: string, resolve: (name: string) => { item: EntityId } | { note: string }): StartingOption[]`.
- Overlay `starting-equipment-names.json`: `{ "<name as written>": "<item id>" | { "note": "<text>" } }` for every name that does not resolve by slug. The transform throws on a name that neither resolves nor appears in the overlay, so new upstream text cannot silently drop an item.

- [ ] **Step 1: Failing protocol test** — class and background parse with and without `startingEquipment`; 4 options are refused. Implement, `build:schema`, PASS.
- [ ] **Step 2: Failing parser tests** — Barbarian → A `[greataxe×1, handaxe×4, explorers-pack×1]` + 15 gp, B 75 gp; Fighter → three options, C 155 gp; Soldier background → A items + 14 gp, B 50 gp; an unknown name throws naming it; a name mapped to a note lands in `notes`.
- [ ] **Step 3: Implement the parser and overlay; wire into both transforms**; `build:pack`; a whole-pack test: all 12 classes and every SRD background have `startingEquipment` and every `item` resolves to an item entity in the pack.
- [ ] **Step 4: Gates; commit** — `feat(content): starting equipment options for classes and backgrounds`.

### Task 8b: Kit cards in the creation wizard (W09)

The equipment step (`apps/web/src/app/views/characters/create-wizard/steps/equipment-step.component.ts`) only adds items by hand; `create-wizard.state.ts` already emits `item.added@1` (`addItem` `:434`) and replaces `currency.changed@1` (`setCurrency` `:465`). Board W09: kit cards A/B/(C) per source, A selected by default, the bag shows "Option A is in the bag below". The "Starting gold is off" house rule is not built (plan 18 territory); all options are choosable.

**Files:**
- Modify: `equipment-step.component.ts`/`.html`/`.scss`, `create-wizard.state.ts`, `apps/web/src/assets/i18n/characters/{en,ru,uk}.json`
- Test: `create-wizard.state.spec.ts`, `equipment-step.component.spec.ts`, `apps/web/e2e/create-fighter.spec.ts`

**Interfaces:**
- Consumes: Task 8a `startingEquipment`.
- Produces: `CreateWizardState.chooseKit(source: 'class' | 'background', label: 'A' | 'B' | 'C' | null): void` and `kitChoice(source): Signal<'A' | 'B' | 'C' | null>`. Kit items are draft `item.added@1` events tagged by source in wizard state; gold is `currency.changed@1` with `gp = class kit gp + background kit gp` (a manual currency edit after that stands until the next kit change).

- [ ] **Step 1: Failing state tests** — choosing class kit A adds its items and sets gp; switching to B removes A's items and sets gp to B's; changing the class removes the old class's kit items and preselects the new class's A; the background kit and hand-added items survive both; `null` removes that source's kit; "of your choice" notes add nothing.
- [ ] **Step 2: Run, implement, PASS.**
- [ ] **Step 3: Failing component tests** — one card per option with its item names (localized), notes and gp; A preselected on first visit; the bag line "Option A is in the bag below"; a class or background without `startingEquipment` (homebrew) shows no cards and the step works as before.
- [ ] **Step 4: Implement** with the existing `ui/` card and radio patterns from W09; e2e: create a Fighter, pick kit C, finish → the sheet shows 155 gp plus the background kit A gp and none of kit A’s items.
- [ ] **Step 5: Gates (incl. `e2e:textfit` for the cards in ru/uk); commit** — `feat(web): starting equipment kits in the creation wizard`.

### Task 9: Import an export-all zip (R61)

Export-all (`apps/web/src/app/shared/services/export/export-all-heroes.service.ts`) zips one `.hero` per hero with fflate (`zip-files.ts:6`). Single import is `HeroReaderService.import(file)` (`hero-reader.service.ts:307`) via `HeroImportFlow.importFile` (`views/characters/hero-import.flow.ts:39`), picker accept `'.hero'` (`:18`). A `.hero` is itself a zip with `manifest.json`; the outer export-all zip has none, so today it fails with `HeroImportBadZipError`.

**Files:**
- Modify: `apps/web/src/app/views/characters/hero-import.flow.ts` (`HERO_IMPORT_ACCEPT = '.hero,.zip'`, zip detection, per-entry loop, summary), `apps/web/src/assets/i18n/characters/{en,ru,uk}.json`
- Test: `apps/web/src/app/views/characters/hero-import.flow.spec.ts` (new), `apps/web/e2e/export-import.spec.ts` (extend)

**Interfaces:**
- Produces: `HeroImportFlow.importFile(file)` handles both kinds; for an export-all zip it returns `{ imported: string[]; merged: string[]; skipped: { name: string; reason: 'synced' | 'invalid' }[] }` and shows one summary toast/dialog.
- Limits (checked from the zip directory before inflating anything): at most 500 `.hero` entries; each entry's declared size within the single-file `.hero` cap the reader already enforces; total declared size ≤ 512 MiB. A zip with a `manifest.json` at the root is a single `.hero` (unchanged path); a zip with neither a manifest nor any `.hero` entry is refused with "This file is not a hero or an export of heroes".

- [ ] **Step 1: Failing tests** — an export-all zip of 3 heroes (built with the real export path in the spec) imports all 3; with one already on the device it reports 2 imported + 1 merged; with one synced it reports it skipped and still imports the others; a zip of two `.png` files is refused; a zip whose directory declares an over-cap entry is refused before inflating; a single `.hero` still imports as before.
- [ ] **Step 2: Run, implement, PASS** — reuse `HeroReaderService.import` per entry (wrap each inflated entry as a `File` named after the entry); errors per entry are collected, never thrown out of the loop.
- [ ] **Step 3: e2e** — export all with two heroes, delete one, import the zip → both present, summary says 1 imported, 1 merged.
- [ ] **Step 4: Gates; commit** — `feat(web): import the export-all zip`.

### Task 10: Regenerate recovery codes

Registration creates 6 codes (`apps/api/src/core/auth/register.ts:15,61-71`; table `recovery_codes` `core/db/schema.ts:75-84`; queries `insertRecoveryCodes` `:202`, `deleteRecoveryCodesForUser` `:217`; `cli/admin.ts:258-268` already does delete-then-insert). Auth routes: `core/routes/auth.ts` (`createAuthRoutes` `:20`, `requireAuth` from `core/auth/middleware.ts:23`).

**Files:**
- Create: `apps/api/src/core/auth/regenerate-recovery-codes.ts`
- Modify: `apps/api/src/core/routes/auth.ts` (route), `apps/api/test/conformance/scenarios.ts` (extend `authLifecycleScenario`)
- Modify: `apps/web/src/app/shared/services/auth/auth.service.ts` (method), `apps/web/src/app/views/settings/settings.component.html`/`.ts` (button in `.settings__actions` `:196-216`)
- Create: `apps/web/src/app/ui/recovery-codes/recovery-codes.component.ts` (list + copy + download, moved out of `views/auth/register/register.component.ts:174-259` and reused there), `apps/web/src/app/views/settings/recovery-codes-dialog.component.ts`
- Test: `apps/api/test/core/auth.test.ts`, conformance (both adapters), `auth.service.spec.ts`, the two new component specs, `register.component.spec.ts` stays green, `apps/web/e2e-sync/` auth scenario (extend)

**Interfaces:**
- Produces: `POST /api/auth/recovery-codes` — `requireAuth` + the existing `requireXRequestedWith` and `ipAuthRateLimit`; body `{ verifier }` checked exactly as `/login` checks the password (reuse that function; a session alone is not enough); one transaction deletes the user's codes and inserts 6 new ones (hashing as `register.ts`); `200 { recoveryCodes: string[] }`; `401` without a session; `401` (same body as a failed login) on a wrong password.
- Produces: `AuthService.regenerateRecoveryCodes(password: string): Promise<string[]>`.

- [ ] **Step 1: Failing API tests** — happy path returns 6 codes; a new code resets the password via `POST /reset`; an old code is refused; no session → 401; wrong password → 401 and the old codes still work.
- [ ] **Step 2: Run** `pnpm vitest run --project api -t "recovery"` — FAIL; implement; PASS; extend the conformance scenario; `pnpm --filter api test:cloudflare` PASS.
- [ ] **Step 3: Failing web tests** — the Settings account section (signed in) shows "New recovery codes"; the dialog asks for the password, then shows the codes with copy and download and the warning that old codes stop working; a wrong password shows the login error text; the register screen still shows its codes through the shared component.
- [ ] **Step 4: Implement**; `e2e:sync`: sign in, regenerate, sign out, reset the password with a new code.
- [ ] **Step 5: Gates; commit** — `feat(api): regenerate recovery codes`.

### Task 11: Prerelease pack versions are not offered as updates

`updatesFor(pins, installed, shippedCore)` (`apps/web/src/app/shared/services/packs/pack-updates.ts:38`) compares with `semver.gt` (`:43-50`), so `1.1.0-beta.1` is offered over `1.0.0`.

**Files:**
- Modify: `pack-updates.ts`
- Test: `pack-updates.spec.ts` (`:58` flips: the owner decided prereleases are not offered)

- [ ] **Step 1: Failing test** — `1.0.0` pinned, `1.1.0-beta.1` installed → no update; `1.0.0` pinned, `1.1.0-beta.1` and `1.0.1` installed → `1.0.1`; a character already pinned to a prerelease is offered the stable release of that line.
- [ ] **Step 2: Run, implement** (skip candidates where `semver.prerelease(v) !== null`), **PASS.**
- [ ] **Step 3: Gates; commit** — `fix(web): prerelease packs are not offered as updates`.

### Task 12: Docs and wrap

**Files:**
- Modify: `docs/03-roadmap/phases.md` (mark the built rows in "Owner decisions on the open flags"; drop R35/R40/R43/R61/R74/B10a/B12a from the Phase 5 follow-ups), `docs/02-architecture/04-content-packs.md` (`startingEquipment`, `higherLevelDice`), `docs/02-architecture/09-frontend-architecture.md` (library URL state, Back scroll memory), `docs/README.md` (numbers from your final run), `docs/manual-device-checklist.md` (kit pick, HP roll lock, export-all restore, new recovery codes), this plan's STATUS → EXECUTED.

- [ ] **Step 1: Run every gate once after the last change** — lint, web unit, build (record gzip), typecheck, root vitest, `pnpm --filter api test:cloudflare`, `e2e`, `e2e:sync`, `e2e:textfit`, `e2e:mobile`; known load flakes get one retry, named.
- [ ] **Step 2: Write the docs; `pnpm format` on the files you touched only.**
- [ ] **Step 3: Commit** — `docs(repo): phase 5 owner decisions wrap`.
