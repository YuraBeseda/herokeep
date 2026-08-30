import { z } from 'zod';
import { ENTITY_ID_RE, EntityIdSchema, EntityTypeSchema, SLUG_RE, parseEntityId } from '../ids.ts';
import { ShortTextSchema } from './enums.ts';
import { ClassRefSchema, PredicateSchema } from './predicate.ts';

export const CHOICE_ID_RE = new RegExp(`^(${ENTITY_ID_RE.source.slice(1, -1)})@(\\d{1,2})/([a-z0-9][a-z0-9-]*)$`);

export interface ParsedChoiceId {
  entityId: string;
  level: number;
  slug: string;
}

export function parseChoiceId(id: string): ParsedChoiceId | null {
  const m = CHOICE_ID_RE.exec(id);
  if (!m) return null;
  const entityId = m[1];
  const level = m[m.length - 2];
  const slug = m[m.length - 1];
  if (entityId === undefined || level === undefined || slug === undefined) return null;
  if (parseEntityId(entityId) === null) return null;
  return { entityId, level: Number(level), slug };
}

export const ChoiceIdSchema = z
  .string()
  .refine((s) => parseChoiceId(s) !== null, { message: 'Expected <entityId>@<level>/<slug>' });

export const ChoiceAtSchema = z.union([
  z.strictObject({ kind: z.literal('creation') }),
  z.strictObject({ kind: z.literal('classLevel'), class: ClassRefSchema, level: z.int().min(1).max(20) }),
  z.strictObject({ kind: z.literal('level'), level: z.int().min(1).max(20) }),
]);

export const EntityQuerySchema = z.strictObject({
  type: EntityTypeSchema,
  tags: z.array(z.string().min(1).max(64)).optional(),
  level: z.int().min(0).max(9).optional(),
  classes: z.array(ClassRefSchema).optional(),
  school: z.string().regex(SLUG_RE).optional(),
});

export const PickSchema = z.union([
  z.strictObject({ static: z.array(EntityIdSchema).min(1) }),
  z.strictObject({ query: EntityQuerySchema }),
  z.strictObject({
    abilities: z.strictObject({
      count: z.int().min(1).max(6),
      max: z.int().min(1).max(30).default(20),
      improve: z.enum(['+1', '+2', '+2/+1', '+1/+1/+1']),
    }),
  }),
  z.strictObject({ abilityGeneration: z.literal(true) }),
  z.strictObject({ literal: z.enum(['text']) }),
  z.strictObject({
    equipmentOption: z
      .array(z.array(z.strictObject({ item: EntityIdSchema, qty: z.int().min(1).default(1) })).min(1))
      .min(1),
  }),
]);

export const ChoiceSchema = z.strictObject({
  id: ChoiceIdSchema,
  prompt: ShortTextSchema,
  at: ChoiceAtSchema,
  pick: PickSchema,
  count: z.int().min(1).default(1),
  unique: z.boolean().default(true),
  repeatableAt: z.array(z.int().min(1).max(20)).default([]),
  prerequisites: z.array(PredicateSchema).default([]),
});
export type Choice = z.infer<typeof ChoiceSchema>;
export type ChoiceAt = z.infer<typeof ChoiceAtSchema>;
export type Pick = z.infer<typeof PickSchema>;
export type EntityQuery = z.infer<typeof EntityQuerySchema>;
