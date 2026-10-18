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
| `system` | `abilities[]`, `skills[{id, ability}]`, `saves[]`, `compositionSlots[{id, entityType, count, at}]`, `restTypes[]`, `tables` (`xp`, `proficiency`, `spellSlots` by caster type — `full\|half\|third\|pact\|none`; `multiclassSlots?` — see below), `currencies[]`, `damageTypes[]`, `sizes[]`, `conditions[]`, `restRules`, `hpRules`, `attunementMax`, `encumbrance?` (`standard`/`variant` carry-capacity data — see below), `multiclass` prerequisites, `abilityGeneration` (`standardArray: [15,14,13,12,10,8]`, `pointBuy: {budget: 27, min: 8, max: 15, costs: {…}}`, `roll: "4d6kh3"`, `manual: {min: 3, max: 18}`; a campaign's house rules may restrict which methods are offered) |
| `species` | `size`, `speed`, `creatureType`, `lifespan?`; traits as `grants` |
| `background` | `abilityScores[]` (2024: the three abilities the player may raise), `originFeat`, `skillProficiencies[]`, `toolProficiency`, `equipment` option |
| `class` | `hitDie`, `primaryAbility[]`, `saves[]`, `armorTraining[]`, `weaponProficiencies[]`, `toolProficiencies`, `skillChoice {from[], count}`, `startingEquipment[]` options, `spellcasting?` (effect), `levels[{level, grants[], choices[], spellSlots?, extra: {…}}]` — `extra`'s values are int, formula, dice roll (e.g. Rage Damage `"1d6"`) or short plain text (e.g. an ordinal column). `extra`'s plain-text values (`ExtraTextSchema`) are MECHANICAL NOTATION — table-column values like dice or ordinal labels, not display prose — so they are exempt from the Localizer; display prose for a feature belongs in that feature's (already-localized) `description`, not in an `extra` column. `extra` is also the mechanism for STEPPED per-level tables that don't fit one formula (one `extra` entry per level-with-a-change, keyed `"<classSlug>-<fact>"`, e.g. `"wizard-cantrips-known"`/`"fighter-weapon-mastery-count"`): `@hk/engine`'s `bestRowExtra` (`derive/spellcasting.ts`) takes the HIGHEST such row at or below the character's level, resolving it through the formula grammar if the row's own value is itself a formula string. `spellcasting.define`'s `cantripsKnown`/`preparedCount` formulas and `mastery.grant`'s `count` formula (effects table below) are each read ONLY as a fallback, when no matching row-extra exists for that class/key at or below the current level — a row always wins over the flat formula once one is authored. Other `class`-level fields: `subclassLevel`, `multiclass {prereq, gains}` |
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
school?, hasField?, category?} }`, `{ "queries": [query, query, …] }` (mixed-type picks, below), `{ "abilities": { "count": 2, "max": 20, "improve": "+1|+2/+1", "from"?: ["str", "dex"] } }` (ASI-style
improvements; `from` restricts the offered abilities, intersected with a background owner's
`abilityScores`), `{ "abilityGeneration": true }` (the creation-time score assignment; the
allowed methods and their parameters come from `system.abilityGeneration`, and the
selection records the method, the six scores and — for `roll` — every die result),
`{ "literal": "text" }` (names), `{ "equipmentOption": [...] }`. Selections are stored in
`decision.made` events by choice id.

**Choice scope (plan 14 task 1).** A class-row choice may carry `scope: "initial" | "later"`
(optional, no default — an unscoped choice is offered exactly as before). `initial` is offered only
when the owning class entry is the character's FIRST class (`facts.classes[0]`), `later` only when it
is not; a subclass row follows its class entry's position. `derive/choices.ts`'s `scopeOffers` /
`offeredRowChoices` apply it in one place for both outstanding choices and level-up advancement
steps, and `offeredRowChoices` also hides a `later` choice once an `initial` sibling on the SAME row
already has a recorded decision (a legacy log that answered the full pick is never offered the
reduced one too). Only OFFERS change: a recorded decision for an out-of-scope choice still grants and
raises no `decision.unknownChoice`. Pack validation refuses `scope` on a choice whose `at.kind` is not
`classLevel` (`choice.scopeOnNonClassChoice`). The synthetic class skill picks (`<classId>@1/skills` /
`<classId>@1/multiclass-skills`) have no backing `Choice` entity, so they keep their slug-based
initial/later split as the fallback. SRD content: Bard `@1/tools` (three instruments) and Monk
`@1/tools` are `initial`; Bard `@1/multiclass-tools` (one Musical Instrument, count 1) is `later`.

**Expertise picks (plan 13 task 1).** A `{type: "skill"}` query pick may carry two optional keys
(legal only on a skill query — a schema refine): `proficiency: "proficient" | "expertise"` (the rank a
selected skill gets; absent = `proficient`, so every older pick is unchanged) and `requireProficient:
true` (offer only skills the character already has at a FULL rank — `proficient` or `expertise`;
`half` does not count). Selections of a `requireProficient` pick apply after every other proficiency
source (background, class skills, plain picks, `proficiency.grant`), so an expertise pick upgrades a
skill and never creates proficiency: a recorded selection of a skill the character is not proficient
in grants nothing. The engine's `queryPickOptions(pick, index, sheet)` is the single list of eligible
options, used both by validation (a target outside it is refused as `selection.notOffered`) and by
the web picker. A total is `mod + 2 × prof` (not 3×). SRD content: Rogue `@1/expertise` and
`@6/expertise` (2 each), Bard `@2/expertise` and `@9/expertise` (2 each), Ranger `@2/expertise`
(Deft Explorer, 1) and `@9/expertise` (2), all with
`{"query":{"type":"skill"},"proficiency":"expertise","requireProficient":true}`. A class's two picks
share the slug `expertise`, so the existing `unique` family check refuses repeating an earlier pick
(`selection.duplicate`). Selection values are skill entity ids (`srd-5e-2024:skill/stealth`).

**Expertise across owners (plan 14 task 4).** The list is now `queryPickOptions(pick, index, sheet,
ownerId?)`. Expertise picks apply in class order (`facts.classes[]` in the order gained, a subclass
with its class, any non-class owner after every class), and each skill whose expertise rank came
from a pick records that pick's owner as `sheet.skills[s].expertiseOwner` (absent for a fixed grant
or no expertise). An expertise pick offers a skill that is ALREADY at expertise only when
`expertiseOwner === ownerId` — the owner's own earlier pick stays visible so the draft sheet's own
selection is not dropped; expertise from another class (or from a fixed grant) is not offered, and
without an `ownerId` every expertise-rank skill is dropped. Validation passes the choice's owner, so
offers and `selection.notOffered` agree: a Rogue 3 → Ranger 2 is not offered the Stealth the Rogue
already made expert. Same-family repeats (Rogue `@1` vs `@6`) stay listed and refused as
`selection.duplicate`, as above. A legacy log whose later class picked an already-expert skill keeps
granting (a no-op on the rank); only that later decision reports `selection.notOffered`.

`EntityQuerySchema`'s filters are AND-combined: `tags` (an entity's `tags[]` must include every
listed tag) and `hasField` (dot-paths, e.g. `"weapon.mastery"`, that must be present on the
candidate entity — a field-presence filter, preferred over inventing a bespoke tag taxonomy for
data the schema already models structurally). Fighter's Weapon Mastery choice, for example, is a
real entity query rather than a `literal: "text"` placeholder:
`{ "query": { "type": "item", "hasField": ["weapon.mastery"] } }` selects exactly the items that
carry a weapon-mastery property. `category` (plan 14 task 2) filters items by their `category`
(the item category enum, one shared `ItemCategorySchema` for the entity field and the filter):
`{ "type": "item", "category": "tool" }` selects every tool. On any non-item query `category`
matches nothing.

**Mixed-type picks (plan 14 task 2).** `{ "queries": [q1, q2, …] }` (two or more queries; mutually
exclusive with `static` and `query`) offers the union of its queries as ONE option list — each
entity once, in authored query order — and the choice's `count` applies to that union. Each
selection grants through the path its own entity type already uses (a skill entity a skill
proficiency, a `category: "tool"` item a tool proficiency row), so one decision may grant both.
`queryPickOptions` unions the queries for validation and the web picker alike. SRD content: the
Skilled feat's "any combination of three skills or tools" is
`{"queries":[{"type":"skill"},{"type":"item","category":"tool"}]}` with `count: 3`.
Validation runs over the union: `selection.count` counts the union's selections, and
`selection.notOffered`, `selection.duplicate` and per-entity prerequisites all apply. `queries`
takes none of the skill-only keys (`proficiency` / `requireProficient` stay single-`query` only).
The choice id `feat/skilled@1/skills` is unchanged, so a recorded skills-only Skilled decision
replays identically. Related content in the same task: the Soldier background's "Choose one kind of
Gaming Set" is no longer a generic `gaming-set` tool row but a real pick,
`srd-5e-2024:background/soldier@0/tools` (`at: creation`, a count-1 `static` pick over the four
`gaming-set-*` items). An existing Soldier character therefore shows one new outstanding pick until
it is answered.

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
| `proficiency.grant` | `kind: skill\|save\|armor\|weapon\|tool\|language, target, level: proficient\|expertise\|half` | `target` may be a category (`martial`); tool proficiencies land as `kind: 'tool'` rows (see "Tool proficiencies") |
| `ac.formula` | `formula, key` | candidates; engine takes the max |
| `ac.bonus` | `value, key?, when?` | shields, Defense, rings |
| `hp.perLevel` | `value` | Tough-style |
| `hp.bonus` | `value` | flat |
| `speed.set` / `speed.bonus` | `mode: walk\|fly\|swim\|climb\|burrow, value, key?` | `speed.set` value is an int; `speed.bonus` value is an int OR a formula (plan 13 task 5), and a non-walk bonus may read `speed(walk)` — see "Speed formulas" |
| `sense.grant` | `sense: darkvision\|blindsight\|tremorsense\|truesight, range` | |
| `resource.define` | `id, name, max (formula), reset: shortRest\|longRest\|dawn\|never, display: pips\|number` | Re-declaring an id: `max` stacks (same id keeps the highest), `name`/`display`/`source` stay first-wins, `reset` is last-wins (Font of Inspiration). "First"/"last" follow composition's sort order — lexical by source entity id, then feature id — NOT the level a feature was gained at; an overriding define must sort after the original (plan 13 task 3; see `derive/resources.ts`) |
| `spellcasting.define` | `class, ability, list (class id or explicit), preparation: prepared\|known\|spellbook\|innate, slots: full\|half\|third\|pact\|none, ritual, focus, cantripsKnown (formula), preparedCount (formula), spellsKnown (formula)` | |
| `spell.grant` | `spell, castingAbility?, uses? {count, per} \| {resource}, alwaysPrepared, level?` | Magic Initiate, species spells; `uses` = free casts (see "Free casts") |
| `spell.listAdd` | `class, spells[]` | subclass spell lists |
| `damage.resistance` / `damage.immunity` / `damage.vulnerability` | `types[]` | `damage.resistance` derives into `sheet.resistances` (display only; plan 14 task 3) — see "Damage resistances" |
| `condition.immunity` | `conditions[]` | derived into `sheet.immunities` (display only; plan 13 task 5) — see "Condition immunities" |
| `attack.bonus` / `damage.bonus` | `value (formula), filter {weapon?: melee\|ranged\|any, spell?: true}` | Archery |
| `damage.rerollBelow` | `value, filter` | Great Weapon Fighting |
| `initiative.bonus` / `save.bonus` / `skill.bonus` / `check.bonus` | `value, target?` | |
| `advantage.grant` / `disadvantage.impose` | `on: save.<ability>\|skill.<id>\|attack\|initiative, when?` | shown on sheet as reminders; not auto-applied to rolls without the user's tap |
| `action.define` | `id, name, kind: action\|bonus\|reaction\|free, description, uses?, resource?` | Second Wind, Action Surge |
| `feature.text` | `name, description` | pure text |
| `mastery.grant` | `count (formula)` | 2024 weapon mastery; several active grants take the MAX count, not the sum (plan 14 task 4, owner-flag) — see "Multiclass weapon mastery" |
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
ident  := level | prof | classLevel | mod | score | hitDie | resource | speed | max | min | floor | ceil | abs
```
Division is integer division rounding down unless wrapped in `ceil`. Max length 256,
depth 16. Comparisons (`>= <= > < ==`) are allowed only inside `{ "formula": … }`
predicates. Evaluation context: `level`, `prof`, `classLevel(id)`, `mod(ab)`,
`score(ab)`, `hitDie(classId)`, `resource(id)`, and — only in a non-walk `speed.bonus` value —
`speed(walk)` (plan 13 task 5; see "Speed formulas").

## Dice values

`DiceSchema` is `NdS(+/-M)` notation, e.g. `1d8`, `2d6+3`, `8d6`. `FlatDiceSchema` (phase 4,
additive) is a fixed amount with no die: `{ "flat": 1 }`, for a component that's a plain bonus
rather than a roll (replacing zero-count-die hacks like `0d4+1`). `DiceOrFlatSchema` accepts
either form.

**Migrated this task (ruling 6, phase 4 plan 11 task 7): `item.weapon.damage`.** The Blowgun
(SRD 5.2.1) deals a flat 1 Piercing damage with no die roll — upstream's `damage_dice: "1"`, the
ONLY weapon in the vendored SRD 5.2.1 snapshot without `NdS` notation (verified over the full 38
records). It's now `{ "flat": 1 }`, replacing the old `"0d4+1"` encoding, which was not just
inelegant but actually BROKEN: `@hk/engine`'s own dice parser (`dice/parse.ts`'s `parseRollSpec`)
rejects a `0d4` term (`n <= 0` throws `DiceFormulaError`), so rolling Blowgun damage in the app
would have crashed. `weapon.versatile` and `spell.damage.dice` are untouched (`DiceSchema` only —
no SRD weapon has flat versatile damage); migrating either is future work if content ever needs it.
`AttackRow.damage.dice` (engine, `derive/attacks.ts`) stays `string` — a flat amount normalizes to
its bare integer (`"1"`, which `parseRollSpec` correctly reads as a zero-dice flat modifier) so
existing string consumers (apps/web's roll UI, the Library detail formatter) need no shape change.

## Multiclass spellcasting table

`system.tables.multiclassSlots` (optional) holds the combined-caster-level slot table for
multiclass characters, plus the DATA needed to compute that combined level — never hardcoded in
engine code. Rounding is **per-progression data**, not one global rule, because the direction
differs by progression (see the citation below):

```jsonc
"multiclassSlots": {
  "weights": {
    "full": { "divisor": 1, "rounding": "down" },  // divisor 1 never has a remainder — no-op
    "half": { "divisor": 2, "rounding": "up" },
    "third": { "divisor": 3, "rounding": "down" }  // OWNER-FLAG: SRD-silent, see below
  },
  "slots": [[2], [3], [4, 2], …]                   // same per-row shape as one spellSlots table
}
```

Each class's own level is divided by its progression's `divisor` and rounded `rounding`
**individually**, then the results are summed across classes; the combined total is looked up on
the Multiclass Spellcaster table. This is quoted verbatim from the vendored 2024 SRD text
(`packages/content/upstream/open5e-srd-2024/Rule.json`, pk
`srd-2024_multiclassing_spellcasting`):

> You determine your available spell slots by adding together the following:
> - All your levels in the Bard, Cleric, Druid, Sorcerer, and Wizard classes
> - Half your levels (round up) in the Paladin and Ranger classes

So **half-caster levels round UP** — a deliberate 2024 change from the 2014 rule (which rounded
half- and third-caster contributions DOWN). An earlier draft of this table wrongly carried the
2014 round-down rule as if it were current 2024 text; corrected here.

**OWNER-FLAG (2024 SRD-silent on third casters):** the quoted passage names only full and half
casters — it gives no rule at all for third-caster classes (Eldritch Knight, Arcane Trickster).
`third` stays expressible in `weights` (nothing stops a pack from supplying it), but its
`divisor`/`rounding` are not specified by the core rules text this repo has access to; a content
pack author must choose a value (the 2014 precedent, if adopted, is divisor 3 / round down) and
record that choice as their own decision, not an SRD citation.

Pact-magic casters never participate: their slots are tracked separately (`facts.pactSlots`) and
are not part of this table (`weights` has no `pact` key — `MulticlassProgressionSchema` excludes
it). Single-class characters keep using the per-class `spellSlots` table unchanged.

**When the combined table applies (engine consumption, phase 4 plan 11 task 3):** the gate is NOT
"more than one class" — it's "more than one class with the Spellcasting feature." Quoted verbatim
from the same vendored passage: "Once you have the Spellcasting feature from more than one class,
use the rules below. If you multiclass but have the Spellcasting feature from only one class,
follow the rules for that class." A Fighter 3 / Wizard 5 character therefore keeps using Wizard's
own solo `spellSlots.full` table — Fighter contributes no `spellcasting.define` effect at all.
`packages/engine/src/derive/spellcasting.ts` implements this by counting active
`spellcasting.define` effects whose `slots` progression has an entry in `multiclassSlots.weights`
(so an authored-but-unweighted `third` progression, per the OWNER-FLAG above, also stays solo); the
combined table only applies once that count is 2 or more.

**Real system data (phase 4 plan 11 task 7).** `srd-5e-2024:system/5e-2024`'s
`tables.spellSlots.half` (Paladin/Ranger), `.pact` (Warlock) and `tables.multiclassSlots.slots` are
transcribed verbatim from the vendored `ClassFeatureItem.json` (`packages/content/upstream/
open5e-srd-2024/`) — `srd-2024_paladin_slots-1st`..`slots-5th` for half-casters (cross-checked
byte-identical to Ranger's own rows), `srd-2024_warlock_spell-slots` (count) +
`srd-2024_warlock_slot-level` (slot level) combined into T3's sparse-row pact encoding, and the
20-row Multiclass Spellcaster table from `Rule.json` above (byte-identical to the single-class
full-caster table — not a coincidence, 5e's multiclass table has always mirrored it, so
`multiclassSlots.slots` and `spellSlots.full` are the SAME array). `tables.spellSlots.third`
(Eldritch Knight/Arcane Trickster) is OWNER-FLAG: this vendored SRD 5.2.1 snapshot doesn't include
either subclass (Fighter's only SRD subclass here is Champion, Rogue's is Thief —
`CharacterClass.json`'s `subclass_of` links name only the 12 SRD subclasses), so there is no
vendored per-level table; authored from public SRD/PHB knowledge (unchanged 2014→2024: one-third of
a full caster's levels, starts at class level 3, capped at 4th-level spells).

**`system.multiclass.prerequisites` (T2 carry, ruling 2): populated for all 12 classes.** Single
primary-ability classes (8 of 12) are cited verbatim from the same `Rule.json` passage quoted above
("a score of at least 13 in the primary ability of the new class") combined with
`transform/classes.ts`'s own `PRIMARY_ABILITY` table. The 4 dual-primary-ability classes (Fighter,
Monk, Paladin, Ranger) are OWNER-FLAG: the vendored passage's one worked example (Barbarian → Druid)
only covers single-ability classes, so it never states whether a dual-ability class needs EITHER or
BOTH abilities at 13+; authored from public SRD/PHB knowledge (unchanged since 2014): Fighter is an
OR (either ability qualifies), Monk/Paladin/Ranger are AND (both required).

**`pendingAdvancements` ordering fix (discovered by task 7, real-pack ripple of the system map above).**
Once `system.multiclass.prerequisites` is populated for real, a character's own EXISTING class can
sort AFTER a class they merely qualify to multiclass into (e.g. `srd-5e-2024:class/wizard`, already
taken, sorts after `srd-5e-2024:class/barbarian`, a new-class offer — plain alphabetical order).
`packages/engine/src/derive/advancement.ts`'s `pendingAdvancements` now sorts every existing-class
entry (`isNewClass: false`) before every new-class offer (`isNewClass: true`), alphabetical only as
the tiebreak within each group — so a UI reading `pendingAdvancements()[0]` (today's
`LevelUpState`, per task 2's carry) keeps landing on the character's own normal level-up instead of
a same-priority multiclass offer it never asked to see. This surfaced only once a real pack (not a
synthetic fixture) supplied both a real character with qualifying ability scores AND system-wide
prerequisite data at the same time — no fixture pack before this task exercised that combination.

**System map vs. class-entity field (T2 carry, resolved).** `advancement.ts`'s `pendingAdvancements`
reads `system.multiclass.prerequisites` — that map is the GATING authority. The class entity's own
singular `multiclass.prerequisites` field (pre-existing schema, predates plan 11) is
validation/reference-collection only: it's walked by `content/refs.ts`'s dependency-ref collector at
pack-validation time, but `advancement.ts` never reads it. The five slice-1 classes that carry
`multiclass.gains` (below) also populate this field — required alongside `gains` by
`ClassEntitySchema.multiclass`'s shape — with the SAME predicate value the system map carries for
that class (one source of truth, `MULTICLASS_PREREQUISITES` in `packages/content/src/static/
system.ts`, exported and reused by `transform/classes.ts`), so the two can never drift for a class
that has both.

**`class.multiclass.gains` (T2 carry #3, ruling 2): the five slice-1 classes.** Fighter, Wizard,
Barbarian, Cleric and Warlock's own class entities carry real `gains` data (a later class's
proficiencies when multiclassed in — `packages/engine/src/derive/index.ts`'s `deriveProficiencies`
applies it as a RESTRICTION, never a union, replacing that class's own full proficiency lists for
any class beyond the character's first). ⚠️ OWNER-FLAG, 2024-SRD-silent: `Rule.json`'s own
`srd-2024_multiclassing_proficiencies` entry is prose only ("you gain only some of the new class's
starting proficiencies, as detailed in each class's description") — no `ClassFeature` entry anywhere
in this vendored snapshot actually details it per class. Authored from public SRD 5.2.1 knowledge
(the 2014→2024-unchanged multiclass proficiencies table). Plan 12 authored `gains` for all 12 classes;
Bard, Rogue and Ranger carry `skillChoiceCount: 1`, every other class `0`. Since the plan-12 final
wave the engine consumes it: a LATER class with `gains` is offered a bonus skill choice on multiclass
entry (synthetic `<classId>@1/multiclass-skills`, `skillChoiceCount` picks from the new class's own
`skillChoice.from` list) instead of the full `<classId>@1/skills` creation pick, which is reserved
for the initial class. A later class with no `gains` keeps its full pick and full proficiency list
(`deriveProficiencies`'s documented compat fallback). Plan 14 task 1 added
`gains.toolProficiencies` (slug list, default `[]`, emitted for all 12 classes): a later class grants
those as `kind: 'tool'` rows. Rogue's is `["thieves-tools"]`, every other class's is empty; the
later-class Bard's one instrument is the scoped pick `bard@1/multiclass-tools` instead (see "Choice
scope"). Same owner-flag as the rest of `gains`: the vendored snapshot has no per-class multiclass
rows, and these two are authored from the public SRD 5.2.1 table.

Pact Magic slots (Warlock) recover on a short OR long rest — the vendored 2024 SRD's own Warlock
feature text (`packages/content/upstream/open5e-srd-2024/ClassFeature.json`, pk
`srd-2024_warlock_pact-magic`): "You regain all expended Pact Magic spell slots when you finish a
Short or Long Rest." The reducer stays content-free (it doesn't know "Warlock" by name), so this is
NOT hardcoded into `rest.taken@1`'s handler — same as `resourcesUsed`, it's the proposer's job (T14)
to emit an explicit `slot.restored {pact: true, count}` event as part of a rest transaction, exactly
like `resource.restored` is emitted per active resource today.

## Item charges and attunement

`item.charges` (optional; phase 4, plan 11 task 4) is `{ max: Formula, reset:
shortRest|longRest|dawn|never, regain?: RegainDice }` (`regain`: plan 13 task 6, see "Rolled
charge regain" below) — the same formula grammar every other resource max uses
(`level`, `prof`, `classLevel(id)`, `mod(ab)`, `score(ab)`, `hitDie(classId)`, `resource(id)`).
`@hk/engine`'s `deriveResources` materializes one resource per ACTIVE (equipped OR attuned)
inventory instance whose item declares `charges`, keyed `item:<instanceId>` — never
`item:<itemId>`, so two instances of the same item never collide, and the key can never collide
with a `resource.define` id either (`item:` contains a colon, illegal in every `SlugSchema`
value used for those ids). This reuses the existing `resource.spent`/`resource.restored` events
and `propose/rest.ts`'s generic reset-by-trigger sweep unchanged — no new event type. A charged
item's resource (and its spend/restore controls) exists only while the item is active;
un-equipping/un-attuning it removes it from `Sheet.resources`, but `facts.resourcesUsed` for that
key is untouched and simply resumes being read on re-equip (removing the item from inventory
entirely leaves a harmless orphaned key).

**Charge parsing (phase 4 slice 2, plan 12 task 6).** The SRD pack's `item.charges` are not
hand-authored: `packages/content/src/transform/charges.ts` derives them from each magic item's
vendored description. `max` comes from exactly one distinct "has/have N charges" figure (N >= 1;
dice maxes never match and are skipped). `reset` comes from the regain sentence: "regains ...
expended charges daily at dawn" maps to `dawn`; an item with no regain sentence at all maps to
`never`; any other regain wording is skipped rather than guessed. 43 items are mechanized (39
`dawn`, 4 `never`), pinned by an exact manifest in `packages/content/test/charges.test.ts`.
Slice 2 shipped two documented v1 approximations, both owner-flagged (the second is retired by
plan 13 task 6):

- **Dawn on long rest.** The engine has no "dawn" trigger event, so `propose.rest`'s long-rest
  sweep restores every `reset: 'dawn'` charged item as well as `longRest` ones (a short rest is
  unchanged). `reset: 'never'` items are never swept; their charges are restored manually with
  `resource.restored`.
- ~~**Rolled regain amounts fully restore.**~~ *Retired by plan 13 task 6.* In slice 2 the
  vendored regain amount ("1d6 + 4", "all") was parsed but not stored, so a "regains 1d6 + 4
  charges at dawn" item was restored to FULL by the long-rest sweep. See "Rolled charge regain".

**Rolled charge regain (plan 13 task 6).** `item.charges.regain` (optional) is the dice an item
regains when its `reset` fires, validated by `RegainDiceSchema` — the `DiceSchema` pattern plus `d3`
(both built from one shared list of die sides; `DiceSchema` itself is unchanged and still refuses
`d3`). A schema refine refuses `regain` on a `reset: 'never'` item. The content transform emits it
only for a dice amount: 38 of the 43 charged SRD items carry `regain` (14 of them `1d3`, e.g. Wand of
Secrets, Ring of Evasion, Cubic Gate); Eyes of Charming ("regain all") and the 4 `never` items carry
none and keep the full restore. The sheet exposes it as `ResourceView.regain` (absent when empty).
The CALLER rolls, as with hit dice: `propose.rest(sheet, kind, hitDice, regainRolls)` (both trailing
parameters required — pass `undefined` / `{}` explicitly) takes
`regainRolls[resourceId] = <rolled total>` and records it as `resource.restored {resourceId, count}`
(no new event field; doc 02). The refusal is all-or-nothing: a missing total
(`rest.regain-roll-missing`) or a total outside the dice's min..max or not an integer
(`rest.regain-roll-invalid`) refuses the WHOLE rest — never a silent full restore. Resources
without `regain` keep the byte-identical full-restore event. The web app rolls every `regain`
resource with the same `roll(parseRollSpec(...), cryptoRng)` path the hit-die roll uses.

**Progression-driven choice counts (plan 12 task 2).** `choice.count` is `int | Formula`. An
integer behaves exactly as before. A formula (same grammar and context as a resource max; only
`level`, `classLevel()` and `hitDie()` are live when choices are requested, the rest evaluate to
0) is resolved per character and floored/clamped to at least 1 (`derive/choice-count.ts`). When a
formula count grows past an already-recorded decision (e.g. Fighter's weapon masteries, 3 → 6),
the SAME choice id is re-offered and re-answering replaces the decision with the full set.
Integer counts keep the historical never-re-asked behavior, so existing event logs are unchanged.
`validatePack` validates formula counts on entity and row choices.

**Always-prepared spell grants (plan 12 task 3).** `spell.grant { alwaysPrepared: true }`
(already in the schema) is now honored: the granting class (the effect's source entity if it is a
class, or its parent class for a subclass) gets the spell on its spellcasting block, which exposes
`alwaysPrepared?: string[]` (absent when none) and merges those spells into `prepared`, deduped
by spell id. Always-prepared spells do not count against `preparedMax`, and
`propose.unprepare` refuses them with the `spell.always-prepared` code. Feat/species/item sources
bind to no block, so the content validator reports `spell.grantUnbound` for an `alwaysPrepared`
grant on a feat, species, background or item.

**Free casts (plan 13 task 4).** `spell.grant.uses` is either an inline counter `{count, per}` or a
reference `{resource}` to an existing resource id. Every active grant with `uses` adds one
`sheet.freeCasts` entry `{spellId, resourceId, level}` (absent when none): the reference form spends
the named resource (Favored Enemy's Hunter's Mark casts spend `favored-enemy`; Wild Companion's Find
Familiar spends a `wild-shape` use), the inline form materializes a resource whose id is the spell's
slug (named after the spell; a `resource.define` with that id merges with it under the rules above).
`level` is the grant's `level`, else the spell's base level, and is the only level a free cast uses
(no slot, so no upcast). `propose.cast(..., {freeResource})` drafts `spell.cast {slotUsed: false}` +
`resource.spent`; it refuses `spell.free-cast-unavailable` (no such entry, another level, or combined
with `pact`/`useSlot: true`) and `resource.none-left` (counter empty). The slot lanes never touch the
counter. A reference to a resource the sheet lacks is not offered (`derive.freeCastResourceMissing`).

**Tool proficiencies (plan 13 task 2).** Tool proficiencies are not a separate sheet field: they
land in the existing `sheet.proficiencies` array as rows with `kind: 'tool'` and `target` = the
tool item's slug (`thieves-tools`, `gaming-set-dice`, `musical-instrument-lute`), so one tool from
several sources merges into one row and consumers filter by `kind`. Sources: the INITIAL class's
`toolProficiencies` (Rogue: Thieves' Tools), a later class's `multiclass.gains.toolProficiencies`
(plan 14 task 1; Rogue again), every active background's `toolProficiency` (the Soldier no longer
carries one — since plan 14 task 2 its gaming set is a pick), a decided pick whose selections are items of category
`tool` (whoever owns the choice — a `static` pick over item ids, or a `queries` pick such as Skilled;
Monk `@1/tools` offers one Artisan's Tools or Musical Instrument, Bard `@1/tools` three Musical
Instruments, Soldier `@0/tools` one Gaming Set), and `proficiency.grant {kind: 'tool'}` effects. The
play tab lists them under Tools in the Proficiencies section. ~~Known residual: a later-class Bard is
still offered three instruments and a later-class Monk a tool.~~ *Retired by plan 14 task 1* (choice
`scope`): a later Bard is offered one instrument, a later Monk no tool.

**Multiclass attack proficiency (plan 13 task 7).** `classProficiencyGrants(facts, index)`
(`derive/proficiency.ts`) is the one place that decides which class lists apply — the first class's
full armor/weapon/tool lists, a later class's `multiclass.gains` (tools since plan 14 task 1), or a
gains-less later class's full lists (compat). Both `sheet.proficiencies` and the attack table
(`derive/attacks.ts`) read it, so an attack line can no longer be proficient when the sheet's
proficiency list says it is not (a Wizard → Rogue no longer adds proficiency to a rapier).

**Multiclass weapon mastery (plan 14 task 4).** `sheet.masteryCount` is the MAX over the active
`mastery.grant` resolved counts, not their sum, and the cap is shared: `derive/attacks.ts` collects
every `weapon-masteries` choice in class order (each class's own and row choices through the
scope-aware `offeredRowChoices`, then its subclass's, then any other active entity) and fills at most
`masteryCount` slots in that order, then in recorded order within a decision. A weapon picked twice
counts once, and only selections that resolve to an `item` entity take a slot. A selection beyond the
cap is silently not applied — no diagnostic, because each decision is still valid against its own
`count`. Example: Fighter 5 / Barbarian 3 → `masteryCount` 4 (the fighter row extra is 4 from fighter
level 4; Barbarian 2), where the old sum gave 6. ⚠️ OWNER-FLAG: the vendored multiclassing rule
(`Rule.json` pk `srd-2024_multiclassing_class-features`) names only Extra Attack, Spellcasting and
alternative AC as special cases and never mentions mastery, so max-with-a-shared-cap is
PHB-sourced. The later class's mastery choice is still offered when the cap is already full; its
picks only apply up to the cap.

**Speed formulas (plan 13 task 5).** `speed.bonus.value` is `int | Formula` (`speed.set` stays an
int). A formula bonus resolves through the shared evaluator, so a scaling column becomes one row:
Monk Unarmored Movement is `10 + 5 * floor((classLevel(monk) - 2) / 4)` gated on no armor, no
shield, Monk level 2+. A NON-walk `speed.bonus` value may also read `speed(walk)`: derive resolves
walk first (after all walk bonuses have been added), then every other mode with `speed(walk)` bound
to that value. Pack validation (`formula.speedSymbol`) refuses `speed()` anywhere else — in a walk
bonus or in any other formula — and refuses any argument but `walk`, so a mode can
never read itself or chain through another mode (no cycles). **Key convention for "a <mode> Speed
equal to your Speed":** author it as `speed.bonus {mode, value: "speed(walk)", key:
"<mode>-equal-to-speed"}` (Ranger Roving uses `climb-equal-to-speed` and `swim-equal-to-speed`).
Bonuses that share a key keep only the highest (`sum-unique-key`), so two such grants on the same
mode dedupe; a grant with a DIFFERENT key would SUM with it and double the speed. Every future
"equal to your Speed" grant must reuse the per-mode key. Plan 14 task 3 added four more users, all
on the same keys: Thief Second-Story Work's Climber (climb), Gloves of Swimming and Climbing (climb +
swim), Slippers of Spider Climbing (climb) and Cloak of Arachnida (climb). A Thief wearing attuned
Slippers, or attuned Slippers plus Cloak, still has climb = walk (30), not double.

**Condition immunities (plan 13 task 5).** Active `condition.immunity` effects (after their `when`
predicates) derive into `sheet.immunities?: {condition, sources}[]` — sorted by condition id,
`sources` = the granting features, unique and sorted; absent when empty. It is display-only: nothing
blocks `condition.added`. SRD content: Paladin Aura of Courage (Frightened) and Aura of Devotion
(Charmed), each gated `not {condition: incapacitated}` like Aura of Protection; the "and your allies"
half stays in the description. Berserker Mindless Rage stays text: its immunity applies "while your
Rage is active" and no raging fact or predicate exists, so an ungated immunity would be wrong.

**Damage resistances (plan 14 task 3).** Before this task `damage.resistance` had no derive consumer
and no pack entity used it. Active `damage.resistance` effects now derive into
`sheet.resistances?: {type, sources}[]` (`derive/resistances.ts`), mirroring `sheet.immunities`
exactly: sorted by damage type, `sources` unique and sorted, absent when empty, display only (no
damage math reads it; no protocol change, `Sheet` is an engine type). The play tab shows a
Resistances heading with one badge per type after the immunity badges (plan 14 task 6), naming the
type through the pack's `rule/damage-type-<slug>` entity. SRD content: Cloak of Arachnida (Poison).

`item.attunement` (optional) is `{ required: boolean, by?: Predicate }`. `by`, when present, is
the item's own attunement-requirement predicate (e.g. "requires attunement by a Wizard") —
evaluated at derive time, per inventory instance, against that instance's own predicate context
(ability scores, class, level, tags, active features), and pre-resolved onto
`Sheet.inventory[].attunementAllowed` (present only when `by` exists; absent means no
restriction). `propose.attune()` refuses with the `'attune.by'` code when `attunementAllowed ===
false`, checked BEFORE the pre-existing `'attune.max'` cap (`sheet.attunementMax`). `attunementMax`
itself defaults to `system.attunementMax` but can be overridden per `derive()` call via the
optional 4th `overrides: { attunementMax?: number, encumbrance?: 'off'|'standard'|'variant' }`
parameter (`derive/overrides.ts`'s `DeriveOverrides`) — the same override seam `encumbrance`
below reuses; a campaign's own house-rule `attunementMax` (plan-10's edit-lock projection) is
what the client threads through it. `Sheet.overridesProvenance` — `{ attunementMax?: 'house
rule', encumbrance?: 'house rule' | 'character option' }` — records that tag per-key, only for
whichever override(s) were actually supplied, so the sheet can show it as such (`'character option'`
since plan 14 task 5 — see "Encumbrance" and doc 05).

**Attunement gating (plan 14 task 3).** An inventory instance whose item has `attunement.required:
true` activates its effects and grants ONLY while `attuned`; equipping it alone does nothing. Every
other item keeps the `equipped || attuned` rule. This is one generic gate in
`derive/composition.ts`'s inventory loop — no item is named in code. Charges are deliberately NOT
gated: an equipped-but-unattuned charged item still materializes its `item:<instanceId>` resource
(above). An attuned item that is not worn stays active (the old behavior, kept by the plan's ruling).

**Items overlay (plan 14 task 3).** `packages/content/src/overlays/items.json` is the first overlay
that patches item entities; it is applied last in `build.ts` and only MERGES `effects` into three
existing items (whose upstream `effects` were `[]`), so the pack still has 1866 entities. Before it,
0 of the 960 items carried effects. Each patch cites its vendored `MagicItem` pk:

- Gloves of Swimming and Climbing (`srd-2024_gloves-of-swimming-and-climbing`): climb and swim
  `speed(walk)` bonuses, `skill.bonus {target: 'athletics', value: 5}`, and a `feature.text`
  restating the climb/swim-only scope. ⚠️ OWNER-FLAG: `skill.bonus` has no "checks made to climb or
  swim" scope, so the sheet's Athletics total includes the +5 for every Athletics check.
- Slippers of Spider Climbing (`srd-2024_slippers-of-spider-climbing`): climb `speed(walk)` and a
  `feature.text` for the walls/ceilings and slippery-surface wording.
- Cloak of Arachnida (`srd-2024_cloak-of-arachnida`): `damage.resistance ['poison']`, climb
  `speed(walk)`, `spell.grant {spell: 'srd-5e-2024:spell/web', uses: {count: '1', per: 'dawn'}}` (the
  first real inline-`uses` free cast, resource id `web`), and `feature.text` entries for Spider Climb,
  Spider Walk and Web. ⚠️ OWNER-FLAG: `spell.grant` has no fixed-DC field, so the item's "save DC
  13" is text only and the free cast uses the sheet's casting context; the doubled area is text too.

All three require attunement, so each applies only while attuned (gate above).

## Encumbrance

`system.encumbrance` (optional; phase 4, plan 11, task 5) holds carry-capacity formulas/thresholds
for `@hk/engine`'s `deriveEncumbrance` — DATA, never a hardcoded 5e number in engine code, and
computed ONLY when a `derive()` call opts in via `overrides.encumbrance: 'standard' | 'variant'`
(the 4th, optional `derive()` parameter — see `packages/engine/src/derive/overrides.ts`). The
default, `'off'` (or `overrides` omitted entirely, as every pre-phase-4 call site still does), is
zero computation — no `Sheet.carry` field, no `Sheet.overridesProvenance.encumbrance` key — so
every existing golden/fixture stays byte-identical. Since plan 14 task 5 a character can also opt in
by itself: the `character.options.set@1` event (doc 02) stores `facts.options.encumbrance`, and the
mode derive uses is `overrides.encumbrance ?? facts.options.encumbrance ?? 'off'` — a campaign house
rule (even `'off'`) beats the character option, which beats the default. Provenance and the Build
tab's Rule options control are described in doc 05 ("Rule options").

```jsonc
"encumbrance": {
  "standard": { "capacity": "score(str) * 15" },
  "variant": {
    "capacity": "score(str) * 15",           // hard cap: load beyond this is always 'overloaded'
    "thresholds": [
      { "capacity": "score(str) * 5", "state": "encumbered", "speedPenalty": 10 },
      { "capacity": "score(str) * 10", "state": "heavilyEncumbered", "speedPenalty": 20 }
    ]
  }
}
```

**SRD-silent, verified (not assumed).** Unlike `multiclassSlots` above, the vendored 2024 snapshot
has NO numeric carrying-capacity or encumbrance rule text to quote at all, for either mode. Checked
directly: `packages/content/upstream/open5e-srd-2024/Rule.json`'s own "Interacting with Objects"
entry (pk `srd-2024_exploration_interacting-with-objects`) says only "the GM might require you to
abide by the rules for carrying capacity in 'Rules Glossary'" — that glossary chapter (where the
2024 PHB actually states the STR×15/×5/×10 numbers) is not part of this vendored snapshot's 56 Rule
entries, none of which mention carrying/lifting weight numerically; `ConditionDescription.json`'s
15 conditions also include no "encumbered" state. So the example above is TEST-FIXTURE data (used
in `packages/protocol/test/fixtures/packs/core-mini.json` and this repo's own engine tests), chosen
to match the commonly-known 5e convention for readability, but it carries **no SRD citation**.

**Real system data (T5 carry, phase 4 plan 11 task 7).** `srd-5e-2024:system/5e-2024` now carries
this exact same `standard`/`variant` configuration — OWNER-FLAG, since no independently-citable
vendored text exists for either mode (see above); recorded as this pack's own documented choice
(the well-known public 5e carrying-capacity formulas, STR score × 15/5/10), matching
`multiclassSlots.weights.third`'s OWNER-FLAG posture.

**Shape.** `standard` and `variant` are independently optional (a pack may supply either, both, or
neither); `overrides.encumbrance` selects which one a given `derive()` call uses — asking for a mode
the pack doesn't supply produces a `'derive.encumbranceConfigMissing'` warning diagnostic and no
`Sheet.carry` (not a crash). `standard.capacity` is a single hard cap: `Sheet.carry.state` is binary,
`'normal'` or `'overloaded'`. `variant.capacity` is likewise a hard cap (`'overloaded'` beyond it,
taking priority over the graded thresholds), and `variant.thresholds[]` are graded states — sorted
ascending by resolved `capacity` and applied with `load >= threshold.capacity`, so the HIGHEST
satisfied threshold wins; below every threshold is `'normal'`.

**Load.** `Sheet.carry.load` sums EVERY `facts.inventory` entry's resolved weight × `qty` — unlike
item charges/attunement (which only apply to an ACTIVE, equipped-or-attuned instance), carrying
capacity counts everything on a character's person regardless of equipped state. A resolved item
reads `item.weight ?? 0` (the field predates this task — see the entity table above); a fully custom
inventory entry (no `itemId`) reads `custom.weight` if it's a number, else `0` (`custom` is a
free-form bag with no schema-enforced `weight` key). `item.container.capacityLb` (existing field) is
NOT consumed by this total — reducing effective load for items carried inside a container is
out of this task's scope, a candidate for later work.

**Speed.** `variant.thresholds[].speedPenalty` is carried as DATA only — `deriveEncumbrance` does
NOT apply it to `Sheet.speed` this task (no vendored text exists to justify a specific
speed-reduction NUMBER as SRD fact, the same silence noted above). It's a display-only hook for a
later consumer (e.g. task 12's UI, or a future engine task) to read directly off the matched
threshold; `Sheet.speed` itself is untouched by encumbrance in this phase.

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
