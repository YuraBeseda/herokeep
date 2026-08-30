import { z } from 'zod';
import { EntityIdSchema, SlugSchema } from '../ids.ts';
import { ChoiceSchema } from './choice.ts';
import { FeatureGrantSchema, entity } from './entity-base.ts';
import { ValueSchema } from './enums.ts';
import { AbilityKeySchema, PredicateSchema } from './predicate.ts';

export const ClassLevelRowSchema = z.strictObject({
  level: z.int().min(1).max(20),
  grants: z.array(FeatureGrantSchema).default([]),
  choices: z.array(ChoiceSchema).default([]),
  /** Free-form numeric facts for this row (e.g. { attacks: 2, sneakAttackDice: 3 }); read by effects via formulas later. */
  extra: z.record(SlugSchema, ValueSchema).optional(),
});
export type ClassLevelRow = z.infer<typeof ClassLevelRowSchema>;

const rowsAscending = (rows: { level: number }[]) =>
  rows.every((r, i) => i === 0 || r.level > (rows[i - 1]?.level ?? 0));

export const ClassEntitySchema = entity('class', {
  hitDie: z.union([z.literal(6), z.literal(8), z.literal(10), z.literal(12)]),
  primaryAbility: z.array(AbilityKeySchema).min(1),
  saves: z.array(AbilityKeySchema).min(1).max(2),
  armorTraining: z.array(SlugSchema).default([]),
  weaponProficiencies: z.array(SlugSchema).default([]),
  toolProficiencies: z.array(SlugSchema).default([]),
  skillChoice: z.strictObject({ from: z.array(SlugSchema).min(1), count: z.int().min(0) }),
  subclassLevel: z.int().min(1).max(20),
  levels: z.array(ClassLevelRowSchema).min(1).refine(rowsAscending, { message: 'levels must be ascending and unique' }),
  multiclass: z
    .strictObject({
      prerequisites: PredicateSchema,
      gains: z.strictObject({
        armorTraining: z.array(SlugSchema).default([]),
        weaponProficiencies: z.array(SlugSchema).default([]),
        skillChoiceCount: z.int().min(0).default(0),
      }),
    })
    .optional(),
});

export const SubclassEntitySchema = entity('subclass', {
  class: EntityIdSchema,
  levels: z.array(ClassLevelRowSchema).min(1).refine(rowsAscending, { message: 'levels must be ascending and unique' }),
});
