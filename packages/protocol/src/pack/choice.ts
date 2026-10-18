import { z } from 'zod';
import { ENTITY_ID_RE, EntityIdSchema, EntityTypeSchema, SLUG_RE, parseEntityId } from '../ids.ts';
import { ItemCategorySchema, ShortTextSchema } from './enums.ts';
import { FormulaSchema } from './formula.ts';
import { AbilityKeySchema, ClassRefSchema, PredicateSchema } from './predicate.ts';

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

/**
 * Ruling 4 (phase 4, plan 11 task 1): a dot-separated path into a candidate entity's own JSON shape,
 * for `EntityQuerySchema`'s `hasField` filter — e.g. "weapon.mastery". Lower-camelCase segments only,
 * matching the field names the pack schema itself uses (`weapon`, `mastery`, `stealthDisadvantage`,
 * ...); no array indices (arrays are matched via `tags`, not path filters).
 */
export const FIELD_PATH_RE = /^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)*$/;

export const EntityQuerySchema = z.strictObject({
  type: EntityTypeSchema,
  tags: z.array(z.string().min(1).max(64)).optional(),
  level: z.int().min(0).max(9).optional(),
  classes: z.array(ClassRefSchema).optional(),
  school: z.string().regex(SLUG_RE).optional(),
  /**
   * Ruling 4: dot-paths into the candidate entity that must be present (defined) for a match — AND
   * semantics, same as `tags`. Chosen over inventing a tag taxonomy for e.g. weapon-mastery choices:
   * `{type: 'item', hasField: ['weapon.mastery']}` selects exactly the items with a mastery property,
   * without every weapon needing a hand-authored `weapon-mastery` tag. The engine evaluator walks
   * each path against the raw candidate entity object, segment by segment, testing `!== undefined` at
   * each level (a missing intermediate object is a non-match, not an error).
   */
  hasField: z.array(z.string().regex(FIELD_PATH_RE, 'Expected a dot-path like "weapon.mastery"')).optional(),
  /**
   * Plan 14 task 2 — additive: an item-category filter (the item `category` enum), e.g.
   * `{type: 'item', category: 'tool'}` selects every tool. Matches only item entities (a non-item
   * candidate is a non-match), same as `level`/`school` match only spells. `.optional()`, so every
   * existing query parses byte-identically.
   */
  category: ItemCategorySchema.optional(),
});

/**
 * Plan 13 task 1 (expertise picks) — an additive widening of the `query` pick. A decided pick whose
 * selections are skill entities grants a proficiency rank in them (engine `derive/abilities.ts`);
 * these two optional keys, both legal ONLY on a `{type: 'skill'}` query, shape that grant:
 * - `proficiency`: the rank each selected skill gains — `'proficient'` (the default when absent,
 *   i.e. every pre-existing skill pick, unchanged) or `'expertise'` (the same rank a
 *   `proficiency.grant{level:'expertise'}` effect applies);
 * - `requireProficient`: the pick offers, accepts and applies ONLY skills the character is already
 *   proficient in from some other source (rank proficient or expertise — `half` does not count).
 * Both are `.optional()` (never `.default()`), so every existing pick parses byte-identically.
 */
const QueryPickSchema = z
  .strictObject({
    query: EntityQuerySchema,
    proficiency: z.enum(['proficient', 'expertise']).optional(),
    requireProficient: z.boolean().optional(),
  })
  .refine((p) => (p.proficiency === undefined && p.requireProficient === undefined) || p.query.type === 'skill', {
    message: '"proficiency"/"requireProficient" apply only to a {type: "skill"} query pick',
  });

/**
 * Plan 14 task 2 (mixed-type picks) — an additive pick form: the UNION of several entity queries,
 * deduplicated and offered as ONE option list, with the choice's `count` applying to the union —
 * e.g. the Skilled feat's "any combination of three skills or tools" is
 * `{queries: [{type: 'skill'}, {type: 'item', category: 'tool'}]}`. Each selection grants through
 * the path its own entity type already uses (a skill a skill proficiency, a tool a tool
 * proficiency), so one mixed decision may land both. At least two queries (one query is the
 * `query` form); mutually exclusive with `static` and `query` (strict union members), and carries
 * none of the skill-only `proficiency`/`requireProficient` keys.
 */
const QueriesPickSchema = z.strictObject({ queries: z.array(EntityQuerySchema).min(2) });

export const PickSchema = z.union([
  z.strictObject({ static: z.array(EntityIdSchema).min(1) }),
  QueryPickSchema,
  QueriesPickSchema,
  z.strictObject({
    abilities: z.strictObject({
      count: z.int().min(1).max(6),
      max: z.int().min(1).max(30).default(20),
      improve: z.enum(['+1', '+2', '+2/+1', '+1/+1/+1']),
      /**
       * Plan 13 task 3 (restricted ability picks) — additive: when present, the pick offers,
       * accepts and validates ONLY these abilities (e.g. Grappler's "Strength or Dexterity +1"),
       * intersected with the owner's own `abilityScores` list where it has one (a background).
       * `.optional()` (never `.default()`), so every existing abilities pick parses byte-identically.
       */
      from: z.array(AbilityKeySchema).min(1).max(6).optional(),
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
  /**
   * Picks required. An int is fixed; a formula string (plan 12 task 2) is resolved by the engine
   * against the character (`classLevel(<class>)`, `level`) so a class choice can grow with level —
   * e.g. fighter weapon masteries 3 -> 4 -> 5 -> 6. Additive widening: every int count is unchanged.
   */
  count: z.union([z.int().min(1), FormulaSchema]).default(1),
  unique: z.boolean().default(true),
  repeatableAt: z.array(z.int().min(1).max(20)).default([]),
  prerequisites: z.array(PredicateSchema).default([]),
  /**
   * Plan 14 task 1 — "initial class" as a structural property of a class-row choice
   * (`at.kind === 'classLevel'`): `'initial'` offers it only while its owning class is the
   * character's FIRST class (`facts.classes[0]`), `'later'` only while it is not; absent = offered
   * either way (every pre-existing choice). Only OFFERS depend on it: a recorded decision keeps
   * granting regardless. A `scope` on any other `at` kind is a pack diagnostic
   * (`choice.scopeOnNonClassChoice`). `.optional()` (never `.default()`), so every existing choice
   * parses byte-identically.
   */
  scope: z.enum(['initial', 'later']).optional(),
});
export type Choice = z.infer<typeof ChoiceSchema>;
export type ChoiceAt = z.infer<typeof ChoiceAtSchema>;
export type ChoicePick = z.infer<typeof PickSchema>;
export type EntityQuery = z.infer<typeof EntityQuerySchema>;
