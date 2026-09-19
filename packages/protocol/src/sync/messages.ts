import { z } from 'zod';
import { EventEnvelopeSchema, StreamIdSchema, UUID } from '../events/envelope.ts';
import { PackIdSchema } from '../ids.ts';
import { BlobHashSchema, SemverSchema } from '../pack/common.ts';

/**
 * Sync protocol version (docs/02-architecture/03-sync-protocol.md § Versioning).
 * Independent of PROTOCOL_VERSION (packages/protocol/src/index.ts), which versions the
 * content-pack schema format, not the WebSocket message protocol.
 */
export const PROTO_VERSION = 1 as const;

// Authorization role for a sync-protocol actor (ADR-012 §Authorization). Distinct from
// events/envelope.ts's ActorRoleSchema (owner|dm|system, used to stamp committed events):
// this is the *client-facing* actor identity, which never includes the internal 'system'
// role and carries no deviceId.
export const ActorSchema = z.strictObject({
  userId: z.string().min(1).max(64),
  role: z.enum(['owner', 'dm', 'member']),
});
export type Actor = z.infer<typeof ActorSchema>;

export const RejectCodeSchema = z.enum(['forbidden', 'quota', 'invalid', 'duplicate', 'stream_closed']);
export type RejectCode = z.infer<typeof RejectCodeSchema>;

// Events embedded inside frames (hello.pending, append.events, events.events) are validated
// at the frame level against the full EventEnvelopeSchema (exported by events/envelope.ts,
// strictObject, same package — cheap to import, no extra dependency). Its `payload` field is
// `z.unknown()`, so this only checks the envelope shape (id/stream/ts/actor/type/v/txId);
// the type-specific payload schema is re-checked individually server-side via `parseEvent`
// (packages/protocol/src/events/index.ts) before an event is committed. We do NOT re-embed
// the per-type payload union here — that would duplicate parseEvent's dispatch table and
// drift from it.
const FrameEventSchema = EventEnvelopeSchema;

const QuotaSchema = z.strictObject({
  bytesUsed: z.int().min(0),
  bytesMax: z.int().min(0),
  eventCount: z.int().min(0),
});

const StreamRefSchema = z.strictObject({
  id: StreamIdSchema,
  lastSeq: z.int().min(0),
});

const WelcomeStreamSchema = z.strictObject({
  id: StreamIdSchema,
  headSeq: z.int().min(0),
  quota: QuotaSchema,
});

// Shared by welcome.members and the standalone `members` frame (doc-03's presence-snapshot
// row: `[{userId, displayName, role, online}]`).
const MemberSchema = z.strictObject({
  userId: z.string().min(1).max(64),
  displayName: z.string().min(1).max(128),
  role: z.enum(['owner', 'dm', 'member']),
  online: z.boolean(),
});

// doc-03's welcome row only shows `packs: [...]` in the lifecycle sequence diagram without
// elaborating the shape. We use the same {id, version} pin shape already used for
// corePack/pack.pinned (events/character.ts), since welcome.packs communicates which content
// packs the stream's committed events reference.
const WelcomePackSchema = z.strictObject({
  id: PackIdSchema,
  version: SemverSchema,
});

// --- client -> server --------------------------------------------------------

export const HelloMsgSchema = z.strictObject({
  t: z.literal('hello'),
  rid: z.string().min(1),
  proto: z.int().min(1),
  app: z.string().min(1).max(64),
  streams: z.array(StreamRefSchema),
  have: z.array(BlobHashSchema),
  pending: z.array(FrameEventSchema),
});
export type HelloMsg = z.infer<typeof HelloMsgSchema>;

export const AppendMsgSchema = z.strictObject({
  t: z.literal('append'),
  rid: z.string().min(1),
  events: z.array(FrameEventSchema).min(1).max(50),
});
export type AppendMsg = z.infer<typeof AppendMsgSchema>;

export const SubscribeMsgSchema = z.strictObject({
  t: z.literal('subscribe'),
  stream: StreamIdSchema,
  lastSeq: z.int().min(0).optional(),
});
export type SubscribeMsg = z.infer<typeof SubscribeMsgSchema>;

export const UnsubscribeMsgSchema = z.strictObject({
  t: z.literal('unsubscribe'),
  stream: StreamIdSchema,
  lastSeq: z.int().min(0).optional(),
});
export type UnsubscribeMsg = z.infer<typeof UnsubscribeMsgSchema>;

export const BlobHaveMsgSchema = z.strictObject({
  t: z.literal('blob.have'),
  hashes: z.array(BlobHashSchema),
});
export type BlobHaveMsg = z.infer<typeof BlobHaveMsgSchema>;

export const BlobRequestMsgSchema = z.strictObject({
  t: z.literal('blob.request'),
  rid: z.string().min(1),
  hash: BlobHashSchema,
});
export type BlobRequestMsg = z.infer<typeof BlobRequestMsgSchema>;

export const BlobCancelMsgSchema = z.strictObject({
  t: z.literal('blob.cancel'),
  hash: BlobHashSchema,
});
export type BlobCancelMsg = z.infer<typeof BlobCancelMsgSchema>;

export const PresenceMsgSchema = z.strictObject({
  t: z.literal('presence'),
  state: z.enum(['active', 'idle']),
});
export type PresenceMsg = z.infer<typeof PresenceMsgSchema>;

export const ClientMessageSchema = z.discriminatedUnion('t', [
  HelloMsgSchema,
  AppendMsgSchema,
  SubscribeMsgSchema,
  UnsubscribeMsgSchema,
  BlobHaveMsgSchema,
  BlobRequestMsgSchema,
  BlobCancelMsgSchema,
  PresenceMsgSchema,
]);
export type ClientMessage = z.infer<typeof ClientMessageSchema>;

// --- server -> client --------------------------------------------------------

export const WelcomeMsgSchema = z.strictObject({
  t: z.literal('welcome'),
  rid: z.string().min(1),
  serverTime: z.string().min(1),
  streams: z.array(WelcomeStreamSchema),
  members: z.array(MemberSchema).optional(),
  packs: z.array(WelcomePackSchema).optional(),
});
export type WelcomeMsg = z.infer<typeof WelcomeMsgSchema>;

export const EventsMsgSchema = z.strictObject({
  t: z.literal('events'),
  stream: StreamIdSchema,
  events: z.array(FrameEventSchema),
});
export type EventsMsg = z.infer<typeof EventsMsgSchema>;

const AckResultSchema = z.strictObject({
  id: z.string().regex(UUID),
  seq: z.int().min(1),
});

export const AckMsgSchema = z.strictObject({
  t: z.literal('ack'),
  rid: z.string().min(1),
  results: z.array(AckResultSchema),
});
export type AckMsg = z.infer<typeof AckMsgSchema>;

const RejectResultSchema = z.strictObject({
  id: z.string().regex(UUID),
  code: RejectCodeSchema,
  message: z.string().min(1),
});

export const RejectMsgSchema = z.strictObject({
  t: z.literal('reject'),
  rid: z.string().min(1),
  results: z.array(RejectResultSchema),
});
export type RejectMsg = z.infer<typeof RejectMsgSchema>;

export const BlobPullMsgSchema = z.strictObject({
  t: z.literal('blob.pull'),
  hash: BlobHashSchema,
  to: z.string().min(1),
});
export type BlobPullMsg = z.infer<typeof BlobPullMsgSchema>;

export const BlobUnavailableMsgSchema = z.strictObject({
  t: z.literal('blob.unavailable'),
  hash: BlobHashSchema,
});
export type BlobUnavailableMsg = z.infer<typeof BlobUnavailableMsgSchema>;

export const MembersMsgSchema = z.strictObject({
  t: z.literal('members'),
  members: z.array(MemberSchema),
});
export type MembersMsg = z.infer<typeof MembersMsgSchema>;

export const NoticeMsgSchema = z.strictObject({
  t: z.literal('notice'),
  level: z.enum(['info', 'warning', 'error']),
  key: z.string().min(1),
  params: z.record(z.string(), z.unknown()).optional(),
});
export type NoticeMsg = z.infer<typeof NoticeMsgSchema>;

export const ByeMsgSchema = z.strictObject({
  t: z.literal('bye'),
  reason: z.string().min(1),
});
export type ByeMsg = z.infer<typeof ByeMsgSchema>;

export const ServerMessageSchema = z.discriminatedUnion('t', [
  WelcomeMsgSchema,
  EventsMsgSchema,
  AckMsgSchema,
  RejectMsgSchema,
  BlobPullMsgSchema,
  BlobUnavailableMsgSchema,
  MembersMsgSchema,
  NoticeMsgSchema,
  ByeMsgSchema,
]);
export type ServerMessage = z.infer<typeof ServerMessageSchema>;
