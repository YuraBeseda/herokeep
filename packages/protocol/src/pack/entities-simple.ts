import { z } from 'zod';
import { EntityIdSchema, EntityTypeSchema, SlugSchema } from '../ids.ts';
import { entity } from './entity-base.ts';
import { ResetSchema, ShortTextSchema, SlotProgressionSchema, UsesSchema } from './enums.ts';
import { AbilityKeySchema, ClassRefSchema, PredicateSchema } from './predicate.ts';

const NonNegInt = z.int().min(0);

export const SystemEntitySchema = entity('system', {
  abilities: z.array(z.strictObject({ id: AbilityKeySchema, name: ShortTextSchema })).min(1),
  skills: z.array(z.strictObject({ id: SlugSchema, name: ShortTextSchema, ability: AbilityKeySchema })).min(1),
  saves: z.array(AbilityKeySchema).min(1),
  compositionSlots: z
    .array(
      z.strictObject({
        id: SlugSchema,
        entityType: EntityTypeSchema,
        count: z.union([z.int().min(1), z.literal('many')]),
        at: z.enum(['creation', 'levelUp']),
      }),
    )
    .min(1),
  restTypes: z.array(ResetSchema).min(1),
  tables: z.strictObject({
    /** xp[i] = XP needed to *be* level i+1 (xp[0] = 0). */
    xp: z.array(NonNegInt).min(1).max(20),
    /** proficiency[i] = bonus at level i+1. */
    proficiency: z.array(z.int().min(1)).min(1).max(20),
    /** spellSlots[progression][levelIndex] = slots per spell level (index 0 = 1st-level slots). */
    spellSlots: z.partialRecord(SlotProgressionSchema, z.array(z.array(NonNegInt).max(9)).max(20)),
  }),
  currencies: z.array(z.strictObject({ id: SlugSchema, name: ShortTextSchema, inCopper: z.int().min(1) })).min(1),
  damageTypes: z.array(SlugSchema).min(1),
  sizes: z.array(SlugSchema).min(1),
  conditions: z.array(EntityIdSchema).default([]),
  restRules: z.strictObject({
    shortRest: z.strictObject({ allowHitDice: z.boolean() }),
    longRest: z.strictObject({
      hpToMax: z.boolean(),
      restoreAllSlots: z.boolean(),
      hitDiceRegainDivisor: z.int().min(1),
      hitDiceRegainMin: NonNegInt,
      exhaustionReduce: NonNegInt,
    }),
  }),
  hpRules: z.strictObject({ firstLevelMaxHitDie: z.boolean(), averageRounding: z.enum(['up', 'down']) }),
  attunementMax: NonNegInt,
  multiclass: z.strictObject({ prerequisites: z.record(ClassRefSchema, PredicateSchema) }).optional(),
  abilityGeneration: z.strictObject({
    standardArray: z.array(z.int().min(1).max(30)).min(1),
    pointBuy: z.strictObject({
      budget: NonNegInt,
      min: z.int().min(1),
      max: z.int().min(1),
      costs: z.record(z.string().regex(/^\d{1,2}$/), NonNegInt),
    }),
    /** Dice-spec for rolled scores, e.g. 4d6kh3 (keep highest 3). */
    roll: z.string().regex(/^\d{1,2}d\d{1,3}(kh\d|kl\d)?$/),
    manual: z.strictObject({ min: z.int().min(1), max: z.int().min(1) }),
  }),
});

export const SpeciesEntitySchema = entity('species', {
  size: SlugSchema,
  speed: NonNegInt,
  creatureType: SlugSchema,
});

export const BackgroundEntitySchema = entity('background', {
  abilityScores: z.array(AbilityKeySchema).min(1).max(6),
  originFeat: EntityIdSchema,
  skillProficiencies: z.array(SlugSchema).default([]),
  toolProficiency: SlugSchema.optional(),
});

export const FeatEntitySchema = entity('feat', {
  category: z.enum(['origin', 'general', 'fightingStyle', 'epicBoon']),
  repeatable: z.boolean().default(false),
});

export const FeatureEntitySchema = entity('feature', {
  uses: UsesSchema.optional(),
});

export const ConditionEntitySchema = entity('condition', {
  levels: z.int().min(1).max(10).optional(),
});

export const SkillEntitySchema = entity('skill', { ability: AbilityKeySchema });
export const AbilityEntitySchema = entity('ability', { abbreviation: AbilityKeySchema });
export const LanguageEntitySchema = entity('language', { script: ShortTextSchema.optional() });
export const ToolEntitySchema = entity('tool', { category: SlugSchema.optional() });
export const RuleEntitySchema = entity('rule', {});
export const TableEntitySchema = entity('table', {
  columns: z.array(ShortTextSchema).min(1),
  rows: z.array(z.array(z.union([z.string().max(200), z.number()])).min(1)).min(1),
});
