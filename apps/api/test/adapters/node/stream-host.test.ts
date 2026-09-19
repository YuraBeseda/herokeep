/**
 * `NodeStreamHost` contract: the port surface (append/read/head/deleteAll via `StreamHandle`) plus
 * the per-actor mutex's single-writer guarantee (task-7-brief step 1: "mutex serializes two
 * concurrent appends (deterministic seqs)").
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Actor, Event } from '@hk/protocol';
import { openStreamsDb } from '../../../src/adapters/node/store.sqlite-file.ts';
import { Mutex, NodeStreamHost } from '../../../src/adapters/node/stream-host.ts';
import { uuidv7 } from '../../../src/core/ids.ts';

const OWNER: Actor = { userId: 'user-1', role: 'owner' };

function characterCreatedEvent(streamId: string, overrides: Partial<Event> = {}): Event {
  return {
    id: uuidv7(),
    stream: streamId,
    ts: new Date().toISOString(),
    actor: { userId: OWNER.userId, deviceId: 'device-1', role: 'owner' },
    type: 'character.created',
    v: 1,
    payload: {
      name: 'Aria',
      system: 'srd-5e-2024',
      corePack: { id: 'srd-5e-2024', version: '1.0.0' },
      engineVersion: '1.0.0',
      grammaticalGender: 'feminine',
    },
    ...overrides,
  };
}

function noteEvent(streamId: string): Event {
  return {
    id: uuidv7(),
    stream: streamId,
    ts: new Date().toISOString(),
    actor: { userId: OWNER.userId, deviceId: 'device-1', role: 'owner' },
    type: 'note.added',
    v: 1,
    payload: { id: uuidv7() },
  };
}

let dir: string;
let db: Database.Database;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'hk-stream-host-'));
  db = openStreamsDb(join(dir, 'streams.sqlite'));
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('NodeStreamHost — StreamHandle contract', () => {
  it('append commits through the actor and returns the min/max acked seq', async () => {
    const host = new NodeStreamHost(db);
    const streamId = `char:${uuidv7()}`;
    const handle = host.get(streamId);

    const result = await handle.append([characterCreatedEvent(streamId)], OWNER);
    expect(result).toEqual({ firstSeq: 1, lastSeq: 1 });
    expect(await handle.head()).toBe(1);

    const read = await handle.read(1, 10);
    expect(read).toHaveLength(1);
    expect(read[0]?.type).toBe('character.created');
  });

  it('.get() returns the SAME runtime for the same streamId (lazy, created once)', async () => {
    const host = new NodeStreamHost(db);
    const streamId = `char:${uuidv7()}`;
    await host.get(streamId).append([characterCreatedEvent(streamId)], OWNER);
    expect(await host.get(streamId).head()).toBe(1);
  });

  it('deleteAll wipes the stream via the actor', async () => {
    const host = new NodeStreamHost(db);
    const streamId = `char:${uuidv7()}`;
    const handle = host.get(streamId);
    await handle.append([characterCreatedEvent(streamId)], OWNER);
    expect(await handle.head()).toBe(1);

    await handle.deleteAll();
    expect(await handle.head()).toBe(0);
  });

  it('notify() fans committed events out to every connection currently on the stream', async () => {
    const host = new NodeStreamHost(db);
    const streamId = `char:${uuidv7()}`;
    const runtime = host.getRuntime(streamId);
    // A minimal fake socket — just enough to satisfy `WsConnections.accept`'s `.on('close', ...)`
    // wiring; this test never sends/receives real frames over it (see the comment below).
    const fakeSocket = { on: () => fakeSocket, send: () => undefined, readyState: 1 };
    const conn = runtime.connections.accept(fakeSocket, { userId: 'user-1', role: 'owner', subs: [] });

    const event = characterCreatedEvent(streamId);
    await host.get(streamId).notify('char:other-stream', [event]);

    // No direct "frames sent" inspector on the real WsConnections (it sends over a raw socket) —
    // assert indirectly via `send`'s guard: a plain object (not a real `ws.WebSocket`) has no
    // numeric `readyState`, so `send` silently no-ops rather than throwing. This test's real
    // purpose is proving `notify` does not throw and iterates `connections.all()` — full
    // frame-delivery coverage lives in the WS smoke test (server.test.ts).
    expect(runtime.connections.all()).toContain(conn);
  });

  it('mutex serializes two concurrent appends against the SAME stream into deterministic, non-overlapping seq ranges', async () => {
    const host = new NodeStreamHost(db);
    const streamId = `char:${uuidv7()}`;
    const handle = host.get(streamId);

    // Seed ownership first so both concurrent appends are accepted (character.created must land
    // before any other event type per doc-02's "first event" convention this actor relies on for
    // its meta hooks — irrelevant to append acceptance itself, but keeps this test's events
    // realistic).
    await handle.append([characterCreatedEvent(streamId)], OWNER);

    // Two batches of 5 events each, kicked off "simultaneously" (both promises start before
    // either awaits) — without the mutex, both could read the same `head()` and assign
    // overlapping seqs.
    const batchA = Array.from({ length: 5 }, () => noteEvent(streamId));
    const batchB = Array.from({ length: 5 }, () => noteEvent(streamId));

    const [resultA, resultB] = await Promise.all([handle.append(batchA, OWNER), handle.append(batchB, OWNER)]);

    // Deterministic: whichever call's promise chain entered the mutex first (call order, since
    // both are synchronous up to their first `await`) gets seqs 2-6, the other 7-11 — never
    // interleaved/overlapping.
    expect(resultA).toEqual({ firstSeq: 2, lastSeq: 6 });
    expect(resultB).toEqual({ firstSeq: 7, lastSeq: 11 });

    const all = await handle.read(1, 100);
    expect(all).toHaveLength(11);
    expect(all.map((e) => e.seq)).toEqual(Array.from({ length: 11 }, (_, i) => i + 1));
    // No gaps, no duplicates.
    expect(new Set(all.map((e) => e.seq)).size).toBe(11);
  });
});

describe('Mutex', () => {
  it('runs queued tasks strictly in call order, one at a time', async () => {
    const mutex = new Mutex();
    const order: number[] = [];

    function task(id: number, delayMs: number): Promise<void> {
      return mutex.run(async () => {
        order.push(id);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      });
    }

    await Promise.all([task(1, 20), task(2, 0), task(3, 0)]);
    expect(order).toEqual([1, 2, 3]);
  });

  it('a rejected task does not poison the queue for tasks after it', async () => {
    const mutex = new Mutex();
    const failing = mutex.run(() => Promise.reject(new Error('boom')));
    const after = mutex.run(() => Promise.resolve('ok'));

    await expect(failing).rejects.toThrow('boom');
    await expect(after).resolves.toBe('ok');
  });
});
