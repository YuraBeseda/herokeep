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
});
