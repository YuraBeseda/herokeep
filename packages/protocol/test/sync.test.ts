import { describe, expect, it } from 'vitest';
import {
  ActorSchema,
  AckMsgSchema,
  AppendMsgSchema,
  BlobCancelMsgSchema,
  BlobHaveMsgSchema,
  BlobPullMsgSchema,
  BlobRequestMsgSchema,
  BlobUnavailableMsgSchema,
  ByeMsgSchema,
  ClientMessageSchema,
  EventsMsgSchema,
  HelloMsgSchema,
  MembersMsgSchema,
  NoticeMsgSchema,
  PresenceMsgSchema,
  PROTO_VERSION,
  RejectCodeSchema,
  RejectMsgSchema,
  ServerMessageSchema,
  SubscribeMsgSchema,
  UnsubscribeMsgSchema,
  WelcomeMsgSchema,
  parseClientMessage,
} from '../src/sync/index.ts';

const event = (overrides: Record<string, unknown> = {}) => ({
  id: '018f6d2e-7b1a-7c3d-9e4f-5a6b7c8d9e0f',
  stream: 'char:2b7a1f22-1111-4c9d-a8f2-0a1b2c3d4e5f',
  ts: '2026-08-30T12:00:00.000Z',
  actor: { userId: 'usr_1', deviceId: 'dev_1', role: 'owner' },
  type: 'character.renamed',
  v: 1,
  payload: { name: 'Ivan' },
  ...overrides,
});

describe('PROTO_VERSION', () => {
  it('is 1', () => {
    expect(PROTO_VERSION).toBe(1);
  });
});

describe('ActorSchema', () => {
  it('accepts owner/dm/member roles', () => {
    for (const role of ['owner', 'dm', 'member']) {
      expect(ActorSchema.safeParse({ userId: 'usr_1', role }).success).toBe(true);
    }
  });
  it('rejects unknown roles and extra keys', () => {
    expect(ActorSchema.safeParse({ userId: 'usr_1', role: 'system' }).success).toBe(false);
    expect(ActorSchema.safeParse({ userId: 'usr_1', role: 'owner', extra: 1 }).success).toBe(false);
  });
});

describe('RejectCodeSchema', () => {
  it('accepts the five codes and rejects anything else', () => {
    for (const code of ['forbidden', 'quota', 'invalid', 'duplicate', 'stream_closed']) {
      expect(RejectCodeSchema.safeParse(code).success).toBe(true);
    }
    expect(RejectCodeSchema.safeParse('nope').success).toBe(false);
  });
});

describe('client -> server messages', () => {
  it('hello: accepts a full frame with pending events and rejects extra keys / unknown t', () => {
    const hello = {
      t: 'hello',
      rid: 'r1',
      proto: 1,
      app: '1.4.0',
      streams: [{ id: 'char:2b7a1f22-1111-4c9d-a8f2-0a1b2c3d4e5f', lastSeq: 0 }],
      have: ['sha256:' + '0'.repeat(64)],
      pending: [event()],
    };
    const r = HelloMsgSchema.safeParse(hello);
    expect(r.success, JSON.stringify(r.success ? r.data : r.error.issues)).toBe(true);
    expect(HelloMsgSchema.safeParse({ ...hello, extra: 1 }).success).toBe(false);
    expect(HelloMsgSchema.safeParse({ ...hello, t: 'nope' }).success).toBe(false);
  });

  it('append: 1-50 events accepted, 0 or 51 rejected', () => {
    const base = { t: 'append', rid: 'r1' };
    expect(AppendMsgSchema.safeParse({ ...base, events: [event()] }).success).toBe(true);
    expect(AppendMsgSchema.safeParse({ ...base, events: [] }).success).toBe(false);
    const fifty = Array.from({ length: 50 }, () => event());
    expect(AppendMsgSchema.safeParse({ ...base, events: fifty }).success).toBe(true);
    const fiftyOne = Array.from({ length: 51 }, () => event());
    expect(AppendMsgSchema.safeParse({ ...base, events: fiftyOne }).success).toBe(false);
  });

  it('subscribe / unsubscribe: stream + optional lastSeq', () => {
    const stream = 'char:2b7a1f22-1111-4c9d-a8f2-0a1b2c3d4e5f';
    expect(SubscribeMsgSchema.safeParse({ t: 'subscribe', stream }).success).toBe(true);
    expect(SubscribeMsgSchema.safeParse({ t: 'subscribe', stream, lastSeq: 5 }).success).toBe(true);
    expect(SubscribeMsgSchema.safeParse({ t: 'subscribe', stream, extra: 1 }).success).toBe(false);
    expect(UnsubscribeMsgSchema.safeParse({ t: 'unsubscribe', stream }).success).toBe(true);
    expect(UnsubscribeMsgSchema.safeParse({ t: 'unsubscribe' }).success).toBe(false);
  });

  it('blob.have / blob.request / blob.cancel', () => {
    const hash = 'sha256:' + '1'.repeat(64);
    expect(BlobHaveMsgSchema.safeParse({ t: 'blob.have', hashes: [hash] }).success).toBe(true);
    expect(BlobRequestMsgSchema.safeParse({ t: 'blob.request', rid: 'r1', hash }).success).toBe(true);
    expect(BlobRequestMsgSchema.safeParse({ t: 'blob.request', hash }).success).toBe(false);
    expect(BlobCancelMsgSchema.safeParse({ t: 'blob.cancel', hash }).success).toBe(true);
  });

  it('presence: active/idle only', () => {
    expect(PresenceMsgSchema.safeParse({ t: 'presence', state: 'active' }).success).toBe(true);
    expect(PresenceMsgSchema.safeParse({ t: 'presence', state: 'idle' }).success).toBe(true);
    expect(PresenceMsgSchema.safeParse({ t: 'presence', state: 'away' }).success).toBe(false);
  });

  it('ClientMessageSchema rejects an unknown t across the whole union', () => {
    expect(ClientMessageSchema.safeParse({ t: 'bogus' }).success).toBe(false);
    expect(ClientMessageSchema.safeParse({ t: 'presence', state: 'active' }).success).toBe(true);
  });
});

describe('server -> client messages', () => {
  const stream = 'char:2b7a1f22-1111-4c9d-a8f2-0a1b2c3d4e5f';

  it('welcome: full frame with quota, members, packs', () => {
    const welcome = {
      t: 'welcome',
      rid: 'r1',
      serverTime: '2026-09-19T12:00:00.000Z',
      streams: [{ id: stream, headSeq: 42, quota: { bytesUsed: 100, bytesMax: 1000, eventCount: 5 } }],
      members: [{ userId: 'usr_1', displayName: 'Ivan', role: 'owner', online: true }],
      packs: [{ id: 'core-mini', version: '1.0.0' }],
    };
    const r = WelcomeMsgSchema.safeParse(welcome);
    expect(r.success, JSON.stringify(r.success ? r.data : r.error.issues)).toBe(true);
    // members/packs are optional
    const rest = { t: welcome.t, rid: welcome.rid, serverTime: welcome.serverTime, streams: welcome.streams };
    expect(WelcomeMsgSchema.safeParse(rest).success).toBe(true);
    expect(WelcomeMsgSchema.safeParse({ ...welcome, extra: 1 }).success).toBe(false);
  });

  it('events: stream + events[]', () => {
    expect(EventsMsgSchema.safeParse({ t: 'events', stream, events: [event({ seq: 1 })] }).success).toBe(true);
  });

  it('ack: rid + results[{id, seq}]', () => {
    const r = AckMsgSchema.safeParse({
      t: 'ack',
      rid: 'r1',
      results: [{ id: event().id, seq: 1 }],
    });
    expect(r.success).toBe(true);
  });

  it('reject: valid codes accepted, bad code rejected', () => {
    const okResult = { id: event().id, code: 'forbidden', message: 'nope' };
    expect(RejectMsgSchema.safeParse({ t: 'reject', rid: 'r1', results: [okResult] }).success).toBe(true);
    const badResult = { id: event().id, code: 'bogus', message: 'nope' };
    expect(RejectMsgSchema.safeParse({ t: 'reject', rid: 'r1', results: [badResult] }).success).toBe(false);
  });

  it('blob.pull / blob.unavailable', () => {
    const hash = 'sha256:' + '2'.repeat(64);
    expect(BlobPullMsgSchema.safeParse({ t: 'blob.pull', hash, to: 'conn_1' }).success).toBe(true);
    expect(BlobUnavailableMsgSchema.safeParse({ t: 'blob.unavailable', hash }).success).toBe(true);
  });

  it('members: presence snapshot array', () => {
    const r = MembersMsgSchema.safeParse({
      t: 'members',
      members: [{ userId: 'usr_1', displayName: 'Ivan', role: 'owner', online: true }],
    });
    expect(r.success).toBe(true);
  });

  it('notice: level, key, params', () => {
    expect(
      NoticeMsgSchema.safeParse({ t: 'notice', level: 'warning', key: 'quota.warning', params: { pct: 80 } }).success,
    ).toBe(true);
    expect(NoticeMsgSchema.safeParse({ t: 'notice', level: 'warning', key: 'quota.warning' }).success).toBe(true);
  });

  it('bye: reason', () => {
    expect(ByeMsgSchema.safeParse({ t: 'bye', reason: 'session_expired' }).success).toBe(true);
    expect(ByeMsgSchema.safeParse({ t: 'bye' }).success).toBe(false);
  });

  it('ServerMessageSchema rejects an unknown t across the whole union', () => {
    expect(ServerMessageSchema.safeParse({ t: 'bogus' }).success).toBe(false);
    expect(ServerMessageSchema.safeParse({ t: 'bye', reason: 'x' }).success).toBe(true);
  });
});

describe('parseClientMessage', () => {
  it('round-trips a full hello with pending events', () => {
    const hello = {
      t: 'hello',
      rid: 'r1',
      proto: PROTO_VERSION,
      app: '1.4.0',
      streams: [{ id: 'char:2b7a1f22-1111-4c9d-a8f2-0a1b2c3d4e5f', lastSeq: 0 }],
      have: [],
      pending: [event(), event({ id: '028f6d2e-7b1a-7c3d-9e4f-5a6b7c8d9e0f' })],
    };
    const result = parseClientMessage(hello);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.message).toEqual(hello);
    }
  });

  it('returns {ok:false, issues} mirroring parseEvent shape for invalid input', () => {
    const result = parseClientMessage({ t: 'hello', rid: 'r1' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(Array.isArray(result.issues)).toBe(true);
      expect(result.issues.length).toBeGreaterThan(0);
      expect(result.issues[0]).toHaveProperty('path');
      expect(result.issues[0]).toHaveProperty('message');
    }
  });

  it('rejects a message with an unknown t', () => {
    const result = parseClientMessage({ t: 'bogus' });
    expect(result.ok).toBe(false);
  });
});
