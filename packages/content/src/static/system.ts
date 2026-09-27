import type { Entity, Predicate } from '@hk/protocol';
import { conditionId, entityId } from '../ids.ts';
import { SYSTEM_ID } from '../version.ts';

const SOURCE = { book: 'SRD 5.2.1' };

/** The 15 core conditions, as produced by Task 6's transform (`srd-5e-2024:condition/<slug>`). */
const CONDITION_SLUGS = [
  'blinded',
  'charmed',
  'deafened',
  'exhaustion',
  'frightened',
  'grappled',
  'incapacitated',
  'invisible',
  'paralyzed',
  'petrified',
  'poisoned',
  'prone',
  'restrained',
  'stunned',
  'unconscious',
];

/** XP required to *be* level i+1 (xp[0] = 0), from the SRD 5.2.1 Character Advancement table. */
const XP_TABLE = [
  0, 300, 900, 2700, 6500, 14000, 23000, 34000, 48000, 64000, 85000, 100000, 120000, 140000, 165000, 195000, 225000,
  265000, 305000, 355000,
];

/** Proficiency bonus at level i+1, from the SRD 5.2.1 Character Advancement table. */
const PROFICIENCY_TABLE = [2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 6, 6, 6, 6];

/** Full-caster spell slots per level (rows = levels 1-20, columns = slot levels 1-9). */
const FULL_CASTER_SLOTS = [
  [2],
  [3],
  [4, 2],
  [4, 3],
  [4, 3, 2],
  [4, 3, 3],
  [4, 3, 3, 1],
  [4, 3, 3, 2],
  [4, 3, 3, 3, 1],
  [4, 3, 3, 3, 2],
  [4, 3, 3, 3, 2, 1],
  [4, 3, 3, 3, 2, 1],
  [4, 3, 3, 3, 2, 1, 1],
  [4, 3, 3, 3, 2, 1, 1],
  [4, 3, 3, 3, 2, 1, 1, 1],
  [4, 3, 3, 3, 2, 1, 1, 1],
  [4, 3, 3, 3, 2, 1, 1, 1, 1],
  [4, 3, 3, 3, 3, 1, 1, 1, 1],
  [4, 3, 3, 3, 3, 2, 1, 1, 1],
  [4, 3, 3, 3, 3, 2, 2, 1, 1],
];

/** No spellcasting: twenty empty slot rows. */
const NO_CASTER_SLOTS: number[][] = Array.from({ length: 20 }, () => []);

/**
 * Half-caster spell slots (Paladin/Ranger), levels 1-20 — vendored verbatim from
 * `packages/content/upstream/open5e-srd-2024/ClassFeatureItem.json`'s per-level
 * `srd-2024_paladin_slots-1st`..`slots-5th` rows (cross-checked byte-identical to Ranger's own
 * `srd-2024_ranger_slots-1st`..`slots-5th` rows — both classes share the standard half-caster
 * progression).
 */
const HALF_CASTER_SLOTS = [
  [2],
  [2],
  [3],
  [3],
  [4, 2],
  [4, 2],
  [4, 3],
  [4, 3],
  [4, 3, 2],
  [4, 3, 2],
  [4, 3, 3],
  [4, 3, 3],
  [4, 3, 3, 1],
  [4, 3, 3, 1],
  [4, 3, 3, 2],
  [4, 3, 3, 2],
  [4, 3, 3, 3, 1],
  [4, 3, 3, 3, 1],
  [4, 3, 3, 3, 2],
  [4, 3, 3, 3, 2],
];

/**
 * Third-caster spell slots (Eldritch Knight/Arcane Trickster), levels 1-20 — OWNER-FLAG,
 * 2024-SRD-silent: this vendored SRD 5.2.1 snapshot doesn't include either subclass (Fighter's only
 * subclass here is Champion, Rogue's is Thief — verified via `CharacterClass.json`'s
 * `subclass_of` links, which name only the 12 SRD subclasses), so there is no vendored per-level
 * table to transcribe. Authored from public SRD/PHB knowledge (the third-caster progression is
 * unchanged 2014→2024: one-third of a full caster's levels, spellcasting starts at class level 3,
 * capped at 4th-level spells) — same posture as `multiclassSlots.weights.third` below.
 */
const THIRD_CASTER_SLOTS = [
  [],
  [],
  [2],
  [3],
  [3],
  [3],
  [4, 2],
  [4, 2],
  [4, 2],
  [4, 3],
  [4, 3],
  [4, 3],
  [4, 3, 2],
  [4, 3, 2],
  [4, 3, 2],
  [4, 3, 3],
  [4, 3, 3],
  [4, 3, 3],
  [4, 3, 3, 1],
  [4, 3, 3, 1],
];

/**
 * Pact Magic spell slots (Warlock), levels 1-20 — vendored verbatim from `ClassFeatureItem.json`'s
 * `srd-2024_warlock_spell-slots` (count per level) and `srd-2024_warlock_slot-level` (slot level per
 * level) rows, combined into T3's sparse-row encoding (`packages/engine/src/derive/spellcasting.ts`:
 * exactly one nonzero index per row — `row.findIndex(v => v > 0) + 1` is the slot level, the value at
 * that index is the count). Cross-checked against `ClassFeature.json`'s own `srd-2024_warlock_pact-
 * magic` worked example: "when you're a level 5 Warlock, you have two level 3 spell slots" — row
 * index 4 (level 5) below is `[0, 0, 2]`: zero at slot levels 1-2, two slots at slot level 3. Matches.
 */
const PACT_SLOTS = [
  [1],
  [2],
  [0, 2],
  [0, 2],
  [0, 0, 2],
  [0, 0, 2],
  [0, 0, 0, 2],
  [0, 0, 0, 2],
  [0, 0, 0, 0, 2],
  [0, 0, 0, 0, 2],
  [0, 0, 0, 0, 3],
  [0, 0, 0, 0, 3],
  [0, 0, 0, 0, 3],
  [0, 0, 0, 0, 3],
  [0, 0, 0, 0, 3],
  [0, 0, 0, 0, 3],
  [0, 0, 0, 0, 4],
  [0, 0, 0, 0, 4],
  [0, 0, 0, 0, 4],
  [0, 0, 0, 0, 4],
];

/**
 * Ruling 2 / T2 carry (phase 4 plan 11 task 7): the 2024 SRD multiclass prerequisite for each of the
 * 12 classes, keyed by slug (`ClassRefSchema` accepts a bare slug — resolved against the same pack
 * by `ContentIndex.resolveClassRef`). Exported so `transform/classes.ts` can reuse the SAME predicate
 * values (not a second hand-typed copy) when it populates the five slice-1 classes' own
 * `multiclass.prerequisites` field (required alongside `gains` by `ClassEntitySchema.multiclass`'s
 * shape). This is the GATING authority `advancement.ts`'s `pendingAdvancements` reads
 * (`system.multiclass?.prerequisites`); the class-entity-level `multiclass.prerequisites` field is
 * validation/reference-collection only (`content/refs.ts`'s dependency-ref collector) — see doc-04.
 *
 * Single primary ability (8 classes) — cited verbatim from the vendored 2024 SRD
 * (`packages/content/upstream/open5e-srd-2024/Rule.json`, pk
 * "srd-2024_multiclassing_prerequisties"): "you must have a score of at least 13 in the primary
 * ability of the new class", combined with `transform/classes.ts`'s own `PRIMARY_ABILITY` table
 * (itself verified against each class's Core Traits "Primary Ability" text).
 *
 * OWNER-FLAG — dual primary ability (Fighter, Monk, Paladin, Ranger, 4 classes): the quoted passage
 * and its one worked example (Barbarian → Druid) only cover classes with a SINGLE primary ability;
 * it never states whether a class with TWO primary abilities (Fighter: str/dex; Monk: dex/wis;
 * Paladin: str/cha; Ranger: dex/wis) needs EITHER or BOTH at 13+. Authored from public SRD/PHB
 * knowledge (unchanged since the 2014 Multiclassing Prerequisites table): Fighter is an OR (either
 * ability qualifies — matches its own "Strength or Dexterity" primary-ability phrasing); Monk,
 * Paladin and Ranger are AND (both abilities required) — not derivable from the vendored snapshot
 * alone, same OWNER-FLAG posture as `multiclassSlots.weights.third` and `encumbrance` below.
 */
export const MULTICLASS_PREREQUISITES: Record<string, Predicate> = {
  barbarian: { ability: { str: { gte: 13 } } },
  bard: { ability: { cha: { gte: 13 } } },
  cleric: { ability: { wis: { gte: 13 } } },
  druid: { ability: { wis: { gte: 13 } } },
  fighter: { any: [{ ability: { str: { gte: 13 } } }, { ability: { dex: { gte: 13 } } }] },
  monk: { all: [{ ability: { dex: { gte: 13 } } }, { ability: { wis: { gte: 13 } } }] },
  paladin: { all: [{ ability: { str: { gte: 13 } } }, { ability: { cha: { gte: 13 } } }] },
  ranger: { all: [{ ability: { dex: { gte: 13 } } }, { ability: { wis: { gte: 13 } } }] },
  rogue: { ability: { dex: { gte: 13 } } },
  sorcerer: { ability: { cha: { gte: 13 } } },
  warlock: { ability: { cha: { gte: 13 } } },
  wizard: { ability: { int: { gte: 13 } } },
};

/**
 * The complete `srd-5e-2024:system/5e-2024` entity: rules tables, composition slots, and ability
 * generation for the D&D 5e 2024 ruleset. Carries no creation choices — those are overlaid in
 * Task 11.
 */
export function systemEntity(): Entity {
  return {
    type: 'system',
    id: entityId('system', SYSTEM_ID),
    name: 'D&D 5e (2024 rules)',
    description: 'The D&D 5e 2024 ruleset as defined by the SRD 5.2.1.',
    tags: [],
    source: SOURCE,
    prerequisites: [],
    effects: [],
    grants: [],
    choices: [],
    abilities: [
      { id: 'str', name: 'Strength' },
      { id: 'dex', name: 'Dexterity' },
      { id: 'con', name: 'Constitution' },
      { id: 'int', name: 'Intelligence' },
      { id: 'wis', name: 'Wisdom' },
      { id: 'cha', name: 'Charisma' },
    ],
    skills: [
      { id: 'acrobatics', name: 'Acrobatics', ability: 'dex' },
      { id: 'animal-handling', name: 'Animal Handling', ability: 'wis' },
      { id: 'arcana', name: 'Arcana', ability: 'int' },
      { id: 'athletics', name: 'Athletics', ability: 'str' },
      { id: 'deception', name: 'Deception', ability: 'cha' },
      { id: 'history', name: 'History', ability: 'int' },
      { id: 'insight', name: 'Insight', ability: 'wis' },
      { id: 'intimidation', name: 'Intimidation', ability: 'cha' },
      { id: 'investigation', name: 'Investigation', ability: 'int' },
      { id: 'medicine', name: 'Medicine', ability: 'wis' },
      { id: 'nature', name: 'Nature', ability: 'int' },
      { id: 'perception', name: 'Perception', ability: 'wis' },
      { id: 'performance', name: 'Performance', ability: 'cha' },
      { id: 'persuasion', name: 'Persuasion', ability: 'cha' },
      { id: 'religion', name: 'Religion', ability: 'int' },
      { id: 'sleight-of-hand', name: 'Sleight of Hand', ability: 'dex' },
      { id: 'stealth', name: 'Stealth', ability: 'dex' },
      { id: 'survival', name: 'Survival', ability: 'wis' },
    ],
    saves: ['str', 'dex', 'con', 'int', 'wis', 'cha'],
    compositionSlots: [
      { id: 'species', entityType: 'species', count: 1, at: 'creation' },
      { id: 'background', entityType: 'background', count: 1, at: 'creation' },
      { id: 'class', entityType: 'class', count: 'many', at: 'levelUp' },
    ],
    restTypes: ['shortRest', 'longRest'],
    tables: {
      xp: XP_TABLE,
      proficiency: PROFICIENCY_TABLE,
      spellSlots: {
        full: FULL_CASTER_SLOTS,
        half: HALF_CASTER_SLOTS,
        third: THIRD_CASTER_SLOTS,
        pact: PACT_SLOTS,
        none: NO_CASTER_SLOTS,
      },
      // Ruling 2 (phase 4 plan 11 task 3/7): the 20-row Multiclass Spellcaster table, vendored
      // verbatim from Rule.json's `srd-2024_multiclassing_spellcasting` passage — byte-identical to
      // `FULL_CASTER_SLOTS` above (5e's multiclass table has always mirrored the full-caster table).
      // `third` is OWNER-FLAG SRD-silent (the quoted passage names only full/half casters); the 2014
      // precedent (divisor 3, round down), if adopted, is recorded here as this pack's own choice.
      multiclassSlots: {
        weights: {
          full: { divisor: 1, rounding: 'down' },
          half: { divisor: 2, rounding: 'up' },
          third: { divisor: 3, rounding: 'down' },
        },
        slots: FULL_CASTER_SLOTS,
      },
    },
    currencies: [
      { id: 'cp', name: 'Copper', inCopper: 1 },
      { id: 'sp', name: 'Silver', inCopper: 10 },
      { id: 'ep', name: 'Electrum', inCopper: 50 },
      { id: 'gp', name: 'Gold', inCopper: 100 },
      { id: 'pp', name: 'Platinum', inCopper: 1000 },
    ],
    damageTypes: [
      'acid',
      'bludgeoning',
      'cold',
      'fire',
      'force',
      'lightning',
      'necrotic',
      'piercing',
      'poison',
      'psychic',
      'radiant',
      'slashing',
      'thunder',
    ],
    sizes: ['tiny', 'small', 'medium', 'large', 'huge', 'gargantuan'],
    conditions: CONDITION_SLUGS.map((slug) => conditionId(slug)),
    restRules: {
      shortRest: { allowHitDice: true },
      longRest: {
        hpToMax: true,
        restoreAllSlots: true,
        hitDiceRegainDivisor: 2,
        hitDiceRegainMin: 1,
        exhaustionReduce: 1,
      },
    },
    hpRules: { firstLevelMaxHitDie: true, averageRounding: 'up' },
    attunementMax: 3,
    // Ruling 2 / T2 carry: the gating authority for `advancement.ts`'s `pendingAdvancements` — see
    // `MULTICLASS_PREREQUISITES`'s doc comment above for citations and the OWNER-FLAG dual-ability
    // classes.
    multiclass: { prerequisites: MULTICLASS_PREREQUISITES },
    // T5 carry (phase 4 plan 11 task 7): real carry-capacity data for the SRD pack. BOTH `standard`
    // and `variant` are OWNER-FLAG, SRD-silent (T5's report verified the vendored 2024 snapshot has
    // no numeric carrying-capacity/encumbrance text anywhere — `Rule.json`'s own "Interacting with
    // Objects" entry points at a "Rules Glossary" chapter that isn't part of this vendored snapshot).
    // These are the well-known public 5e formulas (STR score × 15/5/10), the same numbers T5's own
    // `core-mini` test fixture already used for readability — recorded here as this pack's own
    // documented choice, not an SRD citation. `off` (no `overrides.encumbrance`) remains the default
    // — every pre-phase-4 `derive()` call stays byte-identical.
    encumbrance: {
      standard: { capacity: 'score(str) * 15' },
      variant: {
        capacity: 'score(str) * 15',
        thresholds: [
          { capacity: 'score(str) * 5', state: 'encumbered', speedPenalty: 10 },
          { capacity: 'score(str) * 10', state: 'heavilyEncumbered', speedPenalty: 20 },
        ],
      },
    },
    abilityGeneration: {
      standardArray: [15, 14, 13, 12, 10, 8],
      pointBuy: {
        budget: 27,
        min: 8,
        max: 15,
        costs: { '8': 0, '9': 1, '10': 2, '11': 3, '12': 4, '13': 5, '14': 7, '15': 9 },
      },
      roll: '4d6kh3',
      manual: { min: 3, max: 18 },
    },
  };
}
