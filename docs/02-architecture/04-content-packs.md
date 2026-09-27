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
school?, hasField?} }`, `{ "abilities": { "count": 2, "max": 20, "improve": "+1|+2/+1" } }` (ASI-style
improvements), `{ "abilityGeneration": true }` (the creation-time score assignment; the
allowed methods and their parameters come from `system.abilityGeneration`, and the
selection records the method, the six scores and — for `roll` — every die result),
`{ "literal": "text" }` (names), `{ "equipmentOption": [...] }`. Selections are stored in
`decision.made` events by choice id.

`EntityQuerySchema`'s filters are AND-combined: `tags` (an entity's `tags[]` must include every
listed tag) and `hasField` (dot-paths, e.g. `"weapon.mastery"`, that must be present on the
candidate entity — a field-presence filter, preferred over inventing a bespoke tag taxonomy for
data the schema already models structurally). Fighter's Weapon Mastery choice, for example, is a
real entity query rather than a `literal: "text"` placeholder:
`{ "query": { "type": "item", "hasField": ["weapon.mastery"] } }` selects exactly the items that
carry a weapon-mastery property.

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
| `attack.bonus` / `damage.bonus` | `value (formula), filter {weapon?: melee\|ranged\|any, spell?: true}` | Archery |
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
(the 2014→2024-unchanged multiclass proficiencies table); none of the five grants a bonus skill
choice (that's reserved for Bard/Rogue in the 2024 table, neither in this slice), so every
`skillChoiceCount` is `0`. The other 7 classes carry no `multiclass` field on their own class entity
at all (only the system map's entry, above) — `gains` is unauthored for them until a later slice
needs it; `deriveProficiencies`'s documented compat fallback (absent `gains` = full proficiency list)
already covers this correctly.

Pact Magic slots (Warlock) recover on a short OR long rest — the vendored 2024 SRD's own Warlock
feature text (`packages/content/upstream/open5e-srd-2024/ClassFeature.json`, pk
`srd-2024_warlock_pact-magic`): "You regain all expended Pact Magic spell slots when you finish a
Short or Long Rest." The reducer stays content-free (it doesn't know "Warlock" by name), so this is
NOT hardcoded into `rest.taken@1`'s handler — same as `resourcesUsed`, it's the proposer's job (T14)
to emit an explicit `slot.restored {pact: true, count}` event as part of a rest transaction, exactly
like `resource.restored` is emitted per active resource today.

## Item charges and attunement

`item.charges` (optional; phase 4, plan 11 task 4) is `{ max: Formula, reset:
shortRest|longRest|dawn|never }` — the same formula grammar every other resource max uses
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
rule', encumbrance?: 'house rule' }` — records that tag per-key, only for whichever override(s)
were actually supplied, so the sheet can show it as such.

## Encumbrance

`system.encumbrance` (optional; phase 4, plan 11, task 5) holds carry-capacity formulas/thresholds
for `@hk/engine`'s `deriveEncumbrance` — DATA, never a hardcoded 5e number in engine code, and
computed ONLY when a `derive()` call opts in via `overrides.encumbrance: 'standard' | 'variant'`
(the 4th, optional `derive()` parameter — see `packages/engine/src/derive/overrides.ts`). The
default, `'off'` (or `overrides` omitted entirely, as every pre-phase-4 call site still does), is
zero computation — no `Sheet.carry` field, no `Sheet.overridesProvenance.encumbrance` key — so
every existing golden/fixture stays byte-identical.

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
