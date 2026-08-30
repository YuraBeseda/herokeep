import { describe, expect, it } from 'vitest';
import { constantPredicateContext, type PredicateContext } from '../../src/predicate/context.ts';
import { collectPredicateFormulas, evaluatePredicate } from '../../src/predicate/evaluate.ts';

const ctx: PredicateContext = {
  ...constantPredicateContext(),
  level: 5,
  abilityScore: (a) => (({ str: 16, dex: 14 }) as Record<string, number>)[a] ?? 10,
  classLevel: (r) => (r === 'fighter' || r === 'core-mini:class/fighter' ? 5 : 0),
  hasFeature: (id) => id === 'core-mini:feature/second-wind',
  hasFeat: (id) => id === 'core-mini:feat/alert',
  hasSpell: (id) => id === 'core-mini:spell/fireball',
  hasTag: (t) => t === 'martial',
  isProficient: (kind, target) => kind === 'armor' && target === 'heavy',
  armorCategory: () => 'heavy',
  hasShield: () => true,
  speciesId: () => 'core-mini:species/elf',
  classIds: () => ['core-mini:class/fighter'],
  subclassIds: () => ['core-mini:subclass/champion'],
  hasCondition: (id) => id === 'core-mini:condition/prone',
  isSpellcaster: () => false,
  formula: {
    level: 5,
    prof: 3,
    classLevel: () => 5,
    mod: (a) => (a === 'dex' ? 2 : 0),
    score: () => 10,
    hitDie: () => 10,
    resource: () => 0,
  },
};

describe('evaluatePredicate', () => {
  it.each([
    [{ ability: { str: { gte: 13 } } }, true],
    [{ ability: { str: { gte: 13, lte: 15 } } }, false],
    [{ level: { eq: 5 } }, true],
    [{ classLevel: { fighter: { gte: 3 } } }, true],
    [{ classLevel: { 'core-mini:class/fighter': { gt: 5 } } }, false],
    [{ hasFeature: 'core-mini:feature/second-wind' }, true],
    [{ hasFeat: 'core-mini:feat/alert' }, true],
    [{ hasSpell: 'core-mini:spell/fireball' }, true],
    [{ tag: 'martial' }, true],
    [{ proficient: { kind: 'armor', target: 'heavy' } }, true],
    [{ armor: { category: ['none', 'light'] } }, false],
    [{ armor: { category: ['heavy'] } }, true],
    [{ shield: true }, true],
    [{ species: 'core-mini:species/elf' }, true],
    [{ class: 'core-mini:class/fighter' }, true],
    [{ subclass: 'core-mini:subclass/champion' }, true],
    [{ condition: 'core-mini:condition/prone' }, true],
    [{ spellcaster: true }, false],
    [{ formula: 'mod(dex) >= 2' }, true],
    [{ all: [{ level: { gte: 4 } }, { not: { shield: false } }] }, true],
    [{ any: [{ spellcaster: true }, { tag: 'martial' }] }, true],
    [{ not: { any: [{ tag: 'martial' }] } }, false],
  ])('%j → %s', (pred, expected) => {
    expect(evaluatePredicate(pred as never, ctx)).toBe(expected);
  });

  it('is false for everything against the constant context', () => {
    const c = constantPredicateContext();
    expect(evaluatePredicate({ level: { gte: 1 } }, c)).toBe(false);
    expect(evaluatePredicate({ not: { level: { gte: 1 } } }, c)).toBe(true);
  });

  it('collects formulas with paths', () => {
    expect(collectPredicateFormulas({ all: [{ formula: 'a >= 1' }, { not: { formula: 'b < 2' } }] }, 'when')).toEqual([
      { path: 'when.all.0.formula', src: 'a >= 1' },
      { path: 'when.all.1.not.formula', src: 'b < 2' },
    ]);
  });
});
