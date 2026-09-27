import { describe, expect, it } from 'vitest';
import { ClassEntitySchema } from '../src/pack/entities-progression.ts';

const P = 'srd-5e-2024';
const baseClass = {
  id: `${P}:class/barbarian`,
  type: 'class' as const,
  name: 'Barbarian',
  hitDie: 12 as const,
  primaryAbility: ['str'],
  saves: ['str', 'con'],
  skillChoice: { from: ['athletics'], count: 2 },
  subclassLevel: 3,
};

describe('ClassLevelRow.extra typed values (ruling 5)', () => {
  it('still accepts plain integer extras byte-identically (druid-prepared-spells-style)', () => {
    const r = ClassEntitySchema.safeParse({ ...baseClass, levels: [{ level: 1, extra: { 'prepared-spells': 4 } }] });
    expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
    if (r.success) expect(r.data.levels[0]!.extra).toEqual({ 'prepared-spells': 4 });
  });

  it('accepts a dice-notation extra on the same row as an int extra (Rage Damage "1d6"-style)', () => {
    const r = ClassEntitySchema.safeParse({
      ...baseClass,
      levels: [{ level: 1, extra: { 'rage-damage': '1d6', rages: 2 } }],
    });
    expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
    if (r.success) expect(r.data.levels[0]!.extra).toEqual({ 'rage-damage': '1d6', rages: 2 });
  });

  it('accepts short plain-text extras, e.g. an ordinal column value', () => {
    const r = ClassEntitySchema.safeParse({ ...baseClass, levels: [{ level: 1, extra: { 'martial-arts': '1st' } }] });
    expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
  });

  it('newly accepts apostrophes in plain-text extras (previously rejected by the bare formula charset)', () => {
    const r = ClassEntitySchema.safeParse({ ...baseClass, levels: [{ level: 1, extra: { note: "O'Brien" } }] });
    expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
  });

  it('still rejects an empty extra string', () => {
    const r = ClassEntitySchema.safeParse({ ...baseClass, levels: [{ level: 1, extra: { x: '' } }] });
    expect(r.success).toBe(false);
  });
});
