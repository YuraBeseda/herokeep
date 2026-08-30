import { z } from 'zod';
import { SLUG_RE } from '../ids.ts';
import { FormulaSchema } from './formula.ts';

export const SpeedModeSchema = z.enum(['walk', 'fly', 'swim', 'climb', 'burrow']);
export const SenseSchema = z.enum(['darkvision', 'blindsight', 'tremorsense', 'truesight']);
export const ResetSchema = z.enum(['shortRest', 'longRest', 'dawn', 'never']);
export const ProficiencyLevelSchema = z.enum(['proficient', 'expertise', 'half']);
export const ActionKindSchema = z.enum(['action', 'bonus', 'reaction', 'free']);
export const PreparationSchema = z.enum(['prepared', 'known', 'spellbook', 'innate']);
export const SlotProgressionSchema = z.enum(['full', 'half', 'third', 'pact', 'none']);
export const DisplaySchema = z.enum(['pips', 'number']);
/** save.<ability> | skill.<slug> | check.<ability> | attack | initiative */
export const RollTargetSchema = z
  .string()
  .regex(/^(save\.[a-z]{3}|skill\.[a-z0-9][a-z0-9-]*|check\.[a-z]{3}|attack|initiative)$/);
export const DamageTypeSchema = z.string().regex(SLUG_RE);
export const AttackFilterSchema = z.strictObject({
  weapon: z.enum(['melee', 'ranged', 'any']).optional(),
  category: z.enum(['simple', 'martial']).optional(),
  property: z.string().regex(SLUG_RE).optional(),
  spell: z.boolean().optional(),
});
export const UsesSchema = z.strictObject({ count: FormulaSchema, per: ResetSchema });
/** An integer literal or a formula string. */
export const ValueSchema = z.union([z.int(), FormulaSchema]);
export const ShortTextSchema = z.string().min(1).max(200);
export const LongTextSchema = z
  .string()
  .min(1)
  .max(20 * 1024);
