import { TestBed } from '@angular/core/testing';
import { HkDb } from '@shared/services/storage/dexie.db';
import { SettingsRepository } from '@shared/services/storage/settings.repository';

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('SettingsRepository', () => {
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

  afterEach(() => {
    TestBed.inject(HkDb).close();
  });

  it('round-trips an arbitrary key/value through get/set', async () => {
    const repo = TestBed.inject(SettingsRepository);
    await repo.set('locale', 'ru');
    expect(await repo.get('locale')).toBe('ru');
  });

  it('get returns undefined for a key never set', async () => {
    const repo = TestBed.inject(SettingsRepository);
    expect(await repo.get('nope')).toBeUndefined();
  });

  describe('deviceId', () => {
    it('generates a UUIDv7-shaped id on first call and persists it', async () => {
      const repo = TestBed.inject(SettingsRepository);
      const id = await repo.deviceId();

      expect(id).toMatch(UUID_V7);
      expect(await repo.get('deviceId')).toBe(id);
    });

    it('returns the same id on every subsequent call (get-or-create)', async () => {
      const repo = TestBed.inject(SettingsRepository);
      const first = await repo.deviceId();
      const second = await repo.deviceId();

      expect(second).toBe(first);
    });

    it('survives across a fresh repository instance reading the same persisted row', async () => {
      const repo = TestBed.inject(SettingsRepository);
      const id = await repo.deviceId();

      const otherRepo = TestBed.runInInjectionContext(() => new SettingsRepository());
      expect(await otherRepo.deviceId()).toBe(id);
    });
  });
});
