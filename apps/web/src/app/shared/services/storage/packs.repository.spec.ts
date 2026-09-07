import { IDBFactory } from 'fake-indexeddb';
import { TestBed } from '@angular/core/testing';
import type { Pack } from '@hk/protocol';
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
  // Each test gets a fresh in-memory IndexedDB so `hk-db` rows never leak between tests.
  beforeEach(() => {
    (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
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
