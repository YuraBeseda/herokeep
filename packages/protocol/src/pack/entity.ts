import { z } from 'zod';
import { ItemEntitySchema, SpellEntitySchema } from './entities-content.ts';
import { ClassEntitySchema, SubclassEntitySchema } from './entities-progression.ts';
import {
  AbilityEntitySchema,
  BackgroundEntitySchema,
  ConditionEntitySchema,
  FeatEntitySchema,
  FeatureEntitySchema,
  LanguageEntitySchema,
  RuleEntitySchema,
  SkillEntitySchema,
  SpeciesEntitySchema,
  SystemEntitySchema,
  TableEntitySchema,
  ToolEntitySchema,
} from './entities-simple.ts';

/**
 * `entity()` returns a refined schema, which cannot be a discriminatedUnion member;
 * a plain union is used instead. Zod tries members in order, so keep the common types first.
 */
export const EntitySchema = z.union([
  SpellEntitySchema,
  ItemEntitySchema,
  FeatureEntitySchema,
  FeatEntitySchema,
  SpeciesEntitySchema,
  BackgroundEntitySchema,
  ClassEntitySchema,
  SubclassEntitySchema,
  ConditionEntitySchema,
  SkillEntitySchema,
  AbilityEntitySchema,
  LanguageEntitySchema,
  ToolEntitySchema,
  RuleEntitySchema,
  TableEntitySchema,
  SystemEntitySchema,
]);
export type Entity = z.infer<typeof EntitySchema>;
export type SystemEntity = z.infer<typeof SystemEntitySchema>;
export type ClassEntity = z.infer<typeof ClassEntitySchema>;
export type SubclassEntity = z.infer<typeof SubclassEntitySchema>;
export type SpellEntity = z.infer<typeof SpellEntitySchema>;
export type ItemEntity = z.infer<typeof ItemEntitySchema>;
export type FeatureEntity = z.infer<typeof FeatureEntitySchema>;
export type FeatEntity = z.infer<typeof FeatEntitySchema>;
export type SpeciesEntity = z.infer<typeof SpeciesEntitySchema>;
export type BackgroundEntity = z.infer<typeof BackgroundEntitySchema>;
