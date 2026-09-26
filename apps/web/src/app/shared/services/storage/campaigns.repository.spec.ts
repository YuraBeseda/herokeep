import { TestBed } from '@angular/core/testing';
import { CampaignsRepository } from '@shared/services/storage/campaigns.repository';
import { HkDb, type CampaignRow } from '@shared/services/storage/dexie.db';

const campaignA = 'camp:00000000-0000-4000-8000-000000000001';
const campaignB = 'camp:00000000-0000-4000-8000-000000000002';

function mkRow(overrides: Partial<CampaignRow> = {}): CampaignRow {
  return {
    id: campaignA,
    name: 'Curse of Strahd',
    system: 'srd-5e-2024',
    role: 'dm',
    lastSeq: 0,
    updatedAt: 1000,
    ...overrides,
  };
}

describe('CampaignsRepository', () => {
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

  it('round-trips a row through put/get', async () => {
    const repo = TestBed.inject(CampaignsRepository);
    const row = mkRow();

    await repo.put(row);

    expect(await repo.get(row.id)).toEqual(row);
  });

  it('get returns undefined for an unknown id', async () => {
    const repo = TestBed.inject(CampaignsRepository);
    expect(await repo.get('missing')).toBeUndefined();
  });

  it('put is idempotent: writing the same id twice leaves exactly one row, updated', async () => {
    const repo = TestBed.inject(CampaignsRepository);
    await repo.put(mkRow({ lastSeq: 0 }));

    await repo.put(mkRow({ lastSeq: 5 }));

    const list = await repo.list();
    expect(list).toHaveLength(1);
    expect(list[0]?.lastSeq).toBe(5);
  });

  it('remove deletes the row', async () => {
    const repo = TestBed.inject(CampaignsRepository);
    const row = mkRow();
    await repo.put(row);

    await repo.remove(row.id);

    expect(await repo.get(row.id)).toBeUndefined();
  });

  it('list returns every campaign ordered by updatedAt desc', async () => {
    const repo = TestBed.inject(CampaignsRepository);
    await repo.put(mkRow({ id: campaignA, name: 'Older', updatedAt: 1000 }));
    await repo.put(mkRow({ id: campaignB, name: 'Newer', updatedAt: 2000 }));

    const list = await repo.list();

    expect(list.map((r) => r.id)).toEqual([campaignB, campaignA]);
  });

  it('round-trips joinCode for a DM row', async () => {
    const repo = TestBed.inject(CampaignsRepository);
    const row = mkRow({ role: 'dm', joinCode: '7QX4-M2HN' });

    await repo.put(row);

    expect((await repo.get(row.id))?.joinCode).toBe('7QX4-M2HN');
  });

  it('leaves joinCode undefined for a player row (server never sends it)', async () => {
    const repo = TestBed.inject(CampaignsRepository);
    const row = mkRow({ role: 'player' });

    await repo.put(row);

    expect((await repo.get(row.id))?.joinCode).toBeUndefined();
  });
});
