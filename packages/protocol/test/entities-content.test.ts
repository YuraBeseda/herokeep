import { describe, expect, it } from 'vitest';
import { EntitySchema } from '../src/pack/entity.ts';

const P = 'srd-5e-2024';

describe('class / subclass / spell / item', () => {
  it('accepts a Fighter with progression rows and a level-1 equipment choice', () => {
    const r = EntitySchema.safeParse({
      id: `${P}:class/fighter`,
      type: 'class',
      name: 'Fighter',
      hitDie: 10,
      primaryAbility: ['str', 'dex'],
      saves: ['str', 'con'],
      armorTraining: ['light', 'medium', 'heavy', 'shields'],
      weaponProficiencies: ['simple', 'martial'],
      toolProficiencies: [],
      skillChoice: { from: ['acrobatics', 'athletics', 'perception'], count: 2 },
      subclassLevel: 3,
      levels: [
        {
          level: 1,
          grants: [{ feature: `${P}:feature/second-wind` }],
          choices: [
            {
              id: `${P}:class/fighter@1/fighting-style`,
              prompt: 'Fighting Style',
              at: { kind: 'classLevel', class: 'fighter', level: 1 },
              pick: { query: { type: 'feat', tags: ['fighting-style'] } },
            },
            {
              id: `${P}:class/fighter@1/equipment`,
              prompt: 'Starting equipment',
              at: { kind: 'classLevel', class: 'fighter', level: 1 },
              pick: { equipmentOption: [[{ item: `${P}:item/chain-mail` }, { item: `${P}:item/longsword` }]] },
            },
          ],
        },
        { level: 2, grants: [{ feature: `${P}:feature/action-surge` }] },
        { level: 5, grants: [{ feature: `${P}:feature/extra-attack` }], extra: { attacks: 2 } },
      ],
      multiclass: {
        prerequisites: { any: [{ ability: { str: { gte: 13 } } }, { ability: { dex: { gte: 13 } } }] },
        gains: {
          armorTraining: ['light', 'medium', 'shields'],
          weaponProficiencies: ['simple', 'martial'],
          skillChoiceCount: 0,
        },
      },
    });
    expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
  });

  it('accepts a subclass, a spell and three item kinds', () => {
    const ok = (v: unknown) => {
      const r = EntitySchema.safeParse(v);
      expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
    };
    ok({
      id: `${P}:subclass/champion`,
      type: 'subclass',
      name: 'Champion',
      class: `${P}:class/fighter`,
      levels: [{ level: 3, grants: [{ feature: `${P}:feature/improved-critical` }] }],
    });
    ok({
      id: `${P}:spell/fireball`,
      type: 'spell',
      name: 'Fireball',
      level: 3,
      school: 'evocation',
      castingTime: { value: 1, unit: 'action' },
      range: { kind: 'feet', distance: 150 },
      components: { v: true, s: true, m: true, materialText: 'a ball of bat guano and sulfur' },
      duration: { kind: 'instantaneous' },
      concentration: false,
      ritual: false,
      classes: ['sorcerer', 'wizard'],
      damage: { dice: '8d6', type: 'fire' },
      save: 'dex',
      higherLevels: 'The damage increases by 1d6 for each spell slot level above 3.',
    });
    ok({
      id: `${P}:item/longsword`,
      type: 'item',
      name: 'Longsword',
      category: 'weapon',
      cost: { amount: 15, currency: 'gp' },
      weight: 3,
      weapon: {
        kind: 'melee',
        category: 'martial',
        damage: '1d8',
        damageType: 'slashing',
        versatile: '1d10',
        properties: ['versatile'],
        mastery: 'sap',
      },
    });
    ok({
      id: `${P}:item/chain-mail`,
      type: 'item',
      name: 'Chain Mail',
      category: 'armor',
      cost: { amount: 75, currency: 'gp' },
      weight: 55,
      armor: { category: 'heavy', ac: 16, strength: 13, stealthDisadvantage: true },
    });
    ok({
      id: `${P}:item/ring-of-protection`,
      type: 'item',
      name: 'Ring of Protection',
      category: 'magic',
      rarity: 'rare',
      attunement: { required: true },
      effects: [
        { type: 'ac.bonus', value: 1, key: 'ring-of-protection' },
        { type: 'save.bonus', value: 1 },
      ],
    });
  });

  it('rejects mismatched ids, unknown types, and out-of-range spell levels', () => {
    expect(EntitySchema.safeParse({ id: `${P}:spell/x`, type: 'item', name: 'X', category: 'gear' }).success).toBe(
      false,
    );
    expect(EntitySchema.safeParse({ id: `${P}:spell/x`, type: 'cantrip', name: 'X' }).success).toBe(false);
    expect(
      EntitySchema.safeParse({
        id: `${P}:spell/x`,
        type: 'spell',
        name: 'X',
        level: 10,
        school: 'evocation',
        castingTime: { value: 1, unit: 'action' },
        range: { kind: 'self' },
        components: { v: true, s: false, m: false },
        duration: { kind: 'instantaneous' },
        concentration: false,
        ritual: false,
        classes: [],
      }).success,
    ).toBe(false);
  });
});
