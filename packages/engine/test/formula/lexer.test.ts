import { describe, expect, it } from 'vitest';
import { FormulaError, tokenize } from '../../src/formula/lexer.ts';

const kinds = (src: string) => tokenize(src).map((t) => `${t.kind}:${t.value}`);

describe('tokenize', () => {
  it('splits numbers, identifiers and operators', () => {
    expect(kinds('10 + mod(dex)')).toEqual(['num:10', 'op:+', 'ident:mod', 'op:(', 'ident:dex', 'op:)', 'eof:']);
  });
  it('lexes two-character comparison operators', () => {
    expect(kinds('a>=1 <= == != < >')).toEqual([
      'ident:a',
      'op:>=',
      'num:1',
      'op:<=',
      'op:==',
      'op:!=',
      'op:<',
      'op:>',
      'eof:',
    ]);
  });
  it('keeps minus as an operator (identifiers never contain dashes at lex time)', () => {
    expect(kinds('level-1')).toEqual(['ident:level', 'op:-', 'num:1', 'eof:']);
  });
  it('rejects characters outside the grammar and over-long input', () => {
    expect(() => tokenize('mod(dex) $ 1')).toThrow(FormulaError);
    expect(() => tokenize('1 + '.repeat(100))).toThrow(FormulaError);
    try {
      tokenize('1'.repeat(300));
    } catch (e) {
      expect((e as FormulaError).code).toBe('length');
    }
  });
});
