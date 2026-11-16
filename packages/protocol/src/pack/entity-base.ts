import { z } from 'zod';
import { type EntityType, EntityIdSchema, parseEntityId } from '../ids.ts';
import { ChoiceSchema } from './choice.ts';
import { IconRefSchema, SemverSchema, TagSchema } from './common.ts';
import { EffectSchema } from './effects.ts';
import { LongTextSchema, ShortTextSchema } from './enums.ts';
import { PredicateSchema } from './predicate.ts';

export const FeatureGrantSchema = z.strictObject({
  feature: EntityIdSchema,
  when: PredicateSchema.optional(),
});
export type FeatureGrant = z.infer<typeof FeatureGrantSchema>;

/**
 * One starting-equipment option (A/B/C) of a class or background: concrete pack items, short notes
 * for "of your choice" items the player adds themselves, and the gold. Shown on the creation cards.
 */
export const StartingOptionSchema = z.strictObject({
  label: z.enum(['A', 'B', 'C']),
  items: z.array(z.strictObject({ item: EntityIdSchema, qty: z.int().min(1) })).max(30),
  notes: z.array(ShortTextSchema).max(10),
  gp: z.int().min(0),
});
export type StartingOption = z.infer<typeof StartingOptionSchema>;
export const StartingEquipmentSchema = z.array(StartingOptionSchema).min(1).max(3);

export const EntityBaseShape = {
  id: EntityIdSchema,
  name: ShortTextSchema,
  description: LongTextSchema.optional(),
  tags: z.array(TagSchema).default([]),
  source: z.strictObject({ book: z.string().min(1).max(100), page: z.int().min(1).optional() }).optional(),
  prerequisites: z.array(PredicateSchema).default([]),
  effects: z.array(EffectSchema).default([]),
  grants: z.array(FeatureGrantSchema).default([]),
  choices: z.array(ChoiceSchema).default([]),
  deprecated: z.strictObject({ replacedBy: EntityIdSchema.optional(), since: SemverSchema }).optional(),
  icon: IconRefSchema.optional(),
};

/** Builds a strict entity schema for `type` and enforces that the id's type segment matches. */
export function entity<T extends EntityType, S extends z.ZodRawShape>(type: T, shape: S) {
  return z
    .strictObject({ type: z.literal(type), ...EntityBaseShape, ...shape })
    .refine((e) => parseEntityId((e as { id: string }).id)?.type === type, {
      message: `Entity id type must be "${type}"`,
      path: ['id'],
    });
}
