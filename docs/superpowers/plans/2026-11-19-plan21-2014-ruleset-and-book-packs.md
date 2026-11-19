# Plan 21 — 5e 2014 as the Default Ruleset, with Built-in Book Packs, Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**STATUS: WRITTEN 2026-11-19, not started. Runs after plan 20; plan 22 (full ru/uk translation) follows and translates what this plan builds.**

**Goal:** New heroes and campaigns use D&D 5e (2014 rules) by default — the SRD 5.1 core plus the player options of the original books (Player's Handbook 2014; Xanathar's Guide; Sword Coast Adventurer's Guide; Volo's Guide and Mordenkainen's Tome races; Elemental Evil Player's Companion) as built-in packs that are always on, and Tasha's Cauldron of Everything as a built-in pack the user can turn off, remove and restore. The 2024 rules stay available as a Settings switch.

**Architecture:** This is Phase 6 ("second ruleset") pulled forward and widened. `@hk/content` builds two core packs (`srd-5e-2014` from the MIT-licensed 5e-database `src/2014`, and the existing `srd-5e-2024`) and the built-in book packs (`kind: content`, `system: 5e-2014`, depending on the 2014 core) from hand-authored JSON. Protocol changes are optional fields only (subraces, 2014-shaped backgrounds). The web loads the core matching each hero's stored `system`, ships the built-in packs in `public/packs/`, and installs them on first run.

**Tech Stack:** `@hk/content` transforms + overlays (Node, Vitest), Zod pack schemas + JSON-schema drift gate, `@hk/engine` goldens, `pack-tools validate`, Angular 22 web (`PackStore`, Dexie), Playwright.

**Spec:** memory `plans-20-22-owner-decisions` (owner answers of 2026-11-19); `docs/03-roadmap/phases.md` Phase 6 row; ADR-004 (entry modes), ADR-008 (extension format: 2014 composition slots race ×1, subrace ×0–1, background ×1), ADR-013 ("two rulesets without special cases"); `docs/04-reference/srd-content-and-licensing.md:51-58` (5e-database 2014 source); `docs/04-reference/legal-attribution.md:19-27` (SRD 5.1 attribution); `docs/04-reference/content-inventory-2026-11.md` (research input — its lists are partly from memory and must be verified, see Task 9).

## Owner decisions this plan implements (2026-11-19)

1. The **2014 rules are the default**. The 2024 rules stay in the app, switchable in Settings; heroes keep the ruleset they were created with.
2. Content comes from the **original D&D books**, not from Baldur's Gate 3 (BG3 was an example of the breadth wanted; its options were adapted for the game). Scope is every player option of the books listed in the Goal: classes' subclasses, races and subraces, backgrounds, feats, spells, optional class features, and the Artificer (Tasha's).
3. Book packs are built in. PHB 2014, Xanathar's, SCAG, Volo's, Mordenkainen's Tome and Elemental Evil are always on, like the core. **Tasha's** is a built-in pack that can be disabled, removed and restored.
4. The repo stays **public**. Text rule (ADR in Task 1): SRD 5.1 text is used as published (CC-BY-4.0, attributed). For every non-SRD option, names, numbers and mechanics are exact, and the description is written in our own words — complete enough to play from, with no sentence copied from a book or a fan site (dnd.su, wikis).

## Global Constraints

- Game rules are data (CLAUDE.md rule 1): no 2014 rule in TypeScript. Where the engine assumes a 2024 shape (background `originFeat`, background `abilityScores`), make it data-driven, not edition-branched.
- Pack schema additions are `.optional()` only; every existing pack parses unchanged; `pnpm --filter @hk/protocol build:schema` after each schema change.
- Events are immutable; hero identity already stores `system` (`packages/engine/src/reduce/handlers/identity.ts:29`) — existing 2024 heroes keep loading the 2024 core.
- Never edit `dist/` by hand: `pnpm --filter @hk/content build:pack` regenerates every pack.
- Every pack passes `node packages/pack-tools/dist/cli.js validate <pack> --packs <dir>` and `PACK_LIMITS` (5 MB, 5000 entities, `packages/protocol/src/pack/pack.ts:7-13`) — split a book into two packs if it would exceed them.
- Entity ids: `<pack-id>:<type>/<slug>`, slugs from the English name (kebab-case). Book pack ids: `phb-2014`, `xanathars-guide`, `sword-coast-guide`, `volos-guide`, `mordenkainens-tome`, `elemental-evil`, `tashas-cauldron`.
- Each entity's `source: { book, page }` names its real book and page.
- i18n: new UI strings ×3; content text stays English here (plan 22 translates).
- TDD; Conventional Commits with scope; gates per task: `pnpm typecheck`, `pnpm vitest run --project <pkg>`; web tasks also `pnpm --filter web test --watch=false` and `build`.

## Review Focus

1. A 2024 hero created before this plan opens, levels up and syncs unchanged after the default switches to 2014 (Task 6 e2e with a stored 2024 fixture).
2. A hero uses a Tasha's subclass, then the user disables or removes Tasha's: the hero still opens and derives (pinned pack kept or a clear "pack missing" state, never a crash or silent data loss); Restore brings it back (Task 8 test).
3. A 2014 player joins a campaign whose DM runs 2024 (or the reverse): the join picker offers only heroes of the campaign's ruleset and says why others are hidden (Task 7 test).
4. A subrace whose parent race is unpicked or changed: the subrace choice clears and the derive drops its grants (Task 3 golden).
5. A built-in pack update in a new app version (pack 0.1.0 → 0.2.0): heroes pinned to 0.1.0 get the normal plan-15 rebase offer, not a forced change (Task 8 test).

---

## Part A — Platform

### Task 1: ADR-015 and roadmap

**Files:** Create `docs/01-decisions/ADR-015-2014-default-ruleset-and-book-packs.md`; modify `docs/03-roadmap/phases.md` (Phase 6 row: "pulled forward into plan 21; 2014 is the default ruleset"), `docs/04-reference/srd-content-and-licensing.md` (book-pack text rule), `docs/02-architecture/04-content-packs.md` (built-in packs section).

- [ ] **Step 1:** Write the ADR in the house format (context / decision / consequences / alternatives): the four owner decisions above; built-in pack model (Task 8); why the 2024 core stays; the text rule; ADR-004's "5e-2014 later" ordering superseded (ADR-004 is not edited).
- [ ] **Step 2:** Commit — `docs(repo): ADR-015 2014 default ruleset and built-in book packs`.

### Task 2: Vendor the SRD 5.1 data

**Files:** Create `packages/content/upstream/5e-database-2014/` (the `src/2014/*.json` files of `5e-bits/5e-database` at a pinned commit, plus `SOURCE.md`: repo URL, commit SHA, date, MIT licence text, SRD 5.1 CC-BY-4.0 note); `packages/content/test/upstream-2014.spec.ts`.

- [ ] **Step 1: Failing test** — the snapshot has 12 classes, 12 subclasses, 9 races, the expected subraces (hill dwarf, high elf, lightfoot halfling, rock gnome), 1 background (Acolyte), 1 feat (Grappler), 319 spells; `SOURCE.md` names a 40-hex commit.
- [ ] **Step 2:** Download at a commit at least two weeks old; record it. **Step 3:** PASS. **Commit** — `chore(content): vendor 5e-database 2014 SRD snapshot`.

### Task 3: Protocol — subraces and 2014 backgrounds

**Files:** Modify `packages/protocol/src/pack/entities-simple.ts` (`SpeciesEntitySchema` `:168-172`, `BackgroundEntitySchema` `:174-180`, `SystemEntitySchema` composition slots `:16-60`); regenerate schema; tests in `packages/protocol/test/`.

**Interfaces:**
- Produces:
  - `SpeciesEntitySchema.parent?: EntityId` — a subrace names its race (a species entity without `parent` is a race).
  - Composition slot gains `min?: int` (default `count`) and `parentSlot?: string` — options are species whose `parent` is the entity chosen in that slot; the slot is required (`min 1`) only if any such option exists. The 2014 system declares `{ id: 'race', entityType: 'species', count: 1 }` and `{ id: 'subrace', entityType: 'species', count: 1, min: 0, parentSlot: 'race' }`.
  - `BackgroundEntitySchema.abilityScores` and `.originFeat` become optional (2014 backgrounds have neither; their feature is a granted `feature` entity, skills/tools as today).

- [ ] **Step 1: Failing tests** — a subrace with `parent` parses; a slot with `min: 0, parentSlot` parses; a background without `abilityScores`/`originFeat` parses; every current 2024 fixture still parses byte-identically.
- [ ] **Step 2: Implement; `build:schema`. Step 3:** PASS. **Commit** — `feat(protocol): subraces and backgrounds without origin feats`.

### Task 4: Engine — data-driven composition for both rulesets

**Files:** Modify `packages/engine/src/derive/composition.ts:219-224` (activate `originFeat` only when present), `derive/abilities.ts:81-117` (background ability constraint only when `abilityScores` present), `derive/choices.ts` / `validation.ts:256-320` (subrace slot: options filtered by `parentSlot`, cleared when the parent changes), `content/refs.ts:12,66`; goldens in `packages/engine/test/golden/`.

- [ ] **Step 1: Failing goldens** using a minimal 2014 fixture pack in `packages/engine/test/fixtures/` (one race with two subraces, an Acolyte-shaped background, a class with `subclassLevel: 1`): hill dwarf gets +2 CON (race) and +1 WIS (subrace) via effects; switching race to elf drops the subrace and its grants; the background grants its feature, no feat; a level-1 subclass is offered at level 1.
- [ ] **Step 2: Implement. Step 3:** all existing goldens unchanged, new ones PASS; perf note in `PERF.md` unchanged. **Commit** — `feat(engine): subraces and optional origin feats from data`.
- [ ] **Step 4:** Spellcasting rounding: confirm the multiclass and half-caster slot rules come from the system tables (`04-content-packs.md:285-293`); if a 2014 rule cannot be expressed, add the smallest optional vocabulary field with a golden, as its own commit.

### Task 5: The 2014 core pack build

**Files:** Modify `packages/content/src/version.ts` (per-core config), `src/build.ts:53-96` (build each core), `src/cli.ts`, `src/static/attribution.ts` + `static/system.ts` (per core); create `packages/content/src/srd-2014/` (transforms: system, abilities, skills, conditions, languages, rules, races + subraces, background, feat, classes, subclasses, features, spells, items, magic items) and `src/srd-2014/overlays/` (mechanics the source data does not carry, as the 2024 overlays do); tests `packages/content/test/srd-2014/*.spec.ts`; golden heroes `packages/engine/test/golden/2014/`.

**Interfaces:**
- Produces: `CORES = [{ packId: 'srd-5e-2014', version: '0.1.0', systemId: '5e-2014', source: 'SRD 5.1' }, { packId: 'srd-5e-2024', version: '0.1.0', systemId: '5e-2024', source: 'SRD 5.2.1' }]`; output `dist/packs/srd-5e-2014/0.1.0/pack.json`. The 2024 pack output must stay byte-identical (test).

Split in dispatches; each ends green and committed:
- [ ] **5a** system entity (2014 XP, proficiency, spell-slot tables, multiclass prerequisites, composition slots of Task 3, no weapon mastery), abilities, skills, conditions (2014 has exhaustion as 6 levels with listed effects — data), languages, rules. Test counts + `validate`. `feat(content): 2014 core system and rules`.
- [ ] **5b** races and subraces (ability increases, traits as features with effects), Acolyte, Grappler. Goldens: hill dwarf cleric 1, high elf wizard 1. `feat(content): 2014 races, subraces, background and feat`.
- [ ] **5c–5f** classes to 20 with their SRD subclass, three classes per dispatch (c: barbarian/bard/cleric, d: druid/fighter/monk, e: paladin/ranger/rogue, f: sorcerer/warlock/wizard). Reuse 2024 overlay patterns for shared mechanics; 2014 differences are data (e.g. cleric/sorcerer/warlock subclass at 1, wizard at 2, druid at 2; 2014 ranger features; warlock invocations and pact boons). One golden per class at levels 1, 3, 11, 20. `feat(content): 2014 <classes> to 20`.
- [ ] **5g** spells (319), items, magic items; `validate`; perf check (derive median of the 2014 goldens < 15 ms budget, recorded in `PERF.md`). `feat(content): 2014 spells and items`.

### Task 6: Web — one core per ruleset, the Settings switch

**Files:** Modify `apps/web/src/app/shared/services/engine/pack-loader.ts:26` (`loadCore(systemId)` from a generated `public/packs/cores.json` index), `apps/web/tools/copy-packs.ts` (copy both cores + the index), `shared/stores/pack.store.ts:40-120` (cores keyed by system; content packs validated against the core of their `system`), the hero session (load the core of the hero's stored `system`), `views/settings/` (a "Rules edition" choice: "D&D 5e (2014)" default, "D&D 5e (2024)"), `create-wizard.state.ts` and `views/campaigns/create/create-campaign-dialog.component.ts:17-21` (use the setting), the library (shows the setting's ruleset, with a switch chip), the attribution screen (add the SRD 5.1 statement from `legal-attribution.md:19-27`), test fixture `views/characters/sheet/testing/character-fixtures.ts:18`.

**Interfaces:**
- Produces: `RulesetService` (root) — `readonly current: Signal<'5e-2014' | '5e-2024'>`, `set(id)`; device-local setting, default `'5e-2014'`; `PackStore.core(systemId): Signal<LoadedPack | null>`.

- [ ] **Step 1: Failing tests** — fresh device: wizard, campaign creation and library use 2014; switching to 2024 changes all three; an existing 2024 hero fixture opens, levels up and exports with the 2024 core while the setting is 2014 (e2e). Only the core of a used ruleset is fetched (lazy).
- [ ] **Step 2: Implement** in two commits (store/loader, then UI). **Step 3:** web unit + e2e + text-fit PASS; gzip budget held (cores are fetched, not bundled). `feat(web): 2014 is the default rules edition; 2024 is a setting`.

### Task 7: Campaigns carry the ruleset

**Files:** `views/campaigns/` join flow and hero picker, `apps/api/src/core/routes/campaigns.ts:14-26` (unchanged shape; add a conformance test that `corePack.id` round-trips for `srd-5e-2014`), campaign settings (pack toggles list the 2014 book packs; Tasha's toggle).

- [ ] **Step 1: Failing tests** — joining a 2014 campaign lists only 2014 heroes and explains hidden ones; creating a new hero from the join flow uses the campaign's ruleset regardless of the device setting; the DM can enable/disable Tasha's for the campaign through the existing pack-enable flow.
- [ ] **Step 2: Implement. Step 3:** PASS incl. `e2e:sync` and `pnpm --filter api test` + `test:cloudflare`. `feat(web): campaigns keep heroes to their rules edition`.

### Task 8: Built-in packs

**Files:** `packages/content/src/books/` (authoring root, one folder per pack id, Part B fills them), build emits `dist/packs/builtin.json` = `[{ id, version, system, removable }]`; `apps/web/tools/copy-packs.ts`; `shared/stores/pack.store.ts` (install built-ins on init unless the user removed them; disabled/removed flags in Dexie settings — no new table), `views/packs/` (built-in badge; for `removable` packs: Disable / Enable / Remove / Restore; others show "Included"), the per-hero content (new heroes of a ruleset pin every enabled built-in pack of it, via the plan-15 pin mechanism).

**Interfaces:**
- Produces: `BuiltinPackEntry { id: string; version: string; system: string; removable: boolean }`; `PackStore.builtinState(id): 'enabled' | 'disabled' | 'removed'`; `restoreBuiltin(id)`.

- [ ] **Step 1: Failing tests** — first run installs all built-ins; Tasha's Disable hides its options from new choices but a hero who uses them still derives; Remove keeps the pinned copy for heroes that use it (existing dependent check, `pack.store.ts:18-27`) or removes it when unused; Restore reinstalls from the bundled file; a newer bundled version triggers the normal update offer, not a silent rebase; non-removable packs show no Remove.
- [ ] **Step 2: Implement** (stub `tashas-cauldron` with one test entity until Part B). **Step 3:** PASS. `feat(web): built-in book packs; Tasha's can be disabled, removed and restored`.

## Part B — Book content (own-words descriptions, exact mechanics)

Rules for every content task: read `docs/04-reference/book-packs-authoring.md` (written in Task 9); names, numbers, levels, ranges, damage, prerequisites exact; descriptions in our own words (no copied sentence — reviewer rejects copied text); `source.page` set; each subclass gets a golden at its feature levels; each dispatch ≤ ~3 subclasses or ~40 spells or ~15 feats, committed green; `validate` passes; `build:pack` regenerated.

### Task 9: Verified inventory and authoring guide

**Files:** Create `docs/04-reference/book-packs-inventory.md` (per pack: subclasses by class, races/subraces, backgrounds, feats, spells by level, optional class features — names, book, page, which are already in SRD 5.1), `docs/04-reference/book-packs-authoring.md` (text rule, id rules, how to express common 2014 mechanics with the existing vocabulary, review checklist).

- [ ] **Step 1:** Verify each list against at least two independent sources (official D&D Beyond source listings and a reference wiki); `content-inventory-2026-11.md` is a starting point only — its PHB 2024 rows and Tasha's lists were from memory. Record conflicts.
- [ ] **Step 2:** Mark per item: "SRD 5.1 (core)", "book pack", or "skip (not a player option)". Commit — `docs(content): verified 2014 book-pack inventory and authoring guide`.

### Tasks 10–15: One pack per task, dispatched in batches

Order (players' value first). Each task: build the pack folder, entities in batches as above, a pack test (counts equal the Task 9 inventory; every id resolves; `validate`), goldens, commit per batch `feat(content): <pack> <batch>`.

- [ ] **Task 10 — `phb-2014`:** the PHB options outside SRD 5.1 — subclasses (e.g. Path of the Totem Warrior, College of Valor, the other six domains, Circle of the Moon, Battle Master and Eldritch Knight, Way of Shadow and of the Four Elements, Oaths of the Ancients and of Vengeance, Beast Master, Assassin and Arcane Trickster, Wild Magic, Archfey and Great Old One, the seven other schools), subraces (mountain dwarf, wood elf, drow, stout halfling, forest gnome), backgrounds, feats, spells. Variant human (feat at 1) is a race option here.
- [ ] **Task 11 — `xanathars-guide`:** subclasses, racial feats, spells.
- [ ] **Task 12 — `tashas-cauldron`** (removable): subclasses, Artificer class to 20 with its subclasses, optional class features (as opt-in choices at their levels), feats, spells, customizing your origin (as a race-level choice that moves ability increases — data, not code).
- [ ] **Task 13 — `sword-coast-guide`:** subclasses, subraces (duergar, svirfneblin, ghostwise halfling, half-elf and tiefling variants), backgrounds, cantrips.
- [ ] **Task 14 — `volos-guide` and `mordenkainens-tome`:** races and subraces (aasimar, firbolg, goliath, kenku, lizardfolk, tabaxi, triton, …; githyanki, githzerai, eladrin, sea elf, shadar-kai, tiefling legacies, …) — exact list from Task 9.
- [ ] **Task 15 — `elemental-evil`:** races (aarakocra, genasi, …) and spells.

### Task 16: QA gate and handoff

- [ ] Root `pnpm check`, all web e2e projects, `e2e:sync`, `test:cloudflare`; pack sizes and counts table; perf numbers; build a hero of every class + one subclass from each pack by hand in the app (screenshots to `visual-check`).
- [ ] Update `phases.md`, `docs/README.md` (two rulesets), release note in `03-sync-protocol.md` if older clients reject `srd-5e-2014` or the new optional fields (they will: strict schemas — document "update the app before joining a 2014 campaign").
- [ ] Commit — `docs(repo): plan 21 wrap`.
