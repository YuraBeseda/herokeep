# Phase 4 Slice 3 — Vocabulary Completions & Carry Retirement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**STATUS: WRITTEN 2026-10-03 — NOT STARTED (owner directive: plan written after plan 12 merged @ 5d02e05; execution awaits owner resume).**

**Goal:** Retire the slice-2 carry list: close the engine-vocabulary gaps that forced text fallbacks (expertise picks, tool proficiencies, reset overrides, free-cast linkage, restricted ability picks, scaling speed), fix the two known pre-existing derive wrongs (attacks.ts multiclass gains, condition immunity display), convert the affected class/feat features from text to mechanics, and ship the deferred UX/golden hardeners — completing Phase 4's "every expressible SRD rule is mechanized" bar.

**Architecture:** Engine-vocabulary-first again: each new capability lands as a generic mechanism (schema-additive where needed, red-first) with its content retrofit in the SAME task so the mechanism ships proven against real SRD data, never speculatively. Retrofits re-pin only the goldens whose derive output legitimately changes, with inline justification. UX tasks ride on existing component machinery. Sources of record: the plan-12 ledger §"CONSOLIDATED SLICE-3 CARRIES", final-review.md files, and the vendored SRD snapshot (cite pks always).

**Tech Stack:** Existing monorepo (TS 6, Vitest 4, Zod, Angular 22 zoneless). No new dependencies.

**Spec:** `docs/02-architecture/04-content-packs.md` + `02-domain-model-and-events.md`; vendored SRD 5.2.1 at `packages/content/upstream/open5e-srd-2024/`; the plan-12 ledger carry list (plan-12 `.superpowers` workspace is deleted with its worktree — the carries are restated per-task below, self-contained).

## Global Constraints

- Repo non-negotiables (CLAUDE.md): rules are DATA; structural i18n en/ru/uk; events immutable + reducers backward-compatible forever (old logs replay identically — every mechanism here must keep occurrence-#1/legacy behavior byte-stable); `packages/engine/src` deterministic; TDD red-first with captured RED; Conventional Commits with scope + session trailer.
- Protocol changes: additive ONLY, `pnpm --filter @hk/protocol build:schema` committed same-commit (CI fails on drift). Expected additive touches: expertise-capable pick target, `pick.abilities.from`, tool-pick target, speed formula widening, reset override. Each task says which; anything else = controller STOP.
- Goldens: 58 exist. Byte-identical except retrofit tasks' justified re-pins (each re-pin carries an inline comment naming the retrofit).
- Pack gates: ZERO diagnostics, 1866 entities, ≤5MB (currently 2,219,177 B). Build `@hk/engine` BEFORE `@hk/content build:pack`.
- Baselines at plan start (main @ 5d02e05): root 110/1698; web 134/1476; engine isolated ~49 files; api CF 8/40+1 skip; offline e2e 25/25; e2e:sync 8/8; gzip 337.5/600; derive perf 0.635 ms / 15 ms budget.
- Execution notes (plan-11/12 experience): PowerShell FOREGROUND for pnpm; e2e:sync chunked with output to files; web flakes (campaigns-list, party-overview-publisher, "Missing translation") retry once; worktree deletion needs the robocopy /MIR trick.

## Design rulings (baked in — verify cited data, do not re-litigate)

1. **Mechanism+retrofit in one task.** A vocabulary task is not done until real SRD content uses it and a golden pins the result. No speculative vocabulary.
2. **Legacy stability is the bar for every choice/grant change**: recorded decisions keep granting; only OFFERS may change shape. The plan-12 final-wave compat pattern (old ids still resolved, new ids additive) is the template.
3. **Expertise** = a choice whose selections apply `proficiency.grant level:'expertise'` to the picked skills — and the SRD restricts picks to skills you're PROFICIENT in (verify vendored text per feature; the pick's option set must be filterable to current proficiencies — if option-filter-by-sheet-state is not expressible, the mechanism gains a generic `pick.skills.requireProficient: true` flag rather than a state predicate).
4. **Tool proficiencies**: engine currently derives NONE. The task adds the derive surface (sheet.toolProficiencies from class/background/feat data + tool-typed picks) and the sheet display; instrument/artisan-tool CHOICES become expressible via a tool-typed pick mirroring the skill pick (Task-5-plan-12 precedent).
5. **Free-cast linkage**: `spell.grant.uses` (field exists, unconsumed) materializes a resource AND propose/casting offers a "free cast" lane consuming it when casting that spell (beside slot lanes, pact precedent). No UI invention beyond the existing cast-dialog lane picker.
6. **Reset override**: a later `resource.define` for the SAME id may override `reset` (define merge becomes last-wins per field with max still stacking — verify current stacking semantics in derive/resources.ts and keep max behavior byte-stable; only reset gains override semantics). Font of Inspiration is the proving retrofit.
7. **Rolled rest-regain (dice-in-rest)**: use the recorded-rolls precedent (creation ability rolls): the rest proposal, when a resource's regain is dice-shaped, includes a recorded roll in the same tx (deterministic replay — the roll is DATA in the event). Dawn items with NdM+K regain stop being full-restore. If the proposal layer can't carry a roll cleanly, STOP and report (controller rules; fallback = keep v1 approximation, drop the task's engine half, keep its test documenting why).
8. **attacks.ts multiclass gains** (pre-existing f114f01): weapon proficiency for attack math must use the same per-class gains-restricted sets as sheet.proficiencies — one source of truth, extracted not duplicated.
9. **condition.immunity**: derive consumer = a sheet-level immunities list + play-tab badge rendering; condition application flows (if any exist) are NOT gated in v1 (display-only truth, matching provenance conventions) — gating is Phase-5 territory.
10. **Offer-time prerequisite filtering**: ineligible feats stay LISTED but visibly gated (disabled row + reason, matching the attunement disabled-with-reason pattern) — not hidden (discoverability), not selectable (the current selection-time rejection stays as the backstop).
11. Task order: engine-vocab tasks first (1-6), derive-wrongs (7), UX (8-9), goldens (10), e2e/docs (11). Classes already shipped mean every retrofit task runs the full content gates.

## Review Focus

1. Expertise picks on a skill you are NOT proficient in must be refused (and the option gated) — pinned where the mechanism lands (Task 1).
2. A legacy log with Deft Explorer/Expertise answered as TEXT-era (no decision) must replay identically after the retrofit (no new mandatory choice blocks an old character's sheet — outstanding yes, invalid no) (Task 1, 10).
3. Free-cast lane must not double-spend: casting Hunter's Mark via the free lane consumes the counter and NO slot; via a slot lane consumes the slot and NOT the counter (Task 4).
4. attacks.ts fix must not change any SINGLE-class attack bonus (58 goldens are the net; only multiclass attack provenance may move, justified) (Task 7).
5. The rolled-regain tx must replay deterministically from the event log alone (no Math.random in engine — the roll is recorded data) (Task 6).

---

### Task 1: Expertise vocabulary + Rogue/Bard/Ranger retrofit

**Files:**
- Modify: `packages/protocol/src/pack/choice.ts` (additive: skill-pick `level: 'proficient'|'expertise'` target or `requireProficient` flag — verify current PickSchema shape first and keep existing picks valid), `packages/engine/src/derive/abilities.ts` (apply expertise from picks; the `proficiency.grant level:'expertise'` rank already exists), `packages/engine/src/derive/choices.ts`/`validation.ts` (option gating + refusal), `packages/content/src/overlays/{rogue,bard,ranger}.json` (Expertise @1/@9 rogue, @2/@9 bard, Deft Explorer ranger — verify vendored levels+counts, cite)
- Test: engine derive tests + `packages/content/test/mechanics.test.ts` retrofit sections

**Interfaces:** Consumes the Task-5-plan-12 skill-pick path + union policy (expertise outranks proficient — verify rank order in abilities.ts). Produces: expertise-capable picks for any content.

- [ ] Step 1: Verify PickSchema + the vendored Expertise texts (does each restrict to proficient skills? quote). Document in report.
- [ ] Step 2: Red engine tests: expertise pick upgrades a proficient skill's modifier to 2×prof; non-proficient target refused (`selection.*` code per conventions) and gated in outstanding options; proficient+expertise ranks correctly.
- [ ] Step 3: Protocol widening (additive) + build:schema same-commit; engine implementation.
- [ ] Step 4: Retrofit the three overlays (text→choice, text-flag removed, cites); mechanics tests per class assert derive-level doubled modifiers; goldens: rogue/bard/ranger fixtures gain outstanding-choice entries where un-answered — re-pin with justification (recorded-decision-free fixtures stay valid per ruling 2).
- [ ] Step 5: Gates (`pnpm check`, pack rebuild 0 diag); commits `feat(protocol): expertise skill picks` + `feat(engine): expertise pick application` + `feat(content): expertise choices for rogue bard ranger`.

### Task 2: Tool proficiency derive surface + tool picks + instrument choices

**Files:**
- Modify: `packages/engine/src/derive/index.ts`/`abilities.ts` (sheet.toolProficiencies from class/background data + tool-typed picks), protocol ONLY if the pick needs a tool target (verify — skills took a query type), `apps/web` sheet display (build/play tab proficiency section), `packages/content/src/overlays/{monk,bard}.json` (instrument/artisan-tool choices — monk "one type of Artisan's Tools or one Musical Instrument" @1? verify vendored, bard 3 instruments)
- Test: engine + mechanics + one web spec

- [ ] Step 1: Map where tool data already lives (class.toolProficiencies, background equivalents — grep) and what the sheet lacks; document.
- [ ] Step 2: Red: derive exposes toolProficiencies for a class with fixed tools (rogue thieves' tools); tool-typed pick selection lands; web spec renders the list.
- [ ] Step 3: Implement (mirror the skill-pick path; i18n ×3 for the section header); retrofit monk+bard choices (cite); goldens re-pin justified (sheet gains a field — likely ALL 58 move: if so, verify mechanically that ONLY the new field differs — script the diff check and state it in the report; that's an acceptable whole-set re-pin with one justification).
- [ ] Step 4: Gates; commits `feat(engine): tool proficiencies` + `feat(content): tool choices` (+`feat(web): tool proficiency display`).

### Task 3: Reset override at level (Font of Inspiration) + restricted ability picks (Grappler)

**Files:**
- Modify: `packages/engine/src/derive/resources.ts` (per-field define merge: reset last-wins, max stacking unchanged), `packages/protocol/src/pack/choice.ts` (additive `pick.abilities.from?: AbilityId[]`), `packages/engine/src/derive/abilities.ts` (restrict offered set), `packages/content/src/overlays/{bard,feats}.json` (Font of Inspiration shortRest define @5 replacing text-flag; Grappler +1 Str-or-Dex pick replacing text)
- Test: engine + mechanics

- [ ] Step 1: Red: second define same id with different reset → later reset wins, max unchanged; first-define-only logs unchanged. Red: abilities pick with `from:['str','dex']` offers exactly those.
- [ ] Step 2: Implement both (schema regen same-commit); retrofit bard (Bardic Inspiration becomes shortRest from 5 — bard goldens 5/11/20 re-pin justified) + Grappler.
- [ ] Step 3: Gates; commits `feat(engine): resource reset override and restricted ability picks` + `feat(content): font of inspiration and grappler mechanics`.

### Task 4: Free-cast linkage (spell.grant.uses) + Hunter's Mark/Wild Companion retrofit

**Files:**
- Modify: `packages/engine/src/derive/resources.ts` (uses → resource materialization if not already), `packages/engine/src/propose/casting.ts` (free-cast lane beside slot/pact lanes, consuming the counter; refusal when empty), `apps/web` cast-dialog (lane option — reuse pact-lane rendering), `packages/content/src/overlays/{ranger,druid}.json` (wire the existing favored-enemy counter to the grant; Wild Companion from text to grant+uses — verify vendored)
- Test: engine propose tests + web cast-dialog spec + mechanics

- [ ] Step 1: Verify spell.grant.uses shape in protocol + how T10 authored the favored-enemy counter; design the linkage (grant knows its resource id — or uses materializes its own; prefer the existing counter, no duplicate).
- [ ] Step 2: Red (Review Focus 3): free lane consumes counter not slot; slot lane consumes slot not counter; empty counter refuses the lane.
- [ ] Step 3: Implement + retrofit + web lane (i18n ×3); ranger goldens re-pin if resources reshape (justify).
- [ ] Step 4: Gates; commits `feat(engine): free cast lane` + `feat(content): hunters mark and wild companion free casts` (+web).

### Task 5: Scaling speed + condition immunity display

**Files:**
- Modify: `packages/protocol` (speed.bonus value int→int|Formula, additive), `packages/engine/src/derive/index.ts` (evaluate; also climb/swim "=Speed" — add speed kinds ONLY if vendored Roving needs them and the sheet can show them; verify), `packages/engine/src/derive/` (immunities list from condition.immunity effects), `apps/web` play-tab (immunity badges, i18n ×3), `packages/content/src/overlays/{monk,ranger,barbarian,paladin}.json` (monk 5-increment workaround → one formula; Roving climb/swim; Mindless Rage + Aura of Courage/Devotion immunities from text to effect where the effect is now consumed — per-feature verify not state-wrong: aura ally parts stay text)
- Test: engine + mechanics + web spec

- [ ] Step 1: Red: formula speed bonus evaluates per level; immunity effect lands on sheet.immunities; monk speed goldens byte-stable after the workaround swap (same totals — that is the test).
- [ ] Step 2: Implement + retrofits (cites); schema regen; monk goldens must NOT move (same values via formula — a move = bug).
- [ ] Step 3: Gates; commits `feat(engine): formula speed and condition immunities` + `feat(content): scaling speeds and immunity effects` (+web badges).

### Task 6: Rolled rest-regain (dice-in-rest) per ruling 7

**Files:**
- Modify: `packages/engine/src/propose/rest.ts` (+ the charge parser output `packages/content/src/transform/charges.ts` gains structured regain dice where parsed), protocol if the restored event needs a recorded-roll field (verify `resource.restored` shape + the creation recorded-rolls precedent first — STOP if non-additive)
- Test: engine propose/replay tests

- [ ] Step 1: Verify the recorded-roll precedent + event shapes; document the design (or STOP per ruling 7).
- [ ] Step 2: Red (Review Focus 5): rest tx with a dice-regain item records the roll; replay from log alone reproduces the exact restored amount; full-restore items unchanged.
- [ ] Step 3: Implement; parser emits regain dice (manifest test re-pins with justification — values must match the already-verified desc sentences); dawn full-restore approximation comment updated.
- [ ] Step 4: Gates; commit `feat(engine): rolled charge regain on rest`.

### Task 7: attacks.ts respects multiclass gains (pre-existing wrong, f114f01)

**Files:**
- Modify: `packages/engine/src/derive/attacks.ts:~77` + extract the per-class proficiency-set logic shared with `index.ts:118-120` into one helper (one source of truth per ruling 8)
- Test: engine derive tests

- [ ] Step 1: Red: wizard→rogue attack with rapier is NOT proficient on the attack line (matches sheet.proficiencies); single-class attacks unchanged.
- [ ] Step 2: Implement extraction + fix; all 58 goldens — single-class byte-identical (Review Focus 4); multiclass fixtures re-pin ONLY if an attack line legitimately changes (justify each).
- [ ] Step 3: Gates; commit `fix(engine): attack proficiency respects multiclass gains`.

### Task 8: Offer-time prerequisite gating (web) + prepared-list unprepare control

**Files:**
- Modify: `apps/web` feat-choice option rendering (disabled row + reason for unmet prerequisites — evaluate via the existing checkPrerequisites result surface; find how options get metadata), play-tab prepared list (disabled unprepare control with reason for alwaysPrepared — the T9-plan-12 F4 item), i18n ×3
- Test: web specs

- [ ] Step 1: Red: level-4 fighter sees Epic Boons listed-but-disabled with reason; selection still refused engine-side (backstop untouched). Red: granted oath spell shows a disabled unprepare control with reason (real-pack fixture per T9 spec patterns).
- [ ] Step 2: Implement (a11y per repo standard); gates incl. gzip; commit `feat(web): prerequisite gating and always-prepared controls`.

### Task 9: Grown-choice re-pick UX note + legacy-stacking guard test

**Files:**
- Modify: `apps/web` level-up choice step (when re-offering a GROWN choice, pre-seed the previous picks so the player adds the delta instead of re-picking all — verify the decision-replace event shape stays identical; UI-level pre-population only), engine test for the accepted legacy-stacking edge (pin it as documented behavior)
- Test: web spec + engine pin

- [ ] Step 1: Red web spec: fighter mastery growth 3→4 re-offer shows the 3 prior picks pre-selected; finishing with +1 emits the same replace-decision event as before (event log identical shape).
- [ ] Step 2: Engine pin: the answered-later-class-full-pick + gains-bonus stacking edge asserts current behavior with a comment naming it accepted (plan-12 ledger ruling).
- [ ] Step 3: Gates; commit `feat(web): pre-seed grown choice picks`.

### Task 10: Goldens — new-mechanism pins + the missing multiclass combos

**Files:** `packages/engine/test/golden/` + spec only (no src).

- [ ] Step 1: New goldens: paladin5/ranger3 (half+half combined — pin the combined caster level per the weights: ceil(5/2)+ceil(3/2)=5 — VERIFY against the engine, this is exactly the unpinned seam), ranger5/warlock3 (half+pact separation), a rogue-11 with Expertise answered (doubled modifier pinned), a bard-6 with Font-era shortRest reset pinned, a ranger-5 with a free-cast spend/rest cycle if the harness supports proposals (else derive-only pin + note).
- [ ] Step 2: Sanity-check table per golden (recompute by hand) per the T15 discipline; existing goldens byte-identical beyond the justified retrofit re-pins already landed in Tasks 1-7.
- [ ] Step 3: Perf re-measure (HK_RECORD_PERF, heaviest new golden) → PERF.md append; verdict vs 15 ms.
- [ ] Step 4: Gates; commit `test(engine): slice 3 goldens and perf`.

### Task 11: e2e + docs wrap

**Files:** one new offline e2e (rogue create with Expertise through the real wizard — exercises Task 1 end-to-end); docs: doc-04 (expertise picks, tool proficiencies, reset override, free-cast lane, formula speed, immunities, rolled regain), doc-02 (recorded-roll regain event notes), README slice-3 section (source-verified numbers), manual-device-checklist additions, this plan's STATUS → EXECUTED.

- [ ] Step 1: e2e red-first; full offline suite green; e2e:sync ONE pass (chunked, documented) since pack shape changed.
- [ ] Step 2: Docs (claims cited to reports); gates.
- [ ] Step 3: Commits `test(web): slice 3 e2e` + `docs(repo): phase 4 slice 3 wrap`.

---

## Self-review (performed at write time)

- **Carry coverage:** every plan-12 consolidated carry has an owner: expertise (T1), tools+instruments (T2), reset override + restricted abilities (T3), free-cast linkage (T4), formula speed + climb/swim + condition.immunity (T5), dice-in-rest (T6), attacks.ts (T7), offer-time gating + F4 control (T8), re-pick UX + stacking pin (T9), half+half/half+pact + negative-gating goldens (T10), docs (T11). NOT in scope, restated as standing owner-flags: Nature's Ward/Sanctuary upstream text (owner must supply SRD text); option-entity families absent upstream (Metamagic/Hunter's Prey/Wild-Shape forms/invocations — categorical until upstream or hand-vendored data exists, an OWNER decision); per-land conditional grants (needs choice-conditioned grants — large vocabulary, Phase-5 candidate with that decision); spell-list expansion (Magical Secrets — same bucket); half-prof on initiative/raw checks (needs check-roll surfaces that don't exist yet — Phase-5 play-flow).
- **Placeholder scan:** verify-first steps are explicit report-gates (T1 PickSchema, T4 uses-shape, T6 STOP clause); no TBDs.
- **Type consistency:** mechanisms named consistently with shipped code (proficiency.grant level:'expertise' rank exists; spell.grant.uses exists unconsumed; speed.bonus int-only — all verified in plan-12 reports).
- **Review Focus:** five lines, each with an owning task's test (T1, T1/T10, T4, T7, T6).
