# Phase 1b Plan 4 — Engine Complete & Storage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `@hk/engine` fully compute a playable Fighter/Wizard 1–5 character (reduce all Phase-1 events → derive a complete Sheet with provenance), add dice + `propose.*`, prove it with golden fixtures over the real SRD pack, and give `apps/web` the Dexie event/snapshot/character storage layer plan 5's UI will sit on. First task fixes the R8 parked finding from plan 3.

**Architecture:** Pure-function pipeline per `docs/02-architecture/05-rules-engine.md` (ADR-013): reducer folds the event log into `Facts`; `derive` walks content in fixed dependency order collecting modifiers into a `ModifierTable` with explicit stacking policies; every Sheet number is a `Derived<number>` carrying its contributions. Storage is Dexie tables + repositories with Web-Locks leader election; no UI in this plan.

**Tech Stack:** TypeScript ~6.0.3 (`erasableSyntaxOnly` — no parameter properties/enums; `.ts` relative imports), Zod 4 (`z.strictObject`), Vitest 4, Dexie 4 + fake-indexeddb (already set up), Angular 22 DI only in `apps/web` services.

**Spec:** `docs/03-roadmap/phase-1-solo-builder.md` § 1b deliverables 1–2 + acceptance criteria; `docs/02-architecture/02-domain-model-and-events.md` (Facts shape + event catalog — THE authority for payloads); `docs/02-architecture/05-rules-engine.md` (API, module layout, stacking policies, derivation order); `docs/02-architecture/04-content-packs.md` (effect vocabulary). Plan-3 ledger ruling R8 (parked finding) is fixed here first.

## Global Constraints

- Game rules are DATA: no 5e numbers in TS. Armor math, rest rules, XP thresholds, slot tables, ability-generation methods all come from the pack's `system` entity / entity effects. The ONLY rule-shaped constants allowed in engine code are the generic mechanics the spec's docs state as engine contracts: `mod = floor((score - 10) / 2)`, DC `8 + prof + mod`, base AC formula `10 + mod(dex)` (always-present candidate), and stacking policies.
- `packages/engine/src` determinism: no `Date.now` / `Math.random` (except `dice/` with injectable RNG) / locale string ops. Lint enforces it. `dice/roll.ts` production RNG uses `crypto.getRandomValues` behind the injectable.
- Events immutable; reducers backward-compatible forever. New handlers keyed `'type@v'` in `HANDLERS` (see `packages/engine/src/reduce/reducer.ts:10`); a handler returns new `Facts` or a string skip-reason. Reducer stays pure and total: bad payload shapes were already rejected by `parseEvent` at the boundary; handlers may still skip with a reason but must never throw.
- Committed events replay strictly by `seq` (R17, plan 1). Do not touch `orderEvents`.
- i18n: engine emits codes/params, never English sentences (existing `Diagnostic` pattern). New web-side user-visible strings need en/ru/uk keys.
- TDD: failing test first, every task ends with a commit, Conventional Commits with scope.
- Every commit message ends with the trailer line: `Claude-Session: https://claude.ai/code/session_01AcU7JFdSTsYgPNpo9Vtkre`
- All existing tests stay green (`pnpm check`): currently 217 root + 52 content + 173 web.
- Package layout per `05-rules-engine.md` § Module layout — new engine files go exactly where that tree says (e.g. `reduce/handlers/*.ts`, `derive/modifiers.ts`, `propose/*.ts`, `dice/*.ts`).
- The golden harness is `packages/engine/test/support/golden.ts` (fixture shape `{name, packs, events, expect}` where `expect` maps `getPath` paths over `{facts, sheet}` to values). Plan-4 goldens extend this harness (Task 15 adds real-pack loading); do not fork a second harness.
- The REAL SRD pack for goldens is built by `pnpm --filter @hk/content build:pack` into `packages/content/dist/packs/srd-5e-2024/pack.json`. Never hand-edit it; if pack data is wrong, fix transforms/overlays (plan-2 rules) — but expect NO pack changes in this plan.
- Where a golden expectation depends on pack data (resource max formulas, prepared-spells table, background ability lists), the task says "pack-derived: verify against the built pack + SRD text before hard-coding the number in the fixture". Where it is arithmetic from the mechanics above (mods, DCs, AC sums, HP totals), the plan states the number and the arithmetic; a mismatch at implementation time means a bug in code (or an incorrect plan assumption to report), not a number to fudge.

### Design rulings baked into this plan (they resolve doc tensions; executors follow them)

1. **Reduce signature.** `05-rules-engine.md` says the reducer reads `system.restRules`/`system.hpRules` "present in the snapshot as data", but the published API is `reduce(events, from?)`. Resolution: `reduce(events: Event[], from?: Snapshot, rules?: SystemRules)` where `SystemRules = { restRules, hpRules }` (types re-exported from `@hk/protocol`'s system entity schema). `Snapshot` gains a `rules?: SystemRules` field; a resumable snapshot's rules win over the argument (replay determinism across engine versions). When neither is present, `rest.taken` and `level.gained` HP math skip with reason `'no-system-rules'` — callers (goldens, web) always pass rules extracted from the content index.
2. **Reverts are a pre-scan.** `event.reverted` may commit at a later seq than its target. The reducer makes a first pass collecting reverted event ids / txIds, then folds the log skipping targets with reason `'reverted'`. A revert of an unknown target applies as a no-op (it may target a pending event that never committed).
3. **Facts grows to the full doc-02 shape** (additive; existing fields keep their exact names — `appliedEventIds`, `lastSeq`, `skipped` etc. — so plan-3 code and the golden `facts.*` paths keep working).
4. **`Derived<number>`** per doc 05: `{ value: number, contributions: Contribution[] }`, `Contribution = { source: string, feature?: string, kind: string, amount?: number, formula?: string, key?: string }` (`source`/`feature` are entity ids). Non-numeric sheet facts (proficiency lists, senses, languages) carry plain values plus a `sources: string[]`.
5. **Storage keys.** Events table is keyed `&id` with indexes `[stream+seq]` and `stream` (pending events have no `seq`; IndexedDB indexes simply omit them — pending retrieval filters `seq === undefined` on the `stream` index). Snapshots one-per-stream (`&stream`). Leader election via the Web Locks API (`navigator.locks`), falling back to "assume leader" with a console warning when unavailable (Firefox private mode).

## File Structure (what exists → what this plan adds)

```
packages/protocol/src/events/character.ts    # 3 payloads today → all Phase-1 payloads (T2)
packages/engine/src/reduce/
  facts.ts                                   # full Facts (T3)
  reducer.ts                                 # revert pre-scan, rules param (T3)
  handlers/{identity,leveling,vitals,casting,inventory,misc}.ts   # T3–T7
packages/engine/src/derive/
  modifiers.ts (T8) composition.ts (T8) abilities.ts (T9) proficiency.ts (T9)
  defense.ts (T10) hp.ts (T10) attacks.ts (T11) spellcasting.ts (T12)
  resources.ts (T12) actions.ts (T12) sheet.ts+index.ts (T13 rewrite)
  choices.ts (T13 extends) advancement.ts (T13) validation.ts (T13)
packages/engine/src/propose/*.ts             # T14
packages/engine/src/dice/{parse,roll}.ts     # T14
packages/engine/test/golden/*.json           # T15 (real-pack goldens)
packages/engine/test/support/golden.ts       # T15 (real-pack loading + rules)
apps/web/src/app/shared/stores/pack.store.ts # T1 (R8 guard only)
apps/web/src/app/shared/services/storage/    # T16: dexie.db.ts v2, events.repository.ts,
                                             #      snapshots.repository.ts, characters.repository.ts,
                                             #      leader.service.ts
```

---

### Task 1: R8 fix — guard `validatePack` on the translation load path

Plan-3's final re-review found (ruling R8, parked): `PackStore.init()` calls `validatePack(pack, [core])` outside any try/catch (`apps/web/src/app/shared/stores/pack.store.ts:65-68`). `PacksRepository.getAll()` returns raw `row.json`; a structurally corrupted/drifted row makes `validatePack` throw synchronously (it dereferences `pack.entities` etc.), rejecting `init()` and blank-screening — the exact failure the surrounding code exists to prevent, and its own comment ("Never rejects") is false for this path.

**Files:**
- Modify: `apps/web/src/app/shared/stores/pack.store.ts` (the `translations.filter(...)` line + comment)
- Test: `apps/web/src/app/shared/stores/pack.store.spec.ts` (one new spec next to the existing re-validation specs)

**Interfaces:** none change — `init(): Promise<void>` behavior only.

- [ ] **Step 1: Failing spec.** In the existing "re-validates persisted translations" describe block, add:

```ts
it('drops a structurally corrupted persisted row instead of failing init', async () => {
  // A row whose json is not Pack-shaped at all — validatePack would throw on it.
  packsRepository.getAll.mockResolvedValue([
    brokenRow as unknown as Pack, // e.g. { kind: 'translation' } with no entities/i18n/format
    validRuTranslation,
  ]);
  await store.init();
  expect(store.ready()).toBe(true);
  expect(store.translationPacks().map((p) => p.id)).toEqual([validRuTranslation.id]);
});
```

Use the spec file's existing fixtures/mocks (`validRuTranslation` etc. already exist there); `brokenRow` must keep `kind: 'translation'` so it passes the kind filter and reaches `validatePack`. Run: `pnpm --filter web test -- --include='**/pack.store.spec.ts'` → the new spec FAILS (init rejects / translations empty).

- [ ] **Step 2: Fix.** Replace the unguarded filter with a per-pack guard, and amend the comment:

```ts
const survivesValidation = (pack: Pack): boolean => {
  try {
    return validatePack(pack, [core]).length === 0;
  } catch {
    return false; // structurally corrupted row — same outcome as failed validation: drop it
  }
};
this.translationsState.set(translations.filter(survivesValidation));
```

- [ ] **Step 3: Verify + commit.** Focused spec green, then `pnpm --filter web test`. Commit: `fix(web): drop corrupted persisted packs instead of failing bootstrap`.

### Task 2: Protocol — the complete Phase-1 character event catalog

Extend `EVENT_PAYLOADS`/`EVENT_ACTORS` from 3 events to the full character-stream catalog of `docs/02-architecture/02-domain-model-and-events.md` § "Event catalog — character stream". That table is the authority: payload field names, optionality, and actor columns come from it verbatim. Solo-phase note: campaign-only events (`character.owner_transferred`, `character.campaign_joined/left`) and `level.granted`, `history.compacted` still get schemas (the protocol is the contract), the reducer will handle the campaign ones as no-op skips later.

**Files:**
- Modify: `packages/protocol/src/events/character.ts` (all new payload schemas + registry entries), `packages/protocol/src/events/index.ts` (exports)
- Test: `packages/protocol/test/events.spec.ts` (extend the existing table-driven parse tests)

**Interfaces:**
- Produces (consumed by T3–T7 and T14): one exported Zod schema + inferred type per event, named `<PascalCase>V1` / `<PascalCase>` (existing convention: `CharacterCreatedV1` → `CharacterCreated`). Registry keys `'<type>@1'`.

Payload schemas to add — copy field names/types from the doc table; representative examples that pin the conventions (write ALL of them, the doc table is the checklist):

```ts
export const HpChangedV1 = z.strictObject({
  delta: z.int(),
  kind: z.enum(['damage', 'heal', 'temp', 'set']),
  source: ShortTextSchema.optional(),
  damageType: SlugSchema.optional(),
});
export const LevelGainedV1 = z.strictObject({
  classId: EntityIdSchema,
  level: z.int().min(1).max(20),
  hpRoll: z.union([z.int().min(1), z.literal('average')]).optional(),
  subclassId: EntityIdSchema.optional(),
});
export const RestTakenV1 = z.strictObject({
  kind: z.enum(['short', 'long']),
  hitDiceSpent: z.array(z.strictObject({ classId: EntityIdSchema, count: z.int().min(1) })).optional(),
});
export const ItemAddedV1 = z.strictObject({
  instanceId: z.string().regex(UUID),
  itemId: EntityIdSchema.optional(),      // absent for fully custom items
  qty: z.int().min(1),
  name: ShortTextSchema.optional(),
  custom: z.record(z.string().max(64), z.unknown()).optional(),
});
export const EventRevertedV1 = z
  .strictObject({
    targetId: z.string().regex(UUID).optional(),
    txId: z.string().regex(UUID).optional(),
    reason: ShortTextSchema.optional(),
  })
  .refine((p) => p.targetId !== undefined || p.txId !== undefined, { message: 'targetId or txId required' });
```

(`UUID` is already defined in `envelope.ts` — export it from there rather than duplicating the regex. `EntityIdSchema`, `SlugSchema`, `ShortTextSchema` are existing protocol exports.) `death_save.recorded` result enum: `['success', 'failure', 'critSuccess', 'critFailure']`. `currency.changed`: five optional ints (deltas, negatives allowed). `note.*` body max 8 KB (`z.string().max(8192)`). `override.applied`: `{ path: z.string().min(1).max(128), value: z.unknown(), reason: ShortTextSchema }`.

- [ ] **Step 1: Failing tests.** Extend the existing parse-test table: for EVERY new `'type@1'` key one accepting sample and one rejecting sample (wrong field name or missing required field — `strictObject` must reject unknown keys). Also assert `Object.keys(EVENT_PAYLOADS).length` equals the doc-02 character-table count you implemented (count them as you transcribe; state the count in the test as a literal) and that every `EVENT_PAYLOADS` key has an `EVENT_ACTORS` entry (keyed WITHOUT `@1`, existing convention). Run `pnpm vitest run --project protocol` → FAIL.
- [ ] **Step 2: Implement** all schemas + registry entries + actor rows (actors verbatim from the doc's Actor column: e.g. `hp.changed: ['owner', 'dm']`, `spell.prepared: ['owner']`).
- [ ] **Step 3: Green + schema rebuild.** `pnpm vitest run --project protocol`; then `pnpm --filter @hk/protocol build:schema` (CI drift gate) — commit the regenerated JSON schema if it changed.
- [ ] **Step 4: Commit** `feat(protocol): complete Phase-1 character event catalog`.

### Task 3: Reducer core — full Facts, revert pre-scan, system rules, identity handlers

**Files:**
- Modify: `packages/engine/src/reduce/facts.ts` (full Facts), `packages/engine/src/reduce/reducer.ts` (pre-scan + rules param; move the 3 existing handlers into the new handler files), `packages/engine/src/index.ts` (exports)
- Create: `packages/engine/src/reduce/handlers/identity.ts`
- Test: `packages/engine/test/reduce-core.spec.ts`, `packages/engine/test/handlers-identity.spec.ts` (existing reducer specs keep passing unmodified — they pin R17 ordering)

**Interfaces:**
- Produces: `Facts` (full shape below — every later task consumes it), `SystemRules`, `reduce(events, from?, rules?)`, `Snapshot { seq, facts, engineVersion, rules? }`, and the handler-registration pattern: each `handlers/*.ts` exports `const HANDLERS: Record<string, Handler>`; `reducer.ts` spreads them into one registry (collision = build-time error via a unit test asserting no duplicate keys).

Full `Facts` (doc-02 § "Character facts", additive over the current interface — keep existing field names exactly):

```ts
export interface ClassEntry { classId: string; level: number; subclassId?: string }
export interface ConditionEntry { conditionId: string; source?: string; sinceEventId: string; level?: number }
export interface InventoryEntry {
  instanceId: string; itemId?: string; qty: number; equipped: boolean; attuned: boolean;
  name?: string; notes?: string; custom?: Record<string, unknown>;
}
export interface NoteEntry { id: string; title: string; body: string }
export interface Facts {
  streamId: string; created: boolean; archived: boolean;
  name: string; system: string;
  grammaticalGender: 'masculine' | 'feminine' | 'neuter';
  appearance: Record<string, string>;
  portrait?: { hash: string; thumbHash: string };
  createdWith: { engineVersion: string };
  pins: Record<string, string>;
  decisions: Record<string, string[]>;
  decisionContexts: Record<string, Record<string, unknown>>; // decision.made context, for the timeline
  classes: ClassEntry[];                    // order = order gained
  xp: number;
  hp: { current: number; temp: number; maxOverride?: number };
  hitDiceSpent: Record<string, number>;     // classId → spent
  deathSaves: { successes: number; failures: number };
  slotsUsed: Record<number, number>;        // spell level → used
  resourcesUsed: Record<string, number>;    // resourceId → used
  conditions: ConditionEntry[];
  concentration?: { spellId: string; sinceEventId: string };
  preparedSpells: Record<string, string[]>; // classId → spellIds
  knownSpells: Record<string, string[]>;    // classId → spellbook/known spellIds
  inventory: InventoryEntry[];
  currency: { cp: number; sp: number; ep: number; gp: number; pp: number };
  inspiration: boolean;
  notes: NoteEntry[];
  overrides: { path: string; value: unknown; reason: string }[];
  skipped: SkippedEvent[]; lastSeq: number; appliedEventIds: string[];
}
```

(`sinceEventId` not timestamps: determinism — the event's `ts` is display data the UI reads from the log, not reducer state. `hp.current` starts at 0 and is clamped by handlers against the max the DERIVE side computes? No — the reducer cannot know max HP. Resolution, and this is the contract: the reducer stores hp deltas RAW (`current` may exceed derived max transiently); `derive` clamps for display and `propose.heal/damage` computes clamped deltas so well-formed apps never overshoot. Document this in a comment on the `hp` field.)

`emptyFacts` fills the new fields (`archived: false`, `appearance: {}`, `xp: 0`, `hp: {current: 0, temp: 0}`, `currency` zeros, empty records/arrays, `inspiration: false`).

Reducer changes:

```ts
export interface SystemRules { restRules: SystemEntity['restRules']; hpRules: SystemEntity['hpRules'] }
export function reduce(events: Event[], from?: Snapshot, rules?: SystemRules): Facts
```

- Pre-scan (design ruling 2): collect `reverted` sets from `event.reverted` payloads (both ids and txIds) across ALL events first; during the fold, an event whose `id` is in the reverted-id set or whose `txId` is in the reverted-tx set is skipped with reason `'reverted'` (the `event.reverted` event itself applies as a no-op handler that records nothing).
- Effective rules: `from?.rules ?? rules`; pass to handlers via a context argument — change `Handler` to `(facts, event, ctx: { rules?: SystemRules }) => Facts | string`. Update the three existing handlers' signatures as you move them into `handlers/identity.ts`.
- `Snapshot` gains `rules?: SystemRules`.

Identity handlers (this task): `character.renamed@1`, `character.appearance_set@1` (merge defined fields), `character.gender_set@1`, `character.archived@1`/`character.restored@1`, `decision.cleared@1` (delete decision + context), `portrait.set@1`/`portrait.cleared@1`, `note.added/updated/removed@1`, plus no-op skips (`'not-applicable-solo'`) for `character.owner_transferred@1`, `character.campaign_joined@1`, `character.campaign_left@1`, `level.granted@1`, `history.compacted@1`. All content handlers guard `requireCreated`.

- [ ] **Step 1: Failing tests.** `reduce-core.spec.ts`: (a) revert-by-id skips a committed target that appears EARLIER in seq order than the revert; (b) revert-by-txId skips all three events of a transaction; (c) revert of unknown id is a clean no-op; (d) duplicate-handler-key guard: importing all handler modules and asserting `Object.keys` union has no collisions; (e) `from.rules` beats the `rules` argument. `handlers-identity.spec.ts`: table-driven — each handler happy path + `not-created` skip; appearance merge keeps unspecified fields; note update by id; archived flag round-trip. Run `pnpm vitest run --project engine` → FAIL.
- [ ] **Step 2: Implement** facts + reducer + identity handlers. Existing reducer tests must pass UNCHANGED (they pin ordering/duplicate/skip semantics).
- [ ] **Step 3: Green** engine project, then `pnpm check`.
- [ ] **Step 4: Commit** `feat(engine): full Facts, revert pre-scan, system rules context, identity handlers`.

### Task 4: Handlers — leveling, XP, decisions with context

**Files:**
- Create: `packages/engine/src/reduce/handlers/leveling.ts`
- Modify: `packages/engine/src/reduce/reducer.ts` (register), `handlers/identity.ts` (move `decision.made` here if you put it there — final home for `decision.made@1` is leveling.ts next to `level.gained`)
- Test: `packages/engine/test/handlers-leveling.spec.ts`

**Interfaces:**
- Consumes: `Facts.classes/xp/decisions/decisionContexts`, `ctx.rules` (unused here — HP math happens in derive, see below).
- Produces: `level.gained@1`, `xp.awarded@1`, amended `decision.made@1` (stores `context` into `decisionContexts` when present).

Semantics (binding):
- `level.gained {classId, level, hpRoll?, subclassId?}`: `level` is the CLASS level being gained (fighter 3 = fighter's 3rd level). Skip reasons: `'not-created'`; `'level-not-next'` when `level !== (current class level) + 1` (first gain must be `level: 1`). `subclassId` sets the class entry's subclass (only meaningful at the pack's `subclassLevel`; the reducer records it regardless — validation lives in derive/validateSelection). `hpRoll` is RECORDED on a per-class-level ledger for derive to price: add `Facts.hpRolls: Record<string, (number | 'average')[]>` (classId → one entry per gained level ≥ 2; level 1 has no roll — `hpRules.firstLevelMaxHitDie`). Note: add `hpRolls` to the Facts interface in this task (it was intentionally left out of T3's shape; update `emptyFacts` too).
- `xp.awarded {amount}`: `xp = max(0, xp + amount)` (negative corrections floor at 0).
- `decision.made` with `context`: store selection as today AND `decisionContexts[choiceId] = context`.

- [ ] **Step 1: Failing tests.** Fighter 1→2 happy path (classes `[{classId, level: 2}]`, `hpRolls` `[5]` for the roll variant / `['average']`); wrong-order gain skips (`level: 3` after 1 → `'level-not-next'`); second class starts at 1 (multiclass DATA is allowed even though mechanics are out of scope — assert the entry appends); xp floor at 0; decision context stored and cleared by `decision.cleared`. → FAIL, implement, green.
- [ ] **Step 2: Commit** `feat(engine): leveling, xp and decision-context handlers`.

### Task 5: Handlers — vitals: HP, temp, death saves, hit dice, conditions, concentration, inspiration

**Files:**
- Create: `packages/engine/src/reduce/handlers/vitals.ts`
- Test: `packages/engine/test/handlers-vitals.spec.ts`

**Interfaces:**
- Produces: `hp.changed@1`, `death_save.recorded@1`, `stabilized@1`, `hit_dice.spent@1`, `hit_dice.regained@1`, `condition.added@1`, `condition.removed@1`, `concentration.started@1`, `concentration.ended@1`, `inspiration.changed@1`.

Semantics (from doc-02 "Rules the reducer applies" — these are the SYSTEM-AGNOSTIC parts; anything numeric beyond them comes from `ctx.rules`):
- `hp.changed` delta convention (binding, shared with T14's proposers): `delta` is SIGNED — `damage` carries a negative delta, `heal`/`temp` positive, `set` an absolute value. Magnitude = `|delta|` in the rules below.
- `kind: damage`: magnitude hits `temp` first, remainder reduces `current` (floor 0 — the reducer floors at 0; it cannot ceiling at max, see T3 note).
- `kind: heal`: `current += magnitude`; healing while `current === 0` also resets `deathSaves` to 0/0.
- `kind: temp`: temp HP does not stack — `temp = max(temp, magnitude)`.
- `kind: set`: sets `current` to the value directly (DM override path).
- `death_save.recorded`: `critSuccess` → resets saves AND sets `current = 1`; `critFailure` counts 2 failures; 3 successes → mark stable (reset saves); reducer only tracks counters + the crit rules, "dying/dead" presentation is derive/UI.
- `stabilized`: reset saves.
- `hit_dice.spent {classId, count, healed?}`: `hitDiceSpent[classId] += count`; when `healed` present apply as a heal (same temp-then-current path NO — healing never touches temp; just `current += healed` with the same at-0 death-save reset).
- `condition.added`: replace-by-conditionId (re-adding exhaustion with a new `level` replaces the entry); `condition.removed` removes by conditionId.
- `concentration.started {spellId}` sets, `concentration.ended` clears (a second `started` replaces — breaking concentration is the UI's proposal concern).
- `inspiration.changed {value}` sets the boolean.

- [ ] **Step 1: Failing tests** covering exactly the semantics above, including: damage 7 against `{current 10, temp 5}` → `{current 8, temp 0}`; heal from 0 resets death saves; temp 5 then temp 3 keeps 5; critFailure at 2 failures → 4 (capped at 3? No: cap at 3 — assert cap); exhaustion level replace; spent hit dice accumulate per class. → FAIL, implement, green.
- [ ] **Step 2: Commit** `feat(engine): vitals handlers`.

### Task 6: Handlers — slots, resources, spells, rest

**Files:**
- Create: `packages/engine/src/reduce/handlers/casting.ts`
- Test: `packages/engine/test/handlers-casting.spec.ts`

**Interfaces:**
- Produces: `slot.spent@1`, `slot.restored@1`, `resource.spent@1`, `resource.restored@1`, `spell.prepared@1`, `spell.unprepared@1`, `spell.learned@1`, `spell.forgotten@1`, `spell.cast@1`, `concentration` interplay, `rest.taken@1`.

Semantics:
- `slot.spent {level, count?}`: `slotsUsed[level] += count ?? 1`. `slot.restored`: subtract, floor 0. (`pact` ignored in Phase 1 — no pact casters wired; still accept the field.)
- `resource.spent/restored {resourceId, count?}`: same pattern on `resourcesUsed`; `resource.restored` with NO count resets that resource to 0 used (full restore) — with a count it subtracts (floor 0).
- `spell.prepared/unprepared {spellId, classId}`: set-semantics on `preparedSpells[classId]` (no duplicates, unprepare removes).
- `spell.learned/forgotten {spellId, classId}`: same on `knownSpells[classId]`.
- `spell.cast {spellId, level, slotUsed?, concentration?}`: folds to `slotsUsed[level] += 1` when `slotUsed !== false`, and sets `concentration = {spellId, sinceEventId}` when `concentration === true`.
- `rest.taken {kind, hitDiceSpent?}` — needs `ctx.rules` (skip `'no-system-rules'` when absent). **Binding design — the reducer stays content-free; per-resource reset knowledge lives in the PROPOSER, which has the sheet:** `propose.rest` (T14) emits one transaction: `rest.taken` + one `resource.restored {resourceId}` (full-restore form, no count) per active resource whose `resource.define reset` matches the rest kind (long rest also restores `shortRest` resources — a long rest includes everything a short one grants). The reducer's `rest.taken` handler applies only the rule-scalar parts it can know from `ctx.rules`:
  - long: `temp = 0`; `deathSaves` reset; `slotsUsed = {}` when `restRules.longRest.restoreAllSlots`; exhaustion condition `level -= exhaustionReduce` (remove the condition at level ≤ 0); per class `hitDiceSpent[classId] = max(0, spent - max(hitDiceRegainMin, floor(classLevel / hitDiceRegainDivisor)))`; and when `hpToMax`, `hp.current = 'max'` — `Facts.hp.current` widens to `number | 'max'`, where `'max'` means "full": `derive` resolves it to the computed max, and `propose.damage/heal` resolve it to a number before computing deltas. A raw `hp.changed` arriving while current is `'max'` (only possible from a hand-written event, never from `propose.*`) skips with reason `'hp-unresolved'`.
  - short: marks the payload's `hitDiceSpent` entries as spent (only when `restRules.shortRest.allowHitDice`); nothing else — healing from hit dice arrives as explicit `hit_dice.spent {healed}` events, and resource resets arrive as the proposer's `resource.restored` events described above.
  Document this contract in `casting.ts`'s header comment.

- [ ] **Step 1: Failing tests** for every semantic above (slot floors, resource full-restore vs counted, prepared/known set semantics, cast folding, long rest: slots cleared + temp dropped + exhaustion 3→2 + hit dice regain `floor(5/2)=2` back for a level-5 single-class with 4 spent → 2 spent + hp `'max'`; short rest: only payload hit dice marked; both skip without rules). Include one test that `hp.current: 'max'` survives a following `hp.changed damage` correctly ONLY after a heal/set… no: assert instead that `hp.changed` against `'max'` skips with `'hp-unresolved'` — `propose.damage` always resolves it first (contract test for the propose side lands in T14).
- [ ] **Step 2: Implement, green, commit** `feat(engine): casting, resource and rest handlers`.

### Task 7: Handlers — inventory, currency, overrides

**Files:**
- Create: `packages/engine/src/reduce/handlers/inventory.ts`
- Test: `packages/engine/test/handlers-inventory.spec.ts`

**Interfaces:**
- Produces: `item.added@1`, `item.removed@1`, `item.equipped@1`, `item.unequipped@1`, `item.attuned@1`, `item.unattuned@1`, `item.updated@1`, `currency.changed@1`, `override.applied@1`.

Semantics: `item.added` appends an `InventoryEntry` (`equipped: false, attuned: false`); duplicate `instanceId` skips `'duplicate-instance'`. `item.removed {instanceId, qty?}`: no qty → remove entry; qty → decrement, remove at ≤ 0. equip/unequip/attune/unattune flip flags (missing instance skips `'unknown-instance'`; attune does NOT enforce the max of 3 — doc-02 says UI enforces). `item.updated` merges name/notes/qty. `currency.changed` applies deltas, each denomination floors at 0. `override.applied` appends to `Facts.overrides` (later same-path overrides supersede earlier at DERIVE time; the log keeps all).

- [ ] **Step 1: Failing tests** (each semantic incl. qty-decrement removal, unknown-instance skip, currency floor). Implement, green.
- [ ] **Step 2: Commit** `feat(engine): inventory, currency and override handlers`.

### Task 8: Derive — composition, active entities, grants, ModifierTable

The foundation every later derive task builds on: which entities are ACTIVE for this character, which effects they contribute, and the stacking machinery.

**Files:**
- Create: `packages/engine/src/derive/composition.ts`, `packages/engine/src/derive/modifiers.ts`
- Test: `packages/engine/test/derive-composition.spec.ts`, `packages/engine/test/derive-modifiers.spec.ts` (fixture packs from `test/fixtures/packs/` — extend `core-mini` in place if a scenario needs a construct it lacks; its existing assertions elsewhere must keep passing)

**Interfaces (produced — every later derive task consumes these):**

```ts
// composition.ts
export interface ActiveEffect {
  effect: Effect;                 // the protocol effect object
  source: string;                 // entity id contributing it
  feature?: string;               // feature entity id when routed through a grant
}
export interface Composition {
  entities: string[];             // active entity ids (species, background, classes, subclasses, feats, features, equipped items…)
  effects: ActiveEffect[];        // all effects of active entities whose `when` predicate holds
  classLevels: Record<string, number>;
  totalLevel: number;
  issues: Diagnostic[];           // unresolved ids → warning 'derive.unresolvedEntity'
}
export function compose(facts: Facts, index: ContentIndex): Composition
// modifiers.ts
export type StackPolicy = 'sum-unique-key' | 'max-of-formulas' | 'set-if-higher' | 'cap' | 'union';
export interface Contribution { source: string; feature?: string; kind: string; amount?: number; formula?: string; key?: string }
export interface Derived<T> { value: T; contributions: Contribution[] }
export class ModifierTable {
  add(target: string, c: Contribution & { policy: StackPolicy }): void;
  resolve(target: string, base: number, evalFormula: (f: string) => number): Derived<number>;
}
```

Composition algorithm (doc-05 order): start from `facts.decisions` selections of the system's creation slots (species, background) + `facts.classes` (class + subclass entities) + every OTHER decision selection that resolves to a feat/feature entity + equipped/attuned inventory items (`facts.inventory` where `equipped || attuned`, resolved via `itemId`). For each active entity, walk `grants[]`: a grant whose `when` predicate passes (predicate evaluator exists — `predicate/evaluate.ts`; its context needs `classLevel`/`level` from `facts.classes`, ability scores are NOT available yet at this stage — see layering note) activates the granted feature entity (recursively, feature grants can nest; cap recursion at deps-style depth 8 with a warning `'derive.grantDepth'`). Class/subclass `levels[]` rows with `row.level <= classLevels[classId]` contribute their `grants` the same way. Effects gate on their own `when` the same way.

**Layering note (binding):** predicates that need ability scores (`{ability: {...}}`, `{formula: ...}`) cannot be evaluated during composition (scores derive AFTER composition). `compose` therefore evaluates only score-free predicates and marks effects whose predicate needs scores as `deferred: true` (add the field to `ActiveEffect`); T9 re-evaluates deferred predicates once base scores exist and drops failures. In the 1b content scope this affects only heavy-armor STR gating and similar — assert one such case in tests.

ModifierTable semantics (doc-05 table, verbatim policies): `sum-unique-key` — group by `key` (a contribution without a key uses its `source#feature` as the key), keep max within a key, sum across keys; `max-of-formulas` — evaluate every formula contribution, take the highest, `base` (10 + dex) is always a candidate; `set-if-higher` applied after bonuses; `cap` clamps at the end; `union` for sets (expose `resolveSet(target): { values: string[]; sources: Record<string, string[]> }` where `expertise` beats `proficient` per-target — encode the proficiency level in the contribution `kind`).

- [ ] **Step 1: Failing tests.** Composition: catfolk species (core-mini fixture) activates its granted features; class rows ≤ level contribute, rows above level don't; unresolved decision id → warning not throw; grant with failing classLevel predicate inactive; equipped item's effects active, unequipped's not; deferred marking for a score-dependent predicate. Modifiers: same-key keeps max (two `ac.bonus key: shield` don't stack), different keys sum; max-of-formulas picks highest and records ALL candidates in contributions; set-if-higher only raises; union merges with expertise beating proficient. → FAIL, implement, green.
- [ ] **Step 2: Commit** `feat(engine): derive composition and modifier table`.

### Task 9: Derive — ability scores, proficiency bonus, saves, skills, speed, senses, languages

**Files:**
- Create: `packages/engine/src/derive/abilities.ts`, `packages/engine/src/derive/proficiency.ts`
- Test: `packages/engine/test/derive-abilities.spec.ts`

**Interfaces:**
- Consumes: `Composition`, `ModifierTable`, `index.system()` (abilities list, skills with their ability, proficiency table), `facts.decisions` (the `abilityGeneration` decision + background ability-score decision).
- Produces:

```ts
export interface AbilityBlock { score: Derived<number>; mod: number; save: Derived<number>; saveProficient: boolean }
export interface AbilitiesResult {
  abilities: Record<string, AbilityBlock>;      // keyed by system.abilities ids
  prof: number;                                  // proficiency[totalLevel - 1]
  skills: Record<string, { total: Derived<number>; proficiency: 'none' | 'proficient' | 'expertise' | 'half' }>;
  passivePerception: number;                     // 10 + perception total
  speed: Record<string, Derived<number>>;        // by mode; walk base from species
  senses: { sense: string; range: number; sources: string[] }[];
  languages: { id: string; sources: string[] }[];
  effects: ActiveEffect[];                       // input effects minus resolved deferrals
  issues: Diagnostic[];
}
export function deriveAbilities(facts: Facts, comp: Composition, index: ContentIndex): AbilitiesResult
```

Base scores: the system's `abilityGeneration` creation decision — selection stores the six scores; the decision `context.method` records how. The BACKGROUND's ability-score choice (its `pick.abilities` form — `{count, improve: '+2/+1' | ...}`) contributes `ability.bonus` modifiers keyed by the background entity. Score-generation content contract: the ability-scores decision's `selection` is `['str:15', 'dex:13', …]` (six `<abilityId>:<score>` literals — this is how plan-3 seeded nothing, so DEFINE it here as the binding format; `validateSelection` T13 enforces it and the wizard emits it). `mod = floor((score - 10) / 2)` (use the formula evaluator's `intDiv` flooring — negative scores like 8 → -1 must floor correctly, plain `Math.floor((8-10)/2) = -1` ✓). Saves: `mod + (saveProficient ? prof : 0) + save.bonus modifiers`. Save proficiency comes from class 1 `saves` (first class only — 2024 multiclass rule out of scope). Skills: proficiency from decisions on `skillChoice`-generated choices + background `skillProficiencies` + `proficiency.grant` effects; `total = mod(skill.ability) + prof × (expertise ? 2 : half ? 0.5 floored : proficient ? 1 : 0) + skill.bonus`. Speed: species `speed` as walk base; `speed.set` (max wins among sets per `set-if-higher`? No — `speed.set` policy: highest set wins as base) then `speed.bonus` sums. Senses/languages: union.

- [ ] **Step 1: Failing tests** over extended core-mini: scores parse from the selection format; background +2/+1 lands as contributions (visible in `score.contributions`); prof at levels 1/5 from the fixture's table; save with and without proficiency; skill expertise doubles; passive perception; speed base + bonus; deferred heavy-armor predicate resolves against final STR (both pass and fail directions). → FAIL, implement, green.
- [ ] **Step 2: Commit** `feat(engine): ability, proficiency, skill and speed derivation`.

### Task 10: Derive — AC, HP, hit dice, death saves, conditions view

**Files:**
- Create: `packages/engine/src/derive/defense.ts`, `packages/engine/src/derive/hp.ts`
- Test: `packages/engine/test/derive-defense.spec.ts`

**Interfaces:**
- Produces:

```ts
export interface DefenseResult {
  ac: Derived<number>;
  issues: Diagnostic[];              // heavy-armor STR unmet → warning 'derive.armorStrength'; stealth disadvantage → info-like warning 'derive.stealthDisadvantage'
}
export function deriveDefense(abilities: AbilitiesResult, comp: Composition, facts: Facts, index: ContentIndex): DefenseResult
export interface HpResult {
  max: Derived<number>;
  current: number;                    // facts.hp.current with 'max' resolved and clamped to [0, max]
  temp: number;
  hitDice: Record<string, { die: number; total: number; spent: number }>;
  deathSaves: { successes: number; failures: number };
  conditions: { conditionId: string; level?: number; source?: string }[];
}
export function deriveHp(abilities: AbilitiesResult, comp: Composition, facts: Facts, index: ContentIndex, rules: SystemRules): HpResult
```

AC (doc-05 armor rules, all data-driven): equipped armor item contributes formula candidate `armor.ac + min(mod(dex), dexCap)` (dexCap absent = uncapped; dexCap 0 = no dex); the base candidate `10 + mod(dex)` is always present; `ac.formula` effects add candidates; winner via `max-of-formulas`; then `ac.bonus` modifiers sum on top (shield's `+2` arrives as the shield item's `ac.bonus` effect with `key: 'shield'` — it does NOT compete as a formula). HP max: per class, level 1 = `hitDie + con.mod` when `hpRules.firstLevelMaxHitDie`, levels ≥ 2 price `facts.hpRolls[classId][i]` — a number uses it raw (clamp 1..hitDie), `'average'` uses `hitDie/2 + 1` rounded per `hpRules.averageRounding` (`down` → `floor(hitDie/2) + ... ` — exactly: average = `(hitDie / 2) + 1` for 'up' i.e. d10 → 6, and `floor(hitDie/2) + 1` happens to equal it for even dice; implement as `avg = hitDie / 2 + (rounding === 'up' ? 1 : 1)` — even dice make both equal 6 for d10; keep the rounding switch anyway for odd future dice); each level also adds `con.mod` and `hp.perLevel` effects × totalLevel; `hp.bonus` flat; `maxOverride` (from facts) wins totally with a contribution `kind: 'override'`. Every con-mod/roll lands as a contribution (provenance). Hit dice totals = class levels; die from class `hitDie`.

- [ ] **Step 1: Failing tests**: unarmored AC = 10 + dex; armor with dexCap; armor + shield + `ac.bonus` stacking-key behavior (two shields don't stack); heavy armor STR warning fires below the threshold predicate; HP fighter-like fixture level 3 with rolls `[7, 'average']` → `(10+2) + (7+2) + (6+2) = 29` (fixture con 14, d10 — encode this exact arithmetic); maxOverride wins; `'max'` current resolves to max; current clamps to max when a stale number exceeds it. → FAIL, implement, green.
- [ ] **Step 2: Commit** `feat(engine): AC and HP derivation`.

### Task 11: Derive — attacks and weapon mastery

**Files:**
- Create: `packages/engine/src/derive/attacks.ts`
- Test: `packages/engine/test/derive-attacks.spec.ts`

**Interfaces:**
- Produces:

```ts
export interface AttackRow {
  instanceId: string; itemId: string; name: string;   // name = item entity id for the UI localizer; custom items use entry.name
  toHit: Derived<number>;
  damage: { dice: string; bonus: Derived<number>; type: string };
  properties: string[]; mastery?: string;             // mastery property surfaced when active
  ability: string;                                     // which ability priced it
}
export function deriveAttacks(abilities: AbilitiesResult, comp: Composition, facts: Facts, index: ContentIndex): { attacks: AttackRow[]; attacksPerAction: number; issues: Diagnostic[] }
```

Per equipped weapon: ability = `str`, or `dex` when the weapon's `properties` include `finesse` and `mod(dex) > mod(str)`, or `dex` for `range`-typed weapons (read the item's `weapon.type` / properties from the pack — no property-name constants beyond `finesse` which doc-05 names as the engine contract via "per property"); toHit = `mod + (proficient ? prof : 0) + attack.bonus` effects passing their `filter` (melee/ranged/any); proficiency from class `weaponProficiencies` categories/ids vs the item's tags (`union` set from T8); damage bonus = `mod + damage.bonus` filtered effects. `attacksPerAction` = max over `extraAttack.set` counts, default 1. Mastery: surfaced when the character has a `mastery.grant` effect AND the weapon is selected in the mastery choice's decision (`facts.decisions` on the class's mastery choice — pick form and slug come from the pack).

- [ ] **Step 1: Failing tests**: str melee weapon toHit/damage; finesse picks dex when higher; ranged uses dex; non-proficient drops prof; Archery-style `attack.bonus {filter: ranged}` applies only to ranged rows; `extraAttack.set 2` → attacksPerAction 2; mastery appears only when both grant + decision present. Fixture core-mini needs a small weapon set — add 2 items (one finesse melee, one ranged) if not present. → FAIL, implement, green.
- [ ] **Step 2: Commit** `feat(engine): attack derivation and weapon mastery`.

### Task 12: Derive — spellcasting, resources, actions

**Files:**
- Create: `packages/engine/src/derive/spellcasting.ts`, `packages/engine/src/derive/resources.ts`, `packages/engine/src/derive/actions.ts`
- Test: `packages/engine/test/derive-spellcasting.spec.ts`

**Interfaces:**
- Produces:

```ts
export interface SpellcastingBlock {
  classId: string; ability: string; dc: Derived<number>; attack: Derived<number>;
  slots: { level: number; max: number; used: number }[];      // from system.tables.spellSlots[progression][classLevel-1]
  preparation: string; preparedMax?: number;                   // preparedCount formula OR class row extra.preparedSpells (row wins when both; plan-2 stored the 2024 wizard table in row extra)
  prepared: string[]; known: string[];                         // from facts
  cantripsKnown?: number; ritual: boolean;
}
export function deriveSpellcasting(abilities, comp, facts, index): { blocks: SpellcastingBlock[]; concentration?: { spellId: string } ; issues: Diagnostic[] }
export interface ResourceView { id: string; name: string; max: Derived<number>; used: number; reset: string; display: string; source: string }
export function deriveResources(abilities, comp, facts, index): { resources: ResourceView[]; issues: Diagnostic[] }
export interface ActionView { id: string; name: string; kind: string; description: string; resource?: string; source: string }
export function deriveActions(comp, index): { actions: ActionView[] }
```

Spellcasting from each `spellcasting.define` active effect: DC `8 + prof + mod(ability)`, attack `prof + mod(ability)`; slot row = `system.tables.spellSlots[effect.slots]` indexed by CLASS level (not total — single-class in 1b, same number); `used` from `facts.slotsUsed` (slot pooling across classes is Phase-4; one caster in scope). Formulas (`cantripsKnown`, `preparedCount`) evaluate with the formula evaluator's context (`classLevel(id)` etc. — evaluator exists from plan 1). Resources from `resource.define` effects: `max` formula evaluated, `used` from facts. Actions from `action.define`.

- [ ] **Step 1: Failing tests** (fixture gets a mini spellcasting class if core-mini lacks one — full-caster progression rows only up to level 5 in `system.tables.spellSlots`): DC/attack arithmetic; slots row matches table for levels 1 and 5 with used overlay; `preparedMax` from row extra beating formula; cantrips formula; resource max formula `1 + floor(classLevel(x)/4)`-style evaluated; actions list with resource linkage. → FAIL, implement, green.
- [ ] **Step 2: Commit** `feat(engine): spellcasting, resource and action derivation`.

### Task 13: Derive — Sheet assembly, level-scoped choices, advancement, validateSelection

**Files:**
- Modify: `packages/engine/src/derive/sheet.ts` (full Sheet), `packages/engine/src/derive/index.ts` (orchestrating `derive`), `packages/engine/src/derive/choices.ts` (level-scoped)
- Create: `packages/engine/src/derive/advancement.ts`, `packages/engine/src/derive/validation.ts`
- Test: `packages/engine/test/derive-sheet.spec.ts`, `packages/engine/test/advancement.spec.ts` (existing `derive` tests updated ONLY where the Sheet gained fields — `name/system/level/classes/pins/outstandingChoices/issues` keep their meaning; goldens' `sheet.*` paths from plan 1 keep working)

**Interfaces:**
- Produces (the FULL Sheet — plan 5's UI contract; keep it JSON-serializable):

```ts
export interface Sheet {
  name: string; system: string; level: number;
  classes: { classId: string; level: number; subclassId?: string }[];
  pins: Record<string, string>;
  abilities: Record<string, AbilityBlock>; prof: number;
  skills: AbilitiesResult['skills']; passivePerception: number;
  speed: Record<string, Derived<number>>;
  senses: AbilitiesResult['senses']; languages: AbilitiesResult['languages'];
  ac: Derived<number>; hp: HpResult;                                      // T10
  initiative: Derived<number>;                                            // dex mod + initiative.bonus
  attacks: AttackRow[]; attacksPerAction: number;                         // T11
  spellcasting: SpellcastingBlock[]; resources: ResourceView[]; actions: ActionView[];  // T12
  proficiencies: { kind: string; target: string; level: string; sources: string[] }[];
  inventory: (InventoryEntry & { resolved: boolean })[];                  // resolved=false → unknown-id chip
  currency: Facts['currency']; inspiration: boolean; conditions: HpResult['conditions'];
  xp: number; grammaticalGender: Facts['grammaticalGender'];
  outstandingChoices: ChoiceRequest[];                                    // NOW level-scoped (below)
  issues: Diagnostic[];
}
export function derive(facts: Facts, index: ContentIndex, rules?: SystemRules): Sheet
// rules optional for compatibility: without them hp.max derives with average pricing plus a
// warning 'derive.noSystemRules'; the golden harness and the web app ALWAYS pass rules.
export interface Advancement { classId: string; toLevel: number; steps: ChoiceRequest[]; hpChoice: boolean }
export function pendingAdvancements(sheet: Sheet, facts: Facts, index: ContentIndex): Advancement[]
export function validateSelection(sheet: Sheet, facts: Facts, index: ContentIndex, choiceId: string, selection: string[]): Diagnostic[]
```

`outstandingChoices` extends `creationChoices` with the level scope from doc-05: for each class entry and each row `level ≤ classLevels[classId]`, rows' `choices` (and subclass rows') without a valid decision; keep the creation-slot logic as-is. `pendingAdvancements`: XP mode — `xp ≥ system.tables.xp[totalLevel]` (xp[i] = XP to BE level i+1) → one Advancement per current class (`toLevel = classLevels[classId] + 1`; multiclass listing other classes is out of scope — list only classes the character already has, plus, at totalLevel 0, nothing: creation is not an advancement). `steps` = the choices the NEXT row would ask (subclass choice materializes at `subclassLevel`). `validateSelection` checks: choice exists; selection size vs `count`; each selected id resolves; satisfies the `pick` form (query type/tags match, `static` membership, `abilities` improve format `<id>:+2` etc. — define: ASI selection format is `['str:+2', 'con:+1']` or `['str:+1','dex:+1','con:+1']`-style, validated against the `improve` grammar; abilityGeneration selection is the T9 `<id>:<score>` format validated against the method rules — standardArray must use exactly the array's multiset, pointBuy must cost ≤ budget within min/max using the costs table, manual within min/max, roll: six scores each 3..18); `unique` forbids duplicates with prior decisions; prerequisites predicates of the selected entity evaluated against the CURRENT sheet.

- [ ] **Step 1: Failing tests.** Sheet assembly: initiative = dex mod + bonus; proficiencies list unions with sources; unresolved inventory id → `resolved: false` + warning; a full mini-character (core-mini catfolk fighter-like level 2) snapshot-asserts the whole Sheet SHAPE (keys present, JSON-round-trippable — `JSON.parse(JSON.stringify(sheet))` deep-equals). Advancement: xp table crossing (xp exactly at threshold → advancement present; one below → absent); steps include row choices + subclass at the subclass level; hpChoice true for levels ≥ 2. validateSelection: each pick form one pass + one fail; pointBuy budget overflow fails with `'selection.pointBuyBudget'`; standardArray wrong multiset fails; unique collision fails; prerequisite failure fails. → FAIL, implement, green.
- [ ] **Step 2: Green all engine tests + `pnpm check`** (plan-1 goldens with `sheet.level/classes` paths now derive real values — update those two fixture expectations if they asserted the old hardcoded `0`/`[]`).
- [ ] **Step 3: Commit** `feat(engine): full sheet derivation, advancement and selection validation`.

### Task 14: Dice + `propose.*`

**Files:**
- Create: `packages/engine/src/dice/parse.ts`, `packages/engine/src/dice/roll.ts`, `packages/engine/src/propose/index.ts` plus one file per family: `propose/{vitals,casting,items,rest,notes}.ts`
- Modify: `packages/engine/src/index.ts` (export `propose`, `roll`, `parseRollSpec`)
- Test: `packages/engine/test/dice.spec.ts`, `packages/engine/test/propose.spec.ts`

**Interfaces:**

```ts
// dice (doc-05 § Dice)
export interface RollSpec { dice: { n: number; sides: number; keep?: { mode: 'highest' | 'lowest'; count: number } }[]; modifier: number; advantage?: 'adv' | 'dis' | 'none' }
export function parseRollSpec(text: string): RollSpec        // '4d6kh3', '2d20kl1', '1d8+3', 'd20' — throws FormulaError-style on bad input
export interface RollResult { spec: RollSpec; dice: { sides: number; value: number; kept: boolean }[]; total: number }
export function roll(spec: RollSpec, rng: () => number): RollResult   // rng REQUIRED in the engine API; the WEB layer wraps crypto.getRandomValues (engine stays free of crypto/global RNG)
// propose — every proposer returns ProposedEvent[]: envelope-less payload drafts
export interface ProposedEvent { type: string; v: 1; payload: unknown }
export const propose: {
  damage(sheet: Sheet, amount: number, opts?: { type?: string; source?: string }): ProposedEvent[];
  heal(sheet: Sheet, amount: number): ProposedEvent[];
  tempHp(sheet: Sheet, amount: number): ProposedEvent[];
  spendSlot(sheet: Sheet, level: number): ProposedEvent[];
  cast(sheet: Sheet, spellId: string, opts: { level: number; useSlot?: boolean }): ProposedEvent[];
  rest(sheet: Sheet, kind: 'short' | 'long', hitDice?: { classId: string; count: number }[]): ProposedEvent[];
  spendHitDie(sheet: Sheet, classId: string, rolled: number): ProposedEvent[];
  deathSave(sheet: Sheet, result: 'success' | 'failure' | 'critSuccess' | 'critFailure'): ProposedEvent[];
  equip(sheet: Sheet, instanceId: string, equipped: boolean): ProposedEvent[];
  attune(sheet: Sheet, instanceId: string, attuned: boolean): ProposedEvent[];
  addItem(sheet: Sheet, item: { itemId?: string; qty?: number; name?: string; custom?: Record<string, unknown> }, newId: () => string): ProposedEvent[];
  currency(sheet: Sheet, deltas: Partial<Facts['currency']>): ProposedEvent[];
  condition(sheet: Sheet, conditionId: string, add: boolean, level?: number): ProposedEvent[];
  inspiration(sheet: Sheet, value: boolean): ProposedEvent[];
  note(op: 'added' | 'updated' | 'removed', note: { id: string; title?: string; body?: string }): ProposedEvent[];
};
```

Proposer semantics (each validates against the sheet and throws a `Diagnostic[]`-carrying `ProposeError` on impossible actions — UI catches): `damage` clamps to reachable HP (resolves a `'max'` current first — emits `hp.changed {kind:'damage', delta: -actual}`; delta sign convention: doc-02 has a single `delta` — BINDING: `delta` is SIGNED, damage negative, heal positive, temp positive, set absolute; handlers in T5 must follow this — T5's tests already encode `kind` + magnitude, keep them consistent); `spendSlot` refuses when `used >= max` (`'slot.none-left'`); `cast` folds spell.cast with concentration flag read from the spell entity; `rest` builds the transaction from T6's contract (`rest.taken` + `resource.restored` per matching active resource — reset kind from the sheet's `ResourceView.reset`; long rest matches both `'shortRest'` and `'longRest'` resets); `spendHitDie` refuses when none remain, emits `hit_dice.spent {classId, count: 1, healed: rolled + con.mod}` (floor healed at 0? SRD: add con mod, minimum 0 total — floor at 0); `attune` refuses past `system.attunementMax` (the UI-enforced max lives HERE, the reducer stays permissive); `addItem` takes a `newId` factory so the engine stays UUID-free.

- [ ] **Step 1: Failing dice tests**: `parseRollSpec('4d6kh3')` shape; roll with a scripted rng — `4d6kh3` with rng yielding [3,5,2,6] keeps [5,6,3] total 14 + kept flags; advantage `d20 adv` rolls two, keeps higher; deterministic across two identical rng runs. Propose tests: each proposer happy path emits the exact payloads (assert deep-equal); each refusal case throws with the named code; the rest transaction for a sheet with one shortRest and one longRest resource: short → restores only the shortRest one, long → both; damage against `'max'` current resolves; delta signs verified round-trip through the T5 handlers (`reduce` the proposals over the same facts → expected hp). → FAIL, implement, green.
- [ ] **Step 2: Update T5's `hp.changed` handler/tests** if the signed-delta convention requires it (the propose round-trip test is the arbiter — one convention, both sides).
- [ ] **Step 3: Commit** `feat(engine): dice roller and event proposers`.

### Task 15: Golden fixtures — Fighter 1–5, Wizard 1–5, in-play sequences, perf budget

The proof over the REAL pack. Extends the harness to load `packages/content/dist/packs/srd-5e-2024/pack.json` and pass `SystemRules` from its system entity.

**Files:**
- Modify: `packages/engine/test/support/golden.ts` (accept `packs: ['dist:srd-5e-2024']` prefix → load from content dist via `createRequire`/relative path; extract rules and pass to `reduce`/`derive`), `packages/engine/package.json` (test script gains a `pretest` dependency? NO — CI already builds the content pack before tests via the root pipeline; assert the file exists and fail with a clear message `'run pnpm --filter @hk/content build:pack first'`)
- Create: `packages/engine/test/golden/fighter-1.json` … `fighter-5.json`, `wizard-1.json` … `wizard-5.json`, `fighter-5-play.json`, `wizard-5-play.json`, `packages/engine/test/perf.spec.ts`
- Test: the golden runner spec already iterates `test/golden/*.json` — new fixtures auto-run.

**Fixture recipe (write events as full envelopes; ids uuidv7-shaped literals, `stream` one fixed uuid per fixture, seq ascending):**

Fighter (all five share the prefix; each level adds events):
- `character.created` (system `5e-2024`, core pack `srd-5e-2024@0.1.0` — read the exact version from the built pack, pack-derived), human species decision, soldier background decision (pack-derived: verify the SRD 2024 background whose `abilityScores` contains str+con and whose `originFeat` is Savage Attacker — expected `srd-5e-2024:background/soldier`; if the pack differs, choose the background matching that shape and note it in the fixture `name`), background ability decision `['str:+2','con:+1']` (format per T13), ability scores standardArray `['str:15','dex:13','con:14','int:10','wis:12','cha:8']`, class fighter level 1 (`level.gained {level:1}` + skill choice `[athletics, perception]` + fighting-style choice → `defense` feat + mastery choice pack-derived), equipment: `item.added` chain-mail/longsword/shield + equip all three.
- Levels 2–5: `xp.awarded` to the table threshold (pack-derived from `system.tables.xp`: expected 300/900/2700/6500 cumulative targets), `level.gained {level: n, hpRoll: 'average'}`, subclass champion at 3 (`subclassId` on the gain), ASI at 4 → decision `['str:+1','con:+1']` (2024 fighter 4 is a feat-or-ASI choice; use the ASI pick — pack-derived choice id).

Binding expectations (arithmetic stated; pack-derived marked):
- fighter-1: `sheet.level` 1, `sheet.prof` 2, str score 17 mod 3 (15+2), con 15 mod 2, `sheet.hp.max` **12** (10 + 2), `sheet.ac` **19** (chain mail 16 flat-dex + shield 2 + Defense 1), str save **5** (3+2), longsword toHit **5**, passivePerception **13** (10 + wis mod 1 + prof 2; perception is one of the two chosen skills), attacksPerAction 1, second-wind resource present (max pack-derived).
- fighter-5: prof **3**, hp.max **44** (12 + 4×8), ac **19**, attacksPerAction **2**, toHit **6**, str save **6**, xp ≥ 6500.
- wizard-1/5 (sage background, int-focused mirror): int 17 mod 3; hp.max L1 **8** (6+2), L5 **32** (8 + 4×6); slots L1 `[{level:1,max:2}]`, L5 `[4,3,2]` (pack-derived table); dc L5 **14**; attack **6**; cantripsKnown L5 **4** (`3 + floor(5/4)`); preparedMax L5 **9** (pack-derived row extra); evoker at 3; arcane-recovery resource present; ritual true.
- play fixtures: fighter-5-play appends ~15 events (damage/heal/temp/second-wind spend/short rest transaction/death-save cycle/revert one event) asserting end-state hp/resources/deathSaves paths; wizard-5-play: prepare 9 spells, cast fireball at 3 (slot used), concentration start/end, long rest → slots restored, `'max'` hp resolved.

- [ ] **Step 1: Harness extension + one failing fixture** (fighter-1) — run, watch it fail meaningfully (missing derive pieces should NOT fail here — Tasks 8–13 are done; a failure now means a real bug or a wrong pack-derived assumption: STOP and verify against the built pack + SRD before adjusting any number; adjustments to pack-derived values are fine, adjustments to stated arithmetic are a finding to report).
- [ ] **Step 2: Remaining nine fixtures**, verifying every pack-derived value by reading the built pack (`node -e` one-liners or a scratch script; do NOT commit scratch).
- [ ] **Step 3: `perf.spec.ts`**: build fighter-5-play's facts + 500 synthetic in-play events (cycled damage/heal/slot events), measure `reduce` + `derive` wall time with `performance.now()` median of 5 runs; assert < 150 ms (generous CI headroom vs the 30 ms device target — the REAL device measurement is plan 6's checklist); `console.info` the measured numbers so CI logs record them, and write them into the fixture-adjacent `packages/engine/test/golden/PERF.md`.
- [ ] **Step 4: Full `pnpm check` green. Commit** `test(engine): fighter and wizard 1-5 goldens over the real SRD pack + perf budget`.

### Task 16: Storage — Dexie v2: events, snapshots, characters, blobs, leader election

**Files:**
- Modify: `apps/web/src/app/shared/services/storage/dexie.db.ts` (version(2) — ADD a new `this.version(2).stores(...)` call, never edit version(1))
- Create: `apps/web/src/app/shared/services/storage/events.repository.ts`, `snapshots.repository.ts`, `characters.repository.ts`, `blobs.repository.ts`, `leader.service.ts`
- Test: co-located `*.spec.ts` for each (fake-indexeddb global setup exists; Web Locks needs a tiny in-test stub — `navigator.locks` is absent in jsdom)

**Interfaces (consumed by plan 5's CharacterStore):**

```ts
// dexie.db.ts version(2) additional tables
export interface EventRow { id: string; stream: string; seq?: number; json: Event }        // events: '&id, stream, [stream+seq]'
export interface SnapshotRow { stream: string; seq: number; engineVersion: string; json: Snapshot }  // snapshots: '&stream'
export interface CharacterRow { id: string; name: string; system: string; archived: boolean; updatedAt: number; portraitThumbHash?: string }  // characters: '&id, name, updatedAt'
export interface BlobRow { hash: string; mime: string; bytes: Uint8Array; size: number }   // blobs: '&hash'
// events.repository.ts
append(events: Event[]): Promise<void>            // bulkAdd; throws on duplicate id
byStream(stream: string): Promise<Event[]>        // committed by seq asc, then pending in insertion order (Dexie auto-increments? no — pending order via a monotonic 'pendingOrder' field added to EventRow, set from a per-append counter persisted in the settings table)
assignSeqs(stream: string, fromId: string, startSeq: number): Promise<void>  // future sync hook; v1: local commit = write seq at append time via nextSeq(stream)
nextSeq(stream: string): Promise<number>          // max committed seq + 1 (index lookup, not table scan)
// snapshots.repository.ts — put/get per stream; prune on engineVersion mismatch (reduce ignores those anyway)
// characters.repository.ts — CRUD over CharacterRow; list ordered by updatedAt desc; upsertFromFacts(streamId, facts) maps name/system/archived
// blobs.repository.ts — put(hash, mime, bytes) idempotent; get; delete-if-unreferenced deferred to plan 6 (images)
// leader.service.ts
isLeader: Signal<boolean>
acquire(): Promise<void>   // navigator.locks.request('hk-writer', { mode: 'exclusive' }, holdForever) — resolves acquire() once granted, keeps holding; absent Web Locks → isLeader = true + console.warn (single-tab assumption)
```

Solo-phase seq contract (binding, and the reason `append` is simple): this device is the only writer, so events are committed LOCALLY — `append` fills `seq` via `nextSeq(stream)` inside one Dexie transaction (`'rw', events`) making concurrent same-stream appends safe; `pendingOrder` exists but stays unused until sync (Phase 2) — do implement the field, do not implement any pending flow beyond storing `seq`-less rows if a caller passes them (byStream ordering rule above).

- [ ] **Step 1: Failing repo tests**: version(2) migration upgrades a v1 DB with pack rows intact (open v1 schema, close, reopen v2 — packs survive); append assigns contiguous seqs 1..n per stream across two interleaved streams; duplicate id rejects; byStream ordering (committed asc + a seq-less straggler last); snapshot round-trip; characters upsertFromFacts maps fields; blob idempotent put. Leader: with stubbed `navigator.locks` two "tabs" (two service instances sharing the stub) — first is leader, second not until first releases; absent locks → leader true.
- [ ] **Step 2: Implement, green (`pnpm --filter web test`), full `pnpm check`.**
- [ ] **Step 3: Commit** `feat(web): event, snapshot, character and blob storage with leader election`.

---

## Self-Review

**Spec coverage (1b deliverables 1–2):** reduce all Phase-1 handlers + system rest/HP rules (T2–T7); derive complete for scope (T8–T13); `outstandingChoices`/`pendingAdvancements`/`validateSelection` (T13); `propose.*` for damage/heal/temp/slots/cast/rest/equip/attune/items/currency/conditions/death saves/hit dice/notes (T14 — conditions via `propose.condition`, death saves via `propose.deathSave`); dice (T14); golden fixtures Fighter/Wizard 1–5 with gear (T15); rebase remains the plan-1 skeleton (deliverable says "skeleton (report only)" — `planRebase` exists as a stub from plan 1's scope; NOT extended here, listed for plan 5/6 if the spec's §1b line means more — flagged as an explicit scope note, not a gap: report-only planRebase lands with the import/rebase UI in plan 6). Storage deliverable 2 fully in T16 (events, snapshots, blobs, packs [exists], settings [exists], characters index, migrations, persistence request [exists from plan 3], leader election). Acceptance criteria touched here: golden-fixture equality (T15), perf budget proxy (T15; device measurement deferred to plan 6's checklist), airplane-mode/UI criteria belong to plans 5–6.
**Placeholder scan:** no TBD/TODO/"similar to"; T13's Sheet references named T9–T12 types by import, all defined in their tasks; the one intentionally deferred behavior (short-rest per-resource resets) is a stated contract with its owner (proposer), not a gap.
**Type consistency pass:** `Facts` fields used by T5–T7 handlers match T3's interface (+ `hpRolls` added in T4, `lastRest` NOT used — removed from design; `hp.current: number | 'max'` widening introduced in T6 and consumed by T10/T14); `Derived`/`Contribution` defined T8, consumed T9–T13; `AbilitiesResult` T9 → T10/T11/T13; `SystemRules` T3 → T6/T10/T15; `ProposedEvent` T14 only; storage rows self-contained in T16. `reduce(events, from?, rules?)` signature consistent across T3/T15/golden harness.

