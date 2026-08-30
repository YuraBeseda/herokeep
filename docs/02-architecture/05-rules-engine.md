# Rules engine (`@hk/engine`)

Pure TypeScript, no DOM, no Angular, no I/O. Public API is small and stable; internals
are organised as a pipeline (ADR-013).

## Public API

```ts
// content
createContentIndex(packs: Pack[], pins: Pins): ContentIndex        // resolves deps, overrides, i18n
index.get(id): Entity | undefined; index.query(q): Entity[]; index.system(): SystemEntity
// state
reduce(events: Event[], from?: Snapshot): Facts
// derivation
derive(facts: Facts, index: ContentIndex, opts: DeriveOptions): Sheet
// advancement
pendingAdvancements(sheet): Advancement[]          // levels available and their choices
outstandingChoices(sheet): ChoiceRequest[]
validateSelection(sheet, choiceId, selection): Issue[]
// actions → proposed events (never mutate)
propose.damage(sheet, n, opts) / heal / tempHp / spendSlot / cast / rest / equip / attune / addItem / …
// dice
roll(spec: RollSpec, ctx: RollContext, rng?: () => number): RollResult
// i18n
createLocalizer(index, locale): Localizer;  localizer.text(entityId, field): LocalizedText
createSearchIndex(index, localizer): SearchIndex; search.query(text): Hit[]
// rebase
planRebase(facts, indexOld, indexNew): RebasePlan
```

`Sheet` is a plain JSON-serializable object; every numeric field is a `Derived<number>`:
`{ value, contributions: [{ source: EntityRef, feature?: EntityRef, kind, amount|formula }] }`.

## Module layout

```
packages/engine/src/
  content/    index.ts (dependency closure, override patching, entity map, queries), ids.ts
  formula/    lexer.ts, parser.ts (Pratt), evaluate.ts, validate.ts
  predicate/  evaluate.ts
  effects/    registry.ts (type → applier), appliers/*.ts (one file per effect type)
  reduce/     reducer.ts, handlers/*.ts (one per event family), upcast.ts, snapshot.ts
  derive/     composition.ts, grants.ts, modifiers.ts (ModifierTable, stacking policies),
              abilities.ts, defense.ts, hp.ts, movement.ts, skills.ts, attacks.ts,
              spellcasting.ts, resources.ts, actions.ts, validation.ts, choices.ts, sheet.ts
  propose/    *.ts (event proposers)
  dice/       parse.ts, roll.ts
  i18n/       localizer.ts, search.ts, normalize.ts
  rebase/     plan.ts
  index.ts
```

## Derivation order and stacking policies

Targets are evaluated in a fixed dependency order (abilities → proficiency → AC/HP/speed
→ saves/skills → attacks → spellcasting → resources → actions). A `ModifierTable` collects
per target:

| Policy | Targets | Rule |
|--------|---------|------|
| `sum-unique-key` | most bonuses | modifiers with the same `key` do not stack (keep max) |
| `max-of-formulas` | `ac.formula` | evaluate all candidates; take the highest; base 10+dex always present |
| `set-if-higher` | `ability.set` | applied after bonuses |
| `cap` | `ability.max` | final clamp |
| `union` | proficiencies, senses, languages, resistances | set semantics; `expertise` beats `proficient` |

Armor rules (2024): armor `ac` + `min(mod(dex), dexCap)`; shield `+2` as `ac.bonus key:
shield`; heavy armor STR requirement and stealth disadvantage as validation issues /
reminders. Weapon attacks: to-hit = `prof (if proficient) + mod(str|dex per property) +
attack.bonus filters`; damage similarly; mastery property surfaced from the item when the
character has `mastery.grant` and selected that weapon in the mastery choice.

Spellcasting per class: ability, DC `8 + prof + mod`, attack `prof + mod`, slots by the
system's table for the class's `slots` kind (multiclass table in Phase 4), prepared count
formula, ritual flag, cantrips known formula, spellbook contents from `spell.learned`.

## Choices and advancement

`outstandingChoices` = for each active entity and each class level ≤ current: choices
whose `at` matches and that have no (valid) decision. `pendingAdvancements` = levels the
character may take now (XP threshold reached, or `level.granted` count > levels taken).
The UI's wizard iterates `Advancement.steps[]`, calling `validateSelection` live, and
finally builds one transaction (`level.gained` + `decision.made`s + HP roll/average).

## Validation

`Sheet.issues[]`: `{ severity: error | warning, code, entityId?, choiceId?, message
params }`. In strict mode (campaign `houseRules.strictValidation`) the UI blocks emitting
events that would create an `error`; with overrides allowed the DM can accept a warning.
Derivation itself never fails: an unresolved entity becomes a chip with the id and a
warning; a failed predicate simply deactivates the grant.

## Rests and reducer rules

The reducer reads the pinned core pack's `system.restRules` and `system.hpRules`
(present in the snapshot as data) so replay is deterministic even if the engine version
changes. Handlers are small pure functions per event type, registered by `type` and `v`;
upcasters convert older payload versions at read time.

## Dice

`RollSpec` = `{ dice: [{n, sides, keep?: highest|lowest}], modifier, advantage?:
adv|dis|none }`. `RollResult` records each die. RNG is injectable (tests are
deterministic; production uses `crypto.getRandomValues`). The log event is produced by
the UI from the result; applying damage remains a separate, explicit tap.

## Localizer and search

`Localizer` caches per (entity, field, locale); `SearchIndex` builds normalized tokens for
name/aliases in the active locale plus English; queries return hits with a match kind and
the entity type for grouping.

## Performance targets

- `reduce` of 2,000 events: < 5 ms (desktop), < 15 ms (mid phone).
- `derive` of a level-20 character with ~150 active effects: < 5 ms / < 15 ms.
- `createContentIndex` for the SRD core pack (≈ 1,200 entities): < 50 ms; cached per
  (pins) in the app.
Measured in Phase 1b; if exceeded, `derive` moves to a Web Worker (pure function, no
refactor).

## Determinism contract

No `Date.now()`, `Math.random()` (outside `dice/` with injectable RNG), locale-dependent
string ops (sorting uses explicit `Intl.Collator` only in `i18n/`), or object-key-order
dependence in derivation. Enforced by a lint rule set for the package and by the golden
tests running in both Node and a browser (Vitest browser mode in Phase 4).
