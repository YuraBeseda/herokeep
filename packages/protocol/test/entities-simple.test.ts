import { describe, expect, it } from 'vitest';
import {
  AbilityEntitySchema,
  BackgroundEntitySchema,
  ConditionEntitySchema,
  FeatEntitySchema,
  FeatureEntitySchema,
  LanguageEntitySchema,
  RuleEntitySchema,
  SkillEntitySchema,
  SpeciesEntitySchema,
  SystemEntitySchema,
  TableEntitySchema,
  ToolEntitySchema,
} from '../src/pack/entities-simple.ts';

const P = 'srd-5e-2024';

describe('simple entity schemas', () => {
  it('system entity: composition slots, tables, ability generation', () => {
    const r = SystemEntitySchema.safeParse({
      id: `${P}:system/5e-2024`,
      type: 'system',
      name: 'D&D 5e (2024 rules)',
      abilities: [
        { id: 'str', name: 'Strength' },
        { id: 'dex', name: 'Dexterity' },
        { id: 'con', name: 'Constitution' },
        { id: 'int', name: 'Intelligence' },
        { id: 'wis', name: 'Wisdom' },
        { id: 'cha', name: 'Charisma' },
      ],
      skills: [{ id: 'stealth', name: 'Stealth', ability: 'dex' }],
      saves: ['str', 'dex', 'con', 'int', 'wis', 'cha'],
      compositionSlots: [
        { id: 'species', entityType: 'species', count: 1, at: 'creation' },
        { id: 'background', entityType: 'background', count: 1, at: 'creation' },
        { id: 'class', entityType: 'class', count: 'many', at: 'levelUp' },
      ],
      restTypes: ['shortRest', 'longRest'],
      tables: {
        xp: [0, 300, 900, 2700, 6500],
        proficiency: [2, 2, 2, 2, 3],
        spellSlots: { full: [[2], [3], [4, 2], [4, 3], [4, 3, 2]] },
      },
      currencies: [{ id: 'gp', name: 'Gold', inCopper: 100 }],
      damageTypes: ['fire', 'cold'],
      sizes: ['small', 'medium'],
      conditions: [`${P}:condition/prone`],
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
    });
    expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
  });

  it('accepts minimal valid instances of each simple type', () => {
    const ok = (
      schema: { safeParse: (v: unknown) => { success: boolean; error?: { issues: unknown } } },
      v: unknown,
    ) => {
      const r = schema.safeParse(v);
      expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
    };
    ok(SpeciesEntitySchema, {
      id: `${P}:species/elf`,
      type: 'species',
      name: 'Elf',
      size: 'medium',
      speed: 30,
      creatureType: 'humanoid',
      grants: [{ feature: `${P}:feature/darkvision` }],
    });
    ok(BackgroundEntitySchema, {
      id: `${P}:background/acolyte`,
      type: 'background',
      name: 'Acolyte',
      abilityScores: ['int', 'wis', 'cha'],
      originFeat: `${P}:feat/magic-initiate-cleric`,
      skillProficiencies: ['insight', 'religion'],
      toolProficiency: 'calligraphers-supplies',
    });
    ok(FeatEntitySchema, {
      id: `${P}:feat/alert`,
      type: 'feat',
      name: 'Alert',
      category: 'origin',
      effects: [{ type: 'initiative.bonus', value: 'prof' }],
    });
    ok(FeatureEntitySchema, {
      id: `${P}:feature/second-wind`,
      type: 'feature',
      name: 'Second Wind',
      description: 'Regain HP.',
      uses: { count: '2', per: 'shortRest' },
    });
    ok(ConditionEntitySchema, { id: `${P}:condition/exhaustion`, type: 'condition', name: 'Exhaustion', levels: 6 });
    ok(SkillEntitySchema, { id: `${P}:skill/stealth`, type: 'skill', name: 'Stealth', ability: 'dex' });
    ok(AbilityEntitySchema, { id: `${P}:ability/strength`, type: 'ability', name: 'Strength', abbreviation: 'str' });
    ok(LanguageEntitySchema, { id: `${P}:language/common`, type: 'language', name: 'Common' });
    ok(ToolEntitySchema, { id: `${P}:tool/thieves-tools`, type: 'tool', name: "Thieves' Tools", category: 'artisan' });
    ok(RuleEntitySchema, { id: `${P}:rule/concentration`, type: 'rule', name: 'Concentration', description: '…' });
    ok(TableEntitySchema, {
      id: `${P}:table/travel-pace`,
      type: 'table',
      name: 'Travel Pace',
      columns: ['Pace', 'Per hour'],
      rows: [
        ['Fast', '4 miles'],
        ['Normal', '3 miles'],
      ],
    });
  });

  it('rejects an id whose type does not match the entity type', () => {
    expect(
      SkillEntitySchema.safeParse({ id: `${P}:feat/stealth`, type: 'skill', name: 'Stealth', ability: 'dex' }).success,
    ).toBe(false);
  });

  it('applies base defaults', () => {
    const e = LanguageEntitySchema.parse({ id: `${P}:language/elvish`, type: 'language', name: 'Elvish' });
    expect(e.tags).toEqual([]);
    expect(e.effects).toEqual([]);
    expect(e.grants).toEqual([]);
    expect(e.choices).toEqual([]);
    expect(e.prerequisites).toEqual([]);
  });
});
