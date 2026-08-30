import { describe, expect, it } from 'vitest';
import type { FormulaError } from '../../src/formula/lexer.ts';
import { containsComparison, parseFormula } from '../../src/formula/parser.ts';

describe('parseFormula', () => {
  it('respects precedence: comparison < additive < multiplicative < unary < call', () => {
    expect(parseFormula('1 + 2 * 3')).toEqual({
      k: 'bin',
      op: '+',
      l: { k: 'num', v: 1 },
      r: { k: 'bin', op: '*', l: { k: 'num', v: 2 }, r: { k: 'num', v: 3 } },
    });
    expect(parseFormula('-level + 1')).toEqual({
      k: 'bin',
      op: '+',
      l: { k: 'un', op: '-', e: { k: 'var', name: 'level' } },
      r: { k: 'num', v: 1 },
    });
    expect(parseFormula('mod(dex) >= 2')).toEqual({
      k: 'cmp',
      op: '>=',
      l: { k: 'call', name: 'mod', args: [], slug: 'dex' },
      r: { k: 'num', v: 2 },
    });
  });

  it('parses slug arguments with dashes and multi-arg math calls', () => {
    expect(parseFormula('classLevel(fighter-arcane)')).toEqual({
      k: 'call',
      name: 'classLevel',
      args: [],
      slug: 'fighter-arcane',
    });
    expect(parseFormula('max(1, level + mod(int))')).toMatchObject({ k: 'call', name: 'max' });
    expect(parseFormula('floor(level / 2)')).toMatchObject({ k: 'call', name: 'floor' });
  });

  it('rejects unknown identifiers, wrong arity and trailing input', () => {
    const code = (src: string) => {
      try {
        parseFormula(src);
        return 'ok';
      } catch (e) {
        return (e as FormulaError).code;
      }
    };
    expect(code('strength')).toBe('identifier');
    expect(code('hp(1)')).toBe('identifier');
    expect(code('mod(dex, con)')).toBe('arity');
    expect(code('max(1)')).toBe('arity');
    expect(code('floor(1, 2)')).toBe('arity');
    expect(code('1 + ')).toBe('syntax');
    expect(code('1 2')).toBe('syntax');
    expect(code('(1')).toBe('syntax');
    expect(code('mod()')).toBe('syntax');
  });

  it('enforces the nesting depth limit', () => {
    expect(() => parseFormula('('.repeat(17) + '1' + ')'.repeat(17))).toThrow(/depth/);
    expect(parseFormula('('.repeat(15) + '1' + ')'.repeat(15))).toEqual({ k: 'num', v: 1 });
  });

  it('reports whether a comparison is present', () => {
    expect(containsComparison(parseFormula('level >= 5'))).toBe(true);
    expect(containsComparison(parseFormula('max(level, 5)'))).toBe(false);
  });
});
