# Phase 1b Plan 6 — Play Features, Images, Export & Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the character sheet PLAYABLE — every in-play action (HP, slots, resources, cast, rests, conditions, inventory, dice) round-trips through events — plus portrait images, `.hero` export/import, the remaining PWA polish (Wake Lock, install nag), and the Phase-1b closing docs.

**Architecture:** All play actions go `UI → engine propose.* (or hand-assembled DraftEvents) → CharacterStore.appendTx → reducer → derive` — the store and sheet from plan 5 are untouched infrastructure; this plan adds interaction components on the play tab and dialogs. Images follow doc-07's client pipeline (decode→fit→encode→hash→Dexie blobs). Export is a `.hero` ZIP (fflate) carrying a manifest + full event log + referenced images; import merges by event id.

**Tech Stack:** Angular 22 zoneless/signals, `@hk/engine` propose/dice, Dexie 4 (v3 schema additive), fflate (NEW dependency — MIT, ~8 KB, verify current version from npm at execution time), Canvas/createImageBitmap, Web Share API / showSaveFilePicker with download fallback, Screen Wake Lock API.

**Spec:** `docs/03-roadmap/phase-1-solo-builder.md` §1b deliverables 6–10 + acceptance criteria (all play actions round-trip with timeline/revert; airplane mode; export iOS→import Android reproduces with portrait; `reduce`+`derive` of 5th-level + 500 events < 30 ms on mid-range Android measured and recorded; axe; UI en/ru/uk complete). `docs/02-architecture/07-images-and-blobs.md` (pipeline steps 1–6, caps, placeholders, export/safety sections ONLY — blob transfer/prefetch/LRU are Phase-2 campaign scope). `docs/02-architecture/09-frontend-architecture.md`. Plan-4/5 ledger carries (below).

## Global Constraints

- Non-negotiables (CLAUDE.md): rules are data (condition list, attunement max, rest rules all read from pack/engine — the ONLY new UI constants are non-rule mechanics like image byte caps from doc-07); structural i18n (every new string en/ru/uk, natural, ICU where counts/gender vary; scoped-`t()` discipline — THREE double-prefix bugs happened in plan 5, keys in TS constants rendered through scoped t() are scope-relative); events immutable; engine determinism untouched; TDD failing-test-first; Conventional Commits; commit attribution = the EXECUTING session's current host trailer (none embedded here).
- Established conventions: standalone components, signal inputs, tokens-only SCSS, co-located `*.spec.ts` (web) with TestBed+provideZonelessChangeDetection+fake-indexeddb+afterEach-HkDb-close, engine tests `test/**/*.test.ts`, specs over the REAL dist pack via the established PackStore seeding, captured RED evidence in every report, production gzip ≤ 600 KB (postbuild gate; was 305.9 kB at plan-5 close — image/export code is lazy-loaded where heavy).
- **Binding engine surfaces (plan 4, verified):** `propose.damage/heal/tempHp(sheet, n)`, `propose.spendSlot(sheet, level)`, `propose.cast(sheet, spellId, {level, useSlot?, concentration})` — `concentration` REQUIRED (R9), read the spell entity's `concentration` field via the index; `propose.rest(sheet, kind, hitDice?)` emits rest.taken + per-resource resource.restored — the CANONICAL rest flow (plan-4 carry, documented on CharacterStore): hit-dice HEALING uses `propose.spendHitDie(sheet, classId, rolled)` per die, never `rest(hitDice)`; `propose.deathSave(sheet, result)`, `propose.equip/attune(sheet, instanceId, bool)` (attune enforces `sheet.attunementMax`), `propose.addItem(sheet, item, newId)`, `propose.currency(sheet, deltas)`, `propose.condition(sheet, conditionId, add, level?)`, `propose.inspiration(sheet, value)`, `propose.note(op, note)`. Proposers throw `ProposeError` with Diagnostic codes → toast via `characters.validation.<code>`-style mapping. All return `ProposedEvent[]` — CONCAT related proposals into ONE `CharacterStore.appendTx` call so the timeline groups them (shared txId), e.g. a short rest = `[...perDie spendHitDie, ...rest('short')]`.
- `roll(spec, rng)`/`parseRollSpec` + `cryptoRng` for all dice; `sheet.hp.currentWasMax` exists; `DEATH_SAVE_MAX` exported constant.
- **Plan-5 first-commit carries (Task 1):** R12 — the create-flow cleanup must not delete a valid character when `router.navigate` rejects AFTER `appendTx` succeeded (gate the catch's `deleteCharacter` on an `appendTx`-not-yet-succeeded flag); ResourceView/ActionView names bake English strings — play tab renders `localizer.name(view.source)` when the source entity resolves, falling back to `view.name`.
- Timeline renders unknown/new flows automatically (all 51 event types have sentences); revert works per plan 5 — play actions need NO timeline changes, but e2e verifies round-trip visibility.
- doc-07 image caps (binding): portrait 1024 long edge / 400 KB; thumb & token 256² / 64 KB; quality ladder 0.85→0.7→0.55 then 0.8× dimensions ≤3 retries else reject `image.too-large`; accept `image/*` minus HEIC (input accept list), store only webp/jpeg/png, reject SVG; `imageOrientation: 'from-image'` with `<img>` fallback.
- `.hero` format (defined by THIS plan, Task 9): a ZIP containing `manifest.json` (Zod schema `HeroBundleManifestSchema` in `@hk/protocol`: `{format: 1, kind: 'hero', characterId, name, exportedAt (ISO), engineVersion, appVersion, pins: Record<packId, version>, eventCount, images: [{hash, mime, size, kind}]}`), `events.json` (the FULL ordered committed event array, parseEvent-valid), `images/<hash-hex>.<ext>` (ext from mime). Import: validate manifest + every event; character id UNKNOWN locally → create the stream verbatim (events keep ids; seqs reassigned 1..n in order) + store images + upsert row; id EXISTS → MERGE-BY-ID: union events by event id (existing win), re-sort merged committed set by original seq order (stable), rewrite seqs 1..n, `SnapshotsRepository.remove`, full replay, images de-duplicated by hash. Never import packs in 1b (`pins` informational; warn on core-pack version mismatch, proceed — rebase is post-1b).
- Wake Lock: `navigator.wakeLock.request('screen')` behind a play-tab toggle; re-acquire on `visibilitychange` when toggled on; absent API → toggle hidden. Install nag: wire the EXISTING `InstallPromptService` (built plan 3, unconsumed — plan-4 R6): a dismissible banner on the characters list when `canInstall`, an iOS instructions sheet (with the 7-day standalone-storage explanation from the spec) when `showIosHint`; dismissal persisted via SettingsRepository.
- Perf acceptance: the automated proxy exists (engine perf.test, ~2.5 ms). This plan RECORDS the device measurement procedure + results table in `docs/manual-device-checklist.md` (Task 13); a dev-only in-app measurement (console.info of reduce+derive timing on load, `isDevMode()`-gated) gives the checklist a number source on-device.

### Design rulings baked into this plan

1. **Roll log is session-local**, not evented (doc-02 has `roll.logged` on the CAMPAIGN stream only — solo has no campaign): a `RollLogService` (root, signal array, capped 50, newest first) feeds a play-tab log panel; entries `{id, ts, labelKey/params, spec, results, total, manual?: boolean}`. Manual-result entry adds a log row flagged manual. Cleared on character switch.
2. **Custom item quick form** emits `item.added {instanceId, name, qty, custom: {}}` (no itemId — the plan-4 R2 ruling's path); custom weapon/armor mechanics stay out (Phase 4) — custom items are name+qty+notes inventory lines.
3. **Dexie v3 (additive):** `blobs` table gains row fields `kind?: 'portrait'|'thumb'|'token'`, `width?`, `height?` (schema string unchanged — Dexie only indexes declared keys; a `version(3)` bump is NOT needed for non-indexed fields → NO migration; extend `BlobRow` type only). If an index proves needed, that's a finding, not a silent bump.
4. **Portrait events:** `portrait.set {hash, thumbHash, mime, w, h}` / `portrait.cleared {}` (plan-4 payloads); the reducer stores `{hash, thumbHash}`; sheet header + characters list render the thumb via a `BlobUrlPipe` (object-URL cache with revoke-on-destroy); tokenHash generated per doc-07 but stored as a blob only (the payload has no token field — doc-02 authority; token use arrives with campaigns).
5. **Export delivery ladder:** `showSaveFilePicker` → `navigator.share({files})` (iOS) → `<a download>` object-URL fallback; file name `<name>.hero`.

## File Structure (all under `apps/web/src/app` unless noted)

```
packages/protocol/src/bundle/manifest.ts (+test)        # T9 HeroBundleManifestSchema
shared/components/hp-bar/…  shared/components/pips/…     # T2/T3 (SKILL.md each)
views/characters/sheet/play/ interactions:               # T2 hp+death+inspiration, T3 slots/resources/cast,
  (sections gain controls; dialogs co-located)           # T4 conditions+notes, T5 inventory, T6 rests, T7 dice
shared/services/roll-log/roll-log.service.ts (+spec)     # T7 (ruling 1)
shared/services/images/{image-pipeline.service,placeholder.service}.ts (+specs)  # T8
shared/pipes/blob-url.pipe.ts (+spec)                    # T8
shared/services/export/{hero-writer,hero-reader}.ts (+specs)  # T9/T10 (fflate, lazy-imported)
views/characters/sheet/… export button; views/characters/list/… import button + install banner  # T9/T10/T11
shared/services/pwa/wake-lock.service.ts (+spec)         # T11
apps/web/e2e/{play-actions,export-import}.spec.ts        # T12
docs/manual-device-checklist.md                          # T13
```

---

### Task 1: Plan-5 carry fixes (R12 guard + resource/action name localization)

**Files:**
- Modify: `views/characters/create-wizard/create-wizard.component.ts` (+spec), `views/characters/sheet/play/play-tab.component.ts` (+html/spec)

**Interfaces:** consumes `EngineFacade.localizer()` (`localizer.name(entityId)`), the create flow's existing catch. Produces: no new API.

- [ ] **Step 1: Failing specs.** (a) create-flow: `create` + `appendTx` BOTH succeed but `router.navigate` rejects → `deleteCharacter` NOT called, failure toast shown, character row survives (assert repository non-empty). Keep the existing no-stub spec green (appendTx failure still cleans up). (b) play-tab: a resource whose `source` entity resolves renders the LOCALIZED source-entity name (seed a ru localizer case); an unresolvable source falls back to `view.name`; same for actions. → FAIL.
- [ ] **Step 2: Implement** — an `appendTxSucceeded` flag gating the catch's cleanup; a `resourceLabel(view)`/`actionLabel(view)` helper preferring `localizer.name(view.source)`. Green.
- [ ] **Step 3: `pnpm check`; commit** `fix(web): guard create cleanup after successful commit; localize resource and action names`.

### Task 2: HP bar, death saves, inspiration — first interactive play controls

**Files:**
- Create: `shared/components/hp-bar/…` (component+scss+SKILL.md+spec)
- Modify: `views/characters/sheet/play/play-tab.component.{ts,html,scss}` (+spec), i18n `characters/*.json`

**Interfaces:**
- Consumes: `CharacterStore.sheet/appendTx`, `propose.damage/heal/tempHp/deathSave/inspiration`, `DEATH_SAVE_MAX`, `hk-number-field/dialog/button`.
- Produces: `<hk-hp-bar [current] [max] [temp]>` (pure presentational bar with temp overlay, tokens-only, no arithmetic beyond width % formatting); play-tab HP section gains a damage/heal/temp input group (one number-field + three buttons) calling the proposers and `appendTx(proposal)`; death-save section gains success/failure/crit buttons (visible only when `hp.current === 0`) via `propose.deathSave`; inspiration becomes a toggle via `propose.inspiration`. ProposeError → toast (`characters.validation.<code>`, generic fallback — reuse plan-5's mapping helper if exported, else extract it to `shared/helpers/diagnostic-toast.ts` now and refactor ONE existing consumer to prove reuse).

- [ ] **Step 1: Failing specs.** hp-bar renders proportions incl. temp overlay; damage 5 via the input appends the proposer's exact events and the sheet's current drops (seeded real stream); heal past max clamps (proposer behavior — assert resulting current == max); temp sets; death-save buttons hidden at current > 0, shown at 0, a success round-trips into `sheet.hp.deathSaves`; inspiration toggles. → FAIL.
- [ ] **Step 2: Implement.** Green. **Step 3: `pnpm check`; commit** `feat(web): interactive hp, death saves and inspiration`.

### Task 3: Slots, resources, prepare/cast, concentration

**Files:**
- Create: `shared/components/pips/…` (component+SKILL.md+spec), `views/characters/sheet/play/cast-dialog.component.{ts,html}` (+spec)
- Modify: `play-tab.component.*` (+spec), i18n

**Interfaces:**
- Consumes: `propose.spendSlot/cast`, DraftEvent for `slot.restored`/`resource.spent`/`resource.restored`/`spell.prepared`/`spell.unprepared`/`concentration.ended` (hand-assembled — proposers don't cover all of these; payload shapes from @hk/protocol), spell entities via `index.get` (level, `concentration` flag — R9), `hk-dialog`.
- Produces: `<hk-pips [max] [used] (spend) (restore)>` (clickable pip row, aria-pressed semantics, disabled at bounds); slots sections use pips (spend = `propose.spendSlot`, restore = draft `slot.restored {level}`); resources use pips (`resource.spent/restored {resourceId}` drafts); spellcasting prepared list gains prepare/unprepare toggles (capped by `preparedMax` — cap enforced in UI, engine has no prepared-cap validation on events; comment this); each prepared/known spell gains a Cast button → cast-dialog (slot level select from available slots ≥ spell level; "no slot" option for at-will contexts is NOT offered — 1b casts use slots except cantrips which cast directly without dialog; `concentration` read from the spell entity and passed to `propose.cast` per R9; casting while concentrating shows an inline "replaces current concentration" note); a concentration indicator chip on the HP section with an End button (`concentration.ended {}` draft).

- [ ] **Step 1: Failing specs.** pips bounds + a11y; slot spend/restore round-trip; resource pips; prepared cap blocks with message; cantrip cast emits `spell.cast {slotUsed: false? — VERIFY: cantrip = no slot → cast draft with level 0 and slotUsed false via propose.cast {level: 0, useSlot: false, concentration}}`; leveled cast via dialog spends the chosen slot and sets concentration when the spell has it; End clears; replaces-note shown when already concentrating. → FAIL.
- [ ] **Step 2: Implement.** Green. **Step 3: `pnpm check`; commit** `feat(web): slot, resource, casting and concentration play controls`.

### Task 4: Conditions, exhaustion, notes

**Files:**
- Create: `views/characters/sheet/play/condition-dialog.component.*` (+spec)
- Modify: `play-tab.component.*` (+spec), i18n

**Interfaces:** consumes `propose.condition`, `index.system().conditions` (entity-id list — the picker's options, localized), exhaustion = the pack's exhaustion condition entity (find by the system list + a `level`-bearing add; the picker shows a level stepper 1–6 for it — 6 is NOT hardcoded rule-wise: derive the max from… the pack has no exhaustion-max field; RULING: level input is a free number-field min 1, the reducer replaces-by-id so levels just overwrite; no cap constant), `propose.note` for notes CRUD (add/edit/remove dialogs, body ≤ 8 KB from the protocol schema — reuse the Zod limit).
- Produces: conditions section gains add (dialog: localized condition picker + level stepper when the chosen entity has levels) and per-chip remove; notes section (new, collapsible per R2-plan5 style) with add/edit/delete.

- [ ] **Step 1: Failing specs.** condition add round-trips into `sheet.conditions` and renders a localized chip; exhaustion add with level 3 then re-add level 2 replaces; remove clears; note add/edit/remove round-trip; body over-limit blocked with message. → FAIL.
- [ ] **Step 2: Implement.** Green. **Step 3: `pnpm check`; commit** `feat(web): condition and note management`.

### Task 5: Inventory management + currency

**Files:**
- Create: `views/characters/sheet/play/add-item-dialog.component.*` (+spec), `custom-item-dialog.component.*` (+spec)
- Modify: `play-tab.component.*` (inventory section becomes interactive) (+spec), i18n

**Interfaces:** consumes `propose.addItem(sheet, item, uuidv7)`, `propose.equip/attune`, `item.removed/item.updated` drafts, `propose.currency`, the entity-picker (with `limit` — R3-plan5) for add-from-library (items query), design ruling 2 (custom items name+qty+notes only).
- Produces: inventory rows gain equip/attune toggles (attune failure at max → the ProposeError toast shows `attune.max`), qty stepper (`item.updated {qty}`), remove (confirm); Add-from-library dialog (search items, qty, add — `propose.addItem` with itemId); Custom item dialog (name/qty/notes → addItem with `custom: {}` + name); currency editor (five number-fields, submit computes DELTAS from current — the event carries deltas, negatives allowed, floor handled by the reducer).

- [ ] **Step 1: Failing specs.** add-from-library appends with a fresh uuid instanceId and renders; custom item renders by its name with `resolved: false` styling; equip flips and AC updates for armor (real pack chain mail — assert sheet.ac change); attune blocks at attunementMax with the toast; qty stepper; remove; currency entry of gp 15 → cp/sp/ep/pp unchanged, gp 15 (delta computed correctly from a non-zero start). → FAIL.
- [ ] **Step 2: Implement.** Green. **Step 3: `pnpm check`; commit** `feat(web): inventory and currency management`.

### Task 6: Short & long rests with the hit-dice picker

**Files:**
- Create: `views/characters/sheet/play/rest-dialog.component.*` (+spec)
- Modify: `play-tab.component.*` (rest buttons) (+spec), i18n

**Interfaces:** consumes `propose.rest`, `propose.spendHitDie`, engine `roll/parseRollSpec` + `cryptoRng` (die = `1d<hitDie>` per class from `sheet.hp.hitDice[classId].die`), the CANONICAL flow (Global Constraints): short rest dialog lets the user roll hit dice one at a time (each roll → dice display → its `spendHitDie` proposal collected), then confirm → ONE `appendTx([...collectedSpendHitDie, ...propose.rest(sheet, 'short')])` (single tx group in the timeline); long rest = confirm dialog → `appendTx(propose.rest(sheet, 'long'))`.
- Produces: rest section with Short/Long buttons + the dialog; remaining-dice counters from `sheet.hp.hitDice[*].remaining`; rolled dice rendered kept-style; post-long-rest the sheet shows full HP (the 'max' sentinel resolves — assert numerically).

- [ ] **Step 1: Failing specs.** short rest with 2 rolled dice (scripted rng) heals by rolls+con each and marks 2 spent, resources with shortRest reset restore, ONE txId across all events (assert via store.events); long rest → hp.current === hp.max, slots restored, exhaustion reduced (seed level 2 → 1); dice display kept-style. → FAIL.
- [ ] **Step 2: Implement.** Green. **Step 3: `pnpm check`; commit** `feat(web): short and long rests with hit dice`.

### Task 7: Dice roller + roll log

**Files:**
- Create: `shared/services/roll-log/roll-log.service.ts` (+spec), `views/characters/sheet/play/roll-log-panel.component.*` (+spec), `shared/components/dice-result/…` (component+SKILL.md+spec — extract the kept/dropped dice markup used in 3 places now)
- Modify: `play-tab.component.*` (roll affordances on ability/save/skill/attack/spell rows) (+spec), i18n

**Interfaces:**
- Consumes: `roll/parseRollSpec/cryptoRng`, `Derived` values off the sheet (modifiers — NO recomputation: the roll spec is `1d20` + the row's already-derived total as modifier), CDK LiveAnnouncer.
- Produces (ruling 1): `RollLogService {entries: Signal<readonly RollEntry[]>; add(entry): void; addManual(labelKey, params, total): void; clear(): void}` with `RollEntry {id, ts, labelKey, params, dice: {sides, value, kept}[], modifier, total, advantage?, manual?}` capped 50; play-tab rows gain a tap-to-roll (ability checks, saves, skills, attack toHit, attack damage (the row's dice string via parseRollSpec + bonus), spell attack) with an advantage/disadvantage long-press-free toggle group in the log panel header (applies to the NEXT d20 roll); a manual-entry row (number-field + label select) → `addManual`; every roll announced via LiveAnnouncer (ICU); log panel collapsible, newest first, dice-result component rendering.
- `CharacterStore` load/switch clears the log (subscribe in the service to streamId changes — check how to observe; an effect on `characterStore.streamId` inside the service is fine).

- [ ] **Step 1: Failing specs.** service cap/ordering/clear-on-switch; a skill roll uses `1d20+<derived total>` (scripted rng, exact total asserted); advantage rolls 2d20 keep-highest (engine keep semantics via spec `2d20kh1`); damage roll parses the row's dice string; manual entry flagged; announcer spy. → FAIL.
- [ ] **Step 2: Implement.** Green. **Step 3: `pnpm check`; commit** `feat(web): dice roller with local roll log`.

### Task 8: Portrait pipeline + placeholders

**Files:**
- Create: `shared/services/images/image-pipeline.service.ts` (+spec), `shared/services/images/placeholder.service.ts` (+spec), `shared/pipes/blob-url.pipe.ts` (+spec)
- Modify: `shared/services/storage/dexie.db.ts` (BlobRow type fields only — design ruling 3, NO version bump), `views/characters/sheet/sheet-shell.component.*` (portrait display + upload from Build… PLACEMENT: the upload affordance lives on the BUILD tab's appearance section; the shell header shows thumb/monogram) (+specs), `views/characters/sheet/build/build-tab.component.*` (+spec), `views/characters/list/characters-list.component.*` (thumbs) (+spec), i18n

**Interfaces:**
- Consumes: doc-07 pipeline steps/caps (Global Constraints), `BlobsRepository.put/get`, `CharacterStore.appendTx` (`portrait.set {hash, thumbHash, mime, w, h}` / `portrait.cleared {}`), `CharactersRepository` row `portraitThumbHash` (upsertFromFacts already maps facts.portrait — VERIFY and wire if the mapping is a stub).
- Produces: `ImagePipelineService.processPortrait(file: File): Promise<{hash, thumbHash, tokenHash, mime, w, h}>` implementing decode (createImageBitmap `from-image`, `<img>` fallback), fit (1024 long edge; 256² thumb cover; 256² token), encode (webp probe → jpeg/png; ladder 0.85/0.7/0.55; 0.8× dims ≤3; reject `image.too-large`), sha-256 hash, store three blobs (kind fields set); `PlaceholderService.monogram(name, characterId)` → deterministic hue + initials (SVG-free: a styled div, hue = simple hash of id mod 360); `BlobUrlPipe` (transform hash → object URL via BlobsRepository, cached, revoked on destroy; async — returns a signal or observable per existing pipe patterns, choose and document). Upload flow on Build/appearance: file input (accept per doc-07, no HEIC) → pipeline → appendTx portrait.set → header/list update; a Remove button → portrait.cleared.
- jsdom limits: createImageBitmap/canvas are unavailable — the SPEC strategy: unit-test the pure parts (ladder decisions, mime choice, cap math) by injecting a fake encoder boundary (`EncodeFn` seam), and the hash/store path with tiny synthetic bytes; the FULL pipeline is covered by the e2e (T12) with a real PNG fixture. Structure the service with the seam explicitly.

- [ ] **Step 1: Failing specs** (seamed): ladder retries then dimension-reduce then reject sequence; mime selection (alpha→png when no webp); hash/store writes 3 blobs with kinds; portrait.set payload; monogram determinism (same id same hue); BlobUrlPipe caches + revokes; build-tab upload flow with a stubbed pipeline; list renders thumb when row has portraitThumbHash. → FAIL.
- [ ] **Step 2: Implement.** Green. **Step 3: `pnpm check`; commit** `feat(web): portrait pipeline, placeholders and thumbnails`.

### Task 9: `.hero` export

**Files:**
- Create: `packages/protocol/src/bundle/manifest.ts` (+ `packages/protocol/test/bundle.test.ts`), `shared/services/export/hero-writer.service.ts` (+spec)
- Modify: `packages/protocol/src/index.ts` (export), `apps/web/package.json` (+fflate — current version verified from npm at execution), `views/characters/sheet/sheet-shell.component.*` (Export button) (+spec), i18n

**Interfaces:**
- Produces: `HeroBundleManifestSchema` exactly per Global Constraints (strictObject; `parseHeroManifest(value): {ok, manifest}|{ok:false, issues}` helper mirroring parseEvent's shape); `HeroWriterService.export(characterId): Promise<{blob: Blob, fileName: string}>` — loads events (EventsRepository.byStream), facts-derived name, pins from facts, referenced image hashes (facts.portrait hash+thumb+token blob lookups — token by kind query… BlobsRepository lacks a by-kind query: collect hashes from facts.portrait {hash, thumbHash} + the token blob stored at upload — RESOLUTION: the writer exports the hashes it can resolve from facts.portrait (hash, thumbHash) plus any blob whose row exists for those two; token regenerates on import-side upload only — document the scope cut: tokens are re-derivable, not exported); zips via `fflate` (LAZY dynamic import — keep it out of the initial bundle) manifest.json + events.json + images/*; delivery ladder per design ruling 5. Export button on the sheet shell.
- [ ] **Step 1: Failing specs.** manifest schema accept/reject; writer over a seeded real stream: manifest fields exact (eventCount, pins, name), events.json parses back event-for-event, images present by hash, ZIP round-trips via fflate's unzip in the spec; fileName sanitized (`<name>.hero`, path-unsafe chars stripped). → FAIL.
- [ ] **Step 2: Implement.** Green (fflate lazy chunk verified in the build output — note gzip figure in the report). **Step 3: `pnpm check`; commit** `feat(web): .hero character export`.

### Task 10: `.hero` import with merge-by-id

**Files:**
- Create: `shared/services/export/hero-reader.service.ts` (+spec)
- Modify: `views/characters/list/characters-list.component.*` (Import button + file input + result toast/dialog) (+spec), i18n

**Interfaces:**
- Consumes: `parseHeroManifest`, `parseEvent`, fflate unzip (lazy), `EventsRepository` (byStream + a NEW `replaceStream(stream, events)` — atomic delete+bulkAdd in one 'rw' transaction, seqs 1..n, add with spec to events.repository.spec.ts), `SnapshotsRepository.remove`, `BlobsRepository.put` (dedupe: skip existing hashes), `CharactersRepository.upsertFromFacts`, `CharacterStore` reload when the imported id is currently loaded.
- Produces: `HeroReaderService.import(file: File): Promise<ImportResult>` where `ImportResult = {characterId, name, mode: 'created'|'merged', imported: number, skippedDuplicates: number, warnings: string[]}` — validation failures throw typed errors (bad zip / bad manifest / bad event N) → localized toast; merge-by-id per Global Constraints (existing events win, union re-sorted by source seq order stable, seqs rewritten via replaceStream, snapshot dropped, full replay through the store when loaded); core-pack version mismatch → warning entry, proceed. List gains the Import button; success shows mode+counts (ICU).
- [ ] **Step 1: Failing specs.** import of an exported bundle into an EMPTY db → created, byte-equal facts (export→import round-trip assert deep-equal facts vs source); re-import over the same → merged with 0 imported, all skipped; import over a DIVERGED copy (source has 2 extra events) → merged, 2 imported, replay includes them; bad manifest/event rejects with the typed error; images deduped; pins mismatch → warning. → FAIL.
- [ ] **Step 2: Implement.** Green. **Step 3: `pnpm check`; commit** `feat(web): .hero import with merge by id`.

### Task 11: Wake Lock + install nag

**Files:**
- Create: `shared/services/pwa/wake-lock.service.ts` (+spec), `views/characters/list/install-banner.component.*` (+spec incl. the iOS sheet)
- Modify: `views/characters/sheet/play/play-tab.component.*` (toggle) (+spec), `views/characters/list/characters-list.component.*` (banner slot), i18n

**Interfaces:** consumes the EXISTING `InstallPromptService` (`canInstall`, `prompt()`, `showIosHint` — plan-3 file, read it), `SettingsRepository` (banner dismissal persistence key `install-banner-dismissed`), Screen Wake Lock API (stub in specs).
- Produces: `WakeLockService {supported, active: Signal<boolean>, enable(), disable()}` re-acquiring on visibilitychange while enabled, released on disable/destroy; play-tab toggle (hidden when unsupported); install banner on the characters list (Chromium: `prompt()` button; iOS: opens an instructions sheet — Add to Home Screen steps + the spec's 7-day storage-eviction explanation, i18n'd en/ru/uk); dismissed state persists.
- [ ] **Step 1: Failing specs.** wake-lock enable/re-acquire-on-visibility/disable with a stubbed navigator.wakeLock; unsupported hides the toggle; banner shows when canInstall, prompt() called on click, dismissal persists across TestBed re-creation (fake-indexeddb); iOS path opens the sheet with the 7-day text key. → FAIL.
- [ ] **Step 2: Implement.** Green. **Step 3: `pnpm check`; commit** `feat(web): wake lock and install prompt`.

### Task 12: E2E — play actions, export/import, axe

**Files:**
- Create: `apps/web/e2e/play-actions.spec.ts`, `apps/web/e2e/export-import.spec.ts`
- Modify: `apps/web/e2e/a11y.spec.ts` (+ rest dialog, cast dialog, roll log open state), `apps/web/e2e/locale.spec.ts` (+ any new screen-states if cheap — dialogs count as states of existing screens, keep the screen list as-is unless a key leaks)

**Interfaces:** consumes the existing harness (production build, workers:1, helpers from plan-5's create-fighter). Scenarios: (a) create fighter (existing helper) → damage 5 → HP 7/12 → heal to full → short rest with one hit die (accept whatever heal the real rng gives: assert HP increased and one die spent — no scripted rng in e2e) → timeline shows the grouped rest → revert the rest group → die restored; (b) wizard path quick-create (helper variant or seeded via UI) → prepare → cast fireball at 3 → slot dot fills → concentration chip if applicable (fireball: none — use a concentration spell from the pack for the chip assertion, e.g. haste if present, else assert no chip for fireball) → long rest → slots restored; (c) export the fighter → file downloads (Playwright download event) → delete the character → import the file → character back with name and HP intact (portrait skipped in e2e — no camera; pipeline covered by unit seam + a direct-file-input upload of a small PNG fixture IS feasible: include it — upload portrait, export, delete, import, thumb visible again — the spec's export-with-portrait criterion, browser-local); (d) axe green on the new dialog states.
- [ ] **Step 1: Write + stabilize (2 consecutive clean full-suite runs).** A stated-behavior failure = STOP and report (integration bug). **Step 2: `pnpm check` green. Step 3: Commit** `test(web): play actions and export-import e2e`.

### Task 13: Docs — manual device checklist + wrap

**Files:**
- Create: `docs/manual-device-checklist.md`
- Modify: `README.md`, `CLAUDE.md` (layout/commands only if changed — fflate lazy chunk doesn't change commands), `views/characters/sheet/play/play-tab.component.ts` ONLY IF the dev-mode perf log (Global Constraints last bullet) isn't naturally placed in CharacterStore.load — put it there: `isDevMode() && console.info('[perf] reduce+derive', ms)` measured around the load's replay+first-derive (+spec asserting the info fires in dev mode with a number).

**Content (checklist):** install on iPhone + Android (with the iOS sheet steps); airplane-mode pass (create/play/reload offline); export on iOS via Share → import on Android (file transfer suggestions), portrait intact; perf: open the 5th-level seeded character, read the dev-mode `[perf]` console line on-device (steps to enable remote debugging for Android chrome + iOS Safari), RECORD table (device, date, ms) with the acceptance line "< 30 ms mid-range Android" and an empty row to fill; axe/e2e pointers; known Phase-4/backlog items (weapon-mastery typo trap R4-plan5, resource/action localization dependency on pack keys, exhaustion cap free-form).
- [ ] **Step 1: Perf log + spec; write the checklist; update README (plan pointer per convention, shipped list gains play/images/export/PWA); verify every claim.**
- [ ] **Step 2: `pnpm check`; commit** `docs(repo): manual device checklist and phase 1b wrap`.

---

## Self-Review

**Spec coverage (deliverables 6–10):** 6 — HP bar/damage/heal/temp (T2), death saves (T2), hit dice (T6), slots pips (T3), prepare/cast (T3), concentration indicator (T3), conditions & exhaustion chips (T4), inventory add-from-library/custom/qty/equip/attune/weight? — WEIGHT: the spec lists weight; inventory rows show item weight from the entity (display-only, T5 renders `entity.weight` via the index — added to T5's Produces implicitly through the row rendering; noting here for the executor: display weight per row + a simple sum in the section header, no encumbrance rules (spec's encumbrance is a campaign house-rule, Phase 3)) — T5; currency (T5); short/long rest with hit-dice picker (T6); inspiration (T2); notes (T4); dice roller with log + manual entry (T7). 7 — portrait pipeline/thumb/token/placeholder (T8). 8 — export/import .hero with save picker/Share/download + merge-by-id (T9/T10). 9 — install nag with iOS 7-day explanation (T11), update prompt EXISTS (plan 3), Wake Lock (T11). 10 — manual-device-checklist (T13), SKILL.md per new shared component (hp-bar/pips/dice-result in their tasks), CLAUDE.md already exists (T13 touches only if needed). Acceptance: round-trip+revert (T12a), airplane (covered by plan-3 offline spec + checklist), export/import with portrait (T12c + checklist cross-device), perf recorded (T13 + dev log), axe (T12d), ru/uk complete (every task's i18n + the check gate).
**Placeholder scan:** the T3 Step-1 "VERIFY" inline note is a real instruction (cantrip cast semantics), not a placeholder; no TBD/TODO/similar-to remain.
**Type consistency:** `RollLogService/RollEntry` (T7) self-contained; `HeroBundleManifestSchema/parseHeroManifest` (T9) consumed by T10; `replaceStream` defined in T10 where used; `ImagePipelineService/PlaceholderService/BlobUrlPipe` (T8) consumed by T8's own views + T9 hash collection reads facts not the pipeline; propose surface names match plan-4's shipped API throughout.
