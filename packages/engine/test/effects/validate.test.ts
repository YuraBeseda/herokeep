import { describe, expect, it } from 'vitest';
import { collectEffectFormulas, isKnownEffectType, validateEffects } from '../../src/effects/validate.ts';

describe('effects', () => {
  it('knows the vocabulary', () => {
    expect(isKnownEffectType('ac.formula')).toBe(true);
    expect(isKnownEffectType('ac.bonuses')).toBe(false);
  });

  it('collects formula-bearing fields', () => {
    expect(collectEffectFormulas({ type: 'ac.formula', formula: '10 + mod(dex)' }, 'effects.0')).toEqual([
      { path: 'effects.0.formula', src: '10 + mod(dex)', allowComparison: false },
    ]);
    expect(collectEffectFormulas({ type: 'hp.bonus', value: 'level' }, 'effects.1')).toEqual([
      { path: 'effects.1.value', src: 'level', allowComparison: false },
    ]);
    expect(collectEffectFormulas({ type: 'hp.bonus', value: 3 }, 'effects.2')).toEqual([]);
    expect(
      collectEffectFormulas(
        {
          type: 'spell.grant',
          spell: 'x:spell/y',
          uses: { count: 'prof', per: 'longRest' },
          alwaysPrepared: false,
          when: { formula: 'level >= 3' },
        },
        'effects.3',
      ),
    ).toEqual([
      { path: 'effects.3.uses.count', src: 'prof', allowComparison: false },
      { path: 'effects.3.when.formula', src: 'level >= 3', allowComparison: true },
    ]);
  });

  it('reports unknown types as warnings and bad formulas as errors', () => {
    const d = validateEffects(
      [
        { type: 'ac.bonuses', value: 1 },
        { type: 'ac.bonus', value: 'mod(dex' },
        { type: 'ac.bonus', value: 'level >= 2' },
      ],
      'effects',
      'x:feat/y',
    );
    expect(d.map((x) => [x.severity, x.code, x.path])).toEqual([
      ['warning', 'effect.unknownType', 'effects.0.type'],
      ['error', 'formula.syntax', 'effects.1.value'],
      ['error', 'formula.comparison', 'effects.2.value'],
    ]);
    expect(d.every((x) => x.entityId === 'x:feat/y')).toBe(true);
  });
});
