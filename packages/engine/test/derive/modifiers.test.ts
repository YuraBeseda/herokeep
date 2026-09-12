import { describe, expect, it } from 'vitest';
import { ModifierTable } from '../../src/derive/modifiers.ts';

describe('ModifierTable', () => {
  it('sum-unique-key: same key keeps the max, distinct keys sum', () => {
    const t = new ModifierTable();
    t.add('ac', { source: 'a', kind: 'ac.bonus', amount: 1, key: 'shield', policy: 'sum-unique-key' });
    t.add('ac', { source: 'b', kind: 'ac.bonus', amount: 2, key: 'shield', policy: 'sum-unique-key' });
    t.add('ac', { source: 'c', kind: 'ac.bonus', amount: 1, key: 'ring', policy: 'sum-unique-key' });

    const d = t.resolve('ac', 10, () => 0);
    expect(d.value).toBe(13); // 10 + max(1, 2) for "shield" + 1 for "ring"
    expect(d.contributions).toHaveLength(3);
  });

  it('a contribution without a key falls back to source#feature as its stacking key', () => {
    const t = new ModifierTable();
    t.add('x', { source: 'a', feature: 'f1', kind: 'k', amount: 5, policy: 'sum-unique-key' });
    t.add('x', { source: 'a', feature: 'f1', kind: 'k', amount: 9, policy: 'sum-unique-key' });
    t.add('x', { source: 'a', feature: 'f2', kind: 'k', amount: 3, policy: 'sum-unique-key' });

    const d = t.resolve('x', 0, () => 0);
    expect(d.value).toBe(12); // max(5, 9) for a#f1, + 3 for the distinct a#f2
  });

  it('max-of-formulas evaluates every candidate, picks the highest, and base is always a candidate', () => {
    const t = new ModifierTable();
    t.add('ac.formula', { source: 'monk', kind: 'ac.formula', formula: 'monkAc', policy: 'max-of-formulas' });
    t.add('ac.formula', { source: 'barb', kind: 'ac.formula', formula: 'barbAc', policy: 'max-of-formulas' });
    const amounts: Record<string, number> = { monkAc: 15, barbAc: 12 };

    const d = t.resolve('ac.formula', 13, (f) => amounts[f]!);
    expect(d.value).toBe(15);
    expect(d.contributions).toHaveLength(2); // every candidate is recorded, including the losing one

    const lower = new ModifierTable();
    lower.add('ac.formula', { source: 'x', kind: 'ac.formula', formula: 'lowAc', policy: 'max-of-formulas' });
    expect(lower.resolve('ac.formula', 13, () => 9).value).toBe(13); // base beats a lower formula candidate
  });

  it('set-if-higher only raises the value', () => {
    const t = new ModifierTable();
    t.add('str', { source: 'a', kind: 'ability.set', amount: 19, policy: 'set-if-higher' });
    t.add('str', { source: 'b', kind: 'ability.set', amount: 14, policy: 'set-if-higher' });

    const d = t.resolve('str', 17, () => 0);
    expect(d.value).toBe(19); // 14 would lower the running 19, so it's ignored
  });

  it('cap clamps the final value after bonuses', () => {
    const t = new ModifierTable();
    t.add('str', { source: 'a', kind: 'ability.set', amount: 22, policy: 'set-if-higher' });
    t.add('str', { source: 'b', kind: 'ability.max', amount: 20, policy: 'cap' });

    const d = t.resolve('str', 17, () => 0);
    expect(d.value).toBe(20);
  });

  it('union merges per-target proficiency levels, expertise beating proficient', () => {
    const t = new ModifierTable();
    t.add('proficiency.skill.stealth', { source: 'class', kind: 'proficient', policy: 'union' });
    t.add('proficiency.skill.stealth', { source: 'feat', kind: 'expertise', policy: 'union' });

    const r = t.resolveSet('proficiency.skill.stealth');
    expect(r.values).toEqual(['expertise']);
    expect(r.sources).toEqual({ expertise: ['class', 'feat'] });
  });

  it('union tracks arbitrary set members (e.g. languages) by key, deduping sources', () => {
    const t = new ModifierTable();
    t.add('languages', { source: 'a', kind: 'language.grant', key: 'core-mini:language/common', policy: 'union' });
    t.add('languages', { source: 'b', kind: 'language.grant', key: 'core-mini:language/elvish', policy: 'union' });
    t.add('languages', { source: 'c', kind: 'language.grant', key: 'core-mini:language/common', policy: 'union' });

    const r = t.resolveSet('languages');
    expect(r.values).toEqual(['core-mini:language/common', 'core-mini:language/elvish']);
    expect(r.sources['core-mini:language/common']).toEqual(['a', 'c']);
    expect(r.sources['core-mini:language/elvish']).toEqual(['b']);
  });
});
