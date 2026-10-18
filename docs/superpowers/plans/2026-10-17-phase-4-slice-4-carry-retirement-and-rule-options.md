# Phase 4 Slice 4 — Carry Retirement II & Per-Character Rule Options Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**STATUS: EXECUTED 2026-10-18 — all 8 tasks complete on branch `worktree-phase-4-plan14-carries` (merged head recorded at merge).**

**Goal:** Retire the plan-13 carry list (later-class tool handling, Soldier gaming set, Skilled tools, cross-class Expertise eligibility, "= your Speed" items, multiclass weapon mastery, regain/provenance/seeded-count display gaps) and give solo characters per-character rule options (encumbrance) so the SRD mechanics already shipped are correct for every multiclass and background combination before the custom-pack platform (plan 15) builds on them.

**Architecture:** Same engine-vocabulary-first discipline as plans 11–13: each gap closes as a generic, schema-additive mechanism whose first real consumer is SRD content in the same task, pinned by a content test and a golden. Choice scoping (`scope: 'initial' | 'later'`) replaces the slug-special-cased skills split as the one structural notion of "initial class"; mixed-type picks (`queries[]` + item `category` filter) express "skills or tools"; a new `overlays/items.json` makes magic items carry effects for the first time, with attunement-required effects gated on `attuned`; a new additive character event `character.options.set@1` carries per-character rule options into `Facts` so `derive` reads them where a campaign house rule is absent.

**Tech Stack:** Existing monorepo (TS 6, Vitest 4, Zod, Angular 22 zoneless, Playwright). No new dependencies.

**Spec:** `docs/02-architecture/04-content-packs.md`, `02-domain-model-and-events.md`, `05-rules-engine.md`; vendored SRD 5.2.1 at `packages/content/upstream/open5e-srd-2024/` (cite pk/slug for every content claim); the plan-13 carries recorded in the planning-baseline memory and in `README.md` slice-3 section; the Phase 4 row of `docs/03-roadmap/phases.md` (encumbrance option).

## Global Constraints

- Repo non-negotiables (CLAUDE.md): rules are DATA; structural i18n en/ru/uk (×3 for every new UI string); events immutable + reducers backward-compatible forever — old logs replay identically: recorded decisions keep granting, only OFFERS change; `packages/engine/src` deterministic; TDD red-first with captured RED; Conventional Commits with scope; every commit ends with the trailer `Claude-Session: https://claude.ai/code/session_01LmRHJ6gLUJsaj7fHYJkG4F`.
- Protocol changes: additive ONLY, `pnpm --filter @hk/protocol build:schema` committed in the SAME commit. Expected additive touches: `ChoiceSchema.scope`, `multiclass.gains.toolProficiencies`, `PickSchema.queries` + `EntityQuerySchema.category`, the `character.options.set@1` event. Anything else: STOP, report BLOCKED.
- Goldens: 63 tests (62 fixtures + 1 pin) in `packages/engine/test/golden/`. Byte-identical except justified re-pins carrying an inline `note` naming the task and WHY the value legitimately moved. Whole-set effects (Task 2's Soldier row removal) must be mechanically verified: script the diff, state in the report that ONLY the named paths differ.
- New per-mechanism content tests go in NEW files under `packages/content/test/` (precedent `free-casts.test.ts`, `speed-and-immunities.test.ts`); do not grow `mechanics.test.ts` (3145 lines).
- Pack gates: ZERO diagnostics, 1866 entities (Task 3 may add NO entities — it adds effects to existing items), ≤ 5 MB (now 2,225,945 B). Build `@hk/engine` BEFORE `@hk/content build:pack`.
- Baselines at plan start (main @ 7824312): root 123 files / 1839 tests; web 136 / 1501; api CF 8 / 40 + 1 skip; offline e2e 26/26; e2e:sync 8/8; gzip 339.3 / 600 kB; derive perf 0.326 ms / 15 ms.
- Execution notes: PowerShell FOREGROUND for pnpm; long outputs to files under the plan workspace; known web flakes (campaigns-list empty state, party-overview-publisher, "Missing translation") retry once; worktree deletion needs the robocopy /MIR trick.

## Design rulings (baked in — verify cited data, do not re-litigate)

1. **"Initial class" is structural, not a predicate.** `ChoiceSchema.scope?: 'initial' | 'later'` (additive) on class-row choices: `initial` offers only when the owning class is `facts.classes[0]`; `later` only when it is not; absent = both (today's behavior). The existing `@1/skills` / `@1/multiclass-skills` slug special-case (`packages/engine/src/content/choices.ts:38-62`, `derive/choices.ts:99-108`) stays as the FALLBACK when `scope` is absent; content sets `scope` on those two choices too so one mechanism governs. Cost if wrong: one additive field; the slug fallback keeps old packs valid.
2. **Later-class tool proficiencies come from `multiclass.gains`.** Additive `multiclass.gains.toolProficiencies: Slug[]` (rogue: `['thieves-tools']`, vendored `srd-2024_rogue` multiclassing row — verify text; bard/monk: `[]`). `classProficiencyGrants` (`derive/proficiency.ts:28-43`) honors it. Bard later-class instrument = a new `bard@1/multiclass-tools` choice (count 1, same 10 instruments, `scope: 'later'`) — verify the vendored bard multiclassing text says one instrument; if it says none, do not add the choice and cite.
3. **Mixed-type picks** = additive `PickSchema.queries: EntityQuery[]` (union, deduped, offered as one list; `count` applies to the union; mutually exclusive with `static`/`query`) + additive `EntityQuerySchema.category` (item category filter). Skilled → `queries: [{type:'skill'}, {type:'item', category:'tool'}]`; its "Skilled (tools)" text fallback is removed. Soldier → a background `@0/tools` static pick over the 4 `gaming-set-*` items (exactly monk's static-pick shape) and the transform stops emitting `toolProficiency: 'gaming-set'` for Soldier. Cost if wrong: 32 goldens re-pin for a removed non-entity row (mechanically verified).
4. **Magic items carry effects via a new `overlays/items.json`** (loaded in `overlays/load.ts`). First consumers: Gloves of Swimming and Climbing (`speed.bonus` climb+swim `speed(walk)` keyed `climb-equal-to-speed`/`swim-equal-to-speed` + `skill.bonus` Athletics 5), Slippers of Spider Climbing (climb), Cloak of Arachnida (climb + `damage.resistance` poison + Web via `spell.grant` with the inline `uses{count:1, per}` form — the inline form's FIRST real consumer; use the reset kind the schema offers for "dawn" and cite plan-12's dawn≈longRest approximation if that is the only option). Thief Second-Story Work (`rogue.json:349-361`) → `speed.bonus` climb `speed(walk)`; Jumper stays text.
5. **Attunement gating is a correctness fix:** an item with `attunement.required: true` activates its effects/grants only when the inventory entry is `attuned` (today `derive/composition.ts:252-255` activates on `equipped || attuned`). No golden has `attuned: true`, so this is golden-neutral; the plan-12 charged-items behavior (charges exist regardless of attunement) is unchanged — only effects/grants are gated. Cost if wrong: a player must press Attune to get an attunement item's bonuses — which is the rule.
6. **Expertise eligibility excludes existing expertise from ANY owner**: for picks with `proficiency: 'expertise'`, eligible = proficient AND not already at expertise rank (`queryPickOptions` + validation). A legacy decision on a now-ineligible skill keeps granting (no-op upgrade) but surfaces as a validation issue so the player can re-pick. Cost if wrong: one more filtered option.
7. **Multiclass weapon mastery (SRD-silent → OWNER-FLAG):** the vendored multiclassing rules (`Rule.json` `srd-2024_multiclassing_*`) say nothing about Weapon Mastery. Ruling: `masteryCount = max` over active `mastery.grant` counts (not the sum), and selections from ALL `weapon-masteries` choices are honored in class order up to that cap (today `findMasteryChoiceId` honors the first class only). Owner-flag: this follows the 2024 PHB multiclassing text, not the SRD. Cost if wrong: a multiclass character gets fewer masteries than the sum.
8. **Per-character rule options** = additive owner-only event `character.options.set@1 { encumbrance?: 'off'|'standard'|'variant' }` (object of optional keys so future options are additive) → `Facts.options`. Precedence in `derive`: explicit `overrides` (campaign house rule) > `facts.options` > default (`off`). Provenance distinguishes `'house rule'` from `'character option'`. Solo default stays `off` (byte-stable).
9. **Provenance shows numbers:** `Contribution` gains a resolved `amount` next to `formula` (engine evaluates once in `modifiers.ts resolve`); the popover shows the number with the formula as secondary text. Goldens pin totals, not contributions — verify with the diff script; re-pin only if a pinned path serializes contributions.
10. **No speculative vocabulary.** A mechanism is not done until real SRD content uses it in the same task and a golden/content test pins the result.

## Review Focus

1. A later-class bard is offered exactly ONE instrument (`bard@1/multiclass-tools`) and no `@1/tools`; an initial-class bard is offered three; a legacy log where a later-class bard answered `@1/tools` with three instruments still grants all three (Task 1).
2. A legacy Soldier character's sheet differs ONLY by the removed generic `gaming-set` proficiency row — every other path byte-identical (Task 2, scripted over the 32 Soldier goldens).
3. Slippers of Spider Climbing in inventory, equipped but NOT attuned → no climb speed; attuned → climb = walk; a non-attunement item's effects still activate on equip alone (Task 3).
4. `character.options.set {encumbrance:'variant'}` on a solo character yields `sheet.carry` with the variant thresholds; the same character inside a campaign whose house rule says `off` yields no carry and provenance names the house rule (Task 5).
5. A ranger whose Rogue Expertise already covers Stealth is NOT offered Stealth in `ranger@2/expertise`, and a hand-built decision selecting it is refused with `selection.notOffered` (Task 4).

---

### Task 1: Choice scope (`initial` / `later`) + multiclass tool gains

**Files:**
- Modify: `packages/protocol/src/pack/choice.ts` (additive `scope`), `packages/protocol/src/pack/entities-progression.ts:45-48` (additive `toolProficiencies`), `packages/protocol/schema/pack-v1.json` (regenerated)
- Modify: `packages/engine/src/derive/choices.ts:94-108` (scope filter in `collectRows`/`levelScopedChoices`; slug fallback kept), `packages/engine/src/derive/proficiency.ts:28-43` (later class grants `gains.toolProficiencies`), `packages/engine/src/content/validate.ts` (a `scope` on a non-`classLevel` choice is a pack diagnostic `choice.scopeOnNonClassChoice`)
- Modify: `packages/content/src/overlays/bard.json:39-55` (`scope:'initial'` + new `bard@1/multiclass-tools` count 1 `scope:'later'`), `monk.json:20-54` (`scope:'initial'`), `rogue.json:9` + class `multiclass.gains.toolProficiencies: ['thieves-tools']`, and `scope` on every class's `@1/skills` (`initial`) and `@1/multiclass-skills` (`later`)
- Test: `packages/engine/test/derive/choice-scope.test.ts` (new), `packages/content/test/multiclass-tools.test.ts` (new), `packages/protocol/test/choice.test.ts` (scope accepted; `pack.test.ts` gains fixture)

**Interfaces:** Produces `Choice.scope?: 'initial'|'later'` and `MulticlassGains.toolProficiencies: string[]` (default `[]`) for Tasks 2, 7.

- [ ] Step 1: Verify the vendored multiclassing proficiency rows for bard, monk, rogue (`ClassFeature.json` / `Rule.json` `srd-2024_multiclassing_proficiencies` and each class's multiclassing text); quote them in the report. Decide `bard@1/multiclass-tools` existence per ruling 2.
- [ ] Step 2: RED protocol tests: `scope` parses; `toolProficiencies` default `[]`; existing fixtures unchanged. RED engine tests (synthetic mini pack): `initial` choice offered for class[0] only; `later` for class[1] only; absent → both; slug fallback still splits skills when `scope` absent; later class gains `toolProficiencies` as `kind:'tool'` rows.
- [ ] Step 3: Protocol + `build:schema` same commit; engine implementation; GREEN.
- [ ] Step 4: Content retrofit per ruling 2; RED→GREEN content test over the real pack: initial bard offered `@1/tools` (3) and NOT `@1/multiclass-tools`; later bard (rogue→bard) offered `@1/multiclass-tools` (1) and NOT `@1/tools`; later monk offered no tool pick; later rogue has `thieves-tools` row; legacy replay: a later-class bard log with `@1/tools` answered ×3 still grants 3 (Review Focus 1).
- [ ] Step 5: Gates (`pnpm check`, engine build → pack 1866/0, goldens 63/63 — `multi-rogue3-bard2` must stay byte-identical: its bard answered nothing); commits `feat(protocol): choice scope and multiclass tool gains`, `feat(engine): scope-aware class choices`, `feat(content): later-class tool proficiencies`.

### Task 2: Mixed-type picks — Skilled (skills or tools) + Soldier gaming set

**Files:**
- Modify: `packages/protocol/src/pack/choice.ts:44-59,82-106` (additive `EntityQuerySchema.category`, `PickSchema.queries`), schema regenerated
- Modify: `packages/engine/src/content/index.ts:36` (query evaluator honors `category`), `packages/engine/src/derive/validation.ts:134-160` (`queryPickOptions` unions `queries`; `selection.count` over the union), `packages/engine/src/derive/abilities.ts:122-140` + `derive/index.ts:139-147` (unchanged grant paths — confirm both fire for one mixed decision)
- Modify: `packages/content/src/overlays/feats.json:61-83` (Skilled → `queries`; text fallback removed; note updated), `packages/content/src/transform/backgrounds.ts:43-48,95` (Soldier: no `toolProficiency`), `packages/content/src/overlays/backgrounds.json` (Soldier `@0/tools` static pick over `srd-5e-2024:item/gaming-set-{dice,dragonchess,playing-cards,three-dragon-ante}`, count 1)
- Modify: web `apps/web/src/app/views/characters/create-wizard/steps/choice-step.component.ts` + `entity-picker` only if a `queries` pick does not already render through the query path (verify first; the picker lists entities by id — mixed types should need no change)
- Test: `packages/content/test/mixed-picks.test.ts` (new), engine `test/derive/queries-pick.test.ts` (new), protocol tests; golden re-pins per ruling 3

**Interfaces:** Consumes Task 1's `scope` only indirectly (Soldier pick is a background choice, no scope). Produces `Pick.queries?: EntityQuery[]`, `EntityQuery.category?` for Task 7 goldens.

- [ ] Step 1: Verify vendored `srd-2024_skilled_1` ("three skills or tools") and `srd-2024_soldier_tool-proficiencies` ("one kind of Gaming Set"); quote.
- [ ] Step 2: RED protocol (`queries` ⊕ `static` ⊕ `query` exclusive; `category` enum = item category) and engine tests: `queryPickOptions` of `queries:[skill, item category tool]` returns 18 skills + every tool item once; count 3 over the union; a decision of 2 skills + 1 tool grants 2 skill rows + 1 tool row.
- [ ] Step 3: Implement; GREEN; `build:schema` same commit.
- [ ] Step 4: Content: Skilled + Soldier per ruling 3. Content test: Skilled offers skills and tools, mixed decision grants both; Soldier offers exactly the 4 gaming sets, decision grants `kind:'tool'` row `gaming-set-dice`, no generic `gaming-set` row remains. Legacy script (Review Focus 2): derive all 32 Soldier goldens before/after — assert the ONLY diff is the removed `gaming-set` row (and index shifts of the rows after it); re-pin those fixtures with `note: "plan-14 task 2: Soldier generic gaming-set row replaced by the @0/tools pick"`.
- [ ] Step 5: Gates; commits `feat(protocol): mixed-type picks`, `feat(engine): union pick options`, `feat(content): skilled tools and soldier gaming set`, `test(engine): re-pin soldier goldens`.

### Task 3: Magic item effects overlay + attunement gating + Second-Story Work

**Files:**
- Create: `packages/content/src/overlays/items.json`; Modify: `packages/content/src/overlays/load.ts:2-19`
- Modify: `packages/engine/src/derive/composition.ts:252-255` (attunement gate per ruling 5), `packages/content/src/overlays/rogue.json:349-361` (Second-Story Work climb + note)
- Test: `packages/content/test/item-effects.test.ts` (new), `packages/engine/test/derive/attunement-gating.test.ts` (new)

**Interfaces:** Consumes plan-13 `speed.bonus` formula values, `speed(walk)`, key convention; `spell.grant.uses` inline form. Produces attunement-gated effects for Task 7's golden.

- [ ] Step 1: Verify vendored texts for `srd-2024_gloves-of-swimming-and-climbing`, `srd-2024_slippers-of-spider-climbing`, `srd-2024_cloak-of-arachnida`, `srd-2024_rogue_thief_second-story-work`; confirm the `uses.per` enum and the Web spell id; quote.
- [ ] Step 2: RED engine test: attunement-required item equipped-not-attuned → effects inactive; attuned → active; non-attunement item equipped → active (Review Focus 3). RED content test over the real pack: Slippers attuned → `sheet.speeds.climb == walk`; Gloves attuned → climb+swim = walk and Athletics +5; Cloak attuned → poison resistance + Web spell with 1 use; Thief 3 → climb = walk.
- [ ] Step 3: Engine gate; items overlay + rogue overlay; engine build → pack (1866 entities, 0 diagnostics — the overlay patches existing items); GREEN.
- [ ] Step 4: Gates; goldens 63/63 byte-identical (no attuned fixture exists — state it); commits `fix(engine): gate attunement item effects on attuned`, `feat(content): magic item speed and resistance effects`.

### Task 4: Expertise eligibility across owners + multiclass weapon mastery

**Files:**
- Modify: `packages/engine/src/derive/validation.ts:134-145` (expertise picks exclude expertise-rank skills), `packages/engine/src/derive/abilities.ts:281-286` (eligibility same rule), `packages/engine/src/derive/attacks.ts:105-138,213-219` (`masteryCount = max`; honor all mastery choices in class order up to the cap)
- Modify: `packages/content/src/overlays/ranger.json:47-52,95,229` notes
- Test: `packages/engine/test/derive/expertise-eligibility.test.ts` (new), `packages/engine/test/derive/mastery-multiclass.test.ts` (new), `packages/content/test/expertise-cross-class.test.ts` (new)

**Interfaces:** Produces the eligibility rule Task 7 pins (rogue3/ranger2 golden) and `sheet.masteryCount` semantics for the fighter5/barbarian3 golden.

- [ ] Step 1: Confirm the vendored multiclassing rules are silent on Weapon Mastery (quote the `srd-2024_multiclassing_class-features` text) → record the owner-flag per ruling 7.
- [ ] Step 2: RED: rogue 1 (Stealth expertise) → ranger 2 `@2/expertise` options exclude Stealth; a decision selecting Stealth → `selection.notOffered`; a legacy log with that decision keeps Stealth at expertise and reports the issue (Review Focus 5). RED mastery: fighter 5 / barbarian 3 → `masteryCount == 3` (max(3,2)), selections from both choices honored up to 3 in class order; single-class fixtures unchanged (goldens).
- [ ] Step 3: Implement; GREEN; content test over the real pack for the ranger case; ranger.json notes updated.
- [ ] Step 4: Gates; goldens 63/63 (any multiclass fixture with two mastery choices moves → justified re-pin); commits `fix(engine): expertise eligibility across classes`, `fix(engine): multiclass weapon mastery cap`.

### Task 5: Per-character rule options (encumbrance) — event, derive precedence, Build-tab UI

**Files:**
- Modify: `packages/protocol/src/events/character.ts` (additive `CharacterOptionsSetV1 = { encumbrance?: 'off'|'standard'|'variant' }`, registered `character.options.set@1`, owner-only), schema/types
- Modify: `packages/engine/src/reduce/facts.ts` (`options: CharacterOptions` default `{}`), `packages/engine/src/reduce/handlers/identity.ts` (merge handler), `packages/engine/src/derive/index.ts:272-276,324-325` + `derive/overrides.ts` (precedence per ruling 8; provenance `'character option'`), `packages/engine/src/propose/` (new `setOptions(sheet, patch): EventInput[]`)
- Modify: web Build tab (`apps/web/src/app/views/characters/sheet/build/`): new "Options" section with the encumbrance select (reuse the campaign labels' wording via NEW `characters.sheet.options.*` keys ×3), `character.store.ts:183-190` passes options through `derive` (facts already carry them), timeline sentence key `characters.timeline.character-options-set` ×3
- Test: protocol event test, `packages/engine/test/reduce/options.test.ts` (new), `packages/engine/test/derive/encumbrance.test.ts` (precedence cases), web build-tab spec + timeline pipe spec

**Interfaces:** Produces `Facts.options`, `propose.setOptions`, provenance literal `'character option'` for Task 7 golden + Task 8 e2e.

- [ ] Step 1: RED protocol (event parses, unknown key rejected, empty object allowed); RED reducer (merge, last write wins per key); RED derive: options variant → `sheet.carry` with variant thresholds; overrides `off` beats options `variant` and provenance says `'house rule'`; options alone → `'character option'` (Review Focus 4).
- [ ] Step 2: Implement protocol + schema same commit; reducer + derive + propose; GREEN.
- [ ] Step 3: RED web spec: Build tab shows the select with the current value; changing it commits exactly one `character.options.set@1`; timeline renders the sentence. Implement; i18n ×3; GREEN.
- [ ] Step 4: Gates incl. `pnpm --filter web build`; goldens 63/63 (solo default unchanged); commits `feat(protocol): character rule options event`, `feat(engine): per-character encumbrance option`, `feat(web): character options in build tab`.

### Task 6: Display polish — regain counts, provenance numbers, seeded count diagnostic, mastery names

**Files:**
- Modify: `packages/engine/src/derive/modifiers.ts:4-11,86` (`Contribution.amount` resolved for formula entries, `formula` kept), `apps/web/src/app/shared/directives/derived-popover.directive.ts:76-79`
- Modify: `apps/web/src/app/views/characters/sheet/timeline/event-sentence.pipe.ts:90-150` + i18n (`resource-restored` with `{count}` variant; `item:<uuid>` → item instance name from the sheet)
- Modify: `apps/web/src/app/views/characters/create-wizard/steps/choice-step.component.ts:235-241` (validate the seeded selection so `selection.count` shows before the first toggle; no decision committed)
- Modify: `apps/web/src/app/views/characters/sheet/play/play-tab.component.html:367` (mastery name through the Localizer if a `rule`/`tool` entity exists for the mastery slug — VERIFY in the pack; if none exists, leave the slug and record an owner-flag: masteries need pack entities)
- Test: engine `modifiers` test (amount resolved), web popover spec, timeline pipe spec, choice-step spec (seeded 3-of-4 shows the count message immediately; `fw`-era level-up spec still passes)

**Interfaces:** Consumes Task 5's timeline key convention. Produces `Contribution.amount?: number` (always set when `formula` is set).

- [ ] Step 1: RED engine: a formula contribution resolves `amount` equal to the evaluated value; goldens diff script shows no pinned path serializes contributions (else justified re-pin).
- [ ] Step 2: RED web: popover shows `+10` for the monk walk formula contribution (formula as title); timeline shows "Restored 2 charges of Wand of X" shape per i18n; seeded choice step shows the count diagnostic before any click.
- [ ] Step 3: Implement; i18n ×3; GREEN.
- [ ] Step 4: Gates; commits `feat(engine): resolved amounts in provenance`, `feat(web): regain counts, provenance numbers, seeded count message`.

### Task 7: Goldens + perf

**Files:** `packages/engine/test/golden/` + `derive-perf.test.ts` fixture list + `PERF.md` only.

- [ ] Step 1: New goldens (hand table per fixture in the report): `multi-rogue3-bard2-tools` (later bard: one instrument answered; tool rows pinned), `soldier-gaming-set` (background pick answered; tool row pinned), `skilled-mixed` (Skilled with 2 skills + 1 tool), `thief-3-climb` (climb = walk), `attuned-slippers` (equipped-only vs attuned pair in one fixture via two inventory entries or two fixtures), `multi-rogue3-ranger2-expertise` (eligibility: Stealth excluded; a different skill at expertise), `multi-fighter5-barbarian3-mastery` (count 3, honored picks), `encumbrance-variant-option` (options.set → carry state). Existing fixtures byte-identical beyond Task 2's justified Soldier re-pins.
- [ ] Step 2: Mutation check: one wrong value per new fixture → exactly those fail (evidence file).
- [ ] Step 3: Perf (`HK_RECORD_PERF=1`) on the heaviest new golden → PERF.md; verdict vs 15 ms.
- [ ] Step 4: Gates; commit `test(engine): slice 4 goldens and perf`.

### Task 8: e2e + docs wrap

**Files:** new offline e2e `apps/web/e2e/create-soldier-options.spec.ts` (Soldier through the real wizard: gaming-set pick → sheet Tools shows the chosen set; Build tab Options → variant → carry state visible); docs: doc-04 (choice `scope`, `queries` + `category`, items overlay, attunement gating, cross-class expertise rule, mastery cap owner-flag), doc-02 (`character.options.set@1`), doc-05 (options precedence), `README.md` slice-4 section (source-verified numbers), `docs/manual-device-checklist.md` section 8d, this plan's STATUS → EXECUTED.

- [ ] Step 1: e2e red-first (deliberate assertion mutation if it passes on first valid run); offline suite 27/27; e2e:sync ONE pass (pack shape changed).
- [ ] Step 2: Docs (claims cited to task reports); gates.
- [ ] Step 3: Commits `test(web): slice 4 e2e`, `docs(repo): phase 4 slice 4 wrap`.

---

## Self-review (performed at write time)

- **Carry coverage:** every plan-13 carry has an owner — later-class tools (T1), Soldier gaming set + Skilled tools (T2), "= your Speed" items + Second-Story Work + attunement gating (T3), cross-class expertise + multiclass mastery (T4), per-character encumbrance (T5), regain counts + provenance numbers + seeded count message + mastery slug display (T6), goldens incl. the brittle-pin follow-ups (T7), docs/e2e (T8). Deferred to plan 15 with the pack platform: pack-tools guard for unsatisfiable `abilities.from` (pack-tools work), level-ordered reset merge (no consumer), golden index brittleness (accepted), play-tab comment tidy (:898/:926 — fold into T6's touch of play-tab if trivial).
- **Step scan:** every verify-first step is a report gate with the vendored pk named; the two owner-flags (ruling 7 mastery cap; T6 mastery names) are explicit.
- **Type consistency:** `scope` (T1) is a choice field, never a pick field; `queries` (T2) is a pick field; `Facts.options` / `propose.setOptions` / `'character option'` literal used identically in T5, T7, T8; `Contribution.amount` (T6) only.
- **Review Focus:** five lines, each pinned in its owning task (T1, T2, T3, T5, T4).
- **Proportion:** ~200 lines for ~8 multi-file tasks; no code bodies beyond JSON shapes the implementer could not infer.
