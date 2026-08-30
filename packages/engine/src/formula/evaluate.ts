import { type FormulaAst } from './ast.ts';
import { parseFormula } from './parser.ts';

export interface FormulaContext {
  level: number;
  prof: number;
  classLevel(slug: string): number;
  mod(ability: string): number;
  score(ability: string): number;
  hitDie(slug: string): number;
  resource(slug: string): number;
}

export function constantContext(): FormulaContext {
  return { level: 0, prof: 0, classLevel: () => 0, mod: () => 0, score: () => 0, hitDie: () => 0, resource: () => 0 };
}

const intDiv = (a: number, b: number): number => (b === 0 ? 0 : Math.floor(a / b));

export function evaluateFormula(ast: FormulaAst, ctx: FormulaContext): number {
  switch (ast.k) {
    case 'num':
      return ast.v;
    case 'var':
      return ast.name === 'level' ? ctx.level : ctx.prof;
    case 'un':
      return -evaluateFormula(ast.e, ctx);
    case 'bin': {
      const l = evaluateFormula(ast.l, ctx);
      const r = evaluateFormula(ast.r, ctx);
      switch (ast.op) {
        case '+':
          return l + r;
        case '-':
          return l - r;
        case '*':
          return l * r;
        case '/':
          return intDiv(l, r);
      }
      break;
    }
    case 'cmp': {
      const l = evaluateFormula(ast.l, ctx);
      const r = evaluateFormula(ast.r, ctx);
      const ok =
        ast.op === '>='
          ? l >= r
          : ast.op === '<='
            ? l <= r
            : ast.op === '>'
              ? l > r
              : ast.op === '<'
                ? l < r
                : ast.op === '=='
                  ? l === r
                  : l !== r;
      return ok ? 1 : 0;
    }
    case 'call': {
      const slug = ast.slug ?? '';
      switch (ast.name) {
        case 'classLevel':
          return ctx.classLevel(slug);
        case 'hitDie':
          return ctx.hitDie(slug);
        case 'resource':
          return ctx.resource(slug);
        case 'mod':
          return ctx.mod(slug);
        case 'score':
          return ctx.score(slug);
        case 'max':
          return Math.max(...ast.args.map((a) => evaluateFormula(a, ctx)));
        case 'min':
          return Math.min(...ast.args.map((a) => evaluateFormula(a, ctx)));
        case 'floor':
          return Math.floor(evaluateFormula(ast.args[0]!, ctx));
        case 'ceil': {
          const arg = ast.args[0]!;
          if (arg.k === 'bin' && arg.op === '/') {
            const l = evaluateFormula(arg.l, ctx);
            const r = evaluateFormula(arg.r, ctx);
            return r === 0 ? 0 : Math.ceil(l / r);
          }
          return Math.ceil(evaluateFormula(arg, ctx));
        }
        case 'abs':
          return Math.abs(evaluateFormula(ast.args[0]!, ctx));
      }
    }
  }
  return 0;
}

export function evalFormulaString(src: string, ctx: FormulaContext): number {
  return evaluateFormula(parseFormula(src), ctx);
}
