# Phase 1b Plan 5 — Character Builder & Sheet UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A user can create a level-1 Fighter or Wizard in the PWA in under five minutes, see a full live character sheet (Play/Build/Timeline), and level it to 5 — every action an event, every derived number carrying provenance, sheets matching plan 4's golden fixtures.

**Architecture:** Signal stores over event replicas (doc 09): `CharacterStore` wraps plan 4's storage repositories + engine (`reduce`→`facts` signal, `sheet = computed(derive(...))`); UI components read signals and call store methods that build events via `propose.*` / hand-assembled transactions. The creation and level-up wizards are driven by the ENGINE's `outstandingChoices`/`pendingAdvancements`/`validateSelection` — the UI renders pick forms generically and never encodes a 5e rule. One transaction (shared `txId`) per wizard completion; undo = `event.reverted` by txId + snapshot drop + full replay.

**Tech Stack:** Angular 22 zoneless/signals/standalone, SCSS + `@hk/ui-tokens` custom properties, Transloco 8 (en/ru/uk, ICU), Dexie 4 (existing v2 schema), `@hk/engine` + `@hk/protocol`, CDK a11y, Playwright + axe (existing harness).

**Spec:** `docs/03-roadmap/phase-1-solo-builder.md` §1b deliverables 3–5 + acceptance criteria; `docs/02-architecture/09-frontend-architecture.md` (folder layout, stores, sheet modes, forms, `hk-derived`); `02-domain-model-and-events.md` (event payloads, decision.made context for rolls); plan 4's ledgered carries (below).

## Global Constraints

- Non-negotiables (CLAUDE.md): rules are data — the wizard renders PICK FORMS (query/static/abilities/abilityGeneration/literal), never class-specific hardcoded steps; i18n structural — no user-visible string literals, new scopes get en/ru/uk with natural translations; engine determinism untouched; TDD failing-test-first; Conventional Commits with scope; commit attribution = whatever trailer the EXECUTING session's host instruction currently specifies (do not copy one from this plan).
- Angular conventions from plans 3–4: standalone components, `inject()`, `provideZonelessChangeDetection` in TestBed, `TestBed.tick()` to flush effects, template string inputs bracket-bound (`[variant]="'ghost'"`), web specs are co-located `*.spec.ts`, fake-indexeddb global setup exists, components use tokens only (`var(--surface-2)`), stylelint bans raw colors.
- Production initial bundle ≤ 600 KB gzip — the postbuild gate enforces it; new routes are `loadComponent` lazy; heavy steps inside the wizard use `@defer` where sensible.
- **Plan-4 load-bearing carries (binding):** (1) `outstandingChoices` does NOT surface a granted/decision-selected feat's own choices — Task 1 fixes this in the engine; (2) the CharacterStore MUST delete the stream's snapshot and full-replay whenever it appends `event.reverted` (contract comments exist on `preScanReverted` and `SnapshotsRepository`); (3) canonical hit-dice flow: `propose.spendHitDie` per die, never `rest(hitDice)` for healing (play UI is plan 6, but the CharacterStore doc states it); (4) the wizard MUST render the `abilities` pick form (backgrounds' `@0/ability-scores` +2/+1 choices and the ASI feat's `@4/ability-scores` +2 choice are live in the pack).
- Engine/storage surfaces consumed (verified at plan time — transcribe, don't invent): `derive(facts, index, rules?) → Sheet`; `outstandingChoices(facts, index)`; `pendingAdvancements(sheet, facts, index) → Advancement[] {classId, toLevel, steps: ChoiceRequest[], hpChoice}`; `validateSelection(sheet, facts, index, choiceId, selection) → Diagnostic[]`; `propose.*` (ProposedEvent = `{type, v: 1, payload}`); `reduce(events, from?, rules?)`; `SystemRules = {restRules, hpRules}` from `index.system()`; `roll(spec, rng)` + `parseRollSpec`; Sheet fields incl. `hp {max: Derived, current, temp, hitDice, deathSaves, conditions, currentWasMax}`, `ac/initiative: Derived`, `abilities`, `attacks`, `spellcasting`, `resources`, `actions`, `attunementMax`, `outstandingChoices`, `issues`. Storage: `EventsRepository.append(events)/byStream(stream)/nextSeq`; `SnapshotsRepository.put/get` (Task 1 adds `remove`); `CharactersRepository.list/get/put/remove/upsertFromFacts`; `LeaderService.isLeader/acquire/release`; `HkDb` v2 tables.
- Pack facts (verified against `packages/content/dist/packs/srd-5e-2024/0.1.0/pack.json` — the UI reads these via the engine, never hardcodes them, but tests/e2e may pin them as goldens): system creation choices `srd-5e-2024:system/5e-2024@0/{species,background,class,ability-scores}`; backgrounds each have `@0/ability-scores` (abilities pick, `+2/+1`, count 2); fighter L1 rows ask `@1/fighting-style` (query) + `@1/weapon-masteries` (literal); wizard L1 rows ask NOTHING (spell learning is event-driven, below); class skills use the SYNTHETIC id `<classId>@1/skills` validated against `skillChoice {from, count}` (both classes count 2); ASI feat carries `@4/ability-scores` (`+2`, count 1); ability-scores selection format `['str:15',…]`, abilities-pick format `['str:+2','con:+1']`.
- Event-envelope conventions (doc-02): event ids are client-generated UUIDv7; stream `char:<uuidv7>`; actor `{userId, deviceId, role: 'owner'}` — solo phase: `userId: 'local'`, `deviceId` = a stable per-install id persisted via SettingsRepository; `ts` ISO-8601 Z (envelope regex: seconds with optional `.SSS`); `txId` groups a wizard's transaction.
- The acceptance criterion "resulting sheet matches the golden fixture for the same choices" is BINDING: the e2e creation golden path uses fighter-1's exact decisions (soldier, standard array str15/dex13/con14/int10/wis12/cha8, +2 str/+1 con, athletics+perception, Defense style, chain mail + longsword + shield equipped) and must show AC 19 / HP 12 / prof +2 on the rendered sheet.

### Design rulings baked into this plan

1. **Equipment step is add-from-library, not class equipment options.** The class schema/pack carry NO `startingEquipment` data (verified) — the spec's "equipment options" cannot be data-driven today. The creation wizard's equipment step is a library-backed item picker (search items, add with qty, mark equipped) plus a starting-currency input, emitting `item.added`/`item.equipped`/`currency.changed` events in the creation transaction. Class equipment packages become Phase-4 content vocabulary (ledger note).
2. **Wizard spell learning is count-guided, not hard-capped.** The pack encodes `wizard-cantrips` (3 at L1) and prepared counts, but NOT the "six 1st-level spells in your spellbook" rule. The wizard-class creation/level-up spell step lets the user learn cantrips up to `sheet.spellcasting[0].cantripsKnown` (hard cap — that IS derived) and add level-appropriate spells to the spellbook with a recommended count shown in helper text (i18n; 6 at creation, 2 per level-up) but not enforced. Prepared selection is capped by `preparedMax` (derived). Phase-4 vocabulary note for spellbook-size.
3. **UUIDv7 is hand-rolled** (~15 lines: 48-bit ms timestamp + version/variant bits + crypto random) in a shared helper with tests — no new dependency; monotonicity within a ms is not required (seq orders replay).
4. **Snapshot policy:** after each committed append, if `facts.lastSeq - snapshot.seq > 100` (or no snapshot), persist a fresh snapshot. On `event.reverted` append: `SnapshotsRepository.remove(stream)` first, then full replay (carry 2).
5. **Rolls RNG:** the web layer wraps `crypto.getRandomValues` into the engine's injectable rng (`() => number` in [0,1)); the ability-scores roll method records every die via `decision.made.context = {method:'roll', scores, rolls: [[d,d,d,d]×6]}` (doc-02) and the Timeline renders them.
6. **Sheet route** is `/c/:id` with a `mode` query/child segment (`play` default, `build`, `timeline`) per doc-09's one-route-with-mode-signal; the plan uses child routes `/c/:id/play|build|timeline` with a shared shell component (deep-linkable, matches doc-09's `/c/<id>/play` deep link).

## File Structure (created/modified; all under `apps/web/src/app` unless noted)

```
packages/engine/src/derive/choices.ts        # T1: walk decision-selected entities' choices
apps/web/.../services/storage/snapshots.repository.ts  # T1: remove(stream)
shared/helpers/uuid.ts                        # T2 (uuidv7 + tests)
shared/services/engine/rng.ts                 # T2 (crypto rng)
shared/stores/character.store.ts (+spec)      # T2 — THE store (replica+sheet+tx+revert)
views/characters/list/…                       # T3
shared/components/{stepper,stat-tile,sheet-section,number-field}/…  # T4 (+SKILL.md each)
views/characters/create-wizard/…              # T5 shell+state, T6 pickers, T7 abilities, T8 class/spells/equipment, T9 review
views/characters/sheet/…                      # T10 shell+play, T11 build, T12 timeline
shared/directives/derived-popover.directive.ts # T10 (hk-derived provenance)
views/characters/level-up/…                   # T13
assets/i18n/characters/{en,ru,uk}.json        # T5+ (one scope: characters)
apps/web/e2e/create-fighter.spec.ts, level-up.spec.ts  # T15
```

---

### Task 1: Engine + storage touch-ups the UI depends on

Two small pre-requisites from plan 4's ledger, done first so every later task builds on them.

**Files:**
- Modify: `packages/engine/src/derive/choices.ts` (walk decision-selected entities' choices), `packages/engine/src/derive/index.ts` only if exports change (they shouldn't)
- Modify: `apps/web/src/app/shared/services/storage/snapshots.repository.ts` (+ its spec)
- Test: `packages/engine/test/derive/choices.test.ts` (extend), `apps/web/src/app/shared/services/storage/snapshots.repository.spec.ts` (extend)

**Interfaces:**
- Consumes: `levelScopedChoices`/`creationChoices` internals in choices.ts; `Composition` is NOT available inside outstandingChoices (it takes `facts, index`) — resolve selected entities from `facts.decisions` directly.
- Produces: `outstandingChoices(facts, index)` now ALSO surfaces, for every entity id selected in any decision (resolved via `index.get`, entity types feat/feature only), that entity's own choices whose `at` matches the character's state (creation choices when selected at creation; `{kind:'level', level:N}` choices when any class has level ≥ N) and that have no decision. Concretely: after picking the ASI feat via `fighter@4/feat`, `srd-5e-2024:feat/ability-score-improvement@4/ability-scores` appears as a ChoiceRequest (ownerId = the feat). Recursion depth 1 (a feat's choice may select another feat — its choices surface on the NEXT call; document this). Also produces `SnapshotsRepository.remove(stream: string): Promise<void>` (plain `db.snapshots.delete(stream)`).

- [ ] **Step 1: Failing engine test** in `choices.test.ts`: extend the fixture inline or reuse core-mini's ASI-like structure — a feat with an `at {kind:'level', level:4}` abilities choice, selected via a class row's level-4 query choice; assert `outstandingChoices` lists the feat's choice once the feat is chosen and the class is level ≥ 4, does NOT list it before the feat is chosen, and stops listing it once decided. Run `pnpm vitest run --project engine` → FAIL.
- [ ] **Step 2: Implement** the selected-entity walk in choices.ts (dedupe against already-asked ids; sorted output preserved). Engine suite green.
- [ ] **Step 3: Failing web spec** for `remove`: put a snapshot, `remove(stream)`, `get` returns undefined. → FAIL, implement (3 lines), green.
- [ ] **Step 4: Full `pnpm check`; commit** `feat(engine): surface selected entities' own choices; snapshot removal`.

### Task 2: CharacterStore — the event replica

The heart of the plan: everything UI-side flows through this store.

**Files:**
- Create: `apps/web/src/app/shared/helpers/uuid.ts` (+ `uuid.spec.ts`), `apps/web/src/app/shared/services/engine/rng.ts`, `apps/web/src/app/shared/stores/character.store.ts` (+ `character.store.spec.ts`)
- Modify: `apps/web/src/app/shared/services/storage/settings.repository.ts` ONLY if it lacks a get-or-create helper for the device id (check first; a `deviceId()` method backed by the settings table, generated once)

**Interfaces:**
- Consumes: `EventsRepository.append/byStream`, `SnapshotsRepository.put/get/remove`, `CharactersRepository.upsertFromFacts/get`, `EngineFacade.index`, `PackStore.ready`, engine `reduce/derive/outstandingChoices/pendingAdvancements/SystemRules/parseEvent`, `LeaderService`.
- Produces (Tasks 3–13 rely on these exact names):

```ts
export function uuidv7(): string;                       // helpers/uuid.ts
export function cryptoRng(): number;                    // rng.ts — [0,1) via crypto.getRandomValues
@Injectable({ providedIn: 'root' }) export class CharacterStore {
  readonly streamId: Signal<string | undefined>;        // 'char:<uuid>'
  readonly loaded: Signal<boolean>;
  readonly facts: Signal<Facts | undefined>;
  readonly sheet: Signal<Sheet | undefined>;            // computed(derive(facts, index, rules)); rules from index.system()
  readonly outstanding: Signal<ChoiceRequest[]>;        // computed
  readonly advancements: Signal<Advancement[]>;         // computed
  readonly events: Signal<Event[]>;                     // full ordered log (timeline reads it)
  load(characterId: string): Promise<void>;             // byStream + snapshot resume; sets signals
  create(name: string, gender: GrammaticalGender): Promise<string>; // new stream; ONE character.created event; returns characterId
  appendTx(drafts: ProposedEvent[] | DraftEvent[]): Promise<void>;  // envelope each (uuidv7, ts from Date, actor, shared txId when >1), parseEvent-validate, EventsRepository.append, re-reduce incrementally, upsertFromFacts, snapshot policy (>100 events since snapshot → put)
  revert(target: { eventId?: string; txId?: string }, reason?: string): Promise<void>; // append event.reverted, SnapshotsRepository.remove, FULL replay from byStream (carry 2)
}
export type DraftEvent = { type: string; v: number; payload: unknown }; // = ProposedEvent shape; wizards hand-assemble non-proposer events (decision.made, level.gained, spell.learned…)
```

- Binding details: `ts` = `new Date().toISOString().replace(/(\.\d{3})\d*Z$/, '$1Z')` (envelope regex allows ≤3 fraction digits); actor `{userId:'local', deviceId: <persisted>, role:'owner'}`; `Date.now` is FINE here (app layer, not engine — the determinism rule binds `packages/engine/src` only); store methods guard `LeaderService.isLeader` — non-leader appends throw a typed error the UI toasts (code `characters.not-leader` i18n key, wired in T3); `navigator.storage.persist()` requested (fire-and-forget with catch) after the FIRST successful `create` (spec: "persistence request after first character").
- CharacterStore doc comment states the canonical hit-dice flow (carry 3) for plan 6's play UI.

- [ ] **Step 1: uuid + rng failing tests**: uuidv7 shape (`/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/`), timestamp prefix increases across 2 calls 10ms apart (use vi.useFakeTimers), 1000 ids unique; cryptoRng in [0,1) over 100 draws. → FAIL, implement, green.
- [ ] **Step 2: CharacterStore failing specs** (fake-indexeddb; real reduce/derive over the REAL dist pack via PackStore's loaded packs — mirror how existing web specs seed PackStore, or seed a minimal core pack fixture if the dist pack is too heavy for unit specs; PREFER the real pack since the app ships it): create → one character.created persisted with seq 1, character row upserted, `navigator.storage.persist` called once (stub navigator.storage); load of an existing stream reduces to the same facts; appendTx of 3 drafts shares one txId and all parse; revert by txId removes the snapshot (spy) and the sheet reflects the pre-tx state; non-leader append rejects; snapshot written when >100 events. → FAIL.
- [ ] **Step 3: Implement store.** Green.
- [ ] **Step 4: Full `pnpm check`; commit** `feat(web): character store over the event replica`.

### Task 3: Characters list view + routes

**Files:**
- Create: `apps/web/src/app/views/characters/list/characters-list.component.{ts,html,scss}` (+ spec)
- Modify: `apps/web/src/app/app.routes.ts` (add `/characters`, `/characters/new`, `/c/:id` lazy routes — `/characters/new` and `/c/:id` point at placeholder components created in T5/T10; for THIS task register only `/characters` and add the nav link), `apps/web/src/app/app.html` (nav link), `apps/web/src/assets/i18n/shell/{en,ru,uk}.json` (nav key), NEW scope `apps/web/src/assets/i18n/characters/{en,ru,uk}.json`
- Test: co-located spec

**Interfaces:**
- Consumes: `CharactersRepository.list/remove`, `CharacterStore` (not needed for list — the repository rows suffice: `{id, name, system, archived, updatedAt, portraitThumbHash?}`), existing `hk-card`/`hk-button`/`hk-skeleton`/`hk-dialog` components, toast service.
- Produces: route `/characters` listing rows newest-first (updatedAt desc — the repository's list already orders), each card → `/c/<id>`; "create" button → `/characters/new`; delete with confirm dialog (`CharactersRepository.remove` + `EventsRepository`/snapshot cleanup — add a `deleteCharacter(id)` method ON CharacterStore in this task: removes character row, snapshot, and the stream's event rows via a new `EventsRepository.removeStream(stream)` — add it with a spec); empty state with a friendly i18n message.

- [ ] **Step 1: Failing specs** — list renders rows from a seeded repository; empty state when none; delete flow calls store.deleteCharacter and the row disappears; `removeStream` spec in events.repository.spec.ts (rows gone, other streams untouched). → FAIL.
- [ ] **Step 2: Implement** (component + removeStream + deleteCharacter + routes/nav + i18n keys en/ru/uk). Green.
- [ ] **Step 3: `pnpm check`; commit** `feat(web): characters list with create and delete`.

### Task 4: Shared components — stepper, stat-tile, sheet-section, number-field

Design-system batch (doc-09 names them); each with co-located SKILL.md per repo convention (plans 3's pattern) and spec.

**Files:**
- Create: `apps/web/src/app/shared/components/stepper/…`, `…/stat-tile/…`, `…/sheet-section/…`, `…/number-field/…` (each: component.ts/html/scss + SKILL.md + spec)

**Interfaces (produced — wizard and sheet tasks consume EXACTLY these selectors/inputs):**

```ts
// hk-stepper: linear wizard frame
inputs: steps: {id: string; labelKey: string; state: 'todo'|'current'|'done'|'blocked'}[]; activeId: string;
outputs: stepSelected = output<string>();   // only 'done' steps and the current one are clickable
content: default slot renders the active step's body; footer slot for back/next buttons (owned by the wizard, not the stepper)
// hk-stat-tile: labeled number with optional provenance hook
inputs: labelKey: string; value: number | string; sub?: string; emphasized?: boolean;
content: attr directive slot — the sheet attaches [hkDerived] (T10) to the host
// hk-sheet-section: titled card section with collapse on phone
inputs: titleKey: string; collapsible?: boolean (default false);
// hk-number-field: labeled numeric input (form-control compatible)
inputs: labelKey: string; min?: number; max?: number; step?: number; implements ControlValueAccessor
```

- All strings via labelKey + Transloco (no literals); keyboard/ARIA: stepper is a `role="tablist"`-free ordered nav (`<ol>` with buttons, `aria-current="step"`); number-field wraps `<input type="number">` with 44px targets.

- [ ] **Step 1: Failing specs per component** (render, input binding, stepper click-gating on state, number-field CVA writeValue/registerOnChange round-trip, section collapse toggle). → FAIL.
- [ ] **Step 2: Implement all four + SKILL.md each.** Green.
- [ ] **Step 3: `pnpm check`; commit** `feat(web): stepper, stat-tile, sheet-section and number-field components`.

### Task 5: Creation wizard — shell, state service, name/gender step, review skeleton

**Files:**
- Create: `apps/web/src/app/views/characters/create-wizard/create-wizard.component.{ts,html,scss}` (+ spec), `create-wizard.state.ts` (+ spec) — a component-provided (NOT root) service holding the draft
- Modify: `app.routes.ts` (`/characters/new` → CreateWizardComponent), `assets/i18n/characters/*.json` (wizard keys)

**Interfaces:**
- Consumes: `hk-stepper` (T4), `CharacterStore.create/appendTx` (T2 — but creation does NOT create the stream until the final review commit: the draft lives entirely in the state service), engine `validateSelection` needs a sheet — for creation-time validation build a THROWAWAY facts/sheet: the state service maintains `draftFacts = computed(reduce(draftEvents))` + `draftSheet = computed(derive(draftFacts, index, rules))` where `draftEvents` are envelope-less drafts wrapped in synthetic envelopes (fixed stream `char:00000000-0000-7000-8000-000000000000`, seqless, fake actor) purely in memory — parseEvent-valid but never persisted. This gives live validation and live outstandingChoices for free.
- Produces (steps in T6–T8 plug into this):

```ts
export class CreateWizardState {                        // provided by CreateWizardComponent
  readonly name = signal(''); readonly gender = signal<GrammaticalGender>('neuter');
  readonly decisions = signal<ReadonlyMap<string, string[]>>(new Map());  // choiceId → selection
  readonly decisionContexts = signal<ReadonlyMap<string, Record<string, unknown>>>(new Map());
  readonly extraDrafts = signal<readonly DraftEvent[]>([]);   // spell.learned / item.added / item.equipped / currency.changed from T8
  readonly draftSheet: Signal<Sheet | undefined>;             // as above; undefined until name set
  readonly outstanding: Signal<ChoiceRequest[]>;
  setDecision(choiceId: string, selection: string[], context?: Record<string, unknown>): void;
  validate(choiceId: string, selection: string[]): Diagnostic[];  // validateSelection over draftSheet
  readonly steps: Signal<WizardStep[]>;   // ORDER: 'name' → one step per outstanding creation choice in a stable curated order (species, background, background-abilities, class, ability-scores, class-skills, then remaining outstanding sorted) → 'spells' (only when draftSheet has a spellcasting block) → 'equipment' → 'review'
  buildTransaction(): DraftEvent[];       // character.created + decision.made (with contexts) per decision + level.gained {classId, level:1} + extraDrafts — in that order
}
export interface WizardStep { id: string; labelKey: string; choiceId?: string; kind: 'name'|'choice'|'spells'|'equipment'|'review' }
```

- The step list is DERIVED from engine `outstandingChoices` over the draft (rules-are-data: adding a pack choice adds a step with zero UI changes); the curated ordering only sorts known slugs first. `level.gained` enters the draft as soon as the class decision is made (so class-level choices/skills surface in outstanding).
- Name/gender step: reactive form, name required (ShortText limits from protocol — import the Zod schema for max length), gender radio (3 options, i18n).
- Review step in THIS task: renders the draft summary skeleton (name, chosen entity names via localizer, ability line, HP/AC from draftSheet) + a disabled-until-complete create button wired to `CharacterStore.create` + `appendTx(buildTransaction minus character.created)`… — EXACTLY: `create(name, gender)` emits character.created; the remaining transaction events append with one shared txId. Navigate to `/c/<id>/play` on success. Completeness = `outstanding` empty AND name non-empty.

- [ ] **Step 1: Failing state-service specs** (over the real pack): initial steps = name+review only; setting name+species/background/class decisions grows steps (background-abilities and class-skills appear); draftSheet reflects decisions (fighter L1 con 14 → hp 12 with soldier+array per the Global Constraints fixture line); validate rejects a wrong-multiset standard array; buildTransaction ordering. → FAIL.
- [ ] **Step 2: Implement state + shell + name step + review skeleton.** Component spec: stepper renders derived steps; create button disabled while incomplete. Green.
- [ ] **Step 3: `pnpm check`; commit** `feat(web): creation wizard shell with engine-driven steps`.

### Task 6: Wizard steps — entity pickers (species / background / class / generic query+static+literal)

**Files:**
- Create: `create-wizard/steps/choice-step.component.{ts,html,scss}` (+ spec) — ONE generic component rendering a ChoiceRequest by pick form, `create-wizard/steps/entity-picker.component.{ts,html,scss}` (+ spec) — card grid for query/static picks
- Modify: `create-wizard.component.html` (render choice steps via the generic component), i18n keys

**Interfaces:**
- Consumes: `CreateWizardState` (T5), `EngineFacade.index/localizer/search/iconFor`, `hk-card`/`hk-chip`/`hk-search-field`/virtual-list, `findChoice` from `@hk/engine` (resolve the Choice by id to get its `pick`).
- Produces: `<hk-choice-step [choiceId]="…">` handling pick forms: `query` (entity-picker: localized name+icon cards, search filter, tap to select `count` entities, selected state, description expansion via existing markdown pipeline from the library detail — reuse, do not re-implement sanitization), `static` (same picker, fixed id list), `literal` (chip multi-select of the literal options — weapon-masteries), and the class-skills SYNTHETIC choice (`choiceId` ending `@1/skills`: options from the class's `skillChoice.from`, count from `skillChoice.count`, rendered as chips with localized skill names). `abilities`/`abilityGeneration` forms delegate to T7's components (placeholder slot until T7 lands — this task renders an explicit "coming in T7" ONLY in the sense of routing: wire the switch cases to T7's selectors, which T7 creates; order tasks 6→7 in execution so the switch compiles by referencing T7 components — NO: tasks must compile standalone. RESOLUTION: T6's switch handles query/static/literal/skills and renders nothing (with a code comment naming T7) for abilities forms; T7 fills the two cases).
- Every selection routes through `state.validate` before `setDecision`; diagnostics render as inline localized messages (map diagnostic `code` → i18n key `characters.validation.<code>` with a generic fallback key).

- [ ] **Step 1: Failing specs**: query pick renders localized cards from the real pack (12 classes → species step shows ≥4 species), selecting `count` entities enables next; literal pick renders chips; skills pick enforces count 2 from the fighter; a validation failure (3 skills) renders the diagnostic message. → FAIL.
- [ ] **Step 2: Implement.** Green. **Step 3: `pnpm check`; commit** `feat(web): generic choice steps with entity picker`.

### Task 7: Wizard steps — ability scores (all four methods) + abilities-pick (+2/+1)

**Files:**
- Create: `create-wizard/steps/ability-scores-step.component.{ts,html,scss}` (+ spec), `create-wizard/steps/abilities-improve-step.component.{ts,html,scss}` (+ spec)
- Modify: `choice-step.component.ts` (fill the two switch cases), i18n keys

**Interfaces:**
- Consumes: `index.system().abilityGeneration` (standardArray `[15,14,13,12,10,8]`, pointBuy `{budget 27, min 8, max 15, costs}`, roll `'4d6kh3'`, manual `{min,max}` — ALL read from the pack, never hardcoded), engine `parseRollSpec/roll` + `cryptoRng` (T2), `hk-number-field`, `state.validate/setDecision` with context.
- Produces: ability-scores step with a method tab bar (four methods from the system entity — hide a method if absent): **standard array** = six selects/drag-assign of the array values to abilities (each value used exactly once — UI enforces the multiset, engine validates authoritatively); **point buy** = per-ability steppers with a live budget meter (cost from the costs table; blocks below min/above max; over-budget disables next and shows the engine diagnostic); **manual** = six number-fields (min/max bounds); **roll** = a "roll" button per slot or "roll all six" using `roll(parseRollSpec(system.abilityGeneration.roll), cryptoRng)`, showing each die with kept/dropped styling (`RollResult.dice[].kept`), free assignment of the six results to abilities, re-roll NOT offered once assigned (rolls are recorded — honesty by design); selection emitted as `['str:15',…]` with `context {method, scores, rolls?}` per doc-02. Abilities-improve step (background +2/+1 and ASI +2): reads the choice's `pick.abilities.improve` grammar and the OWNER's `abilityScores` allow-list when present (backgrounds), renders the allowed abilities as targets; emits `['str:+2','con:+1']`-format selections.
- The dice UI announces results via CDK LiveAnnouncer (a11y) with an ICU i18n message.

- [ ] **Step 1: Failing specs**: standard-array multiset enforcement (assigning 15 twice impossible); point-buy meter math against the pack's costs table (15+15+15+15+15+8 shows over-budget and the engine diagnostic); roll produces six results whose context lands in the decision (`rolls` has 6×4 dice, scores match kept sums); improve step restricted to soldier's three abilities; both steps emit the exact selection formats. → FAIL.
- [ ] **Step 2: Implement.** Green. **Step 3: `pnpm check`; commit** `feat(web): ability score generation with all four methods`.

### Task 8: Wizard steps — wizard spells + equipment

**Files:**
- Create: `create-wizard/steps/spells-step.component.{ts,html,scss}` (+ spec), `create-wizard/steps/equipment-step.component.{ts,html,scss}` (+ spec)
- Modify: `create-wizard.state.ts` if `extraDrafts` helpers are needed (`addSpellLearned/addItem/setCurrency` mutators), i18n keys

**Interfaces:**
- Consumes: `draftSheet().spellcasting[0]` (cantripsKnown cap, preparedMax, classId, list), `EngineFacade.search/index` (spell/item queries: `index.query({type:'spell', level:0|1, classes:[classId]})` — check the real query capabilities in `content/index.ts` and use what exists; fall back to filtering `query({type:'spell'})` in the component), the entity-picker (T6) for both pickers, design rulings 1–2 (recommended counts as helper text, cantrip cap hard, spellbook soft; equipment = add-from-library + currency).
- Produces: spells step (VISIBLE only when the draft has a spellcasting block — state already gates it): cantrip picker (cap = cantripsKnown, hard), level-1 spell picker for the spellbook (recommended 6, soft, helper text ICU), prepared toggle on learned spells (cap preparedMax, hard) — emits `spell.learned {spellId, classId, source:'levelUp'}` per learned spell + `spell.prepared` per prepared into `extraDrafts`. Equipment step: item search picker (add with qty; equip toggle for weapon/armor/shield categories) + currency five-field group → `item.added {instanceId: uuidv7(), itemId, qty}` / `item.equipped {instanceId}` / one `currency.changed` with the entered totals.
- The fighter path sees ONLY the equipment step; the wizard path sees spells+equipment (specs cover both).

- [ ] **Step 1: Failing specs**: fighter draft → no spells step; wizard draft → cantrip cap 3 enforced (4th blocked with message), 7th spellbook spell allowed with helper visible, prepared capped at preparedMax (4 at L1); equipment adds chain mail equipped and the draft events carry matching instanceIds between added/equipped; currency draft. → FAIL.
- [ ] **Step 2: Implement.** Green. **Step 3: `pnpm check`; commit** `feat(web): spell learning and equipment wizard steps`.

### Task 9: Review step completion + character creation end-to-end (unit level)

**Files:**
- Modify: `create-wizard/create-wizard.component.*` (full review rendering + create flow), `create-wizard.state.ts` (buildTransaction finalization), specs

**Interfaces:**
- Consumes: everything T5–T8 produced; `CharacterStore.create/appendTx`; router.
- Produces: the finished wizard. Review lists: identity line, each decision as "prompt: localized selection", spells/items summaries, ability block with final scores (post +2/+1), HP/AC/prof from draftSheet, outstanding-empty guard. Create flow: `create(name, gender)` → `appendTx([...decisions, level.gained, ...extraDrafts])` (ONE txId) → navigate `/c/<id>/play`; failure paths toast (not-leader, validation).
- THE BINDING SPEC (acceptance criterion): a spec drives the state through fighter-1's exact choices (Global Constraints fixture line) and asserts the persisted stream reduces+derives to `hp.max 12, ac 19, prof 2` — the same numbers as the plan-4 golden — and that ALL events share one txId except character.created.

- [ ] **Step 1: The binding failing spec** + review-completeness specs. → FAIL.
- [ ] **Step 2: Implement.** Green. **Step 3: `pnpm check`; commit** `feat(web): wizard review and character creation transaction`.

### Task 10: Sheet shell + Play mode + provenance popovers

**Files:**
- Create: `views/characters/sheet/sheet-shell.component.{ts,html,scss}` (+ spec), `views/characters/sheet/play/play-tab.component.{ts,html,scss}` (+ spec), `shared/directives/derived-popover.directive.ts` (+ spec)
- Modify: `app.routes.ts` (`/c/:id` shell with children `play` (default redirect), `build`, `timeline`; a functional `characterResolver` calling `CharacterStore.load(id)` — 404-style i18n message when missing), i18n keys

**Interfaces:**
- Consumes: `CharacterStore` signals, `hk-stat-tile/sheet-section/tabs/chip`, `EngineFacade.localizer/iconFor`, existing markdown renderer for descriptions.
- Produces: shell = header (name, level/classes line, portrait placeholder circle with initials) + `hk-tabs` routing between modes (keeps doc-09's phone-first single column; desktop grid via container query in play-tab.scss). Play tab (READ-ONLY this plan — inputs land in plan 6): ability grid (six stat-tiles: score + mod + save), AC/initiative/speed/prof tiles, HP section (current/max/temp bar — display only), hit dice + death saves display, attacks table (name/toHit/damage/mastery), spellcasting section (DC/attack/slots as filled-dot rows/prepared list), resources (name + used/max pips display), actions list, conditions chips, proficiencies/senses/languages section. `hkDerived` directive: attached with a `Derived<number>`, opens an `hk-dialog`-based popover on click/Enter listing contributions (source entity name via localizer, amount/formula) — the doc-09 provenance popover.
- Every number comes off `sheet()`; NO recomputation in components.

- [ ] **Step 1: Failing specs**: resolver loads and shell renders name/level for a seeded fighter stream; play tab shows the fighter-1 numbers (12/19/+2) from the store; hkDerived popover lists ≥3 AC contributions (armor, shield, defense) with localized names; slots dots match spellcasting for a wizard stream. → FAIL.
- [ ] **Step 2: Implement.** Green. **Step 3: `pnpm check`; commit** `feat(web): character sheet shell and play mode with provenance`.

### Task 11: Build mode — outstanding choices, rename, appearance, gender

**Files:**
- Create: `views/characters/sheet/build/build-tab.component.{ts,html,scss}` (+ spec)
- Modify: i18n keys; `choice-step.component.ts` gains a standalone usage mode if any wizard-state coupling blocks reuse (it shouldn't: give it optional inputs `sheet`/`validate`/`commit` overrides so both wizard and build tab drive it — refactor minimally, wizard specs stay green)

**Interfaces:**
- Consumes: `CharacterStore.sheet/outstanding/appendTx`, `hk-choice-step` (reused), reactive forms.
- Produces: Build tab: outstanding-choices list (each renders the generic choice step; commit emits ONE `decision.made` via appendTx immediately — no draft layer here); rename form (`character.renamed`), appearance form (age/height/weight/eyes/hair/skin/description → `character.appearance_set`, only dirty fields in the payload), gender radio (`character.gender_set`). Empty-outstanding state shows a "all caught up" message.

- [ ] **Step 1: Failing specs**: seeded stream missing the fighting-style decision → build tab lists it, committing appends decision.made and the list empties; rename round-trips into the sheet name; appearance payload carries only dirty fields. → FAIL.
- [ ] **Step 2: Implement.** Green. **Step 3: `pnpm check`; commit** `feat(web): sheet build mode with outstanding choices`.

### Task 12: Timeline mode — sentences, filters, revert

**Files:**
- Create: `views/characters/sheet/timeline/timeline-tab.component.{ts,html,scss}` (+ spec), `views/characters/sheet/timeline/event-sentence.pipe.ts` (+ spec)
- Modify: i18n keys (`characters.timeline.<event-type>` per Phase-1 event type, en/ru/uk with ICU where params vary)

**Interfaces:**
- Consumes: `CharacterStore.events/revert`, localizer (entity names in sentences), `hk-chip/dialog`, dice display styling from T7 (extract a tiny `roll-dice.component` if reuse demands — otherwise inline).
- Produces: newest-first virtualized list; each event → one localized sentence via the pipe (`type` → key; params: localized entity names resolved from payload ids, values, actor); tx groups render as one collapsible card (shared txId) with a group sentence ("Level 2 taken" style — key per leading event type); filter chips by family (identity/decisions/leveling/combat/items/other); `decision.made` with `context.rolls` renders the dice (kept/dropped); revert affordance per event AND per tx group → confirm dialog → `CharacterStore.revert` (which drops the snapshot + full-replays, carry 2); already-reverted events render struck-through with a reverted badge (facts.skipped reasons keyed by eventId — expose `skippedIds: Signal<ReadonlySet<string>>` on CharacterStore in this task, computed from `facts().skipped`); the `event.reverted` event itself renders as a sentence, with NO revert affordance on it (plan-4 ledger: revert-of-revert semantics undefined — comment this in the component).
- Unknown event types render a generic fallback sentence (future-proof; the i18n check script must not flag the dynamic keys — follow the library's existing dynamic-key pattern, plan-3 precedent).

- [ ] **Step 1: Failing specs**: fighter-1-like stream renders sentences for created/decisions/level.gained; roll context shows 6 dice groups; revert of a decision strikes it through and the sheet loses its effect; a 3-event tx renders as one group whose revert reverts all three; event.reverted rows offer no revert. → FAIL.
- [ ] **Step 2: Implement.** Green. **Step 3: `pnpm check`; commit** `feat(web): timeline with localized sentences and revert`.

### Task 13: XP entry + level-up wizard + undo

**Files:**
- Create: `views/characters/level-up/level-up.component.{ts,html,scss}` (+ spec), `views/characters/level-up/level-up.state.ts` (+ spec — mirrors CreateWizardState over the LIVE character: draft = live facts + pending drafts)
- Modify: `sheet-shell.component.*` (XP display + entry field + "level up available" badge → routes/dialogs into the wizard), i18n keys

**Interfaces:**
- Consumes: `CharacterStore.sheet/facts/advancements/appendTx/revert`, `pendingAdvancements` steps, choice/abilities/spells step components (reused with the override inputs from T11), engine `roll/cryptoRng` for the HP roll, `hk-number-field/stepper/dialog`.
- Produces: XP section: current xp + number-field entry emitting `xp.awarded {amount, reason?}` (delta, positive or negative); badge visible when `advancements().length > 0`. Level-up wizard (dialog or routed page — routed `/c/:id/level-up` for deep-linkability): steps = HP (roll `1d<hitDie>` with dice display OR take average — emits the choice as `level.gained.hpRoll`), the Advancement's `steps` ChoiceRequests via the generic choice component (subclass at 3 arrives as a row choice; feat at 4 via the class's `@4/feat` query choice; picking the ASI feat surfaces its `@4/ability-scores` sub-choice thanks to T1 — the state re-derives outstanding against the draft after each decision, exactly like creation), wizard-class spell learning (recommended 2, soft cap; prepared adjustments), review → ONE transaction: `level.gained {classId, level, hpRoll, subclassId?}` first (subclassId filled when a subclass decision was made this level), then `decision.made`s, then `spell.learned/prepared` — one shared txId. "Undo level-up" button on the sheet (visible while the LAST tx group is a level.gained tx): `revert({txId})` — the acceptance criterion "restores the previous sheet exactly" gets a spec asserting deep-equal sheets before/after.
- The wizard refuses to open when `advancements()` is empty (guard + toast).

- [ ] **Step 1: Failing specs**: xp entry to 300 sets the badge; fighter 1→2 wizard: hp roll recorded (`hpRoll: 5` from a scripted rng), tx shares one id, sheet hp.max = 12+5+2 = 19; fighter 3 offers the subclass step and `level.gained.subclassId` lands; fighter 4 feat step → ASI → its ability sub-choice surfaces and `['str:+2']` validates; wizard 1→2 spell step; undo deep-equals the prior sheet. → FAIL.
- [ ] **Step 2: Implement.** Green. **Step 3: `pnpm check`; commit** `feat(web): xp entry and level-up wizard with undo`.

### Task 14: i18n completeness pass — ru/uk for the characters scope, ICU plural/gender

**Files:**
- Modify: `apps/web/src/assets/i18n/characters/{en,ru,uk}.json` (complete every key added in T3–T13), `shell/*.json` if nav keys were stubbed
- Test: extend the existing i18n key-parity check usage (the `check-i18n-keys.mjs` wrapper runs in `pnpm check` — this task makes it pass with ZERO missing keys) + one spec asserting ICU plural rendering in ru (e.g. slots/hit-dice counters "1 ячейка / 2 ячейки / 5 ячеек") and a gendered timeline sentence using the character's grammatical gender (ICU select over `masculine/feminine/neuter` — the spec's acceptance criterion "ICU plural/gender tested").

**Interfaces:** consumes every key referenced by T3–T13; produces natural (not machine-gloss) ru/uk — dnd.su terminology precedent from plan 2 (испытание not спасбросок; уровень; заклинание; ячейки заклинаний; Черта; Воин/Волшебник).

- [ ] **Step 1: Run the i18n check, enumerate missing keys** (expected FAIL initially), write the ICU specs (FAIL where keys missing).
- [ ] **Step 2: Fill all ru/uk keys** naturally; ICU forms for counts and gender. Green incl. the parity check.
- [ ] **Step 3: `pnpm check`; commit** `feat(web): complete ru/uk translations for character screens`.

### Task 15: E2E — creation golden path, level-up, revert, axe

**Files:**
- Create: `apps/web/e2e/create-fighter.spec.ts`, `apps/web/e2e/level-up.spec.ts`
- Modify: `apps/web/e2e/a11y.spec.ts` (add characters list, wizard step, sheet play/build/timeline to the axe screens), `apps/web/e2e/locale.spec.ts` (add the new screens to the five-screen raw-key check — it becomes eight screens; keep the URL-stripping sanitizer)

**Interfaces:** consumes the running production build (existing Playwright webServer setup, workers:1); the BINDING creation path per Global Constraints (fighter-1 decisions → visible AC 19 / HP 12 / prof +2 on the play tab); level-up e2e: enter 300 XP → badge → wizard with average HP → sheet shows level 2 and HP 20 (12+6+2); revert the level-up from the timeline → sheet back to 12; reload the page mid-test → state persists (airplane-mode criterion's reload half; offline itself is covered by plan 3's offline spec).

- [ ] **Step 1: Write both specs + extend axe/locale lists; run `pnpm --filter web e2e`** — new specs FAIL only if the app misbehaves (the earlier tasks are done; a failure here is a real bug → STOP and report, do not adjust expectations).
- [ ] **Step 2: Green all e2e; `pnpm check`.**
- [ ] **Step 3: Commit** `test(web): creation and level-up e2e with accessibility checks`.

### Task 16: Docs wrap

**Files:**
- Modify: `README.md` (status: character builder + sheet shipped; how to run), `CLAUDE.md` (layout line gains `views/characters`; commands unchanged), `docs/03-roadmap/phase-1-solo-builder.md` — NO (roadmap docs stay); instead note remaining 1b deliverables (6–10 = plan 6) in README's status line if it lists progress.

- [ ] **Step 1: Update the two files; verify every claim** (run any command you document).
- [ ] **Step 2: `pnpm check`; commit** `docs(repo): document the character builder and sheet`.

---

## Self-Review

**Spec coverage (deliverables 3–5):** 3 — list (T3), wizard name+gender (T5), species/background+ability choice/class+skills (T6), all four ability methods with recorded rolls (T7), fighting style via generic query step (T6), spellbook (T8), equipment (T8, per design ruling 1), review→one transaction (T9). 4 — Play phone/desktop (T10), Build re-enter/rename/appearance (T11), Timeline sentences/filters/revert (T12), provenance popovers (T10 hkDerived). 5 — XP entry (T13), badge (T13), per-level wizard incl. HP roll/average, subclass@3, feat/ASI@4 with sub-choice (T1+T13), spells (T13), undo-as-transaction with deep-equal spec (T13). Acceptance: golden-match creation (T9 unit + T15 e2e), level 1→5 both classes covered by unit specs (T13) + e2e to 2 (T15 — full 1→5 e2e would be slow; the plan-4 goldens already pin 1→5 engine truth, the UI path is the same generic steps; noted as a deliberate e2e scope choice), revert/timeline (T12), reload persistence (T15), ru/uk complete + ICU (T14), axe (T15). Portrait upload, play inputs, export, Wake Lock, device checklist = plan 6 (deliverables 6–10).
**Placeholder scan:** no TBD/TODO/"similar to Task N"; T6's abilities-case gap is an explicit two-task contract (switch cases filled by T7), not a placeholder.
**Type consistency:** `CreateWizardState`/`DraftEvent`/`WizardStep` defined T5, consumed T6–T9, T13 mirrors via LevelUpState; `CharacterStore` API defined T2, extended T3 (deleteCharacter) and T12 (skippedIds) with the additions named in those tasks; component selectors/inputs defined T4, consumed T5–T13; `uuidv7/cryptoRng` T2 → T7/T8/T13. Engine surface matches plan-4 exports verbatim.
