/**
 * Task 5: `StreamActor`'s append pipeline and catch-up, against in-memory `StreamStore`/
 * `Connections` fakes (`test/helpers/{fake-stream-store,fake-connections}.ts`, implementing the
 * full port contract including the `findByIds` dedupe extension). Only the Owner column of
 * ADR-012's authorization table is reachable in Phase 2 (no DM without a campaign — Phase 3),
 * so `owner`/`member` cover the permission-relevant role space these tests exercise.
 */
import type { Event, HelloMsg } from '@hk/protocol';
import { beforeEach, describe, expect, it } from 'vitest';
import { uuidv7 } from '../../src/core/ids.ts';
import * as permissions from '../../src/core/permissions.ts';
import type { Role } from '../../src/core/permissions.ts';
import * as quotas from '../../src/core/quotas.ts';
import { STREAM_BYTES_MAX } from '../../src/core/quotas.ts';
import { StreamActor } from '../../src/core/streams/stream-actor.ts';
import { measureEventBytes } from '../../src/core/validate.ts';
import { FakeConnections } from '../helpers/fake-connections.ts';
import { FakeStreamStore } from '../helpers/fake-stream-store.ts';

const STREAM_ID = `char:${uuidv7()}`;

function makeActor(role: Role = 'owner', userId = 'user-1'): { userId: string; role: Role } {
  return { userId, role };
}

/** A syntactically-valid `note.added` event (owner-only per ADR-012/`EVENT_ACTORS`). Every
 * field the schema/size cap cares about is fixed-length (uuidv7, ISO timestamp) except the
 * caller-supplied overrides, so two default-shaped events always serialize to the same byte
 * length — tests that need a precise quota-threshold crossing rely on this. */
function makeEvent(overrides: Partial<Event> = {}): Event {
  return {
    id: uuidv7(),
    stream: STREAM_ID,
    ts: new Date().toISOString(),
    actor: { userId: 'user-1', deviceId: 'device-1', role: 'owner' },
    type: 'note.added',
    v: 1,
    payload: { id: uuidv7() },
    ...overrides,
  };
}

/** A schema-valid but oversized event: `history.compacted`'s `facts` field is `z.unknown()`
 * with no per-field size cap, so it's the cleanest way to build an event that parses but blows
 * the 16 KB cap. */
function makeOversizedEvent(overrides: Partial<Event> = {}): Event {
  return makeEvent({
    type: 'history.compacted',
    payload: { throughSeq: 1, facts: { blob: 'x'.repeat(20_000) } },
    ...overrides,
  });
}

function makeSystem() {
  const store = new FakeStreamStore();
  const connections = new FakeConnections();
  const actor = new StreamActor({ store, connections, quotas, permissions, streamId: STREAM_ID });
  return { store, connections, actor };
}

let system: ReturnType<typeof makeSystem>;

beforeEach(() => {
  system = makeSystem();
});

describe('append', () => {
  it('assigns strictly increasing seq starting at 1', async () => {
    const outcome = await system.actor.append([makeEvent(), makeEvent(), makeEvent()], makeActor());
    expect(outcome.rejected).toEqual([]);
    expect(outcome.acked.map((a) => a.seq)).toEqual([1, 2, 3]);
  });

  it('acks a whole-append retry with the existing seqs and stores nothing twice', async () => {
    const events = [makeEvent(), makeEvent()];
    const first = await system.actor.append(events, makeActor());
    const retry = await system.actor.append(events, makeActor());

    const firstByAId = new Map(first.acked.map((a) => [a.id, a.seq]));
    for (const a of retry.acked) expect(a.seq).toBe(firstByAId.get(a.id));
    expect(retry.acked).toHaveLength(2);
    expect(retry.rejected).toEqual([]);
    expect(system.store.length).toBe(2);
  });

  it('dedupes the existing event and commits the new one in a mixed append', async () => {
    const existingEvent = makeEvent();
    await system.actor.append([existingEvent], makeActor());

    const newEvent = makeEvent();
    const mixed = await system.actor.append([existingEvent, newEvent], makeActor());

    expect(mixed.rejected).toEqual([]);
    const existingAck = mixed.acked.find((a) => a.id === existingEvent.id);
    const newAck = mixed.acked.find((a) => a.id === newEvent.id);
    expect(existingAck?.seq).toBe(1);
    expect(newAck?.seq).toBe(2);
    expect(system.store.length).toBe(2);
  });

  it('rejects every occurrence of a same-id repeat within one append frame as duplicate', async () => {
    const dup = makeEvent();
    const outcome = await system.actor.append([dup, { ...dup }], makeActor());

    expect(outcome.acked).toEqual([]);
    expect(outcome.rejected).toHaveLength(2);
    for (const r of outcome.rejected) {
      expect(r.id).toBe(dup.id);
      expect(r.code).toBe('duplicate');
    }
    expect(system.store.length).toBe(0);
  });

  it('rejects an oversized event as invalid and stores nothing', async () => {
    const big = makeOversizedEvent();
    const outcome = await system.actor.append([big], makeActor());

    expect(outcome.acked).toEqual([]);
    expect(outcome.rejected).toHaveLength(1);
    expect(outcome.rejected[0]).toMatchObject({ id: big.id, code: 'invalid' });
    expect(typeof outcome.rejected[0]?.message).toBe('string');
    expect(system.store.length).toBe(0);
  });

  it('rejects a campaign-only event type (roll.logged) appended to this char: stream as invalid (plan-9 Task 2 stream-binding guard)', async () => {
    const event = makeEvent({
      type: 'roll.logged',
      payload: {
        label: 'Attack roll',
        formula: '1d20+5',
        results: [{ die: 'd20', value: 15 }],
        total: 20,
        kind: 'attack',
        visibility: 'everyone',
      },
    });
    const outcome = await system.actor.append([event], makeActor('dm'));

    expect(outcome.acked).toEqual([]);
    expect(outcome.rejected).toHaveLength(1);
    expect(outcome.rejected[0]).toMatchObject({ id: event.id, code: 'invalid' });
    expect(system.store.length).toBe(0);
  });

  it('rejects an event a member actor is not permitted to append as forbidden', async () => {
    const event = makeEvent(); // note.added: owner-only
    const outcome = await system.actor.append([event], makeActor('member'));

    expect(outcome.acked).toEqual([]);
    expect(outcome.rejected).toHaveLength(1);
    expect(outcome.rejected[0]).toMatchObject({ id: event.id, code: 'forbidden' });
    expect(typeof outcome.rejected[0]?.message).toBe('string');
    expect(system.store.length).toBe(0);
  });

  it('rejects an entire txId group when one member is invalid, storing nothing', async () => {
    const txId = uuidv7();
    const good = makeEvent({ txId });
    const bad = makeOversizedEvent({ txId });

    const outcome = await system.actor.append([good, bad], makeActor());

    expect(outcome.acked).toEqual([]);
    expect(outcome.rejected.map((r) => r.id).sort()).toEqual([good.id, bad.id].sort());
    expect(system.store.length).toBe(0);
  });

  it('acks a txId group that is fully already committed as a whole-group retry, storing nothing new', async () => {
    const txId = uuidv7();
    const events = [makeEvent({ txId }), makeEvent({ txId })];
    const first = await system.actor.append(events, makeActor());
    expect(first.rejected).toEqual([]);
    expect(system.store.length).toBe(2);

    const retry = await system.actor.append(events, makeActor());

    expect(retry.rejected).toEqual([]);
    expect(retry.acked).toHaveLength(2);
    const firstSeqById = new Map(first.acked.map((a) => [a.id, a.seq]));
    for (const a of retry.acked) expect(a.seq).toBe(firstSeqById.get(a.id));
    expect(system.store.length).toBe(2); // nothing stored twice
  });

  it('rejects an entire txId group as invalid when only some members are already committed', async () => {
    const txId = uuidv7();
    const alreadyCommitted = makeEvent({ txId });
    await system.actor.append([alreadyCommitted], makeActor());
    expect(system.store.length).toBe(1);

    const stillNew = makeEvent({ txId });
    const outcome = await system.actor.append([alreadyCommitted, stillNew], makeActor());

    expect(outcome.acked).toEqual([]);
    expect(outcome.rejected).toHaveLength(2);
    expect(outcome.rejected.map((r) => r.id).sort()).toEqual([alreadyCommitted.id, stillNew.id].sort());
    for (const r of outcome.rejected) expect(r.code).toBe('invalid');
    expect(system.store.length).toBe(1); // still just the one event the first append committed
  });

  it('rejects with quota when the append would exceed the per-stream byte cap', async () => {
    await system.store.setMeta('bytes_used', String(STREAM_BYTES_MAX)); // already at the cap
    const event = makeEvent();

    const outcome = await system.actor.append([event], makeActor());

    expect(outcome.acked).toEqual([]);
    expect(outcome.rejected).toHaveLength(1);
    expect(outcome.rejected[0]).toMatchObject({ id: event.id, code: 'quota' });
    expect(typeof outcome.rejected[0]?.message).toBe('string');
    expect(system.store.length).toBe(0);
  });

  it('emits notice quota.warning exactly once when crossing 80%, not again while still above it', async () => {
    const conn = system.connections.accept({}, { userId: 'user-1', role: 'owner', subs: [] });
    const sampleBytes = measureEventBytes(makeEvent());
    const threshold = Math.floor(STREAM_BYTES_MAX * quotas.QUOTA_WARNING_RATIO);
    await system.store.setMeta('bytes_used', String(threshold - sampleBytes + 1)); // one append away from 80%

    await system.actor.append([makeEvent()], makeActor(), conn);
    const noticesAfterFirst = system.connections.framesFor(conn).filter((f) => f.t === 'notice');
    expect(noticesAfterFirst).toHaveLength(1);
    expect(noticesAfterFirst[0]).toMatchObject({ level: 'warning', key: 'quota.warning' });

    await system.actor.append([makeEvent()], makeActor(), conn);
    const noticesAfterSecond = system.connections.framesFor(conn).filter((f) => f.t === 'notice');
    expect(noticesAfterSecond).toHaveLength(1); // still just the one — not re-fired on every append
  });

  it('fans out newly committed events to other connections, never back to the sender', async () => {
    const sender = system.connections.accept({}, { userId: 'user-1', role: 'owner', subs: [] });
    const other = system.connections.accept({}, { userId: 'user-1', role: 'owner', subs: [] });
    const event = makeEvent();

    await system.actor.append([event], makeActor(), sender);

    expect(system.connections.framesFor(sender).filter((f) => f.t === 'events')).toEqual([]);
    const otherFrames = system.connections.framesFor(other).filter((f) => f.t === 'events');
    expect(otherFrames).toHaveLength(1);
    expect(otherFrames[0]?.events.map((e) => e.id)).toEqual([event.id]);
    expect(otherFrames[0]?.events.map((e) => e.seq)).toEqual([1]);
  });
});

describe('hello', () => {
  it('sends welcome first with the correct headSeq and quota', async () => {
    await system.actor.append([makeEvent(), makeEvent()], makeActor());
    const conn = system.connections.accept({}, { userId: 'user-1', role: 'owner', subs: [] });
    const hello: HelloMsg = {
      t: 'hello',
      rid: 'r1',
      proto: 1,
      app: '1.0.0',
      streams: [{ id: STREAM_ID, lastSeq: 0 }],
      have: [],
      pending: [],
    };

    await system.actor.hello(conn, hello);

    const [first] = system.connections.framesFor(conn);
    expect(first).toMatchObject({
      t: 'welcome',
      rid: 'r1',
      streams: [{ id: STREAM_ID, headSeq: 2, quota: { bytesMax: STREAM_BYTES_MAX } }],
    });
  });

  it('pages a 450-event catch-up as 200/200/50, gap-free and strictly increasing', async () => {
    const events = Array.from({ length: 450 }, () => makeEvent());
    await system.store.append(events); // seed history directly; append()'s own frame cap is 50/msg
    const conn = system.connections.accept({}, { userId: 'user-1', role: 'owner', subs: [] });
    const hello: HelloMsg = {
      t: 'hello',
      rid: 'r1',
      proto: 1,
      app: '1.0.0',
      streams: [{ id: STREAM_ID, lastSeq: 0 }],
      have: [],
      pending: [],
    };

    await system.actor.hello(conn, hello);

    const eventsFrames = system.connections.framesFor(conn).filter((f) => f.t === 'events');
    expect(eventsFrames.map((f) => f.events.length)).toEqual([200, 200, 50]);
    const allSeqs = eventsFrames.flatMap((f) => f.events.map((e) => e.seq));
    expect(allSeqs).toEqual(Array.from({ length: 450 }, (_, i) => i + 1));
  });

  it("flushes pending events through the append path and acks them against hello's rid", async () => {
    const conn = system.connections.accept({}, { userId: 'user-1', role: 'owner', subs: [] });
    const pendingEvent = makeEvent();
    const hello: HelloMsg = {
      t: 'hello',
      rid: 'r1',
      proto: 1,
      app: '1.0.0',
      streams: [{ id: STREAM_ID, lastSeq: 0 }],
      have: [],
      pending: [pendingEvent],
    };

    await system.actor.hello(conn, hello);

    const ack = system.connections.framesFor(conn).find((f) => f.t === 'ack');
    expect(ack?.rid).toBe('r1');
    expect(ack?.results).toEqual([{ id: pendingEvent.id, seq: 1 }]);
  });
});

describe('handleMessage', () => {
  it('parses and dispatches a hello frame', async () => {
    const conn = system.connections.accept({}, { userId: 'user-1', role: 'owner', subs: [] });
    await system.actor.handleMessage(conn, {
      t: 'hello',
      rid: 'r1',
      proto: 1,
      app: '1.0.0',
      streams: [],
      have: [],
      pending: [],
    });

    expect(system.connections.framesFor(conn).some((f) => f.t === 'welcome')).toBe(true);
  });

  it('closes the connection on an unparseable frame', async () => {
    const conn = system.connections.accept({}, { userId: 'user-1', role: 'owner', subs: [] });
    await system.actor.handleMessage(conn, { t: 'not-a-real-type' });

    expect(system.connections.wasClosed(conn)).toBe(true);
  });

  it('ignores a Phase-3 message type without closing the connection or replying', async () => {
    const conn = system.connections.accept({}, { userId: 'user-1', role: 'owner', subs: [] });
    await system.actor.handleMessage(conn, { t: 'presence', state: 'active' });

    expect(system.connections.wasClosed(conn)).toBe(false);
    expect(system.connections.framesFor(conn)).toEqual([]);
  });
});

/** Whole-branch review finding 3: hard delete must close every live connection on the stream
 * (code 1001, reason 'stream_closed') and permanently refuse any FURTHER append on this same
 * actor instance — otherwise a connected socket can append after its data is gone, silently
 * resurrecting a "deleted" stream outside every quota. */
describe('deleteAll (finding 3 fix)', () => {
  it('closes every connection currently on the stream with code 1001, reason stream_closed', async () => {
    const connA = system.connections.accept({}, { userId: 'user-1', role: 'owner', subs: [] });
    const connB = system.connections.accept({}, { userId: 'user-2', role: 'owner', subs: [] });

    await system.actor.deleteAll();

    expect(system.connections.wasClosed(connA)).toBe(true);
    expect(system.connections.wasClosed(connB)).toBe(true);
    expect(system.connections.closeArgsFor(connA)).toEqual({ code: 1001, reason: 'stream_closed' });
    expect(system.connections.closeArgsFor(connB)).toEqual({ code: 1001, reason: 'stream_closed' });
  });

  it('wipes the backing store', async () => {
    await system.actor.append([makeEvent()], makeActor());
    expect(system.store.length).toBe(1);

    await system.actor.deleteAll();

    expect(system.store.length).toBe(0);
  });

  it('RED-first: an append that arrives on this SAME actor instance after deleteAll is refused stream_closed, never re-committed', async () => {
    await system.actor.append([makeEvent()], makeActor());
    await system.actor.deleteAll();
    expect(system.store.length).toBe(0);

    // Models the queued-append race the finding calls out: a connection already past the
    // WS-upgrade/ownership check appends on the SAME live actor instance right after delete.
    const queuedEvent = makeEvent();
    const outcome = await system.actor.append([queuedEvent], makeActor());

    expect(outcome.acked).toEqual([]);
    expect(outcome.rejected).toHaveLength(1);
    expect(outcome.rejected[0]).toMatchObject({ id: queuedEvent.id, code: 'stream_closed' });
    // The critical resurrection check: nothing was written to the store as seq 1 again.
    expect(system.store.length).toBe(0);
  });

  it('a hello with pending events on the SAME actor instance after deleteAll rejects the pending events, not commit them', async () => {
    await system.actor.deleteAll();

    const conn = system.connections.accept({}, { userId: 'user-1', role: 'owner', subs: [] });
    const pendingEvent = makeEvent();
    const hello: HelloMsg = {
      t: 'hello',
      rid: 'r1',
      proto: 1,
      app: '1.0.0',
      streams: [],
      have: [],
      pending: [pendingEvent],
    };
    await system.actor.hello(conn, hello);

    const frames = system.connections.framesFor(conn);
    const reject = frames.find((f) => f.t === 'reject');
    expect(reject).toMatchObject({ t: 'reject', results: [{ id: pendingEvent.id, code: 'stream_closed' }] });
    expect(system.store.length).toBe(0);
  });
});
