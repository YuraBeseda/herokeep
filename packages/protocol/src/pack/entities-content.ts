import { z } from 'zod';
import { SlugSchema } from '../ids.ts';
import { DiceSchema } from './common.ts';
import { entity } from './entity-base.ts';
import { DamageTypeSchema, LongTextSchema, ResetSchema } from './enums.ts';
import { FormulaSchema } from './formula.ts';
import { AbilityKeySchema, ClassRefSchema, PredicateSchema } from './predicate.ts';

export const SpellEntitySchema = entity('spell', {
  level: z.int().min(0).max(9),
  school: SlugSchema,
  castingTime: z.strictObject({
    value: z.int().min(1),
    unit: z.enum(['action', 'bonus', 'reaction', 'minute', 'hour']),
    condition: z.string().max(200).optional(),
  }),
  range: z.strictObject({
    kind: z.enum(['self', 'touch', 'feet', 'miles', 'sight', 'unlimited', 'special']),
    distance: z.int().min(1).optional(),
  }),
  components: z.strictObject({
    v: z.boolean(),
    s: z.boolean(),
    m: z.boolean(),
    materialText: z.string().max(500).optional(),
  }),
  duration: z.strictObject({
    kind: z.enum(['instantaneous', 'time', 'untilDispelled', 'special']),
    value: z.int().min(1).optional(),
    unit: z.enum(['round', 'minute', 'hour', 'day']).optional(),
  }),
  concentration: z.boolean(),
  ritual: z.boolean(),
  classes: z.array(ClassRefSchema),
  damage: z.strictObject({ dice: DiceSchema, type: DamageTypeSchema }).optional(),
  save: AbilityKeySchema.optional(),
  attack: z.enum(['melee', 'ranged']).optional(),
  higherLevels: LongTextSchema.optional(),
});

export const ItemEntitySchema = entity('item', {
  category: z.enum(['weapon', 'armor', 'shield', 'gear', 'tool', 'consumable', 'magic']),
  cost: z.strictObject({ amount: z.int().min(0), currency: SlugSchema }).optional(),
  weight: z.number().min(0).optional(),
  rarity: z.enum(['common', 'uncommon', 'rare', 'veryRare', 'legendary', 'artifact']).optional(),
  attunement: z.strictObject({ required: z.boolean(), by: PredicateSchema.optional() }).optional(),
  weapon: z
    .strictObject({
      kind: z.enum(['melee', 'ranged']),
      category: z.enum(['simple', 'martial']),
      damage: DiceSchema,
      damageType: DamageTypeSchema,
      versatile: DiceSchema.optional(),
      properties: z.array(SlugSchema).default([]),
      mastery: SlugSchema.optional(),
      range: z.strictObject({ normal: z.int().min(1), long: z.int().min(1) }).optional(),
    })
    .optional(),
  armor: z
    .strictObject({
      category: z.enum(['light', 'medium', 'heavy']),
      ac: z.int().min(10).max(20),
      dexCap: z.int().min(0).optional(),
      strength: z.int().min(1).optional(),
      stealthDisadvantage: z.boolean().default(false),
    })
    .optional(),
  shield: z.strictObject({ ac: z.int().min(1) }).optional(),
  charges: z.strictObject({ max: FormulaSchema, reset: ResetSchema }).optional(),
  container: z.strictObject({ capacityLb: z.number().min(0).optional() }).optional(),
});
