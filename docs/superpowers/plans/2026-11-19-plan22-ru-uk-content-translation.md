# Plan 22 — Full Russian and Ukrainian Content Translation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**STATUS: WRITTEN 2026-11-19, not started. Runs after plan 21 (it translates the 2014 core and the book packs plan 21 builds).**

**Goal:** Every piece of game content the app ships — the SRD 5.1 core, the built-in book packs, and (last) the SRD 5.2.1 core — reads fully in Russian and Ukrainian, with the terms players already know, and the build fails if a shipped string is missing or out of date.

**Architecture:** The Phase 5 "RU/UK content translation pipeline" item. Translations are `kind: translation` packs (existing format: `strings` keyed `<type>/<slug>` → `{ field: text }`, per-field English fallback in the engine Localizer, `packages/engine/src/i18n/localizer.ts:31-50`). Sources live under `packages/content/translations/<pack-id>/<locale>/<type>.json`, each entry stamped with a hash of its English source so changes to English show up as stale. `pack-tools` gains `translate extract` and `translate check`; a fixed glossary per locale keeps terms consistent. Agents translate in batches; the owner reviews samples. Built-in translation packs ship with the app and install automatically.

**Tech Stack:** `@hk/pack-tools` CLI (Node, Vitest), `@hk/content` build, protocol translation-pack schema (unchanged), Angular web `PackStore` + engine search (`packages/engine/src/i18n/search.ts:39`).

**Spec:** memory `plans-20-22-owner-decisions`; `docs/03-roadmap/phases.md` Phase 5 row ("RU/UK content translation pipeline + first translated packs, in-app 'suggest a translation fix' export"); ADR-009 (i18n); `docs/02-architecture/04-content-packs.md:686-697` (translation packs); `docs/04-reference/content-inventory-2026-11.md` §5 (translation sources and their licences); open question V9 in `docs/04-reference/open-questions.md`.

## Owner decisions and the text rule

- Full en/ru/uk for all shipped content. The owner asked to reuse existing fan translations (dnd.su, 5esrd.kyiv.ua). Their sentences are their translators' copyrighted work (dnd.su states no reuse licence; 5esrd.kyiv.ua claims its translation as protected), and this repo is public, so **we translate the text ourselves** from our English source: the SRD is CC-BY-4.0 (translation allowed, with attribution and a "translated" notice), and the book-pack descriptions are our own words (plan 21).
- **Terms** (names of classes, subclasses, spells, races, skills, conditions, items, game terms) follow the established names players know — official Russian book names where they exist, otherwise the most widely used community name. A single established term is not a copied text; record each choice with its source in the glossary.
- The owner reviews samples (Task 4) before a pack's translation is accepted.

## Global Constraints

- No user-visible English in a ru/uk session for shipped content: CI coverage gate = 100 % of translatable fields of every built-in pack, 0 stale entries.
- Parity: a translation keeps every dice expression (`\d*d\d+`), number, unit-bearing value (feet are converted only if the English source does not — keep the source's units; ru/uk use "фт."/"фут." per glossary), markdown table/list/link structure and inline reference token of its source. `translate check` enforces it.
- Translatable fields are those the Localizer reads (`name`, `description`, and per-type text fields — derive the list from the protocol schemas, not by hand).
- Translation pack ids: `<pack-id>-ru`, `<pack-id>-uk`; `translates: { id: <pack-id>, range: '^<major>.<minor>' }`; one pack per content pack per locale; split by type into two packs only if `PACK_LIMITS` (5 MB) would be exceeded.
- Attribution: the SRD translations carry the CC-BY notice that the work is a translation by the Herokeep project (`docs/04-reference/legal-attribution.md`).
- TDD for tooling; Conventional Commits with scope (`feat(pack-tools)`, `feat(content)`, `feat(web)`); content commits per batch.

## Review Focus

1. The English source of an entity changes after it was translated: `translate check` reports it stale and CI fails until it is re-translated — the old translation is still shown (not blank) at runtime (Task 1 test).
2. A ru player searches the library for a spell by its Russian name ("Огненный шар", uk "Вогняна куля") and by its English name — both find it (Task 6 e2e).
3. A translated description drops or changes a dice expression or a number ("2d6" → "2к6" is allowed only via the glossary's dice notation rule; "3d8" → "3к6" is a failure) — `check` catches it (Task 1 test).
4. A user-imported (non-built-in) pack in a ru session: untranslated fields fall back to English per field, no blank labels (Task 6 test).
5. Long Russian/Ukrainian names fit the sheet, library rows and menus at phone width (Task 6 adds translated content to the text-fit suite).

---

### Task 1: `translate extract` and `translate check`

**Files:** Create `packages/pack-tools/src/translate/{extract,check,fields,parity,hash}.ts`, wire into `packages/pack-tools/src/cli.ts`; tests `packages/pack-tools/test/translate/*.spec.ts` with fixtures in `test/fixtures/translate/`.

**Interfaces:**
- Produces:
  - Source file format `translations/<pack-id>/<locale>/<type>.json`: `{ "<type>/<slug>": { "<field>": { "text": string, "src": string /* sha256 of the English field, first 12 hex */ } } }`.
  - `hk-pack translate extract <pack> --locale <ru|uk> --out <dir>` — writes missing and stale entries (English text + `src` hash, empty `text`), never overwrites existing `text`.
  - `hk-pack translate check <pack> --locale <l> --glossary <file> [--min-coverage 100]` → exit 1 on: coverage below min, any stale `src`, parity failure, glossary violation; prints a per-type table.
  - `hk-pack translate build <pack> --locale <l>` → the `kind: translation` pack JSON (drops `src`).
- Glossary format `translations/glossary/<locale>.json`: `{ "<english term>": { "term": string, "source": string /* where the name comes from */, "forms"?: string[] /* allowed inflections */ } }`; rule: if an English field contains a glossary term (whole word, case-insensitive), its translation contains `term` or one of `forms`.

- [ ] **Step 1: Failing tests** — extract on a fixture pack lists every translatable field; check passes on a complete fixture; fails on: a missing field, a changed English source (stale), "3d8"→"3к6", a dropped table row, a glossary term translated differently; build output parses as a translation pack.
- [ ] **Step 2: Implement. Step 3:** PASS. Commit — `feat(pack-tools): translation extract, check and build`.

### Task 2: Glossaries

**Files:** Create `packages/content/translations/glossary/ru.json`, `uk.json`; `docs/04-reference/translation-glossary.md` (how terms were chosen; dice notation: "к" in ru/uk text — "2к6" — as players expect, parity treats `NdM`↔`NкM` as equal; units; capitalisation rules).

- [ ] **Step 1:** Collect terms: abilities, skills, conditions, damage types, schools, classes, subclasses, races/subraces, backgrounds, feats, every spell name, weapon/armor/tool names, core rule terms (advantage, saving throw, proficiency bonus, concentration, …). Russian: official Russian PHB 2014 names first; record the source per term. Ukrainian: no official book — use the most common community names and mark them for owner review.
- [ ] **Step 2:** Glossary checks: no two English terms map to the same translation unless intended (listed), every class/spell name of the shipped packs is present. Commit — `feat(content): ru and uk game-term glossaries`.

### Task 3: Build and ship translation packs

**Files:** `packages/content/src/build.ts` (build every `translations/<pack-id>/<locale>` into `dist/packs/<pack-id>-<locale>/<version>/pack.json` and list them in `builtin.json` with `kind: 'translation'`), `apps/web/tools/copy-packs.ts`, `shared/stores/pack.store.ts` (install built-in translation packs; the active locale's are used by the Localizer), remove the demo sample (`pack-loader.ts:31` `loadDemoRu`, `translations/srd-5e-2024-ru-sample.json`); CI step in `.github/workflows/ci.yml` running `translate check` for every built-in pack × ru/uk.

- [ ] **Step 1: Failing tests** — build emits a translation pack per content pack per locale; web installs them on first run and switching the UI locale switches content language without reload; CI script fails on a fixture with one missing string.
- [ ] **Step 2: Implement** (CI gate starts in report-only mode until Task 5 finishes, then `--min-coverage 100`). Commit — `feat(content): built-in translation packs and the coverage gate`.

### Task 4: Translation batches — SRD 5.1 core

Process for every batch (one subagent dispatch each, ≤ ~40 spells or ~25 features or ~60 items):
1. `translate extract` for the batch's types; 2. translate into ru, then uk, following the glossary and `translation-glossary.md` — fluent game-book style, not literal; same markdown structure; 3. `translate check` green for the batch; 4. commit `feat(content): srd-5e-2014 <type> <range> ru+uk`.

- [ ] **4a** system strings, abilities, skills, conditions, languages, rules.
- [ ] **4b** races, subraces, background, feat.
- [ ] **4c** classes and class features (3 classes per batch).
- [ ] **4d** spells by level (cantrips + 1st, 2nd, 3rd, 4th–5th, 6th–9th).
- [ ] **4e** items and magic items.
- [ ] **4f Owner review:** write `docs/superpowers/translation-review/srd-5e-2014.md` with 20 random entries per locale (English | ru | uk side by side, including at least 3 spells and 2 class features); stop and ask the owner; apply corrections to the glossary first, then re-run `check` over everything.

### Task 5: Translation batches — book packs, then the 2024 core

- [ ] Same process as Task 4, pack by pack in plan-21 order: `phb-2014`, `xanathars-guide`, `tashas-cauldron`, `sword-coast-guide`, `volos-guide`, `mordenkainens-tome`, `elemental-evil`; owner review sample per pack (10 entries per locale). Then `srd-5e-2024` (lowest priority; may slip to a later plan if the owner says so at a review stop). After the last pack: switch the CI gate to `--min-coverage 100`.

### Task 6: Web — search, fit and "suggest a fix"

**Files:** `packages/engine/src/i18n/search.ts` (index translated names and the English name together), `apps/web/e2e/locale.spec.ts`, `e2e/textfit/` (ru/uk content routes: a long-named spell, subclass and item on sheet, library row, menu), `ui/description-drawer/` (a "Suggest a translation fix" action in ru/uk: opens a small form with the current text, the user edits it, the app saves a `<pack>-<locale>-fix-<entity>.json` file in the extract format for the owner to apply), `views/settings/` none.

- [ ] **Step 1: Failing tests** — ru search finds Fireball by "Огненный шар" and by "fireball"; uk by "Вогняна куля"; a user-imported pack without translations shows English per field; text-fit passes for the translated routes; the fix export produces a file `translate check` accepts.
- [ ] **Step 2: Implement. Step 3:** PASS. Commit — `feat(web): bilingual search, translated text fit, suggest a translation fix`.

### Task 7: QA gate and handoff

- [ ] Root `pnpm check`, web e2e (all projects), CI coverage gate at 100 for every built-in pack; pack-size table; a ru and a uk play-through screenshot set (create, level up, cast, inventory) to `visual-check`.
- [ ] Update `phases.md` (Phase 5 translation items done), `legal-attribution.md` (translation notice), close V9 in `open-questions.md` with the decision ("own translation, community terms only").
- [ ] Commit — `docs(repo): plan 22 wrap`.
