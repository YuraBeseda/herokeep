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
});
