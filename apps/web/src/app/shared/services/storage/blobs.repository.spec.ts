import { TestBed } from '@angular/core/testing';
import { BlobsRepository } from '@shared/services/storage/blobs.repository';
import { HkDb } from '@shared/services/storage/dexie.db';

const hash = 'sha256-abc123';

describe('BlobsRepository', () => {
  // fake-indexeddb's `indexedDB` is captured once, at `dexie`'s own module-top-level scope (see
  // `apps/web/src/test-setup.ts`), and this test builder shares that one module instance across
  // every `it()` in a spec file — so every test in this file talks to the same physical `hk-db`.
  // Clearing the tables (rather than swapping the global) is what actually isolates each test.
  beforeEach(async () => {
    const db = TestBed.inject(HkDb);
    await Promise.all([
      db.packs.clear(),
      db.settings.clear(),
      db.events.clear(),
      db.snapshots.clear(),
      db.characters.clear(),
      db.blobs.clear(),
      db.campaigns.clear(),
    ]);
  });

  // Defensive: TestBed doesn't close `HkDb`'s IndexedDB connection when it tears down the
  // injector between tests, so without this a connection could still be open when another spec
  // file's `beforeEach`/`Dexie.delete` next runs against the same `hk-db` name (see
  // `dexie.db.spec.ts` for the inter-file reasoning).
  afterEach(() => {
    TestBed.inject(HkDb).close();
  });

  it('round-trips a blob through put/get, deriving size from the bytes', async () => {
    const repo = TestBed.inject(BlobsRepository);
    const bytes = new Uint8Array([1, 2, 3, 4]);

    await repo.put(hash, 'image/png', bytes);

    const row = await repo.get(hash);
    expect(row?.hash).toBe(hash);
    expect(row?.mime).toBe('image/png');
    // fake-indexeddb's structured clone hands back a `Uint8Array` from a different realm than
    // this file's, so `toEqual` on the typed arrays themselves reports a (spurious) mismatch
    // despite printing identically — compare the byte values instead.
    expect(Array.from(row?.bytes ?? [])).toEqual(Array.from(bytes));
    expect(row?.size).toBe(4);
  });

  it('get returns undefined for an unknown hash', async () => {
    const repo = TestBed.inject(BlobsRepository);
    expect(await repo.get('missing')).toBeUndefined();
  });

  it('put is idempotent: writing the same hash twice leaves exactly one row', async () => {
    const repo = TestBed.inject(BlobsRepository);
    const db = TestBed.inject(HkDb);
    const bytes = new Uint8Array([9, 9, 9]);

    await repo.put(hash, 'image/webp', bytes);
    await repo.put(hash, 'image/webp', bytes);

    expect(await db.blobs.count()).toBe(1);
    expect(Array.from((await repo.get(hash))?.bytes ?? [])).toEqual(Array.from(bytes));
  });

  it('round-trips the optional kind/width/height meta (plan-6 Task 8, design ruling 3)', async () => {
    const repo = TestBed.inject(BlobsRepository);
    const bytes = new Uint8Array([1, 2, 3]);

    await repo.put(hash, 'image/webp', bytes, { kind: 'thumb', width: 256, height: 256 });

    const row = await repo.get(hash);
    expect(row?.kind).toBe('thumb');
    expect(row?.width).toBe(256);
    expect(row?.height).toBe(256);
  });

  it('omitting meta leaves kind/width/height undefined (pre-Task-8 call shape still works)', async () => {
    const repo = TestBed.inject(BlobsRepository);
    await repo.put(hash, 'image/png', new Uint8Array([1]));

    const row = await repo.get(hash);
    expect(row?.kind).toBeUndefined();
    expect(row?.width).toBeUndefined();
    expect(row?.height).toBeUndefined();
  });

  it('put stamps addedAt/lastUsedAt/origin/pinned defaults (doc-07 Blob record, plan-10 Task 2)', async () => {
    const repo = TestBed.inject(BlobsRepository);
    const before = Date.now();

    await repo.put(hash, 'image/webp', new Uint8Array([1, 2, 3]));

    const row = await repo.get(hash);
    expect(row?.origin).toBe('upload');
    expect(row?.pinned).toBe(false);
    expect(row?.addedAt).toBeGreaterThanOrEqual(before);
    expect(row?.lastUsedAt).toBeGreaterThanOrEqual(before);
  });

  it('re-put of an existing hash preserves pinned/addedAt/origin, only advancing lastUsedAt (Task-2 fix-round 1)', async () => {
    const repo = TestBed.inject(BlobsRepository);
    const db = TestBed.inject(HkDb);

    await repo.put(hash, 'image/webp', new Uint8Array([1, 2, 3]), { kind: 'thumb' });
    const original = await repo.get(hash);
    // Simulate a blob the version(3) upgrade (or a future Task 13 pin) already pinned, bypassing
    // `put`'s own defaults — a re-`put` must not silently unpin/reset-origin this row.
    await db.blobs.update(hash, { pinned: true, origin: 'peer' });
    expect((await repo.get(hash))?.pinned).toBe(true);

    const after = Date.now();
    await repo.put(hash, 'image/webp', new Uint8Array([9, 9, 9, 9]), { kind: 'thumb' });

    const row = await repo.get(hash);
    expect(row?.pinned).toBe(true);
    expect(row?.origin).toBe('peer');
    expect(row?.addedAt).toBe(original?.addedAt);
    expect(row?.lastUsedAt).toBeGreaterThanOrEqual(after);
    expect(Array.from(row?.bytes ?? [])).toEqual([9, 9, 9, 9]);
    expect(row?.size).toBe(4);
  });

  // --- plan-10 Task 13 additions (doc-07 §Cache management) -------------------------------------

  describe('touchLastUsed', () => {
    it('advances lastUsedAt on an existing row without touching any other field', async () => {
      const repo = TestBed.inject(BlobsRepository);
      await repo.put(hash, 'image/webp', new Uint8Array([1]), { kind: 'thumb' });
      const before = await repo.get(hash);

      const after = Date.now();
      await repo.touchLastUsed(hash);

      const row = await repo.get(hash);
      expect(row?.lastUsedAt).toBeGreaterThanOrEqual(after);
      expect(row?.pinned).toBe(before?.pinned);
      expect(row?.origin).toBe(before?.origin);
      expect(row?.addedAt).toBe(before?.addedAt);
    });

    // Regression (plan-10 Task 13): the FIRST implementation used Dexie's partial `Table.update()`
    // for this write, which this project's IndexedDB test backend (fake-indexeddb) was found to
    // silently corrupt an existing row's `bytes` (a `Uint8Array`) into a plain `{0:.., 1:.., ...}`
    // object — caught by `blob-transfer.service.spec.ts`'s own chunk-assembly test, which stores a
    // blob and then (indirectly, via `CacheManagerService.refreshPins()`) calls this method on it.
    // `touchLastUsed` now does a full get-then-`put()` instead — this pins that `bytes` survives a
    // real `Uint8Array`, not a degraded plain object, across the call.
    it('preserves bytes as a genuine Uint8Array (not a degraded plain object) across the call', async () => {
      const repo = TestBed.inject(BlobsRepository);
      const original = new Uint8Array([5, 6, 7, 8]);
      await repo.put(hash, 'image/webp', original);

      await repo.touchLastUsed(hash);

      const row = await repo.get(hash);
      expect(Array.from(row?.bytes ?? [])).toEqual([5, 6, 7, 8]);
    });

    it('is a no-op for a hash that does not exist (never throws)', async () => {
      const repo = TestBed.inject(BlobsRepository);
      await expect(repo.touchLastUsed('missing')).resolves.toBeUndefined();
    });
  });

  describe('setPinned', () => {
    it('flips pinned to true on an existing row', async () => {
      const repo = TestBed.inject(BlobsRepository);
      await repo.put(hash, 'image/webp', new Uint8Array([1]));
      await repo.setPinned(hash, true);
      expect((await repo.get(hash))?.pinned).toBe(true);
    });

    it('flips pinned back to false', async () => {
      const repo = TestBed.inject(BlobsRepository);
      await repo.put(hash, 'image/webp', new Uint8Array([1]));
      await repo.setPinned(hash, true);
      await repo.setPinned(hash, false);
      expect((await repo.get(hash))?.pinned).toBe(false);
    });

    it('is a no-op for a hash that does not exist (never throws)', async () => {
      const repo = TestBed.inject(BlobsRepository);
      await expect(repo.setPinned('missing', true)).resolves.toBeUndefined();
    });

    // Regression (plan-10 Task 13) — see `touchLastUsed`'s own identical regression test above for
    // the full story; `setPinned` had the same `Table.update()`-corrupts-`bytes` bug.
    it('preserves bytes as a genuine Uint8Array (not a degraded plain object) across the call', async () => {
      const repo = TestBed.inject(BlobsRepository);
      const original = new Uint8Array([1, 2, 3, 4]);
      await repo.put(hash, 'image/webp', original);

      await repo.setPinned(hash, true);

      const row = await repo.get(hash);
      expect(Array.from(row?.bytes ?? [])).toEqual([1, 2, 3, 4]);
    });
  });

  describe('list', () => {
    it('returns every row in the table', async () => {
      const repo = TestBed.inject(BlobsRepository);
      await repo.put('h1', 'image/png', new Uint8Array([1]));
      await repo.put('h2', 'image/png', new Uint8Array([2]));
      const rows = await repo.list();
      expect(rows.map((r) => r.hash).sort()).toEqual(['h1', 'h2']);
    });

    it('returns an empty array when the table is empty', async () => {
      const repo = TestBed.inject(BlobsRepository);
      expect(await repo.list()).toEqual([]);
    });
  });

  describe('remove', () => {
    it('deletes an existing row', async () => {
      const repo = TestBed.inject(BlobsRepository);
      await repo.put(hash, 'image/png', new Uint8Array([1]));
      await repo.remove(hash);
      expect(await repo.get(hash)).toBeUndefined();
    });

    it('is a no-op for a hash that does not exist (never throws)', async () => {
      const repo = TestBed.inject(BlobsRepository);
      await expect(repo.remove('missing')).resolves.toBeUndefined();
    });
  });
});
