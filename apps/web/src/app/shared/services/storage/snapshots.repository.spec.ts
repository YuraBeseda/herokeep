import { TestBed } from '@angular/core/testing';
import { emptyFacts, ENGINE_VERSION, type Snapshot } from '@hk/engine';
import { HkDb } from '@shared/services/storage/dexie.db';
import { SnapshotsRepository } from '@shared/services/storage/snapshots.repository';

const stream = 'char:00000000-0000-4000-8000-000000000001';

function mkSnapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    seq: 3,
    facts: emptyFacts(stream),
    engineVersion: ENGINE_VERSION,
    ...overrides,
  };
}

describe('SnapshotsRepository', () => {
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

  it('round-trips a snapshot through put/get', async () => {
    const repo = TestBed.inject(SnapshotsRepository);
    const snapshot = mkSnapshot();

    await repo.put(stream, snapshot);

    expect(await repo.get(stream)).toEqual(snapshot);
  });

  it('get prunes and returns undefined for a snapshot whose engineVersion no longer matches', async () => {
    const repo = TestBed.inject(SnapshotsRepository);
    const db = TestBed.inject(HkDb);
    const stale = mkSnapshot({ engineVersion: '0.0.1-stale' });
    await repo.put(stream, stale);

    expect(await repo.get(stream)).toBeUndefined();
    expect(await db.snapshots.get(stream)).toBeUndefined();
  });

  it('get returns undefined for a stream with no snapshot', async () => {
    const repo = TestBed.inject(SnapshotsRepository);
    expect(await repo.get(stream)).toBeUndefined();
  });
});
