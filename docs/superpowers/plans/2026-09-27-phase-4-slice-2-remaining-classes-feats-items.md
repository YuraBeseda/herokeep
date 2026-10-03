# Phase 4 Slice 2 — Remaining Classes, Feats & Magic Items Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**STATUS: EXECUTED 2026-10-03 — all 16 tasks complete on branch `worktree-phase-4-plan12-slice-2` (merge pending).**

**Goal:** Mechanize the remaining 7 SRD 5.2.1 classes (Bard, Druid, Monk, Paladin, Ranger, Rogue, Sorcerer) to level 20 with their subclasses, mechanize the 17 SRD feats and magic-item charges/attunement at scale, and retire every slice-1 carry — completing Phase 4's "all twelve classes, real data" milestone.

**Architecture:** Pure content-and-carries slice: the plan-11 vocabulary (typed `extra` columns, `resource.define`, `spellcasting.define` with `full|half|third|pact|none` tables, per-progression multiclass weights, charges, `attunement.by`, occurrence-scoped choices) is assumed sufficient; the only engine work is the four carried fixes (passive-effect stacking, choice-count growth, `spell.grant` alwaysPrepared, combined-gate dedupe) plus one web display fix. Each class ships as one overlay JSON following the barbarian/cleric/warlock pattern, patch-only, every feature mechanized-or-text-fallback-with-flag (never silently dropped). Magic-item charges are derived at build time by a desc-parsing transform with overlay corrections — rules stay data.

**Tech Stack:** Existing monorepo (TS 6, Vitest 4, Zod, Angular 22 zoneless). No new dependencies.

**Spec:** `docs/02-architecture/04-content-packs.md` (authoring vocabulary), `docs/02-architecture/02-domain-model-and-events.md` (events), vendored SRD 5.2.1 at `packages/content/upstream/open5e-srd-2024/` (the rules authority — always cite pk), plan 11 (`2026-09-27-phase-4-engine-vocabulary-and-classes.md`) for the vocabulary this plan consumes.

## Global Constraints

- Repo non-negotiables (CLAUDE.md): rules are DATA; structural i18n en/ru/uk; events immutable + reducers backward-compatible forever; `packages/engine/src` deterministic; TDD red-first with captured RED; Conventional Commits with scope + session trailer.
- Overlays PATCH existing entities only (`set`/`merge`/`rows` per `packages/content/src/overlays/merge.ts`); they cannot create entities. If a choice's options have no vendored entities, the choice is categorically impossible → text fallback + owner-flag (the plan-11 T9/T11 posture; Metamagic and Wild Shape forms are expected cases).
- Fallback bar (plan-11 ruling 9): mechanize a feature only if it is doc-04-expressible AND not state-wrong (an always-on effect for a conditional/stance feature is WORSE than text). Every vendored ClassFeature row must land as mechanized effects, a text feature entity, or an explicit ledgered skip-with-reason. Citations (`cite: "pk srd-2024_..."`) per overlay entry.
- Pack gates: ZERO diagnostics; ≤5000 entities / ≤5MB (current: 1866 / 2,109,279 B — ample headroom). Build `@hk/engine` BEFORE `@hk/content build:pack`. Never edit dist by hand.
- Goldens: existing 33 must stay byte-identical unless a task explicitly re-pins with inline justification.
- Baselines at plan start (main @ e8d7b5e): root 105 files/1414 tests + 1 expected-fail; web 134/1463; engine isolated 47/608 + 1 xfail; content 12 files; protocol 16 files; api CF 8/40+1 skip; gzip 336.3/600 KB; offline e2e 24/24; e2e:sync 8/8.
- Schema changes (if any) must be additive + `pnpm --filter @hk/protocol build:schema` committed (CI fails on drift). This plan expects ZERO protocol changes; a task needing one must STOP and get a controller ruling first.

## Design rulings (baked in — do not re-litigate, do verify cited data)

1. **Sneak Attack / Martial Arts / scaling columns are display data, not auto-math.** The engine reads typed `extra` columns generically; the sheet shows them (attacks/features area). Sneak Attack damage is trigger-gated (advantage/ally) → auto-adding it to attack math would be state-wrong. No 5e-specific column names in TS.
2. **Resource pools** (Bardic Inspiration, Focus Points, Sorcery Points, Lay on Hands, Wild Shape uses, Channel Divinity re-uses) are `resource.define` effects with closed-form formulas keyed on `classLevel(<class>)` or `mod(<ability>)`, per the barbarian rage precedent. The vendored column data is the source for the formula's values; sanity-check the closed form against all 20 vendored rows in the task's test.
3. **Casters:** Bard/Druid/Sorcerer = `slots:'full'`; Paladin/Ranger = `slots:'half'` (multiclass weight half/round-UP already in system data); Monk/Rogue = no `spellcasting.define`. Preparation model per vendored 2024 text (all seven prepared-casters in 2024 — verify each column name).
4. **Subclass choice at 3** for all seven, verbatim shape from cleric: `rows` patch at level 3 with `pick:{query:{type:'subclass', classes:['<slug>']}}, count:1`. SRD subclasses: College of Lore, Circle of the Land, Warrior of the Open Hand, Oath of Devotion, Hunter, Thief, Draconic Sorcery.
5. **Expertise (Rogue 1, Bard 2):** mechanize ONLY if the effects registry already has a proficiency-doubling effect kind; otherwise text fallback + owner-flag and a ledger line naming it a slice-3 vocabulary candidate. Do NOT add an effect kind mid-plan (that is protocol/engine vocabulary → controller STOP rule).
6. **Always-prepared subclass/oath/circle spells** ship via the T3 `spell.grant` alwaysPrepared fold; Paladin (Devotion), Druid (Land), Cleric retrofit if trivially safe (byte-identical goldens otherwise leave cleric untouched).
7. **Magic-item charge parsing is conservative:** only descs matching the unambiguous SRD phrasing ("has N charges", "regains \<dice|N\> expended charges daily at dawn", "all expended charges") get `charges`; anything else stays unmechanized. A build report test pins the exact parsed count so a regex regression is loud. Overlay corrections handle exceptions; zero wrong-max items is the bar (a wrong max is worse than none).
8. **`attunement.by` predicates** only for the literal "requires attunement by a \<class or alignment or ability\> ..." forms that PredicateSchema can express (class checks yes; alignment/creature-type likely not → those keep `attunement:{required:true}` only + note).
9. **Rage-state, Wild Shape forms, Metamagic options, stances** (Patient Defense etc.): state/trigger-gated or entity-less → text fallback with flag. Same for any feature whose mechanization would be always-on-wrong.
10. **Task order is engine-carries-first** so class tasks land on fixed machinery; class tasks run simplest→most-caster (Rogue → Monk → Paladin → Ranger → Bard → Sorcerer → Druid); goldens after all classes; web/e2e/docs last.

## Review Focus

1. Half-caster multiclass rounding UP: Paladin 5 / Cleric 3 caster level must be ceil(5/2)+3 = 6 (2024 change; 2014 said floor). Pinned by a T15 golden.
2. Charge-parse misreads: "1d3 charges" vs "3 charges", "regains all" vs "regains 1d6+4" — T6's report test enumerates every parsed item id + max so any regex drift diffs loudly.
3. Repeatable-feat direct effects after T1: Skilled taken twice must yield 6 distinct skill proficiencies (was the plan-11 xfail) — pinned in T1 and re-exercised via T5's mechanized Skilled.
4. Subclass query leakage: a Bard at 3 must be offered ONLY College of Lore (never another class's subclass) — each class task asserts the choice's resolved option set.
5. Pooled-slot display dedupe (T4) must not merge the pact block or collapse a single-class caster's block — component test covers Warlock/Cleric and solo Wizard alongside the pooled pair.

Execution note (per plan-11 experience): e2e:sync full runs ~19 min — chunk foreground with `--grep`, output to file; web full-suite flakes (campaigns-list, "Missing translation") retry once; PowerShell foreground for pnpm; robocopy /MIR trick for worktree deletion.

---

### Task 1: Engine carries — passive-effect stacking + combined-gate dedupe

**Files:**
- Modify: `packages/engine/src/derive/composition.ts` (or wherever `compose` dedupes active entities — verify), `packages/engine/src/derive/abilities.ts` (stacking keys), `packages/engine/src/derive/spellcasting.ts:240-276`
- Test: `packages/engine/test/derive/repeated-feat.test.ts` (un-xfail :164), `packages/engine/test/derive/spellcasting.test.ts`

**Interfaces:** Produces: `ActiveEffect.source` (or equivalent) carries an occurrence discriminator so a twice-acquired entity's direct effects apply per-occurrence; `combinedClassIds` built from DISTINCT classIds. Consumes: plan-11 occurrence-scoped choice ids (`<id>--<n>`), acquisition counting in `derive/choices.ts`.

- [ ] Step 1: Flip `repeated-feat.test.ts:164` from `it.fails` to `it` — run, capture RED (direct effects of a twice-taken repeatable feat apply once).
- [ ] Step 2: Write a second failing test: two acquisitions of a fixture feat granting `+1 speed`-style direct effects → both apply and SUM (mirror the nested-choice occurrence logic).
- [ ] Step 3: Implement: compose keeps one node per acquisition (occurrence-indexed source), stacking keys include the occurrence discriminator for repeat-acquired sources ONLY (single-occurrence keys byte-identical — all 33 goldens must not move; that is the regression net).
- [ ] Step 4: Failing test for the combined-gate: one class defining spellcasting TWICE (fixture) must count as ONE caster for the combined-table gate; dedupe `weightedCasters` by classId at `spellcasting.ts:259`.
- [ ] Step 5: Full engine suite + goldens byte-identical; `pnpm check`; commit `fix(engine): per-occurrence direct effects and combined-gate classId dedupe`.

### Task 2: Engine carry — choice-count growth (mastery counts, future invocation counts)

**Files:**
- Modify: `packages/engine/src/derive/choices.ts`, `packages/engine/src/content/choices.ts` (validation)
- Test: `packages/engine/test/derive/` (new spec), `packages/protocol` ONLY if `count` cannot already be a formula — verify first; if a protocol change is needed, STOP for a controller ruling.

**Interfaces:** Produces: a choice's effective `count` may derive from a class progression column (e.g. fighter weapon-mastery count 3→4→5 at vendored levels); existing numeric `count` behavior unchanged. Consumes: typed `ExtraValueSchema` columns (plan-11 T7).

- [ ] Step 1: Verify how `count` is typed in `ChoiceSchema` and whether a formula string is already legal. Document the finding in the task report before coding.
- [ ] Step 2: Red test: a fixture class whose mastery-style choice count grows by level — at level 1 the choice wants 3 picks, at the growth level 4 — and the extra pick surfaces as outstanding after level-up (occurrence machinery from plan 11 covers the re-offer; verify, don't rebuild).
- [ ] Step 3: Implement minimal count-resolution (formula evaluated in the same ctx as other class formulas); validation red test for a count formula referencing unknown symbols.
- [ ] Step 4: Wire fighter's real count growth in `packages/content/src/overlays/fighter.json` per vendored ClassFeatureItem column values (verify levels — cite pk); pack rebuild; goldens: fighter 11/20 goldens may legitimately re-pin (mastery count) — inline justification required.
- [ ] Step 5: `pnpm check`; commit `feat(engine): progression-driven choice counts` + `feat(content): fighter mastery count growth`.

### Task 3: Engine carry — `spell.grant` alwaysPrepared fold

**Files:**
- Modify: `packages/engine/src/derive/spellcasting.ts` (prepared-list assembly)
- Test: `packages/engine/test/derive/spellcasting.test.ts`

**Interfaces:** Produces: a `spell.grant` effect with `alwaysPrepared: true` (verify the exact existing field name in doc-04/EffectSchema — it shipped in vocabulary, unfolded) adds the spell to the class's prepared list without consuming a preparation slot and un-unpreparable. Consumes: T12-era vocabulary; class tasks 9/11/13 author real oath/circle/domain spells against it.

- [ ] Step 1: Red test: fixture feature granting a spell alwaysPrepared → appears in `SpellcastingBlock` prepared list, does not count against `preparedMax`, `spell.unprepared` for it is refused by `validateSelection`/propose (match existing refusal-code conventions).
- [ ] Step 2: Implement the fold; second test: interplay with multiclass (grant binds to the granting class's block only).
- [ ] Step 3: Goldens byte-identical (no shipped content uses it yet); `pnpm check`; commit `feat(engine): always-prepared spell grants`.

### Task 4: Web carries — pooled-slot row dedupe + house-rule display check

**Files:**
- Modify: `apps/web/src/app/views/characters/sheet/play/play-tab.component.ts:413-423` (+ html/scss as needed)
- Test: `apps/web/src/app/views/characters/sheet/play/play-tab.component.spec.ts`

**Interfaces:** Consumes: engine emits the SAME pooled row on every combined caster block (`spellcasting.test.ts:202-222` pins this). Produces: play tab renders one shared "Spell slots" section when ≥2 blocks share the pooled row, keeping per-class prepared/cantrip sections separate; pact block always separate; solo caster unchanged.

- [ ] Step 1: Red component test: Cleric 3/Wizard 2 fixture (reuse `character-fixtures.ts` patterns) renders the pooled slot row ONCE; Warlock/Cleric fixture still renders pact + regular separately; solo Wizard unchanged.
- [ ] Step 2: Implement `spellBlocks` merge (group by identical slot-row identity, engine-provided — no 5e reasoning in the component); i18n key for the shared header ×3 locales.
- [ ] Step 3: Full web suite; `pnpm check`; commit `fix(web): render pooled multiclass slots once`.

### Task 5: Feats at scale (all 17), ASI note fix

**Files:**
- Modify: `packages/content/src/overlays/feats.json` (grows from 1 entry), `packages/content/src/transform/feats.ts` only if a structured field is missing (prefer overlays)
- Test: `packages/content/test/mechanics.test.ts` (feat section)

**Interfaces:** Consumes: T1 per-occurrence direct effects (Skilled ×2 must stack), plan-11 `repeatable` flag (transform-derived from FeatBenefit "Repeatable"). Produces: every feat entity carries either real effects/choices or is a ledgered text-fallback with owner-flag; prerequisites become predicates where expressible.

- [ ] Step 1: Inventory all 17 vendored feats (`Feat.json` + `FeatBenefit.json`) into the task report: per feat, mechanizable pieces (skill/tool grants, ability +1 choices, speed, HP) vs text (rerolls, triggered reactions — Lucky/Savage Attacker style are state-gated → text per ruling 9).
- [ ] Step 2: Red pack-mechanics tests for the mechanized set (e.g. Skilled → 3-skill query choice; Magic Initiate → cantrip/spell choices IF spell-list queries express it — verify; Tough-style HP if formula-expressible; ability +1 picks via `pick.abilities`).
- [ ] Step 3: Author overlays with cites; REWRITE the stale ASI entry note (safe: `merge.ts:22` strips note/cite from built entities — the plan-11 fix-wave report's contrary claim was wrong) to describe the occurrence-scoped reality and the inexpressible +1/+1 alt-form (owner-flag stays).
- [ ] Step 4: Repeatable-stack integration test over the REAL pack: Skilled ×2 → 6 skills.
- [ ] Step 5: Pack rebuild zero diagnostics; goldens byte-identical (ASI mechanics unchanged); `pnpm check`; commit `feat(content): mechanize SRD feats`.

### Task 6: Magic-item charges & attunement.by at scale

**Files:**
- Modify: `packages/content/src/transform/items.ts:359-381` (buildMagicItem), new `packages/content/src/transform/charges.ts` (parser), `packages/content/src/overlays/` corrections file if needed
- Test: `packages/content/test/items.test.ts`, new `packages/content/test/charges.test.ts`

**Interfaces:** Consumes: plan-11 `charges {max: <formula|int>, reset}` item vocabulary + `attunement.by` predicate field, `item:<uuid>` resources, propose/rest charge restoration. Produces: every unambiguously-phrased charged item mechanized; a pinned manifest test of parsed item ids.

- [ ] Step 1: Corpus scan (test-driven): a spec that runs the parser over all 757 vendored descs and snapshots `{id, max, reset}` for matches — write the CONSERVATIVE regexes per ruling 7 first, red against a hand-verified sample of ≥10 known charged items (Wand of Magic Missiles-class staples — verify presence in this snapshot by grep, cite pks) and ≥5 known non-charged items that contain the word "charge" in prose.
- [ ] Step 2: Implement parser; the snapshot test pins the FULL parsed list (sorted ids + values) with a count assertion — a regex change that alters any item diffs loudly.
- [ ] Step 3: `attunement.by`: parse the literal "requires attunement by a \<X\>" suffixes; mechanize class-forms into predicates; ledger the inexpressible forms (alignment/creature) with counts.
- [ ] Step 4: Derive smoke test over the real pack: one charged item equipped → `item:<uuid>` resource materializes with the parsed max; long rest restores per reset.
- [ ] Step 5: Pack rebuild zero diagnostics, size within caps; `pnpm check`; commit `feat(content): magic item charges and attunement predicates`.

### Tasks 7–13: The seven classes (one task each, shared contract)

Order: **7 Rogue → 8 Monk → 9 Paladin → 10 Ranger → 11 Bard → 12 Sorcerer → 13 Druid.**

**Files (per class `<c>`):**
- Create: `packages/content/src/overlays/<c>.json`
- Modify: `packages/content/src/overlays/load.ts` (+ its `Overlays` interface), `packages/content/src/build.ts` (layer array, after wizard), `packages/content/src/transform/classes.ts:32-38` (`MULTICLASS_GAINS` entry — cite the vendored multiclassing rule text)
- Test: `packages/content/test/mechanics.test.ts` (per-class section, following the barbarian/cleric/warlock sections)

**Interfaces:** Consumes: rulings 1–6, 9; T2 count-growth; T3 alwaysPrepared; system tables `full|half|none`. Produces: `class` entity with real `armorTraining`/`weaponProficiencies`/`toolProficiencies`/`skillChoice` (vendored-cited, replacing placeholders), `multiclass.gains`, subclass choice at 3, every ClassFeature row disposed per the fallback bar.

**Shared steps (each class task):**
- [ ] Step 1: Vendored walk: list every ClassFeature (+ column-data sibling) for the class and its SRD subclass into the report with disposition (mechanize/text/skip+reason). Flag the duplicate-name column-data feature pairs (known transform artifact) — do NOT dedupe in the overlay unless barbarian/cleric precedent did.
- [ ] Step 2: Red mechanics tests: proficiencies/saves vs `CharacterClass.json`; each `resource.define` formula checked against ALL 20 vendored column rows; caster define (list/ability/slots/preparation/cantrip columns verified to 20); subclass choice offers exactly the one SRD subclass; ASI levels + Epic Boon 19 (verify per class — fighter differs).
- [ ] Step 3: Author the overlay (cites per entry); class-specific musts:
  - **Rogue:** Sneak Attack column display-only (ruling 1); Expertise per ruling 5 (verify registry first); Thief features text-heavy; weapon masteries count per vendored.
  - **Monk:** Focus Points `resource.define` (`reset:'shortRest'`, formula vs column 2..20); Martial Arts die column; Unarmored Defense `ac.formula` 10+DEX+WIS mirroring barbarian's authoring incl. armored-suppression; Unarmored Movement column; Open Hand.
  - **Paladin:** `slots:'half'`; Lay on Hands pool (`5*classLevel(paladin)`, long rest); Channel Divinity uses; Devotion oath spells via T3 alwaysPrepared; masteries.
  - **Ranger:** `slots:'half'`; 2024 Favored Enemy = Hunter's Mark always-prepared + uses (verify vendored text; the free-cast counter is a resource); Hunter.
  - **Bard:** full caster; Bardic Inspiration `resource.define` max `mod(cha)` min 1 (verify vendored "equal to your Charisma modifier (minimum of one)"), die-size column; Jack of All Trades per ruling 5 posture (half-proficiency: mechanize only with an existing effect kind); Lore.
  - **Sorcerer:** full caster; Sorcery Points `resource.define`; Metamagic/Innate Sorcery per ruling 9 (check for vendored option entities FIRST — expected absent → text+flag); Draconic.
  - **Druid:** full caster; Wild Shape uses `resource.define` (forms text per ruling 9); Land circle spells via T3; Wild Companion (verify).
- [ ] Step 4: Rebuild engine→pack; zero diagnostics; mechanics suite green; `pnpm check`.
- [ ] Step 5: Commit `feat(content): <class> to level 20`.

### Task 14: Web level-up/create verification pass + i18n

**Files:**
- Modify: only what breaks — expected: none; `apps/web/src/assets/i18n/characters/{en,ru,uk}.json` if any new key surfaced
- Test: existing wizard/level-up/play specs are the net; add one create-wizard spec parameterized over a NEW class (Monk: no caster, resource pips) and one level-up spec (Paladin to 3: subclass + half-caster slots appear).

**Interfaces:** Consumes: all class tasks; the generic choice/step machinery (plan-11 T8/T12 proved count:N and pickers generic — this task VERIFIES no class needed bespoke UI, and STOPs-and-reports if one does).

- [ ] Step 1: Run full web suite against the new pack; triage any failure as stale-spec vs product bug (product bug = STOP and report, controller routes).
- [ ] Step 2: The two new specs above, red-first where they pin new behavior.
- [ ] Step 3: `pnpm check` + `pnpm --filter web build` (gzip gate); commit `test(web): slice 2 class coverage`.

### Task 15: Goldens + perf re-measure

**Files:**
- Test only: `packages/engine/test/golden/` new fixtures + `derive-perf.test.ts` re-run.

**Interfaces:** Consumes: golden harness (`test/support/golden.ts`), real dist pack.

- [ ] Step 1: New goldens, sanity-checked against SRD before pinning (document per golden: HP math, slot row, resource max): each new class at 5/11/20 spot-shape (21 fixtures); multiclass: Paladin 5/Cleric 3 (half-caster round-UP combined level 6 — Review Focus 1), Rogue 3/Bard 2 (non-caster/caster), Sorcerer X/Warlock Y (pact + full separation with a NEW full caster).
- [ ] Step 2: Charged-item golden extension if T6 changed the charged-items fixture landscape (else byte-identical).
- [ ] Step 3: Perf: HK_RECORD_PERF on the heaviest new golden vs the 15 ms budget; ledger the number and a worker-needed verdict (plan-11 baseline 0.549 ms — expect same order).
- [ ] Step 4: `pnpm check`; commit `test(engine): slice 2 goldens and perf`.

### Task 16: e2e + docs wrap

**Files:**
- Create: one offline e2e (create a Monk through the real wizard OR level a fighter into Paladin at 3 picking Devotion — choose the flow that exercises the most new machinery, document why).
- Modify: `docs/02-architecture/02-domain-model-and-events.md` (`spell.cast` row :102 — document per-lane level semantics: pact casts record base level, regular upcasts record cast-at level [slice-1 carry m2]; note the missing-classId ambiguity as a flagged future protocol candidate, do NOT change the event), `docs/02-architecture/04-content-packs.md` (charge-parsing + count-growth + alwaysPrepared sections), `README.md` (Phase-4 slice-2 section, source-verified numbers), `docs/manual-device-checklist.md` (one new-class manual pass), this plan's STATUS header → EXECUTED.

- [ ] Step 1: e2e red-first against the built app; full offline suite green; e2e:sync ONE full pass (chunked, documented) since pack shape changed — helper repairs if the new pack reshapes create-fighter flow again (plan-11 T14 precedent).
- [ ] Step 2: Docs edits above; claims source-verified against task reports.
- [ ] Step 3: `pnpm check`; commits `test(web): slice 2 e2e` + `docs(repo): phase 4 slice 2 wrap`.

---

## Self-review (performed at write time)

- **Spec coverage:** every slice-1 carry from the plan-11 ledger has an owner: passive stacking (T1), combined-gate dedupe (T1), count-growth (T2), alwaysPrepared (T3), pooled-row display (T4), stale ASI note (T5), doc-02 pact semantics (T16), Scholar-activation → subsumed by ruling 5's expertise/half-prof posture (Bard T11/Rogue T7 verify the registry; wizard Scholar retrofit deliberately NOT in scope — ledger it if the registry turns out to support it), rage-state/melee-mastery-filter → remain text by ruling 9 (no task; restated owner-flags). All 7 classes + feats + magic items covered.
- **Placeholder scan:** no TBDs; the two verify-first steps (T2 count typing, ruling-5 registry check) are explicit STOP/report gates, not deferred design.
- **Type consistency:** effect/choice shapes quoted from the researched overlay pattern (`resource.define`, `pick.query type:'subclass' classes:[slug]`, `rows` patches) — all verified against merge.ts/cleric.json/barbarian.json on main @ e8d7b5e.
- **Review Focus:** all five lines have owning tests (T15 golden, T6 snapshot, T1+T5, class-task step 2, T4 spec).
