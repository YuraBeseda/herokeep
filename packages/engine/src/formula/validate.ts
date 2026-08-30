import { type Diagnostic, error } from '../diagnostics.ts';
import { containsComparison } from './ast.ts';
import { FormulaError } from './lexer.ts';
import { parseFormula } from './parser.ts';

export interface ValidateFormulaOptions {
  allowComparison?: boolean;
  path?: string;
  entityId?: string;
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
