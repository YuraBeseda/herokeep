import Dexie, { type EntityTable } from 'dexie';
import type { Pack } from '@hk/protocol';
import { HkDb, type PackRow, type SettingsRow } from '@shared/services/storage/dexie.db';

/**
 * Mirrors the version(1)-only schema `dexie.db.ts` shipped before Task 16, so this spec can seed
 * a database the way an existing install's browser actually has it on disk, then hand it to the
 * real (version 1 + 2) `HkDb` and confirm the upgrade preserves the old rows.
 */
class OldHkDb extends Dexie {
  packs!: EntityTable<PackRow, 'key'>;
  settings!: EntityTable<SettingsRow, 'key'>;

  constructor() {
    super('hk-db');
    this.version(1).stores({
      packs: '&key, id, version, kind',
      settings: '&key',
    });
  }
}

function samplePack(): Pack {
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
  };
}

describe('HkDb migration (version 1 -> 2)', () => {
  // fake-indexeddb's `indexedDB` is captured once, at `dexie`'s own module-top-level scope (see
  // `apps/web/src/test-setup.ts`), and this test builder shares that one module instance across
  // every `it()` in this spec file — so both tests below talk to the same physical `hk-db`.
  // Each test below closes every Dexie connection it opens (`finally { db.close(); }`), so a
  // full `Dexie.delete` here — needed because this file cares about the *schema version itself*,
  // not just row contents — never blocks on a lingering open connection.
  beforeEach(async () => {
    await Dexie.delete('hk-db');
  });

  it('upgrades an existing v1 database in place, keeping its pack rows intact', async () => {
    const pack = samplePack();
    const row: PackRow = {
      key: `${pack.id}@${pack.version}`,
      id: pack.id,
      version: pack.version,
      kind: pack.kind,
      locale: pack.locale,
      json: pack,
    };

    const oldDb = new OldHkDb();
    await oldDb.packs.put(row);
    await oldDb.settings.put({ key: 'theme', value: 'dark' });
    oldDb.close();

    const db = new HkDb();
    await db.open();
    try {
      expect(await db.packs.get(row.key)).toEqual(row);
      expect(await db.settings.get('theme')).toEqual({ key: 'theme', value: 'dark' });

      // The version(2) tables this task adds are present and usable on the upgraded database.
      await db.characters.put({
        id: 'char:1',
        name: 'Ivan',
        system: 'srd-5e-2024',
        archived: false,
        updatedAt: 1,
      });
      expect(await db.characters.count()).toBe(1);
    } finally {
      db.close();
    }
  });

  it('creates all version(2) tables from scratch for a brand-new database', async () => {
    const db = new HkDb();
    await db.open();
    try {
      expect(await db.events.count()).toBe(0);
      expect(await db.snapshots.count()).toBe(0);
      expect(await db.characters.count()).toBe(0);
      expect(await db.blobs.count()).toBe(0);
    } finally {
      db.close();
    }
  });
});
