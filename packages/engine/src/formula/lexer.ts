import { FORMULA_MAX_LENGTH } from '@hk/protocol';

export const FORMULA_MAX_DEPTH = 16;

export type FormulaErrorCode = 'length' | 'syntax' | 'depth' | 'identifier' | 'arity';

export class FormulaError extends Error {
  constructor(
    public readonly code: FormulaErrorCode,
    message: string,
    public readonly pos: number,
  ) {
    super(message);
    this.name = 'FormulaError';
  }
}

export interface Token {
  kind: 'num' | 'ident' | 'op' | 'eof';
  value: string;
  pos: number;
}

const TWO_CHAR_OPS = new Set(['>=', '<=', '==', '!=']);
const ONE_CHAR_OPS = new Set(['+', '-', '*', '/', '(', ')', ',', '<', '>']);

export function tokenize(src: string): Token[] {
  if (src.length > FORMULA_MAX_LENGTH) {
    throw new FormulaError('length', `Formula longer than ${FORMULA_MAX_LENGTH} characters`, FORMULA_MAX_LENGTH);
  }
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      i++;
      continue;
    }
    if (c >= '0' && c <= '9') {
      let j = i;
      while (j < src.length && src[j]! >= '0' && src[j]! <= '9') j++;
      tokens.push({ kind: 'num', value: src.slice(i, j), pos: i });
      i = j;
      continue;
    }
    if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_') {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j]!)) j++;
      tokens.push({ kind: 'ident', value: src.slice(i, j), pos: i });
      i = j;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (TWO_CHAR_OPS.has(two)) {
      tokens.push({ kind: 'op', value: two, pos: i });
      i += 2;
      continue;
    }
    if (ONE_CHAR_OPS.has(c)) {
      tokens.push({ kind: 'op', value: c, pos: i });
      i++;
      continue;
    }
    throw new FormulaError('syntax', `Unexpected character "${c}"`, i);
  }
  tokens.push({ kind: 'eof', value: '', pos: src.length });
  return tokens;
}
