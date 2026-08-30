import { z } from 'zod';
import { PackIdSchema, SlugSchema } from '../ids.ts';
import { ChoiceIdSchema } from '../pack/choice.ts';
import { SemverSchema } from '../pack/common.ts';
import { ShortTextSchema } from '../pack/enums.ts';
import type { ActorRole } from './envelope.ts';

export const GrammaticalGenderSchema = z.enum(['masculine', 'feminine', 'neuter']);

export const CharacterCreatedV1 = z.strictObject({
  name: ShortTextSchema,
  system: SlugSchema,
  corePack: z.strictObject({ id: PackIdSchema, version: SemverSchema }),
  engineVersion: SemverSchema,
  grammaticalGender: GrammaticalGenderSchema,
});
export const PackPinnedV1 = z.strictObject({
  packId: PackIdSchema,
  version: SemverSchema,
  previous: SemverSchema.optional(),
});
export const DecisionMadeV1 = z.strictObject({
  choiceId: ChoiceIdSchema,
  selection: z.array(z.string().min(1).max(200)).max(20),
  context: z.record(z.string().max(64), z.unknown()).optional(),
});

export const EVENT_PAYLOADS: Record<string, z.ZodType> = {
  'character.created@1': CharacterCreatedV1,
  'pack.pinned@1': PackPinnedV1,
  'decision.made@1': DecisionMadeV1,
};

export const EVENT_ACTORS: Record<string, ActorRole[]> = {
  'character.created': ['owner'],
  'pack.pinned': ['owner', 'dm'],
  'decision.made': ['owner'],
};

export type CharacterCreated = z.infer<typeof CharacterCreatedV1>;
export type PackPinned = z.infer<typeof PackPinnedV1>;
export type DecisionMade = z.infer<typeof DecisionMadeV1>;
