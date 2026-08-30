# Content packs: format, effect vocabulary, versioning

Normative schema: `packages/protocol/src/pack/*.ts` (Zod) → published JSON Schema at
`/schema/pack-v1.json`. This document explains the format and lists the v1 vocabulary.
Format version `format: 1`.

## Pack document

```jsonc
{
  "format": 1,
  "id": "srd-5e-2024",                 // ^[a-z0-9][a-z0-9-]{2,63}$ ; globally unique
  "version": "1.0.0",                  // semver
  "kind": "core",                      // core | content | translation | theme
  "system": "5e-2024",                 // required for core/content/translation
  "name": "SRD 5.2.1 (2024 rules)",
  "description": "…",                  // markdown, ≤ 20 KB
  "authors": ["…"],
  "license": "CC-BY-4.0",
  "attribution": "This work includes material from the System Reference Document 5.2.1 …",
  "dependencies": [ { "id": "srd-5e-2024", "range": "^1" } ],
  "locale": "en",                      // language of the entity text in this pack
  "entities": [ /* Entity[] */ ],
  "overrides": [ /* Override[] */ ],   // explicit patches of other packs' entities
  "assets": [ { "hash": "sha256:…", "kind": "icon", "mime": "image/webp", "size": 12345 } ],
  "i18n": { "ru": { "spell/fireball": { "name": "…", "description": "…" } } }  // optional inline
}
```

Distribution: a pack is either a single `pack.json` or a `.hkpack` ZIP (`pack.json` +
`assets/<hash>`). Core packs are served as static assets; others are imported by users.

## Entity

Common fields:

```jsonc
{
  "id": "srd-5e-2024:class/fighter",   // <packId>:<type>/<slug>
  "type": "class",
  "name": "Fighter",
  "description": "…markdown…",
  "tags": ["martial"],
  "source": { "book": "SRD 5.2.1", "page": 51 },
  "prerequisites": [ /* Predicate[] */ ],
  "effects": [ /* Effect[] */ ],        // applied while the entity is active
  "grants": [ /* FeatureGrant[] */ ],   // features this entity confers
  "choices": [ /* Choice[] */ ],        // decisions this entity asks for
  "deprecated": { "replacedBy": "…", "since": "1.2.0" },
  "icon": "sha256:…" | "gi:sword-brandish"   // pack asset hash or bundled game-icons id
}
```

Entity types and their specific data (abridged; schema is authoritative):

| Type | Specific data |
|------|---------------|
| `system` | `abilities[]`, `skills[{id, ability}]`, `saves[]`, `compositionSlots[{id, entityType, count, at}]`, `restTypes[]`, `tables` (`xp`, `proficiency`, `spellSlots` by caster type), `currencies[]`, `damageTypes[]`, `sizes[]`, `conditions[]`, `restRules`, `hpRules`, `attunementMax`, `multiclass` prerequisites, `abilityGeneration` (`standardArray: [15,14,13,12,10,8]`, `pointBuy: {budget: 27, min: 8, max: 15, costs: {…}}`, `roll: "4d6kh3"`, `manual: {min: 3, max: 18}`; a campaign's house rules may restrict which methods are offered) |
| `species` | `size`, `speed`, `creatureType`, `lifespan?`; traits as `grants` |
| `background` | `abilityScores[]` (2024: the three abilities the player may raise), `originFeat`, `skillProficiencies[]`, `toolProficiency`, `equipment` option |
| `class` | `hitDie`, `primaryAbility[]`, `saves[]`, `armorTraining[]`, `weaponProficiencies[]`, `toolProficiencies`, `skillChoice {from[], count}`, `startingEquipment[]` options, `spellcasting?` (effect), `levels[{level, grants[], choices[], spellSlots?, extra: {…}}]`, `subclassLevel`, `multiclass {prereq, gains}` |
| `subclass` | `class`, `levels[{level, grants[], choices[]}]` |
| `feature` | text + `effects` + `choices` + `uses?` (`resource.define` shorthand) |
| `feat` | `category` (origin/general/fightingStyle/epicBoon), `repeatable`, prerequisites, effects, choices |
| `spell` | `level`, `school`, `castingTime`, `range`, `components {v,s,m,materialText}`, `duration`, `concentration`, `ritual`, `classes[]`, `damage?`, `save?`, `attack?`, `higherLevels?`, `effects?` (for spells that grant static effects while active, e.g. Mage Armor) |
| `item` | `category` (weapon/armor/shield/gear/tool/consumable/magic), `cost`, `weight`, `rarity?`, `attunement?`, `weapon? {damage, type, properties[], mastery, range}`, `armor? {ac, dexCap, strength, stealthDisadvantage}`, `charges?`, `effects[]` (while equipped/attuned), `container?` |
| `condition` | `effects[]`, `levels?` (exhaustion) |
| `skill`, `ability`, `language`, `tool`, `rule`, `table` | descriptive/lookup data |

## Feature grants

```jsonc
{ "feature": "srd-5e-2024:feature/second-wind", "when": { "classLevel": { "fighter": { "gte": 1 } } } }
```

## Choices (decision points)

```jsonc
{
  "id": "srd-5e-2024:class/fighter@1/fighting-style",
  "prompt": "Choose a Fighting Style",           // localizable
  "at": { "kind": "classLevel", "class": "fighter", "level": 1 },
  "pick": { "query": { "type": "feat", "tags": ["fighting-style"] } },
  "count": 1,
  "unique": true,
  "repeatableAt": [ ]                            // e.g. ASI at 4, 6, 8…
}
```

`pick` forms: `{ "static": ["id", …] }`, `{ "query": {type, tags?, level?, classes?,
school?} }`, `{ "abilities": { "count": 2, "max": 20, "improve": "+1|+2/+1" } }` (ASI-style
improvements), `{ "abilityGeneration": true }` (the creation-time score assignment; the
allowed methods and their parameters come from `system.abilityGeneration`, and the
selection records the method, the six scores and — for `roll` — every die result),
`{ "literal": "text" }` (names), `{ "equipmentOption": [...] }`. Selections are stored in
`decision.made` events by choice id.

## Predicates

```
{ "all": [P, …] } | { "any": [P, …] } | { "not": P }
{ "ability": { "str": { "gte": 13 } } }
{ "level": { "gte": 4 } } | { "classLevel": { "wizard": { "gte": 3 } } }
{ "hasFeature": "id" } | { "hasFeat": "id" } | { "hasSpell": "id" } | { "tag": "unarmored" }
{ "proficient": { "kind": "armor", "target": "heavy" } }
{ "armor": { "category": ["none", "light"] } } | { "shield": false }
{ "species": "id" } | { "class": "id" } | { "subclass": "id" }
{ "condition": "id" } | { "spellcaster": true } | { "formula": "mod(dex) >= 2" }
```

## Effects (v1 vocabulary)

Every effect may carry `when: Predicate` and `source` is filled by the engine.

| `type` | Fields | Notes |
|--------|--------|-------|
| `ability.bonus` | `ability, value` | stacking key defaults to source feature |
| `ability.set` | `ability, value, ifHigher: true` | Gauntlets of Ogre Power |
| `ability.max` | `ability, value` | raises the 20 cap |
| `proficiency.grant` | `kind: skill\|save\|armor\|weapon\|tool\|language, target, level: proficient\|expertise\|half` | `target` may be a category (`martial`) |
| `ac.formula` | `formula, key` | candidates; engine takes the max |
| `ac.bonus` | `value, key?, when?` | shields, Defense, rings |
| `hp.perLevel` | `value` | Tough-style |
| `hp.bonus` | `value` | flat |
| `speed.set` / `speed.bonus` | `mode: walk\|fly\|swim\|climb\|burrow, value` | |
| `sense.grant` | `sense: darkvision\|blindsight\|tremorsense\|truesight, range` | |
| `resource.define` | `id, name, max (formula), reset: shortRest\|longRest\|dawn\|never, display: pips\|number` | |
| `spellcasting.define` | `class, ability, list (class id or explicit), preparation: prepared\|known\|spellbook\|innate, slots: full\|half\|third\|pact\|none, ritual, focus, cantripsKnown (formula), preparedCount (formula), spellsKnown (formula)` | |
| `spell.grant` | `spell, castingAbility?, uses? {count, per}, alwaysPrepared, level?` | Magic Initiate, species spells |
| `spell.listAdd` | `class, spells[]` | subclass spell lists |
| `damage.resistance` / `damage.immunity` / `damage.vulnerability` | `types[]` | |
| `condition.immunity` | `conditions[]` | |
| `attack.bonus` / `damage.bonus` | `value (formula), filter {weapon?: melee\|ranged\|category\|property, spell?: true}` | Archery |
| `damage.rerollBelow` | `value, filter` | Great Weapon Fighting |
| `initiative.bonus` / `save.bonus` / `skill.bonus` / `check.bonus` | `value, target?` | |
| `advantage.grant` / `disadvantage.impose` | `on: save.<ability>\|skill.<id>\|attack\|initiative, when?` | shown on sheet as reminders; not auto-applied to rolls without the user's tap |
| `action.define` | `id, name, kind: action\|bonus\|reaction\|free, description, uses?, resource?` | Second Wind, Action Surge |
| `feature.text` | `name, description` | pure text |
| `mastery.grant` | `count (formula)` | 2024 weapon mastery |
| `extraAttack.set` | `count` | |
| `item.grant` / `currency.grant` | starting equipment | applied once at the granting decision |
| `size.set` / `type.set` / `language.grant` | | |
| `tag.grant` | `tag` | for predicates |
| `slot.bonus` | `level, count` | reserved |

Unknown `type` → warning in the pack report; ignored at runtime.

## Formula grammar

```
expr   := term (('+' | '-') term)*
term   := unary (('*' | '/') unary)*
unary  := '-' unary | primary
primary:= number | ident | ident '(' args ')' | '(' expr ')'
ident  := level | prof | classLevel | mod | score | hitDie | resource | max | min | floor | ceil | abs
```
Division is integer division rounding down unless wrapped in `ceil`. Max length 256,
depth 16. Comparisons (`>= <= > < ==`) are allowed only inside `{ "formula": … }`
predicates. Evaluation context: `level`, `prof`, `classLevel(id)`, `mod(ab)`,
`score(ab)`, `hitDie(classId)`, `resource(id)`.

## Overrides

```jsonc
{ "target": "srd-5e-2024:class/fighter", "patch": [ { "op": "add", "path": "/levels/0/grants/-", "value": {…} } ] }
```
JSON Patch, applied at content-index build time; every override is listed on the pack's
enable screen. A pack may not override the `system` entity except via `kind: core`.

## Translation packs

```jsonc
{ "format": 1, "id": "srd-5e-2024-ru", "version": "1.0.0", "kind": "translation",
  "system": "5e-2024", "locale": "ru", "translates": { "id": "srd-5e-2024", "range": "^1" },
  "strings": { "spell/fireball": { "name": "Огненный шар", "description": "…" },
               "class/fighter@1/fighting-style": { "prompt": "…" } } }
```

Keys are entity ids without the pack prefix plus a field path; nested feature texts use
`feature/<slug>.name`. Fallback per field to English.

## Versioning and rebase

- Semver semantics as in ADR-008. `deprecated.replacedBy` enables automatic reference
  migration.
- Rebase algorithm: (1) build content index with the new versions; (2) `derive` with
  the old pins and with the new pins; (3) diff Sheets (derived values) and list decisions
  whose `choiceId` no longer exists, whose selection is missing/deprecated, or whose
  prerequisites now fail; (4) present a report; (5) on confirm, emit one transaction:
  `pack.pinned` + `decision.cleared`/`decision.made` fix-ups.

## Validation levels

1. **Schema** (Zod/JSON Schema): shape, ids, sizes, formula syntax.
2. **Semantic** (pack-tools and import): dangling references within the dependency
   closure, duplicate ids, cycles, unknown effect types (warning), unreachable choices,
   assets referenced but missing.
3. **Golden** (engine tests, core packs only): expected sheets.

## Authoring

`pack-tools build ./my-pack/` accepts YAML or JSON per entity in folders by type, merges
into one `pack.json`, validates, and optionally zips assets. `pack-tools diff a b` prints a
human-readable change list used to write release notes. The Phase 7 GUI editor produces
the same files.
