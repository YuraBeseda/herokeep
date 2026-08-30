import { z } from 'zod';
import { EntityIdSchema, SLUG_RE, isEntityId } from '../ids.ts';
import { FormulaSchema } from './formula.ts';

export const ComparisonSchema = z
  .strictObject({
    gte: z.int().optional(),
    lte: z.int().optional(),
    gt: z.int().optional(),
    lt: z.int().optional(),
    eq: z.int().optional(),
  })
  .refine((c) => Object.keys(c).length > 0, { message: 'Comparison needs at least one of gte/lte/gt/lt/eq' });
export type Comparison = z.infer<typeof ComparisonSchema>;

/** Ability keys are lowercase 3-letter ids (str, dex, con, int, wis, cha) declared by the system entity. */
export const AbilityKeySchema = z.string().regex(/^[a-z]{3}$/);

/** A class slug (resolved against the core pack) or a full entity id. */
export const ClassRefSchema = z
  .string()
  .refine((s) => SLUG_RE.test(s) || isEntityId(s), { message: 'Expected a class slug or entity id' });

export const ProficiencyKindSchema = z.enum(['skill', 'save', 'armor', 'weapon', 'tool', 'language']);
export const ArmorCategorySchema = z.enum(['none', 'light', 'medium', 'heavy']);

export type Predicate =
  | { all: Predicate[] }
  | { any: Predicate[] }
  | { not: Predicate }
  | { ability: Record<string, Comparison> }
  | { level: Comparison }
  | { classLevel: Record<string, Comparison> }
  | { hasFeature: string }
  | { hasFeat: string }
  | { hasSpell: string }
  | { tag: string }
  | { proficient: { kind: z.infer<typeof ProficiencyKindSchema>; target: string } }
  | { armor: { category: z.infer<typeof ArmorCategorySchema>[] } }
  | { shield: boolean }
  | { species: string }
  | { class: string }
  | { subclass: string }
  | { condition: string }
  | { spellcaster: boolean }
  | { formula: string };

export const PredicateSchema: z.ZodType<Predicate> = z.union([
  z.strictObject({
    get all() {
      return z.array(PredicateSchema).min(1);
    },
  }),
  z.strictObject({
    get any() {
      return z.array(PredicateSchema).min(1);
    },
  }),
  z.strictObject({
    get not() {
      return PredicateSchema;
    },
  }),
  z.strictObject({ ability: z.record(AbilityKeySchema, ComparisonSchema) }),
  z.strictObject({ level: ComparisonSchema }),
  z.strictObject({ classLevel: z.record(ClassRefSchema, ComparisonSchema) }),
  z.strictObject({ hasFeature: EntityIdSchema }),
  z.strictObject({ hasFeat: EntityIdSchema }),
  z.strictObject({ hasSpell: EntityIdSchema }),
  z.strictObject({ tag: z.string().min(1).max(64) }),
  z.strictObject({ proficient: z.strictObject({ kind: ProficiencyKindSchema, target: z.string().min(1).max(64) }) }),
  z.strictObject({ armor: z.strictObject({ category: z.array(ArmorCategorySchema).min(1) }) }),
  z.strictObject({ shield: z.boolean() }),
  z.strictObject({ species: EntityIdSchema }),
  z.strictObject({ class: EntityIdSchema }),
  z.strictObject({ subclass: EntityIdSchema }),
  z.strictObject({ condition: EntityIdSchema }),
  z.strictObject({ spellcaster: z.boolean() }),
  z.strictObject({ formula: FormulaSchema }),
]);
