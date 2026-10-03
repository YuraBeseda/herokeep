import { type Diagnostic, error } from '../diagnostics.ts';
import { ABILITY_CALLS, containsComparison, type FormulaAst, SLUG_CALLS } from './ast.ts';
import { FormulaError } from './lexer.ts';
import { parseFormula } from './parser.ts';

export interface ValidateFormulaOptions {
  allowComparison?: boolean;
  path?: string;
  entityId?: string;
}

/**
 * Symbols a choice `count` formula may use (plan 12 task 2): it resolves from facts alone, so only
 * `level`, `classLevel()` and `hitDie()` are live (math calls are always fine). Mirrors the context
 * built in `derive/choice-count.ts` — keep the two in sync.
 */
const COUNT_VARS: readonly string[] = ['level'];
const COUNT_CALLS: readonly string[] = ['classLevel', 'hitDie'];

function unsupportedCountSymbols(ast: FormulaAst, out: Set<string>): void {
  switch (ast.k) {
    case 'var':
      if (!COUNT_VARS.includes(ast.name)) out.add(ast.name);
      return;
    case 'call':
      if (
        ((SLUG_CALLS as readonly string[]).includes(ast.name) ||
          (ABILITY_CALLS as readonly string[]).includes(ast.name)) &&
        !COUNT_CALLS.includes(ast.name)
      )
        out.add(ast.name);
      ast.args.forEach((a) => unsupportedCountSymbols(a, out));
      return;
    case 'un':
      unsupportedCountSymbols(ast.e, out);
      return;
    case 'bin':
    case 'cmp':
      unsupportedCountSymbols(ast.l, out);
      unsupportedCountSymbols(ast.r, out);
      return;
    default:
      return;
  }
}

/** Diagnostics for symbols in a choice-count formula that the count context cannot supply. */
export function validateCountSymbols(src: string, path: string, entityId: string): Diagnostic[] {
  let ast: FormulaAst;
  try {
    ast = parseFormula(src);
  } catch {
    return []; // syntax errors are reported by validateFormula
  }
  const bad = new Set<string>();
  unsupportedCountSymbols(ast, bad);
  return [...bad]
    .sort()
    .map((name) =>
      error(
        'formula.countSymbol',
        `"${name}" is not available in a choice count formula (only level, classLevel, hitDie) in "${src}"`,
        { path, entityId },
      ),
    );
}

export function validateFormula(src: string, opts: ValidateFormulaOptions = {}): Diagnostic[] {
  const extra = {
    ...(opts.path !== undefined && { path: opts.path }),
    ...(opts.entityId !== undefined && { entityId: opts.entityId }),
  };
  try {
    const ast = parseFormula(src);
    if (!opts.allowComparison && containsComparison(ast)) {
      return [error('formula.comparison', 'Comparisons are only allowed in predicate formulas', extra)];
    }
    return [];
  } catch (e) {
    if (e instanceof FormulaError) {
      return [error(`formula.${e.code}`, `${e.message} (at ${e.pos}) in "${src}"`, extra)];
    }
    throw e;
  }
}
