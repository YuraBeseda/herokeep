import { z } from 'zod';

export const ActorRoleSchema = z.enum(['owner', 'dm', 'system']);
export type ActorRole = z.infer<typeof ActorRoleSchema>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
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
  type: z.string().regex(/^[a-z]+(\.[a-z_]+)+$/),
  v: z.int().min(1),
  txId: z.string().regex(UUID).optional(),
  payload: z.unknown(),
});
export type Event = z.infer<typeof EventEnvelopeSchema>;
