import {
  ABILITY_CALLS,
  type CallName,
  type CmpOp,
  type FormulaAst,
  MATH_CALLS,
  SLUG_CALLS,
  VARIABLES,
  type VarName,
} from './ast.ts';
import { FORMULA_MAX_DEPTH, FormulaError, type Token, tokenize } from './lexer.ts';

const CMP_OPS = new Set(['>=', '<=', '>', '<', '==', '!=']);
const isVar = (s: string): s is VarName => (VARIABLES as readonly string[]).includes(s);
const isSlugCall = (s: string) => (SLUG_CALLS as readonly string[]).includes(s);
const isAbilityCall = (s: string) => (ABILITY_CALLS as readonly string[]).includes(s);
const isMathCall = (s: string) => (MATH_CALLS as readonly string[]).includes(s);

class Parser {
  private readonly t: Token[];
  private i = 0;
  private depth = 0;

  constructor(t: Token[]) {
    this.t = t;
  }

  parse(): FormulaAst {
    const ast = this.comparison();
    if (this.peek().kind !== 'eof')
      throw new FormulaError('syntax', `Unexpected "${this.peek().value}"`, this.peek().pos);
    return ast;
  }

  private peek(): Token {
    return this.t[this.i]!;
  }

  private next(): Token {
    return this.t[this.i++]!;
  }

  private expectOp(v: string): void {
    const tok = this.next();
    if (tok.kind !== 'op' || tok.value !== v) throw new FormulaError('syntax', `Expected "${v}"`, tok.pos);
  }

  private enter(pos: number): void {
    if (++this.depth > FORMULA_MAX_DEPTH) throw new FormulaError('depth', `depth exceeds ${FORMULA_MAX_DEPTH}`, pos);
  }

  private leave(): void {
    this.depth--;
  }

  private comparison(): FormulaAst {
    const l = this.additive();
    const tok = this.peek();
    if (tok.kind === 'op' && CMP_OPS.has(tok.value)) {
      this.next();
      const r = this.additive();
      return { k: 'cmp', op: tok.value as CmpOp, l, r };
    }
    return l;
  }

  private additive(): FormulaAst {
    let l = this.multiplicative();
    for (;;) {
      const tok = this.peek();
      if (tok.kind === 'op' && (tok.value === '+' || tok.value === '-')) {
        this.next();
        l = { k: 'bin', op: tok.value, l, r: this.multiplicative() };
      } else return l;
    }
  }

  private multiplicative(): FormulaAst {
    let l = this.unary();
    for (;;) {
      const tok = this.peek();
      if (tok.kind === 'op' && (tok.value === '*' || tok.value === '/')) {
        this.next();
        l = { k: 'bin', op: tok.value, l, r: this.unary() };
      } else return l;
    }
  }

  private unary(): FormulaAst {
    const tok = this.peek();
    if (tok.kind === 'op' && tok.value === '-') {
      this.next();
      this.enter(tok.pos);
      const e = this.unary();
      this.leave();
      return { k: 'un', op: '-', e };
    }
    return this.primary();
  }

  private primary(): FormulaAst {
    const tok = this.next();
    if (tok.kind === 'num') return { k: 'num', v: Number(tok.value) };
    if (tok.kind === 'op' && tok.value === '(') {
      this.enter(tok.pos);
      const e = this.comparison();
      this.leave();
      this.expectOp(')');
      return e;
    }
    if (tok.kind === 'ident') {
      const next = this.peek();
      const isCall = next.kind === 'op' && next.value === '(';
      if (!isCall) {
        if (isVar(tok.value)) return { k: 'var', name: tok.value };
        throw new FormulaError('identifier', `Unknown identifier "${tok.value}"`, tok.pos);
      }
      return this.call(tok);
    }
    throw new FormulaError('syntax', `Unexpected "${tok.value || 'end of formula'}"`, tok.pos);
  }

  private call(nameTok: Token): FormulaAst {
    const name = nameTok.value;
    this.expectOp('(');
    this.enter(nameTok.pos);
    let node: FormulaAst;
    if (isSlugCall(name) || isAbilityCall(name)) {
      node = { k: 'call', name: name as CallName, args: [], slug: this.slugArgument(isAbilityCall(name)) };
    } else if (isMathCall(name)) {
      const args: FormulaAst[] = [this.comparison()];
      while (this.peek().kind === 'op' && this.peek().value === ',') {
        this.next();
        args.push(this.comparison());
      }
      const unary = name === 'floor' || name === 'ceil' || name === 'abs';
      if (unary && args.length !== 1)
        throw new FormulaError('arity', `${name}() takes exactly one argument`, nameTok.pos);
      if (!unary && args.length < 2)
        throw new FormulaError('arity', `${name}() takes at least two arguments`, nameTok.pos);
      node = { k: 'call', name: name as CallName, args };
    } else {
      throw new FormulaError('identifier', `Unknown function "${name}"`, nameTok.pos);
    }
    this.leave();
    this.expectOp(')');
    return node;
  }

  /** ident ('-' ident)* joined with dashes; ability calls require a 3-letter key. */
  private slugArgument(ability: boolean): string {
    const first = this.next();
    if (first.kind !== 'ident') throw new FormulaError('syntax', 'Expected a name argument', first.pos);
    let slug = first.value;
    while (this.peek().kind === 'op' && this.peek().value === '-') {
      this.next();
      const part = this.next();
      if (part.kind !== 'ident' && part.kind !== 'num') throw new FormulaError('syntax', 'Bad name argument', part.pos);
      slug += '-' + part.value;
    }
    if (this.peek().kind === 'op' && this.peek().value === ',') {
      throw new FormulaError('arity', 'This function takes exactly one argument', this.peek().pos);
    }
    if (ability && !/^[a-z]{3}$/.test(slug))
      throw new FormulaError('syntax', 'Ability key must be 3 lowercase letters', first.pos);
    return slug.toLowerCase();
  }
}

export function parseFormula(src: string): FormulaAst {
  return new Parser(tokenize(src)).parse();
}

export { containsComparison } from './ast.ts';
