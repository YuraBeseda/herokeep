import { TestBed } from '@angular/core/testing';
import type { Pack } from '@hk/protocol';
import { HkDb } from '@shared/services/storage/dexie.db';
import { PacksRepository } from '@shared/services/storage/packs.repository';

function ruSamplePack(overrides: Partial<Pack> = {}): Pack {
  return {
    format: 1,
    id: 'srd-5e-2024-ru-sample',
    version: '0.1.0',
    kind: 'translation',
    name: 'RU sample',
    authors: [],
    dependencies: [],
    locale: 'ru',
    translates: { id: 'srd-5e-2024', range: '^0.1.0' },
    entities: [],
    overrides: [],
    assets: [],
    i18n: {},
    strings: { 'spell/fireball': { name: 'Огненный шар' } },
    ...overrides,
  };
}

describe('PacksRepository', () => {
  // Same idiom as `blobs.repository.spec.ts`: Dexie captures fake-indexeddb's `indexedDB` once
  // (`apps/web/src/test-setup.ts`), so swapping `globalThis.indexedDB` does not isolate anything —
  // every spec talks to the one shared `hk-db`. Clearing the table before each test (rows other
  // pack-writing specs left) and closing the connection after it is what isolates this file.
  beforeEach(async () => {
    await TestBed.inject(HkDb).packs.clear();
  });

  afterEach(() => {
    TestBed.inject(HkDb).close();
  });

  it('round-trips a pack through putPack/getAll', async () => {
    const repository = TestBed.inject(PacksRepository);
    const pack = ruSamplePack();

    await repository.putPack(pack);

    expect(await repository.getAll()).toEqual([pack]);
  });

  it('putPack with the same id+version overwrites the existing row', async () => {
    const repository = TestBed.inject(PacksRepository);
    const pack = ruSamplePack();
    await repository.putPack(pack);

    const updated = ruSamplePack({ name: 'RU sample v2' });
    await repository.putPack(updated);

    const all = await repository.getAll();
    expect(all).toHaveLength(1);
    expect(all[0]?.name).toBe('RU sample v2');
  });

  it('remove deletes the row by its `<id>@<version>` key', async () => {
    const repository = TestBed.inject(PacksRepository);
    const pack = ruSamplePack();
    await repository.putPack(pack);

    await repository.remove(`${pack.id}@${pack.version}`);

    expect(await repository.getAll()).toEqual([]);
  });
});
