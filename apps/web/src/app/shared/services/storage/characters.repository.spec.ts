import { TestBed } from '@angular/core/testing';
import { emptyFacts } from '@hk/engine';
import { CharactersRepository } from '@shared/services/storage/characters.repository';
import { HkDb, type CharacterRow } from '@shared/services/storage/dexie.db';

const streamA = 'char:00000000-0000-4000-8000-000000000001';
const streamB = 'char:00000000-0000-4000-8000-000000000002';

function mkRow(overrides: Partial<CharacterRow> = {}): CharacterRow {
  return {
    id: streamA,
    name: 'Ivan',
    system: 'srd-5e-2024',
    archived: false,
    updatedAt: 1000,
    ...overrides,
  };
}

describe('CharactersRepository', () => {
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

  it('round-trips a row through put/get', async () => {
    const repo = TestBed.inject(CharactersRepository);
    const row = mkRow();

    await repo.put(row);

    expect(await repo.get(row.id)).toEqual(row);
  });

  it('remove deletes the row', async () => {
    const repo = TestBed.inject(CharactersRepository);
    const row = mkRow();
    await repo.put(row);

    await repo.remove(row.id);

    expect(await repo.get(row.id)).toBeUndefined();
  });

  it('list returns every character ordered by updatedAt desc', async () => {
    const repo = TestBed.inject(CharactersRepository);
    await repo.put(mkRow({ id: streamA, name: 'Older', updatedAt: 1000 }));
    await repo.put(mkRow({ id: streamB, name: 'Newer', updatedAt: 2000 }));

    const list = await repo.list();

    expect(list.map((r) => r.id)).toEqual([streamB, streamA]);
  });

  it('upsertFromFacts maps name/system/archived/portraitThumbHash and stamps updatedAt', async () => {
    const repo = TestBed.inject(CharactersRepository);
    const facts = {
      ...emptyFacts(streamA),
      name: 'Ivan',
      system: 'srd-5e-2024',
      archived: false,
      portrait: { hash: 'blob-hash', thumbHash: 'thumb-hash' },
    };
    const before = Date.now();

    await repo.upsertFromFacts(streamA, facts);

    const row = await repo.get(streamA);
    expect(row?.name).toBe('Ivan');
    expect(row?.system).toBe('srd-5e-2024');
    expect(row?.archived).toBe(false);
    expect(row?.portraitThumbHash).toBe('thumb-hash');
    expect(row?.updatedAt).toBeGreaterThanOrEqual(before);
  });

  it('upsertFromFacts overwrites an existing row for the same streamId', async () => {
    const repo = TestBed.inject(CharactersRepository);
    await repo.upsertFromFacts(streamA, {
      ...emptyFacts(streamA),
      name: 'First',
      system: 'srd-5e-2024',
    });

    await repo.upsertFromFacts(streamA, {
      ...emptyFacts(streamA),
      name: 'Second',
      system: 'srd-5e-2024',
      archived: true,
    });

    const list = await repo.list();
    expect(list).toHaveLength(1);
    expect(list[0]?.name).toBe('Second');
    expect(list[0]?.archived).toBe(true);
  });
});
