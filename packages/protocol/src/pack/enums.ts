import { z } from 'zod';
import { SLUG_RE } from '../ids.ts';
import { DiceSchema } from './common.ts';
import { FormulaSchema } from './formula.ts';

export const SpeedModeSchema = z.enum(['walk', 'fly', 'swim', 'climb', 'burrow']);
export const SenseSchema = z.enum(['darkvision', 'blindsight', 'tremorsense', 'truesight']);
export const ResetSchema = z.enum(['shortRest', 'longRest', 'dawn', 'never']);
export const ProficiencyLevelSchema = z.enum(['proficient', 'expertise', 'half']);
export const ActionKindSchema = z.enum(['action', 'bonus', 'reaction', 'free']);
export const PreparationSchema = z.enum(['prepared', 'known', 'spellbook', 'innate']);
export const SlotProgressionSchema = z.enum(['full', 'half', 'third', 'pact', 'none']);
/** Ruling 2 (phase 4): the progressions that participate in a multiclass combined caster level.
 *  `pact` is excluded — pact-magic slots stay separate (Warlock-only), never combined; `none` isn't
 *  a caster progression at all. */
export const MulticlassProgressionSchema = z.enum(['full', 'half', 'third']);
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

/**
 * Ruling 5 (phase 4, plan 11 task 1): short plain-text value for a typed `ClassLevelRow.extra`
 * column that isn't a dice roll, integer or formula (e.g. an ordinal column value like "1st", a
 * short note). Letters, digits, spaces, `'` and `-` only. Distinct from (and stricter than)
 * `FormulaSchema`'s charset, which was already permissive enough to accept most such strings by
 * accident (it validates charset only — grammar is checked later, by `@hk/engine`'s
 * `validateFormula()` — so e.g. "1d6" or "Rage Damage" already satisfied `FormulaSchema`'s regex
 * without being valid formulas). This schema exists to make "plain text, not a formula" an explicit,
 * named shape rather than a coincidence of a loose charset check.
 */
export const ExtraTextSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9][A-Za-z0-9 '-]*$/, "Expected plain text (letters, digits, spaces, - or ')");

/**
 * Ruling 5: a `ClassLevelRow.extra` column value — an int or formula (`ValueSchema`, evaluated
 * numerically), a dice roll (`DiceSchema`, e.g. Rage Damage "1d6"), or short plain text
 * (`ExtraTextSchema`, e.g. an ordinal column). A pure superset of `ValueSchema` (old integer/formula
 * extras, e.g. `druid-prepared-spells`, keep parsing byte-identically) — deliberately its own union
 * rather than a widening of `ValueSchema` itself, because `ValueSchema` is shared with numeric-context
 * effects (`ac.bonus`, `hp.bonus`, `attack.bonus`, ...) where a stray dice/text value would be a
 * domain error, not a legal input. Downstream (engine) consumption note: `extra` values are today
 * pushed through formula-grammar validation unconditionally (`packages/engine/src/content/
 * entity-formulas.ts`); a value that matches `DiceSchema`/`ExtraTextSchema` should be treated as a
 * typed literal, not a formula-validation candidate — that wiring is for whichever task next touches
 * `entity-formulas.ts`/`deriveSpellcasting`'s extra-reading, not this one.
 */
export const ExtraValueSchema = z.union([ValueSchema, DiceSchema, ExtraTextSchema]);

export const ShortTextSchema = z.string().min(1).max(200);
export const LongTextSchema = z
  .string()
  .min(1)
  .max(20 * 1024);
