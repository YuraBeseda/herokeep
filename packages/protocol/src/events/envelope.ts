import { z } from 'zod';

// 'member' added for campaign-stream events (plan-9 Task 1): a campaign member authors
// roll.logged/chat.message/member.renamed/own campaign.character_joined-left directly (doc-08
// §Authorization matrix), so the committed event's actor.role must be able to carry it. Never
// appears on a character-stream event — character.ts's EVENT_ACTORS has no entry that grants
// 'member' (apps/api's permissions.ts Role-narrowing early-returns false for it there).
export const ActorRoleSchema = z.enum(['owner', 'dm', 'system', 'member']);
export type ActorRole = z.infer<typeof ActorRoleSchema>;

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const StreamIdSchema = z.string().regex(new RegExp(`^(char|camp):${UUID.source.slice(1, -1)}$`, 'i'));

export const EventEnvelopeSchema = z.strictObject({
  id: z.string().regex(UUID),
  stream: StreamIdSchema,
  seq: z.int().min(1).optional(),
  ts: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/),
  actor: z.strictObject({
    userId: z.string().min(1).max(64),
    deviceId: z.string().min(1).max(64),
    role: ActorRoleSchema,
  }),
  // dot-separated lowercase segments, each optionally underscore_joined (e.g. `hp.changed`,
  // `hit_dice.spent`, `death_save.recorded`); a bare single segment is allowed (`stabilized`).
  type: z.string().regex(/^[a-z]+(_[a-z]+)*(\.[a-z]+(_[a-z]+)*)*$/),
  v: z.int().min(1),
  txId: z.string().regex(UUID).optional(),
  payload: z.unknown(),
});
export type Event = z.infer<typeof EventEnvelopeSchema>;
