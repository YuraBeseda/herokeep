export const VARIABLES = ['level', 'prof'] as const;
export const SLUG_CALLS = ['classLevel', 'hitDie', 'resource'] as const;
export const ABILITY_CALLS = ['mod', 'score'] as const;
export const MATH_CALLS = ['max', 'min', 'floor', 'ceil', 'abs'] as const;

export type VarName = (typeof VARIABLES)[number];
export type CallName = (typeof SLUG_CALLS)[number] | (typeof ABILITY_CALLS)[number] | (typeof MATH_CALLS)[number];
export type BinOp = '+' | '-' | '*' | '/';
export type CmpOp = '>=' | '<=' | '>' | '<' | '==' | '!=';

export type FormulaAst =
  | { k: 'num'; v: number }
  | { k: 'var'; name: VarName }
  | { k: 'call'; name: CallName; args: FormulaAst[]; slug?: string }
  | { k: 'un'; op: '-'; e: FormulaAst }
  | { k: 'bin'; op: BinOp; l: FormulaAst; r: FormulaAst }
  | { k: 'cmp'; op: CmpOp; l: FormulaAst; r: FormulaAst };

export function containsComparison(ast: FormulaAst): boolean {
  switch (ast.k) {
    case 'cmp':
      return true;
    case 'bin':
      return containsComparison(ast.l) || containsComparison(ast.r);
    case 'un':
      return containsComparison(ast.e);
    case 'call':
      return ast.args.some(containsComparison);
    default:
      return false;
  }
}
