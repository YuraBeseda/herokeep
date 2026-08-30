import { describe, expect, it } from 'vitest';
import { type FormulaContext, evalFormulaString } from '../../src/formula/evaluate.ts';
import { validateFormula } from '../../src/formula/validate.ts';

const ctx: FormulaContext = {
  level: 5,
  prof: 3,
  classLevel: (s) => ({ fighter: 5, wizard: 0 })[s] ?? 0,
  mod: (a) => ({ str: 3, dex: 2, con: 1, int: -1 })[a] ?? 0,
  score: (a) => ({ str: 16, dex: 14, con: 12, int: 8 })[a] ?? 10,
  hitDie: (s) => (s === 'fighter' ? 10 : 6),
  resource: () => 0,
};

describe('evaluateFormula', () => {
  it.each([
    ['10 + mod(dex) + mod(con)', 13],
    ['level / 2', 2],
    ['-7 / 2', -4],
    ['floor(level / 2)', 2],
    ['ceil(level / 2)', 3],
    ['max(1, level + mod(int))', 4],
    ['min(prof, 2)', 2],
    ['abs(mod(int))', 1],
    ['classLevel(fighter) * hitDie(fighter)', 50],
    ['score(str) >= 13', 1],
    ['mod(dex) == 3', 0],
    ['1 / 0', 0],
    ['-level', -5],
  ])('%s → %d', (src, expected) => {
    expect(evalFormulaString(src, ctx)).toBe(expected);
  });
});

describe('validateFormula', () => {
  it('returns no diagnostics for valid formulas', () => {
    expect(validateFormula('10 + mod(dex)')).toEqual([]);
  });
  it('maps parser errors to diagnostic codes', () => {
    expect(validateFormula('mod(dex) +')[0]?.code).toBe('formula.syntax');
    expect(validateFormula('hp')[0]?.code).toBe('formula.identifier');
    expect(validateFormula('max(1)')[0]?.code).toBe('formula.arity');
    expect(validateFormula('('.repeat(20) + '1' + ')'.repeat(20))[0]?.code).toBe('formula.depth');
    expect(validateFormula('1'.repeat(300))[0]?.code).toBe('formula.length');
  });
  it('rejects comparisons unless allowed', () => {
    expect(validateFormula('level >= 5')[0]?.code).toBe('formula.comparison');
    expect(validateFormula('level >= 5', { allowComparison: true })).toEqual([]);
  });
  it('carries path and entityId', () => {
    const d = validateFormula('bad(1)', { path: 'effects.0.formula', entityId: 'x:feat/y' })[0]!;
    expect(d.path).toBe('effects.0.formula');
    expect(d.entityId).toBe('x:feat/y');
  });
});
