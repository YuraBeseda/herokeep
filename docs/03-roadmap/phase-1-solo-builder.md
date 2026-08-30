# Phase 1 — Library (1a) and Solo builder & play (1b)

The first shipped product. No accounts, no server (a static host is enough), no
campaigns. Everything lives on the device. The next planning step for this phase is a
task-level implementation plan (writing-plans skill), written in a separate session.

## 1a — Library

### Deliverables

1. **Monorepo** (`pnpm`, workspaces, TS project references, ESLint flat config,
   Prettier, stylelint, Vitest, Playwright, GitHub Actions running lint/typecheck/test/
   build). No application code beyond what 1a needs.
2. **`@hk/protocol`**: pack schema (entities, effects, predicates, choices, formulas
   as strings), event envelope + the Phase-1 event catalog, bundle manifest; JSON Schema
   export; fixtures.
3. **`@hk/engine`** core: content index (deps, overrides, i18n merge), formula parser/
   evaluator, predicate evaluator, effects registry (all v1 types registered; appliers
   for the ones 1b needs, the rest as no-op with warning until 4), localizer, search index.
   `reduce`/`derive` skeletons with golden-test harness.
4. **`@hk/content`**: import tool from open5e `srd-2024` JSON → `srd-5e-2024` core pack
   (all entity types as data; class progression rows including choices; the `system`
   entity with 2024 composition slots and tables); `icons.json` mapping to the game-icons
   subset; attribution text. Validation in CI.
5. **`@hk/pack-tools`** CLI: `validate`, `build`, `diff`, `i18n extract`.
6. **`@hk/ui-tokens`** + base components: button, icon-button, card, chip, tabs, list
   with virtual scroll, search field, dialog/bottom sheet, toast, skeleton; dark/light
   themes; Inter + Philosopher self-hosted; icon sprite.
7. **`apps/web`** PWA shell: routes (home, library, settings/language, about/attribution),
   Transloco with `en/ru/uk` UI strings for these screens, service worker precaching the
   core pack, install prompt, storage estimate.
8. **Library view**: browse by type; search (per-locale + English); entity detail with
   markdown rendering and cross-reference links; fallback "EN" tag; sample RU translation
   pack (`srd-5e-2024-ru-sample`, ~20 entities) importable from Settings to prove the
   pipeline.

### Acceptance criteria

- Installed on an iPhone and an Android phone; works in airplane mode after first load.
- Search "fireball" / "огненный" finds Fireball; sorting in RU uses Cyrillic collation.
- Switching UI language does not reload; no visible key names anywhere.
- `pnpm test` runs golden harness (empty set allowed in 1a), schema tests, content
  validation; CI green.
- Attribution screen shows the exact SRD 5.2.1 and game-icons.net statements.

## 1b — Solo builder & play

### Mechanics scope

Fighter (Champion) and Wizard (Evoker), levels 1–5 — chosen because together they cover:
hit dice & HP on level-up, armor/shield AC, fighting styles, weapon mastery, Second Wind
/Action Surge resources, Extra Attack, subclass at 3, ASI/feat at 4, spellcasting with
spellbook + preparation + slots + cantrips, ritual casting, Arcane Recovery, school
savant, concentration. All species, backgrounds (origin feats: Alert, Magic Initiate,
Savage Attacker, Skilled…), equipment and all 339 spells are available as data (spells
of other classes are browsable; only Wizard casting is mechanically wired).

### Deliverables

1. **Engine**: `reduce` with all Phase-1 event handlers and system rest/HP rules;
   `derive` complete for the scope; `outstandingChoices`, `pendingAdvancements`,
   `validateSelection`; `propose.*` for damage/heal/temp/slots/cast/rest/equip/attune/
   items/currency/conditions/death saves/hit dice/notes; dice; rebase *skeleton* (report
   only). Golden fixtures for Fighter 1–5 and Wizard 1–5 with representative gear.
2. **Storage**: Dexie schema (events, snapshots, blobs, packs, settings, characters
   index), migrations, persistence request, leader election (single tab writes).
3. **Character list & creation wizard**: name + grammatical gender; species; background
   (ability score choice, origin feat); class (skills, fighting style/spellbook); ability
   scores by every basic method the system entity defines — standard array, point buy
   (27 points, 8–15), manual entry, and dice rolling (4d6 drop lowest, six results
   assigned freely; the rolls are recorded in `decision.made.context` and shown in the
   timeline); equipment options; review → one transaction of events.
4. **Sheet**: Play (phone tabs; tablet/desktop grid), Build (re-enter wizard steps for
   outstanding choices; rename; appearance), Timeline (sentences, filters, revert).
   Provenance popovers on derived numbers.
5. **Level-up**: XP entry (solo), "level up available" badge, wizard for each level
   (HP roll/average, subclass at 3, ASI/feat at 4, spells), undo as one transaction.
6. **Play features**: HP bar with damage/heal/temp input; death saves; hit dice; slots as
   pips; prepare/cast; concentration indicator; conditions & exhaustion chips; inventory
   (add from library, custom item via quick form, qty, equip, attune, weight, currency);
   short/long rest with hit-dice picker; inspiration; notes; dice roller for checks,
   saves, attacks, spell attacks/damage with a local roll log and "manual result" entry.
7. **Images**: portrait upload pipeline (resize/encode/hash/store), thumb/token
   generation, placeholder set.
8. **Export/import** `.hero` (events + snapshot + pins + non-core packs + images) via
   save picker / Web Share / download; import with merge-by-id.
9. **PWA**: install nag with iOS-specific explanation of the 7-day rule; update prompt;
   Wake Lock toggle in Play.
10. **Docs**: `manual-device-checklist.md`; SKILL.md per shared component; CLAUDE.md for
    the repo (first time it is allowed).

### Acceptance criteria

- A new user creates a level-1 Fighter in under 5 minutes on a phone without reading
  docs; the resulting sheet matches the golden fixture for the same choices.
- Level 1 → 5 for both classes via the wizard produces sheets equal to golden fixtures;
  "undo level-up" restores the previous sheet exactly.
- All play actions round-trip through events (timeline shows them; revert works).
- Airplane mode: everything above works; reloading the app keeps state.
- Export on iOS via Share → import on Android reproduces the character with portrait.
- `reduce`+`derive` of the 5th-level fixture with 500 in-play events < 30 ms on a
  mid-range Android phone (measured and recorded in the docs).
- UI in `en`, `ru`, `uk` complete for all 1b screens; ICU plural/gender tested.
- axe: no serious violations on sheet/play/wizard; keyboard-only wizard completion.

### Out of scope for Phase 1 (explicitly)

Accounts, sync, campaigns, other classes' mechanics, multiclassing, magic item
mechanics beyond `+N` bonuses on weapons/armor (data is present), pack rebase UI,
PDF export, fantasy theme.
