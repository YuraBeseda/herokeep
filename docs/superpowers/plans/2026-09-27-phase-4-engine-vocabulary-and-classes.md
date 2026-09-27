# Phase 4 Plan 11 — Engine Vocabulary, Multiclassing & Validation Classes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **STATUS: EXECUTED 2026-09-27 — all 14 tasks complete, Phase 4 slice 1 (engine vocabulary, multiclassing, five classes — Fighter, Wizard, Barbarian, Cleric, Warlock — to level 20) done. Slice 2 = remaining 7 classes + feats + magic-item data at scale; slice 3 = .hkpack import, quick homebrew, pack update/rebase.**

**Goal:** Retire Phase 4's vocabulary risk: extend the pack format and engine so EVERY SRD 5.2.1 class mechanic is expressible (flat damage, dice/text progression columns, item tag queries, charges, attunement rules, encumbrance, all four slot progressions, multiclassing), fix the latent multiclass derive bugs, and prove the vocabulary by shipping FIVE classes with full mechanics to level 20 — Fighter & Wizard (extending plan 2's 1–5) plus Barbarian, Cleric, and Warlock with their SRD subclasses — ending with multiclass goldens and a derive-perf measurement against the 15 ms budget.

**Architecture:** Rules stay data: new expressiveness lands as ADDITIVE optional fields in `@hk/protocol`'s pack schemas (format stays 1 per doc-04's tolerance rules — verify; unknown-type warnings already exist), the multiclass spell-slot table and slot progressions land in the SYSTEM entity (data), and the engine only grows generic interpreters (multiclass composition, charges-as-instance-resources, tag-query evaluation, carry capacity). Class mechanics are pure overlay JSON per plan 2's pattern. House-rule overrides (campaign `attunementMax`, `encumbrance`) reach derive as an explicit, typed override input — the engine stays deterministic and campaign-unaware.

**Tech Stack:** Existing only (Zod, Vitest, the content transform/overlay pipeline). No new dependencies expected; any that prove necessary are verified+pinned at execution.

**Spec:** `docs/03-roadmap/phases.md` Phase-4 row (this slice's subset); `docs/02-architecture/04-content-packs.md` (format 1, entity/effects tables incl. `charges?`/`attunement?`/`weapon.mastery`/`multiclass {prereq, gains}`/`levels[].spellSlots?`, `mastery.grant`, validation levels — IN FULL); `docs/02-architecture/05-rules-engine.md` (derive pipeline, §perf targets 112-120: derive <15 ms mid-phone else Web Worker; "multiclass table in Phase 4" L74); ADR-007 (advancement: "Multiclassing (Phase 4) is the same flow with a 'which class' choice first", L108); ADR-008 (extension format/safety, additive evolution); doc-02 facts (`classes[]` order = order gained; `pactSlots?`); plan 2's file (`2026-08-30-phase-1a-srd-content-import.md`) for the overlay/transform patterns and its L1243 Phase-4 debt list (half/third/pact slot tables, feat prerequisites, structural fields for the 10 classes). ADRs never edited.

## Global Constraints

- Repo non-negotiables hold: game rules are DATA (the multiclass slot table, slot progressions, class mechanics, mastery lists, carry-capacity formulas all live in pack/system JSON — a 5e number in TypeScript is a review-blocking defect); `packages/engine/src` deterministic (lint-enforced); structural i18n (any new UI copy through scopes ×3 en/ru/uk); events immutable; TDD strictly red-first with captured RED evidence; Conventional Commits + the executing session's trailer. Root `pnpm check` is the gate; after ANY protocol schema change run `pnpm --filter @hk/protocol build:schema` (CI fails on drift); build `@hk/engine` BEFORE `@hk/content build:pack`; the pack must keep validating with ZERO diagnostics and stay ≤5,000 entities / ≤5 MB (currently 1,866); web gzip budget 600 KB.
- Protocol changes are ADDITIVE ONLY (optional fields, new enum members where schemas already accept unknowns per doc-04's "unknown type → warning" posture): existing packs and characters must keep parsing byte-identically. Every schema addition gets a doc-04 table update in the same task.
- Engine changes must keep every existing golden green untouched (the 10 plan-4 goldens are the regression net); new behavior gets NEW goldens. Reducers stay backward-compatible; NO new event types expected this plan (attune/unattune/resource events already exist — verify before inventing any).
- Survey facts the executor re-verifies in place (sources cited; the code wins): derive/hp.ts:101-104 grants max hit die at level 1 of EVERY class and sorts classes alphabetically (latent multiclass bug — facts.classes[] order = order gained per doc-02); derive/abilities.ts:166 saves from classes[0] only (correct base, but `multiclass.gains` from entities-progression.ts:30 is read by nothing); system.ts spellSlots has only {full, none}; derive/spellcasting.ts:109-122 indexes spellSlots[eff.slots] by CLASS level with no pooled multiclass table; facts.pactSlots exists (doc-02) but no pact machinery; derive/advancement.ts:17-19 lists existing classes only; item.charges {max: Formula, reset} schema-valid but unread; InventoryEntry.attuned + item.attuned/unattuned handlers + propose attune() vs sheet.attunementMax all exist, `item.attunement.by` predicate NOT enforced, campaign attunementMax NOT wired; weapon.mastery on all 38 weapons with derive/attacks.ts:86-198 gating on a literal-text choice (the plan-5 R4 typo trap) and the level-4 mastery count sitting unused in row extra; DiceSchema (common.ts:10) can't express flat damage (Blowgun `0d4+1` hack at transform/items.ts:60-67); transform/classes.ts:108-114 drops non-integer extra columns (Rage damage dice, Sneak Attack dice).
- Content-side documented gaps this plan CLOSES for the five shipped classes (others stay flagged): mastery literal-text → structural tag-query choice; stepped cantrip tables (wizard note) — verify whether a table-valued formula/column addition is needed or per-level extra columns suffice (decide in T1, document); Second Wind regain-one-use stays approximated (ledger, not this plan).
- OUT OF SCOPE (slice 2/3, restate in docs): remaining 7 classes' mechanics; feats beyond what the five classes grant; mass magic-item charges/attunement DATA (machinery ships now, hand-authored data only for items the five classes' tests need); .hkpack import/homebrew/rebase; multiclass spell-PREPARATION edge rules beyond slots (document what's deferred); Web Worker derive (T13 MEASURES and ledgers the decision; building it is out unless the budget is exceeded — then it becomes a controller ruling).

### Design rulings baked into this plan

1. **House-rule overrides into derive**: `derive()` (and the Sheet builder path) gains an optional, typed `overrides?: {attunementMax?: number, encumbrance?: 'off'|'standard'|'variant'}` input, defaulting to system-entity values / 'off'. The CLIENT computes it (campaign settings via the plan-10 projection for linked characters; solo = defaults) and passes it through the existing facts→sheet call sites. Engine stays campaign-unaware and deterministic. Sheet exposes the effective values (+ provenance "house rule" when overridden).
2. **Multiclass slot table is DATA**: the system entity gains `spellSlots.half`, `spellSlots.third`, `spellSlots.pact` progressions AND a `multiclassSlots` table (caster-level → slots) with per-progression caster-level weights (full=1, half=½, third=⅓ — encode as data, rounding rules per SRD text cited in the overlay note). Engine: compute combined caster level from each class's spellcasting.define slots kind, look up `multiclassSlots` when classes.length > 1 (single-class keeps the per-class table — byte-identical existing behavior). Pact slots stay SEPARATE (facts.pactSlots, Warlock-only) per SRD.
3. **Charges = per-instance resources**: derive materializes an item with `charges` (equipped/attuned, active) as a resource keyed `item:<instanceId>` reusing deriveResources + resourcesUsed machinery (no new events — resource.spent/restored carry the key; VERIFY the resource key schema tolerates the prefix, else additive-extend). Reset semantics from item.charges.reset.
4. **Tag queries**: `EntityQuerySchema` gains an optional `tags?: string[]` filter (AND semantics, additive). Weapon-mastery choices become real entity queries (`type:'item'` + tag/property filter per doc-04's item fields — executor picks the exact queryable field after reading the schema: weapon.mastery presence, not a new tag taxonomy, if expressible; document). The mastery COUNT reads the class-row extra column (level-scaled).
5. **Extra columns typed**: class-row `extra` widens (additive) to accept `string` values validated as dice-or-plain-text alongside integers; transform/classes.ts keeps dice/ordinal columns it currently drops (Rage Damage, Sneak Attack). Features reference them via the existing formula/effect machinery — executor verifies how fighter-weapon-mastery-count is consumed today and mirrors.
6. **Flat damage**: DiceSchema gains an additive variant for flat amounts (e.g. `{flat: n}` or count-0 semantics formalized — pick the cleanest additive shape, migrate the Blowgun hack, keep old packs parsing).
7. **Multiclass rules as data**: system entity's `multiclass.prerequisites` (per-class ability minimums) gets populated (data); advancement offers "new class" entries gated by prerequisites; `multiclass.gains` per class (limited proficiencies on later classes, SRD table) populated for the five shipped classes; saves stay first-class-only (already correct); hp.ts fixed to max-die for the FIRST class's level 1 only + classes processed in facts order (never sorted).
8. **Class order**: facts.classes[] order (order gained) is authoritative everywhere in derive; any current alphabetical sort is a bug to fix with a golden pinning a two-class character created Wizard-then-Fighter.
9. **Validation set**: Fighter+Champion and Wizard+Evoker extended 6→20; Barbarian+Berserker (dice extra columns, Rage as resource), Cleric+Life (prepared full caster, Channel Divinity resource), Warlock+Fiend (pact slots, invocation-style choices kept to what the schema already expresses — anything inexpressible gets a documented literal fallback + ledger flag, NOT a schema invention mid-task) to 20. Subclass = the one SRD subclass each. Every class ships: progression rows with typed extras, choices, feature effects for mechanics the engine interprets (resources, spellcasting, masteries, unarmored defense/rage AC via override-style effects — read what doc-04's effects table supports; anything outside it → documented text-feature fallback, flagged).
10. **Perf**: T13 measures derive on the heaviest golden (multiclass 20) with the documented HK_RECORD_PERF harness (plan-6 precedent) and ledgers the number vs the 15 ms budget; exceeding it produces a WORKER-NEEDED flag for slice 2, not an in-plan rewrite.

## File Structure

```
packages/protocol/src/pack/{common,entities-progression,entities-content,query}.ts (+schema build)  # T1
packages/engine/src/derive/{hp,abilities,advancement}.ts + composition order fix                    # T2
packages/engine/src/derive/spellcasting.ts + system slot data plumbing                              # T3
packages/engine/src/derive/{resources,composition}.ts charges + attunement enforcement + overrides  # T4
packages/engine/src/derive/ (carry capacity module) + sheet fields                                   # T5
packages/engine/src/derive/attacks.ts mastery via tag query + count column                          # T6
packages/content/src/{transform/classes,transform/items,static/system}.ts + tests                   # T7
packages/content/src/overlays/{fighter,wizard}.json → 20                                            # T8
packages/content/src/overlays/barbarian.json (+berserker)                                           # T9
packages/content/src/overlays/cleric.json (+life)                                                   # T10
packages/content/src/overlays/warlock.json (+fiend)                                                 # T11
apps/web (multiclass level-up entry, mastery picker, encumbrance display, override wiring)          # T12
goldens (multiclass, per-new-class) + perf measurement                                              # T13
e2e + docs wrap                                                                                     # T14
```

---

### Task 1: Protocol vocabulary (additive)
Rulings 4/5/6 + slot-progression fields (ruling 2's schema side: system spellSlots half/third/pact + multiclassSlots table shape) + the stepped-cantrip decision (Global Constraints). Every addition optional/additive; old fixture packs must parse unchanged (test); doc-04 tables updated per addition; `build:schema` clean. Red-first schema tests per field. Commit `feat(protocol): phase 4 pack vocabulary`.

### Task 2: Multiclass core (engine)
Ruling 7/8: hp first-class-max-die fix + facts-order processing (red-first golden: Wizard-then-Fighter two-class character — pin hp, saves, proficiencies); multiclass.gains applied to non-first classes; advancement.ts offers new-class entries gated by system multiclass.prerequisites; leveling reducer already appends (verify, don't touch). Existing goldens untouched. Commit `feat(engine): multiclass composition and advancement`.

### Task 3: Slot progressions + multiclass table (engine + system data)
Ruling 2: spellcasting.ts reads half/third/pact progressions; combined-caster-level lookup of multiclassSlots when classes>1; pactSlots derived separately (facts.pactSlots wiring end-to-end: reducer handlers exist? verify — doc-02 names pactSlots in facts; if the slot-used handler needs a pact lane, extend backward-compatibly). Single-class behavior byte-identical (goldens). System entity data in T7 — this task tests against fixture system entities. Commit `feat(engine): slot progressions and multiclass slots`.

### Task 4: Charges + attunement + overrides (engine)
Rulings 1/3: item.charges → per-instance resources (key scheme verified/extended additively); attunement.by predicate enforced in propose attune(); derive overrides input (attunementMax) threaded to sheet.attunementMax with provenance. Red-first incl. a charged-item golden fixture. Commit `feat(engine): item charges and attunement rules`.

### Task 5: Encumbrance (engine)
Ruling 1: carry capacity (STR-based, formulas from the SYSTEM entity — data, cited) computed when overrides.encumbrance ≠ 'off'; standard vs variant per SRD as data; Sheet gains carry fields + load state with provenance. Solo default off = zero behavior change (goldens). Commit `feat(engine): encumbrance option`.

### Task 6: Weapon mastery structural (engine)
Ruling 4: attacks.ts mastery choice resolved via the tag/field query (no literal text); count from the typed extra column (level-scaled); the typo trap dies. Backward tolerance: old literal-text decisions on existing characters must not crash (fallback path + test — events are immutable). Commit `feat(engine): structural weapon mastery`.

### Task 7: Content transforms + system data
Ruling 2/5/6/7 data side: system.ts gains half/third/pact + multiclassSlots + multiclass.prerequisites (SRD-cited); transform/classes.ts keeps typed extra columns; transform/items.ts migrates the Blowgun flat-damage hack; charges hand-authored ONLY where the five classes' tests need items (note per ruling). Pack rebuild: count may grow, ZERO diagnostics. Red-first transform tests. Commit `feat(content): phase 4 system data and typed columns`.

### Task 8: Fighter + Wizard to 20
Extend both overlays 6→20 (features, choices incl. ASI@6,8,12,14,16,19 per class table, subclass features to 18/20; wizard cantrip/prepared scaling per the T1 decision; Champion/Evoker complete). Mechanics-effect coverage per ruling 9's bar; inexpressible → documented fallback + flag. mechanics.test.ts extended; goldens in T13. Commit `feat(content): fighter and wizard to level 20`.

### Task 9: Barbarian + Berserker to 20
New overlay per plan-2 pattern (+ load.ts + build.ts layer): Rage as resource with typed dice extra column, Unarmored Defense, Reckless/Brutal strikes to the effects table's expressiveness, masteries, ASIs, Berserker complete. Commit `feat(content): barbarian to level 20`.

### Task 10: Cleric + Life to 20
Prepared full caster (spellcasting.define list:'cleric'), Channel Divinity resource with level-scaled uses (typed column), Domain spells (choices/grants per doc-04), Life domain complete. Commit `feat(content): cleric to level 20`.

### Task 11: Warlock + Fiend to 20
Pact magic (slots:'pact'), Eldritch Invocations as the schema's choice machinery allows (ruling 9's fallback discipline), Pact Boon choice, Fiend complete. This task VALIDATES ruling 2's pact lane end-to-end. Commit `feat(content): warlock to level 20`.

### Task 12: Client wiring
Multiclass entry in the level-up flow (ADR-007: same wizard with a which-class-first choice; prerequisites-gated options from advancement); mastery picker replaces the freeform text (structural choice UI — reuse the choice-step machinery); encumbrance display on the sheet when active; overrides plumbing (ruling 1: campaign settings → derive input for linked characters via the plan-10 edit-lock-style projection read; solo defaults). i18n ×3; a11y; existing wizard/sheet specs are the net. Commit `feat(web): multiclassing and phase 4 sheet features`.

### Task 13: Goldens + perf
New goldens over the REAL pack: one per new class at levels 5/11/20 spot-shape, one multiclass (e.g. Fighter 1/Wizard 19 and Barbarian 2/Cleric 3) pinning slots/hp/saves/masteries; perf measurement per ruling 10 (HK_RECORD_PERF harness, heaviest golden, ledger vs 15 ms). Commit `test(engine): phase 4 goldens and perf measurement`.

### Task 14: e2e + docs wrap
e2e: create-multiclass flow (level-up into a second class through the real UI) added to the default Playwright project (offline — content is local); extend the existing create-fighter golden assertions if class tables changed them (they shouldn't — verify). Docs: README Phase-4-slice-1 section (source-verified), doc-04 final consistency pass over the new fields, plan STATUS headers (this plan; plan 10's header gains its merge sha cd09f14 if not already), manual-device-checklist multiclass addition, CLAUDE.md only if commands changed (none expected). Commit `test(web): multiclass e2e` + `docs(repo): phase 4 slice 1 wrap`.

---

## Self-Review

**Spec coverage** (Phase-4 row, this slice): multiclassing T2/T3/T12; classes 5-of-12 to 20 T8–T11 (remaining 7 = slice 2, stated); attunement/charges machinery T4 (mass data slice 2); weapon mastery all weapons T6 (data already present on all 38); encumbrance T5/T12; .hkpack/homebrew/rebase = slice 3 (stated); Worker = measured T13, decision ledgered. Survey-named debts closed: hp multiclass bug T2; slot tables T3/T7; DiceSchema flat T1/T7; extra columns T1/T7; mastery typo trap T6/T12; attunement.by + campaign attunementMax T4/T12; plan-2 L1243 debts T1/T3/T7 (feat prerequisites stay text — slice 2, flagged).
**Placeholder scan:** no TBDs; execution-time verifications named with sources (format-1 additive tolerance T1; pactSlots reducer lane T3; resource key scheme T4; effects-table expressiveness per class T8–T11; stepped-cantrip decision T1).
**Type consistency:** overrides shape (ruling 1) consumed T4/T5/T12; multiclassSlots (ruling 2) produced T1/T7 consumed T3/T13; typed extras (ruling 5) produced T1/T7 consumed T6/T9/T10; tag query (ruling 4) produced T1 consumed T6/T12.
**Scope check:** one subsystem chain (vocabulary→engine→content→client) with the five-class validation bar; independently testable per task; engine tasks precede the content that needs them; client last before goldens/e2e. Non-goals restated. Backlog items deliberately NOT pulled in: currentWasMax protocol addition, regenerate-recovery-codes route, pinned-cap UI (all polish-plan candidates, listed for the next planning pass).
