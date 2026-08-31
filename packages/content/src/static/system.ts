import type { Entity } from '@hk/protocol';
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
      spellSlots: { full: FULL_CASTER_SLOTS, none: NO_CASTER_SLOTS },
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
