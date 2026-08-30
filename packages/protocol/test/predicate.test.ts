import { describe, expect, it } from 'vitest';
import { FormulaSchema } from '../src/pack/formula.ts';
import { PredicateSchema } from '../src/pack/predicate.ts';

describe('FormulaSchema', () => {
  it('accepts grammar characters and rejects others', () => {
    expect(FormulaSchema.safeParse('10 + mod(dex) + mod(con)').success).toBe(true);
    expect(FormulaSchema.safeParse('floor(level / 2) >= 3').success).toBe(true);
    expect(FormulaSchema.safeParse('mod(dex); drop').success).toBe(false);
    expect(FormulaSchema.safeParse('x'.repeat(257)).success).toBe(false);
    expect(FormulaSchema.safeParse('').success).toBe(false);
  });
});

describe('PredicateSchema', () => {
  it('accepts every documented form', () => {
    const forms = [
      { ability: { str: { gte: 13 } } },
      { level: { gte: 4 } },
      { classLevel: { wizard: { gte: 3 } } },
      { classLevel: { 'ivan-homebrew:class/warden': { gte: 1 } } },
      { hasFeature: 'srd-5e-2024:feature/second-wind' },
      { hasFeat: 'srd-5e-2024:feat/alert' },
      { hasSpell: 'srd-5e-2024:spell/fireball' },
      { tag: 'unarmored' },
      { proficient: { kind: 'armor', target: 'heavy' } },
      { armor: { category: ['none', 'light'] } },
      { shield: false },
      { species: 'srd-5e-2024:species/elf' },
      { class: 'srd-5e-2024:class/fighter' },
      { subclass: 'srd-5e-2024:subclass/champion' },
      { condition: 'srd-5e-2024:condition/prone' },
      { spellcaster: true },
      { formula: 'mod(dex) >= 2' },
      { all: [{ level: { gte: 4 } }, { not: { shield: true } }] },
      { any: [{ class: 'srd-5e-2024:class/fighter' }, { tag: 'martial' }] },
    ];
    for (const form of forms) {
      const r = PredicateSchema.safeParse(form);
      expect(r.success, JSON.stringify(form)).toBe(true);
    }
  });

  it('rejects unknown keys, empty groups and extra keys', () => {
    expect(PredicateSchema.safeParse({ levell: { gte: 1 } }).success).toBe(false);
    expect(PredicateSchema.safeParse({ all: [] }).success).toBe(false);
    expect(PredicateSchema.safeParse({ level: {} }).success).toBe(false);
    expect(PredicateSchema.safeParse({ level: { gte: 1 }, tag: 'x' }).success).toBe(false);
    expect(PredicateSchema.safeParse({ ability: { strength: { gte: 13 } } }).success).toBe(false);
  });
});
