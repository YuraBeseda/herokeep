# Phase 5 Slice 2 — Approved Additions from the Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**STATUS: WRITTEN 2026-11-03 — NOT STARTED. Starts after plan 17 Stage B (the presentation-only rebuild) has merged; its tasks assume the new `apps/web/src/app/ui/` component library and the new views exist.**

**Goal:** Ship the rule and campaign additions the owner approved in the Stage A designs that need engine, protocol or API work: condition durations with a round counter inside encounters, four new campaign house rules that gate the wizard, level-up and sheet, and item icons for custom and homebrew items.

**Architecture:** Each addition is an event-schema extension (`packages/protocol`), a reducer/derive extension (`packages/engine`, deterministic, no new special cases outside the pack vocabulary), relay permission rows where the campaign stream is involved (`apps/api` core, both adapters through the shared conformance suite), and the already-designed UI wired to the data. Round-based durations are DERIVED from the campaign's round counter and the condition's start round, so advancing a round writes one campaign event and no per-character writes. House rules extend the existing `campaign.settings` house-rules object. Item icons are either a game-icons id or a content-addressed blob through the existing image pipeline.

**Tech Stack:** Zod schemas + JSON schema drift gate (`pnpm --filter @hk/protocol build:schema`), `@hk/engine` reducers with goldens, Hono API core with the Cloudflare and Node adapters and `test/conformance/`, Angular 22 views from plan 17, Playwright sync e2e.

**Spec:** `docs/superpowers/specs/2026-11-02-frontend-redesign-foundations.md` §4.3 (house rules), §8 (conditions with duration, round advance, encounters), §8a (options), `docs/superpowers/design/2026-11-stage-a/README.md` (board map: `DL03`, `C06`, `C09`, `C10`, `W09`, `L01`, `DL04`, `PK05`), `docs/02-architecture/03-sync-protocol.md`, `04-rules-engine.md`, `08-permissions.md`.

## Global Constraints

- Events are immutable; reducers stay backward-compatible forever: every new field is optional on a new event VERSION (`@2`) or a new event; old events replay unchanged (CLAUDE.md rule 3).
- `packages/engine/src` stays deterministic: no `Date.now`, no `Math.random`, no locale string ops (lint-enforced).
- Game rules are data: the engine learns nothing about Paladins; durations, encounters and house rules are generic mechanics; any rule text comes from packs.
- The server never runs the rules engine: it validates envelopes, permissions and sizes; house rules are enforced by clients and audited by the DM override path (doc-08).
- TDD red-first per task; goldens for every reducer change (`packages/engine/test/goldens/`); `pnpm --filter @hk/protocol build:schema` after any schema change (CI fails on drift); conformance scenarios run against BOTH adapters (`apps/api/test/conformance/`, `pnpm --filter api test:cloudflare`).
- i18n: every new UI string ×3 (en/ru/uk).
- Conventional Commits with scope; each commit typechecks alone.

## Review Focus

1. A condition added with "3 rounds" in round 2 of encounter 1, then the encounter ends and a new one starts: the remaining rounds must not jump or go negative — derive clamps at 0 and the chip reads "ended" after the encounter closes (Task 2 test).
2. A player with "Players manage their own conditions" OFF removes a condition offline, then syncs: the client must never have allowed it (control locked), and a DM's `condition.removed` for the same condition must still apply (Task 3 test).
3. A level-up started while "Multiclassing" was ON, then the DM turns it OFF mid-flow: the open flow finishes as started; the next level-up skips the class step (Task 3 test).
4. A custom item with an uploaded icon exported in a `.hero` and imported on a device that never saw the blob: the slot shows the monogram fallback, never a broken image, and the blob relays later (Task 4 test).
5. An old client receiving `encounter.started@1` from a new DM: unknown campaign events are ignored without breaking the stream (existing strict-client behaviour; Task 2 conformance test).

---

### Task 1: Condition duration and source on the character stream

**Files:**
- Modify: `packages/protocol/src/events/character.ts` (add `ConditionAddedV2` with `duration?`, `source?`, `startedAtRound?`; add `'condition.updated@1'`), `packages/protocol/schema/*.json` (regenerated)
- Modify: `packages/engine/src/reduce/` (condition reducer), `packages/engine/src/derive/` (condition views carry `duration`, `remaining`, `source`)
- Test: `packages/protocol/test/events/character.test.ts`, `packages/engine/test/reduce/conditions.test.ts`, goldens under `packages/engine/test/goldens/conditions-duration/`

**Interfaces:**
- Produces: `ConditionDuration = { kind: 'rounds' | 'minutes' | 'hours'; amount: number } | { kind: 'untilShortRest' | 'untilLongRest' | 'untilRemoved' }`; `condition.added@2` payload `{ conditionId, level?, duration?: ConditionDuration, source?: string (≤ 80), startedAtRound?: number }`; `condition.updated@1` payload `{ conditionId, duration: ConditionDuration }`; derived `ConditionView.remaining?: { kind: 'rounds'; value: number } | { kind: 'time'; minutes: number }` and `ConditionView.endsAt?: 'shortRest' | 'longRest'`.

- [ ] **Step 1: Write the failing protocol test** — `condition.added@2` parses with and without `duration`; `amount` must be a positive integer ≤ 999; `source` ≤ 80 chars; `condition.added@1` still parses.
- [ ] **Step 2: Run it** — `pnpm vitest run --project protocol -t "condition"`; expected FAIL (unknown version).
- [ ] **Step 3: Add the schemas and register the versions in the event map**; run `pnpm --filter @hk/protocol build:schema`.
- [ ] **Step 4: Run the protocol tests** — expected PASS; `git diff --stat packages/protocol/schema` shows the regenerated files.
- [ ] **Step 5: Write the failing engine tests** — reducer keeps `duration`/`source`; `condition.updated` replaces the duration; a long rest removes `untilLongRest` and `untilShortRest` conditions, a short rest only `untilShortRest`; `remaining.minutes` for time durations is the amount (no clock in the engine); golden fixture `conditions-duration` added to the golden runner.
- [ ] **Step 6: Run them** — `pnpm vitest run --project engine -t "condition"`; expected FAIL.
- [ ] **Step 7: Implement the reducer and derive changes**; the v1 reducer path stays untouched.
- [ ] **Step 8: Run engine + goldens** — expected PASS, golden count +1; `pnpm typecheck` clean.
- [ ] **Step 9: Commit** — `feat(engine): condition durations and sources`.

### Task 2: Encounters and the round counter on the campaign stream

**Files:**
- Modify: `packages/protocol/src/events/campaign.ts` (add `'encounter.started@1'` `{ encounterId, startedAtSeq }`, `'encounter.ended@1'` `{ encounterId }`, `'round.advanced@1'` `{ encounterId, round }`, DM-only in the permission table; add the solo variant `'round.advanced@1'` to `character.ts` for unlinked heroes), `apps/api/src/core/campaign-permissions.ts` (rows for the three events), `apps/api/test/conformance/` (scenario: DM starts an encounter, advances two rounds, ends it; a player's append is refused 403)
- Modify: `packages/engine/src/derive/` (a `CampaignClock` input `{ encounter?: { id, round } }` to `derive`, so `ConditionView.remaining.value = amount - (currentRound - startedAtRound)` clamped at 0; `ended: true` when the condition's encounter is closed)
- Modify: `apps/web/src/app/shared/stores/campaign.store.ts` (expose `encounter()` signal from the campaign stream), `apps/web/src/app/shared/stores/character.store.ts` (feed the clock into derive for linked heroes; solo heroes use their own `round.advanced` events)
- Modify UI (already designed; wire data): party leaf header + table session strip encounter plate (`apps/web/src/app/views/campaigns/party/`, `.../log/`), `hk-condition-chip` remaining badge, solo "Advance round" on the Conditions leaf
- Test: protocol + engine tests as above, `apps/api/test/conformance/encounters.test.ts`, `apps/web/src/app/views/campaigns/party/party-tab.component.spec.ts` (plate states), `apps/web/e2e/sync/campaign-encounter.spec.ts` (DM advances a round, member's chip reads 2 rounds)

**Interfaces:**
- Consumes: Task 1's `startedAtRound`.
- Produces: `derive(facts, pack, { clock?: CampaignClock })` signature extension; `CampaignStore.encounter: Signal<{ id: string; round: number } | null>`.

- [ ] **Step 1: Failing protocol tests** for the three events and the permission rows (`dm` only).
- [ ] **Step 2: Run** `pnpm vitest run --project protocol -t "encounter|round"`; FAIL.
- [ ] **Step 3: Add schemas + permission rows**, regenerate the JSON schema.
- [ ] **Step 4: Failing conformance scenario** (both adapters) — DM append accepted and fanned out to a member socket; player append refused with the existing permission error code.
- [ ] **Step 5: Run** `pnpm --filter api test` and `pnpm --filter api test:cloudflare`; FAIL on the new scenario only.
- [ ] **Step 6: Implement the API rows**; run again; PASS.
- [ ] **Step 7: Failing engine test** — remaining rounds derive from the clock; clamp at 0; ended encounters mark the view `ended`; golden `conditions-rounds`.
- [ ] **Step 8: Implement `CampaignClock` in derive**; PASS; goldens +1.
- [ ] **Step 9: Failing web specs** — party plate shows "No encounter · Start encounter" vs "Encounter 2 · Round 3 · Advance round · End encounter"; the condition chip badge decrements when the store's round changes; solo hero's Advance round appends `round.advanced`.
- [ ] **Step 10: Wire the stores and the designed UI**; PASS.
- [ ] **Step 11: Sync e2e** `campaign-encounter.spec.ts` green on `pnpm --filter web e2e:sync`.
- [ ] **Step 12: Commit** — `feat(campaign): encounters and round counter`.

### Task 3: Four house rules

**Files:**
- Modify: `packages/protocol/src/events/campaign.ts:74` (`houseRules` gains `playersManageConditions`, `startingGold`, `multiclassing`, `playersAddItems`, all optional booleans, default true when absent), schema regenerated
- Modify: `apps/web/src/app/views/campaigns/settings/campaign-settings.component.*` (four toggles as designed on `C10`), `apps/web/src/app/views/characters/create-wizard/steps/equipment-step.component.*` (gold alternative disabled with the hint when `startingGold === false` for a hero being made for a campaign; solo heroes unaffected), `apps/web/src/app/views/characters/level-up/level-up.component.*` (skip the "Which class" step when `multiclassing === false`; stepper shows it locked with the hint), `apps/web/src/app/views/characters/sheet/play/` (Add item locked with the hint when `playersAddItems === false` on a linked hero; condition chip End/Edit and Add condition locked when `playersManageConditions === false`; the DM's quick effects are the unlocked path)
- Test: protocol test; web specs per gate; `apps/web/e2e/sync/campaign-house-rules.spec.ts`

**Interfaces:**
- Consumes: the existing `CampaignStore.settings()` house rules; the wizard's campaign context (the "for campaign" pin from `W01`).
- Produces: `HouseRules` type with the four booleans; a `houseRuleAllows(rule, campaign | null): boolean` helper in `apps/web/src/app/shared/services/campaigns/house-rules.ts` (null campaign → true).

- [ ] **Step 1: Failing protocol test** — settings event accepts the four booleans and rejects unknown keys (strict object).
- [ ] **Step 2–3: Run (FAIL), implement, regenerate schema, PASS.**
- [ ] **Step 4: Failing web specs** — each gate: control disabled, `aria-describedby` reason present, no inline caption; level-up skips the class step and the stepper shows the locked step; a flow started before the rule flipped finishes unchanged (Review Focus 3).
- [ ] **Step 5: Implement the helper and the four gates**; PASS.
- [ ] **Step 6: Sync e2e** — DM flips "Players add items themselves" off; the member's Add item locks live.
- [ ] **Step 7: Commit** — `feat(campaign): house rules for conditions, starting gold, multiclassing, items`.

### Task 4: Item icons for custom and homebrew items

**Files:**
- Modify: `packages/protocol/src/events/character.ts` (custom item payload gains `icon?: { kind: 'gi'; id: string } | { kind: 'blob'; hash: string }`), `packages/protocol/src/pack/` (item entity `icon` already exists for packs: confirm `sha256:` support; add nothing if present)
- Modify: `apps/web/src/app/shared/services/images/image-pipeline.service.ts` (an `encodeWithinCap('icon', …)` call at 128 × 128), `apps/web/src/app/views/characters/sheet/play/custom-item-dialog.component.*` (Icon field + picker sheet as designed on `DL04`), `apps/web/src/app/views/packs/homebrew/item-form.component.*` (Icon field; uploads stored with the pack images), `apps/web/src/app/ui/satchel-grid/` (renders `gi:` ids from the sprite and `sha256:` blobs from the blob cache with the monogram fallback)
- Test: protocol test; `image-pipeline.service.spec.ts` (icon cap); dialog spec (picker opens, search filters, upload path); e2e `export-import.spec.ts` extended: a `.hero` with an icon blob round-trips and shows the fallback until the blob arrives (Review Focus 4)

**Interfaces:**
- Produces: `ItemIconRef` type; `IconPickerComponent` (`hk-icon-picker`, inputs `used: string[]`, `value: ItemIconRef | null`, output `picked`).

- [ ] **Step 1: Failing protocol test** for the `icon` union.
- [ ] **Step 2–3: Run, implement, regenerate, PASS.**
- [ ] **Step 4: Failing pipeline spec** — an uploaded PNG is resized to 128 px and content-addressed.
- [ ] **Step 5: Implement; PASS.**
- [ ] **Step 6: Failing dialog and form specs** — picker lists the hero's used glyphs first, filters by search, "Upload your own" calls the pipeline, Save writes `icon` on the event.
- [ ] **Step 7: Implement the picker and the two forms; PASS.**
- [ ] **Step 8: e2e round trip; PASS.**
- [ ] **Step 9: Commit** — `feat(web): item icons with upload for custom and homebrew items`.

### Task 5: Docs and wrap

**Files:**
- Modify: `docs/02-architecture/03-sync-protocol.md` (encounter and round events, house rules), `04-rules-engine.md` (durations, the campaign clock input), `08-permissions.md` (DM-only rows), `docs/README.md` (slice 2 section), `docs/manual-device-checklist.md` (§8g: two phones — DM advances a round, member's chip counts down; house rule flips live), this plan's STATUS → EXECUTED.

- [ ] **Step 1: Update the docs**; run `pnpm format`.
- [ ] **Step 2: `pnpm check` green; e2e + sync e2e green.**
- [ ] **Step 3: Commit** — `docs(repo): phase 5 slice 2 wrap`.

## Self-review (performed at write time)

- **Spec coverage:** §8 durations (T1), round advance and encounters incl. solo heroes (T2), §4.3 four house rules with their gates and the "flow finishes as started" rule (T3), item icon picker with upload on both forms (T4), docs (T5). The choice-options popover and features-by-source are presentation over existing engine data and live in plan 17.
- **Step scan:** each step names its test and expected result; implementation steps give the file and the signature; the derive formula for remaining rounds is stated once.
- **Type consistency:** `ConditionDuration`, `CampaignClock`, `HouseRules`, `ItemIconRef` are defined once and reused by name.
- **Review Focus:** five lines, each pinned to a task's test.
- **Proportion:** ~130 lines for four features that each touch three packages.
