import { describe, expect, it } from 'vitest';
import { BackgroundEntitySchema } from '../src/pack/entities-simple.ts';
import { ClassEntitySchema } from '../src/pack/entities-progression.ts';

const P = 'srd-5e-2024';
const cls = {
  id: `${P}:class/barbarian`,
  type: 'class',
  name: 'Barbarian',
  hitDie: 12,
  primaryAbility: ['str'],
  saves: ['str', 'con'],
  skillChoice: { from: ['athletics'], count: 2 },
  subclassLevel: 3,
  levels: [{ level: 1 }],
};
const bg = {
  id: `${P}:background/soldier`,
  type: 'background',
  name: 'Soldier',
  abilityScores: ['str'],
  originFeat: `${P}:feat/alert`,
};
const opt = (label: string) => ({ label, items: [{ item: `${P}:item/greataxe`, qty: 1 }], notes: [], gp: 15 });

describe('startingEquipment', () => {
  it('is optional on class and background', () => {
    expect(ClassEntitySchema.safeParse(cls).success).toBe(true);
    expect(BackgroundEntitySchema.safeParse(bg).success).toBe(true);
    expect(ClassEntitySchema.safeParse({ ...cls, startingEquipment: [opt('A'), opt('B')] }).success).toBe(true);
    expect(BackgroundEntitySchema.safeParse({ ...bg, startingEquipment: [opt('A')] }).success).toBe(true);
  });
  it('refuses 4 options, an empty list, a bad label or an unknown key', () => {
    const four = [opt('A'), opt('B'), opt('C'), opt('A')];
    expect(ClassEntitySchema.safeParse({ ...cls, startingEquipment: four }).success).toBe(false);
    expect(BackgroundEntitySchema.safeParse({ ...bg, startingEquipment: four }).success).toBe(false);
    expect(ClassEntitySchema.safeParse({ ...cls, startingEquipment: [] }).success).toBe(false);
    expect(ClassEntitySchema.safeParse({ ...cls, startingEquipment: [opt('D')] }).success).toBe(false);
    expect(ClassEntitySchema.safeParse({ ...cls, startingEquipment: [{ ...opt('A'), x: 1 }] }).success).toBe(false);
  });
});
