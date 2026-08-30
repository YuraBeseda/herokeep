import { z } from 'zod';

export const FORMULA_MAX_LENGTH = 256;

/** Charset + length only. Syntax and identifier whitelist are checked by @hk/engine validateFormula(). */
export const FormulaSchema = z
  .string()
  .min(1)
  .max(FORMULA_MAX_LENGTH)
  .regex(/^[A-Za-z0-9_+\-*/().,<>=!\s]+$/, 'Formula contains characters outside the grammar');
export type Formula = z.infer<typeof FormulaSchema>;
