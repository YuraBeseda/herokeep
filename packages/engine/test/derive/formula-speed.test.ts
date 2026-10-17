import type { Effect } from '@hk/protocol';
import { describe, expect, it } from 'vitest';
import { createContentIndex } from '../../src/content/index.ts';
import { deriveAbilities } from '../../src/derive/abilities.ts';
import type { ActiveEffect, Composition } from '../../src/derive/composition.ts';
import { validateEffect } from '../../src/effects/validate.ts';
import { type FormulaContext, evalFormulaString } from '../../src/formula/evaluate.ts';
import { validateFormula } from '../../src/formula/validate.ts';
import { emptyFacts } from '../../src/reduce/facts.ts';
import { loadFixturePack } from '../support/fixtures.ts';

// Plan 13 task 5: `speed.bonus.value` widens int -> int | Formula (evaluated through the shared
// formula engine, e.g. Monk Unarmored Movement's one scaling row), and the formula grammar gains
// `speed(walk)` — the resolved walk Speed — legal ONLY in a non-walk `speed.bonus` value (Roving's
// "Climb Speed and Swim Speed equal to your Speed").

const index = createContentIndex([loadFixturePack('core-mini')]);
const elf = 'core-mini:species/elf'; // speed 30
const fighter = 'core-mini:class/fighter';

const ae = (effect: Effect, feature = 'x:feature/one'): ActiveEffect => ({ effect, source: fighter, feature });
const speedOf = (effects: ActiveEffect[], fighterLevel = 1) => {
  const comp: Composition = {
    entities: [elf],
    effects,
    classLevels: { [fighter]: fighterLevel },
    totalLevel: fighterLevel,
    issues: [],
  };
  return deriveAbilities(emptyFacts('char:t'), comp, index).speed;
};
const bonus = (mode: string, value: number | string, key?: string): Effect =>
  ({ type: 'speed.bonus', mode, value, ...(key ? { key } : {}) }) as Effect;

describe('speed.bonus with a formula value', () => {
  it('evaluates per level through the shared formula engine', () => {
    const scaling = [ae(bonus('walk', '10 + 5 * floor((classLevel(fighter) - 2) / 4)'))];
    const walk = (l: number) => speedOf(scaling, l)['walk']!.value;
    expect([2, 5, 6, 9, 10, 14, 18, 20].map(walk)).toEqual([40, 40, 45, 45, 50, 55, 60, 60]);
  });

  it('records the formula on the contribution (provenance), like every other formula-valued effect', () => {
    const walk = speedOf([ae(bonus('walk', 'prof'))])['walk']!;
    expect(walk.value).toBe(32);
    expect(walk.contributions).toEqual([
      { source: fighter, feature: 'x:feature/one', kind: 'speed.bonus', formula: 'prof' },
    ]);
  });

  it('an int value is unchanged (amount contribution)', () => {
    expect(speedOf([ae(bonus('walk', 10))])['walk']!.contributions[0]).toMatchObject({ amount: 10 });
  });
});

describe('speed(walk): a mode equal to the resolved walk Speed', () => {
  it('a climb/swim bonus of speed(walk) equals the final walk speed (including walk bonuses)', () => {
    const s = speedOf([ae(bonus('walk', 10)), ae(bonus('climb', 'speed(walk)')), ae(bonus('swim', 'speed(walk)'))]);
    expect(s['walk']!.value).toBe(40);
    expect(s['climb']!.value).toBe(40);
    expect(s['swim']!.value).toBe(40);
  });

  it('keeps the speed record keys in sorted mode order', () => {
    const s = speedOf([ae(bonus('swim', 'speed(walk)')), ae(bonus('climb', 'speed(walk)'))]);
    expect(Object.keys(s)).toEqual(['climb', 'swim', 'walk']);
  });

  it('two "equal to your Speed" grants sharing a key keep the max instead of summing', () => {
    const s = speedOf([
      ae(bonus('climb', 'speed(walk)', 'climb-equals-speed'), 'x:feature/one'),
      ae(bonus('climb', 'speed(walk)', 'climb-equals-speed'), 'x:feature/two'),
    ]);
    expect(s['climb']!.value).toBe(30);
  });

  it('evaluates to 0 in any context that does not supply speed()', () => {
    const ctx: FormulaContext = {
      level: 1,
      prof: 2,
      classLevel: () => 0,
      mod: () => 0,
      score: () => 10,
      hitDie: () => 0,
      resource: () => 0,
    };
    expect(evalFormulaString('speed(walk)', ctx)).toBe(0);
    expect(evalFormulaString('speed(walk)', { ...ctx, speed: (m) => (m === 'walk' ? 35 : 0) })).toBe(35);
  });
});

describe('speed() validation', () => {
  const codes = (eff: unknown) => validateEffect(eff, 'effects.0', 'x:feature/one').map((d) => d.code);

  it('the formula grammar parses speed(<mode>)', () => {
    expect(validateFormula('speed(walk)', { allowSpeed: true })).toEqual([]);
  });

  it('is rejected outside a speed.bonus value', () => {
    expect(validateFormula('speed(walk)').map((d) => d.code)).toEqual(['formula.speedSymbol']);
    expect(codes({ type: 'ac.bonus', value: 'speed(walk)' })).toEqual(['formula.speedSymbol']);
  });

  it('is legal in a non-walk speed.bonus, rejected in a walk one (self-reference) and for non-walk modes', () => {
    expect(codes(bonus('climb', 'speed(walk)'))).toEqual([]);
    expect(codes(bonus('walk', 'speed(walk)'))).toEqual(['formula.speedSymbol']);
    expect(codes(bonus('swim', 'speed(climb)'))).toEqual(['formula.speedSymbol']);
  });

  it('a speed.bonus formula without speed() validates like any other formula', () => {
    expect(codes(bonus('walk', '5 * floor(classLevel(monk) / 4)'))).toEqual([]);
    expect(codes(bonus('walk', '5 *'))).toEqual(['formula.syntax']);
  });
});
