import { TestBed } from '@angular/core/testing';
import type { Event } from '@hk/protocol';
import { HkDb } from '@shared/services/storage/dexie.db';
import { EventsRepository } from '@shared/services/storage/events.repository';

function uuid(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

const streamA = `char:${uuid(1)}`;
const streamB = `char:${uuid(2)}`;

function mkEvent(id: string, stream: string, type: string, extra: Partial<Event> = {}): Event {
  return {
    id,
    stream,
    ts: '2026-09-12T00:00:00.000Z',
    actor: { userId: 'u', deviceId: 'd', role: 'owner' },
    type,
    v: 1,
    payload: {},
    ...extra,
  };
}

describe('EventsRepository', () => {
  // fake-indexeddb's `indexedDB` is captured once, at `dexie`'s own module-top-level scope (see
  // `apps/web/src/test-setup.ts`), and this test builder shares that one module instance across
  // every `it()` in a spec file — so every test in this file talks to the same physical `hk-db`.
  // Clearing the tables we touch (rather than swapping the global) is what actually isolates
  // each test.
  beforeEach(async () => {
    const db = TestBed.inject(HkDb);
    await Promise.all([
      db.packs.clear(),
      db.settings.clear(),
      db.events.clear(),
      db.snapshots.clear(),
      db.characters.clear(),
      db.blobs.clear(),
    ]);
  });

  // Defensive: TestBed doesn't close `HkDb`'s IndexedDB connection when it tears down the
  // injector between tests, so without this a connection could still be open when another spec
  // file's `beforeEach`/`Dexie.delete` next runs against the same `hk-db` name (see
  // `dexie.db.spec.ts` for the inter-file reasoning).
  afterEach(() => {
    TestBed.inject(HkDb).close();
  });

  it('append assigns contiguous per-stream seqs across two interleaved streams in one call', async () => {
    const repo = TestBed.inject(EventsRepository);
    await repo.append([
      mkEvent(uuid(10), streamA, 'note.added'),
      mkEvent(uuid(11), streamB, 'note.added'),
      mkEvent(uuid(12), streamA, 'note.updated'),
      mkEvent(uuid(13), streamB, 'note.updated'),
    ]);

    const a = await repo.byStream(streamA);
    const b = await repo.byStream(streamB);
    expect(a.map((e) => e.seq)).toEqual([1, 2]);
    expect(b.map((e) => e.seq)).toEqual([1, 2]);
  });

  it('append rejects — and applies nothing — when an id already exists', async () => {
    const repo = TestBed.inject(EventsRepository);
    const id = uuid(20);
    await repo.append([mkEvent(id, streamA, 'note.added')]);

    await expect(repo.append([mkEvent(id, streamA, 'note.added')])).rejects.toThrow();

    const events = await repo.byStream(streamA);
    expect(events).toHaveLength(1);
  });

  it('byStream orders committed rows by seq asc, then any seq-less row last', async () => {
    const repo = TestBed.inject(EventsRepository);
    const db = TestBed.inject(HkDb);
    const idA = uuid(30);
    const idB = uuid(31);
    const strayId = uuid(32);
    await repo.append([mkEvent(idA, streamA, 'note.added'), mkEvent(idB, streamA, 'note.updated')]);
    await db.events.put({
      id: strayId,
      stream: streamA,
      pendingOrder: 0,
      json: mkEvent(strayId, streamA, 'note.removed'),
    });

    const events = await repo.byStream(streamA);
    expect(events.map((e) => e.id)).toEqual([idA, idB, strayId]);
    expect(events.at(-1)?.seq).toBeUndefined();
  });

  it('nextSeq is 1 for a stream with no committed events, and max+1 otherwise', async () => {
    const repo = TestBed.inject(EventsRepository);
    expect(await repo.nextSeq(streamA)).toBe(1);

    await repo.append([mkEvent(uuid(40), streamA, 'note.added')]);
    expect(await repo.nextSeq(streamA)).toBe(2);
  });

  it('removeStream deletes every row of one stream, leaving other streams untouched', async () => {
    const repo = TestBed.inject(EventsRepository);
    await repo.append([
      mkEvent(uuid(60), streamA, 'note.added'),
      mkEvent(uuid(61), streamA, 'note.updated'),
      mkEvent(uuid(62), streamB, 'note.added'),
    ]);

    await repo.removeStream(streamA);

    expect(await repo.byStream(streamA)).toEqual([]);
    const remaining = await repo.byStream(streamB);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.id).toBe(uuid(62));
  });

  it('assignSeqs assigns startSeq.. to pending rows from fromId onward, in pendingOrder', async () => {
    const repo = TestBed.inject(EventsRepository);
    const db = TestBed.inject(HkDb);
    const idA = uuid(50);
    const idB = uuid(51);
    const idC = uuid(52);
    await db.events.bulkAdd([
      { id: idA, stream: streamA, pendingOrder: 0, json: mkEvent(idA, streamA, 'note.added') },
      { id: idB, stream: streamA, pendingOrder: 1, json: mkEvent(idB, streamA, 'note.updated') },
      { id: idC, stream: streamA, pendingOrder: 2, json: mkEvent(idC, streamA, 'note.removed') },
    ]);

    await repo.assignSeqs(streamA, idB, 5);

    expect((await db.events.get(idA))?.seq).toBeUndefined();
    const rowB = await db.events.get(idB);
    expect(rowB?.seq).toBe(5);
    expect(rowB?.json.seq).toBe(5);
    const rowC = await db.events.get(idC);
    expect(rowC?.seq).toBe(6);
    expect(rowC?.json.seq).toBe(6);
  });

  // --- pending-write helpers (Phase 2 Task 6 — CharacterStore sync seam) ---------------------

  describe('appendPending', () => {
    it('writes seq-less rows at contiguous pendingOrder from startOrder, ordered after committed by byStream', async () => {
      const repo = TestBed.inject(EventsRepository);
      const committedId = uuid(80);
      const pendingIdA = uuid(81);
      const pendingIdB = uuid(82);
      await repo.append([mkEvent(committedId, streamA, 'note.added')]);

      await repo.appendPending(
        [
          mkEvent(pendingIdA, streamA, 'note.updated'),
          mkEvent(pendingIdB, streamA, 'note.updated'),
        ],
        0,
      );

      const events = await repo.byStream(streamA);
      expect(events.map((e) => e.id)).toEqual([committedId, pendingIdA, pendingIdB]);
      expect(events[1]?.seq).toBeUndefined();
      expect(events[2]?.seq).toBeUndefined();

      const db = TestBed.inject(HkDb);
      expect((await db.events.get(pendingIdA))?.pendingOrder).toBe(0);
      expect((await db.events.get(pendingIdB))?.pendingOrder).toBe(1);
    });

    it('rejects — and applies nothing — when an id already exists, like append', async () => {
      const repo = TestBed.inject(EventsRepository);
      const id = uuid(83);
      await repo.appendPending([mkEvent(id, streamA, 'note.added')], 0);

      await expect(repo.appendPending([mkEvent(id, streamA, 'note.added')], 5)).rejects.toThrow();

      const events = await repo.byStream(streamA);
      expect(events).toHaveLength(1);
    });
  });

  describe('nextPendingOrder', () => {
    it('is 0 for a stream with no pending rows, and max+1 otherwise', async () => {
      const repo = TestBed.inject(EventsRepository);
      expect(await repo.nextPendingOrder(streamA)).toBe(0);

      await repo.appendPending([mkEvent(uuid(84), streamA, 'note.added')], 0);
      expect(await repo.nextPendingOrder(streamA)).toBe(1);

      await repo.appendPending([mkEvent(uuid(85), streamA, 'note.updated')], 1);
      expect(await repo.nextPendingOrder(streamA)).toBe(2);
    });

    it('ignores committed rows entirely', async () => {
      const repo = TestBed.inject(EventsRepository);
      await repo.append([mkEvent(uuid(86), streamA, 'note.added')]);
      expect(await repo.nextPendingOrder(streamA)).toBe(0);
    });
  });

  describe('removePending', () => {
    it('deletes only the named ids that are still pending, leaving committed rows and other ids untouched', async () => {
      const repo = TestBed.inject(EventsRepository);
      const committedId = uuid(87);
      const keepId = uuid(88);
      const dropId = uuid(89);
      await repo.append([mkEvent(committedId, streamA, 'note.added')]);
      await repo.appendPending(
        [mkEvent(keepId, streamA, 'note.updated'), mkEvent(dropId, streamA, 'note.updated')],
        0,
      );

      await repo.removePending(streamA, [dropId, committedId]); // committedId must be ignored — it has a seq

      const events = await repo.byStream(streamA);
      expect(events.map((e) => e.id)).toEqual([committedId, keepId]);
    });

    it('leaves other streams untouched', async () => {
      const repo = TestBed.inject(EventsRepository);
      const id = uuid(90);
      await repo.appendPending([mkEvent(id, streamB, 'note.added')], 0);

      await repo.removePending(streamA, [id]);

      expect(await repo.byStream(streamB)).toHaveLength(1);
    });
  });

  describe('appendCommittedAt', () => {
    it('writes rows at their OWN given seq, never renumbering via nextSeq', async () => {
      const repo = TestBed.inject(EventsRepository);
      const idA = uuid(91);
      const idB = uuid(92);

      await repo.appendCommittedAt([
        mkEvent(idA, streamA, 'note.added', { seq: 7 }),
        mkEvent(idB, streamA, 'note.updated', { seq: 8 }),
      ]);

      const events = await repo.byStream(streamA);
      expect(events.map((e) => ({ id: e.id, seq: e.seq }))).toEqual([
        { id: idA, seq: 7 },
        { id: idB, seq: 8 },
      ]);
    });

    it('rejects — and applies nothing — when an id already exists', async () => {
      const repo = TestBed.inject(EventsRepository);
      const id = uuid(93);
      await repo.append([mkEvent(id, streamA, 'note.added')]);

      await expect(
        repo.appendCommittedAt([mkEvent(id, streamA, 'note.added', { seq: 99 })]),
      ).rejects.toThrow();
    });

    it('throws when an event lacks a seq', async () => {
      const repo = TestBed.inject(EventsRepository);
      await expect(
        repo.appendCommittedAt([mkEvent(uuid(94), streamA, 'note.added')]),
      ).rejects.toThrow(/seq/);
    });
  });

  describe('assignSeqs with a count (partial-prefix ack)', () => {
    it('assigns only the first `count` pending rows from fromId, leaving the rest pending', async () => {
      const repo = TestBed.inject(EventsRepository);
      const db = TestBed.inject(HkDb);
      const idA = uuid(95);
      const idB = uuid(96);
      const idC = uuid(97);
      await repo.appendPending(
        [
          mkEvent(idA, streamA, 'note.added'),
          mkEvent(idB, streamA, 'note.updated'),
          mkEvent(idC, streamA, 'note.removed'),
        ],
        0,
      );

      await repo.assignSeqs(streamA, idA, 10, 2);

      expect((await db.events.get(idA))?.seq).toBe(10);
      expect((await db.events.get(idB))?.seq).toBe(11);
      expect((await db.events.get(idC))?.seq).toBeUndefined();
    });
  });

  // --- replaceStream (plan-6 Task 10 — `.hero` import merge-by-id) -------------------------

  describe('replaceStream', () => {
    it('writes events verbatim (ids kept) with fresh seqs 1..n, in the given array order', async () => {
      const repo = TestBed.inject(EventsRepository);
      const idA = uuid(70);
      const idB = uuid(71);

      await repo.replaceStream(streamA, [
        mkEvent(idA, streamA, 'note.added'),
        mkEvent(idB, streamA, 'note.updated'),
      ]);

      const events = await repo.byStream(streamA);
      expect(events.map((e) => e.id)).toEqual([idA, idB]);
      expect(events.map((e) => e.seq)).toEqual([1, 2]);
    });

    it('atomically deletes every existing row of the stream before writing the replacement set', async () => {
      const repo = TestBed.inject(EventsRepository);
      const staleId = uuid(72);
      const keptId = uuid(73);
      await repo.append([mkEvent(staleId, streamA, 'note.added')]);

      await repo.replaceStream(streamA, [mkEvent(keptId, streamA, 'note.updated')]);

      const events = await repo.byStream(streamA);
      expect(events.map((e) => e.id)).toEqual([keptId]);
      expect(events[0]?.seq).toBe(1);
    });

    it('rewrites seq from array position even when a given event already carries a different one', async () => {
      const repo = TestBed.inject(EventsRepository);
      const idA = uuid(74);
      const idB = uuid(75);
      // Simulates `.hero` import input: events keep their ORIGINAL source seq (here 9 and 40) —
      // replaceStream must discard both in favor of 1..n by array position.
      await repo.replaceStream(streamA, [
        mkEvent(idA, streamA, 'note.added', { seq: 9 }),
        mkEvent(idB, streamA, 'note.updated', { seq: 40 }),
      ]);

      const events = await repo.byStream(streamA);
      expect(events.map((e) => ({ id: e.id, seq: e.seq }))).toEqual([
        { id: idA, seq: 1 },
        { id: idB, seq: 2 },
      ]);
    });

    it('leaves other streams entirely untouched', async () => {
      const repo = TestBed.inject(EventsRepository);
      await repo.append([mkEvent(uuid(76), streamB, 'note.added')]);

      await repo.replaceStream(streamA, [mkEvent(uuid(77), streamA, 'note.added')]);

      const b = await repo.byStream(streamB);
      expect(b).toHaveLength(1);
      expect(b[0]?.id).toBe(uuid(76));
    });

    it('an empty replacement array clears the stream', async () => {
      const repo = TestBed.inject(EventsRepository);
      await repo.append([mkEvent(uuid(78), streamA, 'note.added')]);

      await repo.replaceStream(streamA, []);

      expect(await repo.byStream(streamA)).toEqual([]);
    });
  });
});
