import { z } from 'zod';
import { EntityIdSchema, EntityTypeSchema, SlugSchema } from '../ids.ts';
import { entity } from './entity-base.ts';
import {
  MulticlassProgressionSchema,
  ResetSchema,
  ShortTextSchema,
  SlotProgressionSchema,
  UsesSchema,
} from './enums.ts';
import { FormulaSchema } from './formula.ts';
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
    /** spellSlots[progression][levelIndex] = slots per spell level (index 0 = 1st-level slots). Every
     *  progression in `SlotProgressionSchema` (full, half, third, pact, none) is a valid key here —
     *  this is a `partialRecord`, so a pack supplies whichever progressions its classes use. */
    spellSlots: z.partialRecord(SlotProgressionSchema, z.array(z.array(NonNegInt).max(9)).max(20)),
    /**
     * Ruling 2 (phase 4, plan 11 task 1; rounding shape corrected in fix round 1): the multiclass
     * combined-caster-level slot table, plus the DATA (not TS constants) needed to compute that
     * combined level from each class's own level — `weights[progression]` is `{divisor, rounding}`:
     * divide the class's own level by `divisor`, round `rounding` ('up' | 'down'), INDIVIDUALLY per
     * class, before summing across classes.
     *
     * Rounding is PER-PROGRESSION data, not a single global rule, because the 2024 SRD text (vendored,
     * `packages/content/upstream/open5e-srd-2024/Rule.json`, pk
     * "srd-2024_multiclassing_spellcasting") specifies different directions per progression — quoted
     * verbatim: "You determine your available spell slots by adding together the following: — All
     * your levels in the Bard, Cleric, Druid, Sorcerer, and Wizard classes — Half your levels (round
     * UP) in the Paladin and Ranger classes." So: full = {divisor: 1, rounding: n/a — divisor 1 never
     * has a fractional part, so either direction is a no-op}; half = {divisor: 2, rounding: 'up'} —
     * this is a DELIBERATE 2024 change from the 2014 rule (which rounded half-casters DOWN); an
     * earlier draft of this schema/doc wrongly carried the 2014 round-down text as if it were the
     * 2024 rule, which fix round 1 corrects.
     *
     * OWNER-FLAG (2024 SRD-silent): that passage names no third-caster (Eldritch Knight/Arcane
     * Trickster) contribution at all — only full and half casters are mentioned. `third` stays
     * expressible in `weights` (`MulticlassProgressionSchema` includes it), but its divisor/rounding
     * are NOT specified by the core rules text available to this repo; a content pack author (T7)
     * must choose a value and note the choice (2014 precedent, if adopted: divisor 3, round down) —
     * this is a content-authoring decision, not something this schema can resolve.
     *
     * `slots` has the same per-row shape as one `spellSlots` progression array: index 0 = combined
     * caster level 1, row[i] = max slots for spell level i+1. Pact-magic casters are excluded from
     * `weights` (`MulticlassProgressionSchema` has no `pact` member) — pact slots are tracked
     * separately and never contribute to this table. Optional: single-class characters keep using the
     * per-class `spellSlots` table untouched (byte-identical existing behavior); engine consumption
     * (T2/T3) is out of this task's scope.
     */
    multiclassSlots: z
      .strictObject({
        weights: z.partialRecord(
          MulticlassProgressionSchema,
          z.strictObject({ divisor: z.int().min(1).max(10), rounding: z.enum(['up', 'down']) }),
        ),
        slots: z.array(z.array(NonNegInt).max(9)).max(20),
      })
      .optional(),
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
  /**
   * Ruling 1 (phase 4, plan 11, task 5 — "encumbrance option"): carry-capacity formulas/thresholds,
   * DATA (not TS constants), consumed by `@hk/engine`'s `deriveEncumbrance` only when a character's
   * `derive()` call opts in via `overrides.encumbrance: 'standard' | 'variant'` (default `'off'` —
   * zero computation, byte-identical to pre-task behavior). `standard` and `variant` are each
   * independently optional so a pack may supply either, both, or neither.
   *
   * SRD-silent, VERIFIED (not assumed): unlike `multiclassSlots` above, the vendored 2024 snapshot
   * (`packages/content/upstream/open5e-srd-2024/Rule.json`, `ConditionDescription.json`) carries NO
   * numeric carrying-capacity/encumbrance rule text at all — `Rule.json`'s own "Interacting with
   * Objects" entry (pk `srd-2024_exploration_interacting-with-objects`) points at "the rules for
   * carrying capacity in 'Rules Glossary'", but that glossary chapter isn't part of this vendored
   * snapshot, and `ConditionDescription.json` has no "encumbered" condition entry either. So BOTH
   * `standard` and `variant` numbers here are entirely a content-pack author's judgment call (T7's
   * job, cited-or-flagged there, same posture as `multiclassSlots.weights.third` above) — this
   * schema only shapes the DATA; the engine only ever evaluates whatever formula is supplied here,
   * never a hardcoded 5e number.
   *
   * `capacity` formulas are evaluated against the formula grammar (`score(str)` etc. — see doc-04);
   * `variant.thresholds[].speedPenalty` is carried as DATA for a future consumer (T12 display, or a
   * later engine task) — `deriveEncumbrance` does NOT apply it to `Sheet.speed` itself (documented
   * engine-side: no vendored text justifies a specific speed-reduction amount this task could cite).
   */
  encumbrance: z
    .strictObject({
      standard: z.strictObject({ capacity: FormulaSchema }).optional(),
      variant: z
        .strictObject({
          /** Hard cap: load beyond this is `'overloaded'` regardless of the graded thresholds below. */
          capacity: FormulaSchema,
          /** Graded, ascending by resolved `capacity` — `load >= threshold.capacity` activates it. */
          thresholds: z
            .array(
              z.strictObject({
                capacity: FormulaSchema,
                state: z.enum(['encumbered', 'heavilyEncumbered']),
                speedPenalty: NonNegInt.optional(),
              }),
            )
            .min(1),
        })
        .optional(),
    })
    .optional(),
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
