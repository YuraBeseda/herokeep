import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { Event } from '@hk/protocol';
import { StoragePersistService } from '@shared/services/pwa/storage-persist.service';
import { BlobsRepository } from '@shared/services/storage/blobs.repository';
import { CampaignsRepository } from '@shared/services/storage/campaigns.repository';
import { CharactersRepository } from '@shared/services/storage/characters.repository';
import { HkDb, type CampaignRow, type CharacterRow } from '@shared/services/storage/dexie.db';
import { EventsRepository } from '@shared/services/storage/events.repository';
import { SettingsRepository } from '@shared/services/storage/settings.repository';
import {
  CACHE_CAP_DEFAULT_BYTES,
  CACHE_CAP_MAX_BYTES,
  CACHE_CAP_MIN_BYTES,
  CacheManagerService,
} from './cache-manager.service';

const CAMPAIGN_STREAM = 'camp:00000000-0000-4000-8000-000000000001';

let nextEventId = 1;

function mkEvent(type: string, payload: unknown): Event {
  const id = `00000000-0000-4000-8000-${String(nextEventId++).padStart(12, '0')}`;
  return {
    id,
    stream: CAMPAIGN_STREAM,
    ts: '2026-09-26T00:00:00.000Z',
    actor: { userId: 'usr_dm', deviceId: 'dev_1', role: 'dm' },
    type,
    v: 1,
    payload,
  };
}

function mkCharacterRow(overrides: Partial<CharacterRow> = {}): CharacterRow {
  return {
    id: 'char:00000000-0000-4000-8000-000000000099',
    name: 'Aria',
    system: 'srd-5e-2024',
    archived: false,
    updatedAt: 1000,
    ...overrides,
  };
}

function mkCampaignRow(overrides: Partial<CampaignRow> = {}): CampaignRow {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    name: 'Curse of Strahd',
    system: 'srd-5e-2024',
    role: 'player',
    lastSeq: 0,
    updatedAt: 1000,
    ...overrides,
  };
}

/** Writes a blob row DIRECTLY via Dexie (not `BlobsRepository.put`, which derives `size` from the
 * REAL byte length) so a test can exercise cap arithmetic against a large `size` (e.g. near
 * `CACHE_CAP_MIN_BYTES`) without actually allocating that many bytes — `CacheManagerService`'s cap
 * logic only ever reads the stored `size` NUMBER, never re-measures `bytes`. */
async function putBlob(
  hash: string,
  size: number,
  pinned = false,
  lastUsedAt?: number,
): Promise<void> {
  const db = TestBed.inject(HkDb);
  const now = Date.now();
  await db.blobs.put({
    hash,
    mime: 'image/webp',
    bytes: new Uint8Array(1),
    size,
    addedAt: now,
    lastUsedAt: lastUsedAt ?? now,
    pinned,
    origin: 'upload',
  });
}

describe('CacheManagerService', () => {
  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        {
          provide: StoragePersistService,
          useValue: { estimate: signal({ usage: 0, quota: 0 }), supported: signal(true) },
        },
      ],
    });

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

  afterEach(() => {
    TestBed.inject(HkDb).close();
  });

  describe('capBytes', () => {
    it('defaults to 500 MB when no cap has ever been set', async () => {
      const service = TestBed.inject(CacheManagerService);
      await service.ready;
      expect(service.capBytes()).toBe(CACHE_CAP_DEFAULT_BYTES);
    });

    it('loads a previously persisted cap on construction', async () => {
      await TestBed.inject(SettingsRepository).set('blobCacheCapBytes', 900 * 1024 * 1024);
      const service = TestBed.runInInjectionContext(() => new CacheManagerService());
      await service.ready;
      expect(service.capBytes()).toBe(900 * 1024 * 1024);
    });

    it('setCapBytes clamps below the 100 MB minimum', async () => {
      const service = TestBed.inject(CacheManagerService);
      await service.ready;
      await service.setCapBytes(1);
      expect(service.capBytes()).toBe(CACHE_CAP_MIN_BYTES);
    });

    it('setCapBytes clamps above the 2 GB maximum', async () => {
      const service = TestBed.inject(CacheManagerService);
      await service.ready;
      await service.setCapBytes(CACHE_CAP_MAX_BYTES * 10);
      expect(service.capBytes()).toBe(CACHE_CAP_MAX_BYTES);
    });

    it('setCapBytes persists so a fresh instance picks it up', async () => {
      const service = TestBed.inject(CacheManagerService);
      await service.ready;
      await service.setCapBytes(CACHE_CAP_MIN_BYTES + 1024);

      const second = TestBed.runInInjectionContext(() => new CacheManagerService());
      await second.ready;
      expect(second.capBytes()).toBe(CACHE_CAP_MIN_BYTES + 1024);
    });

    it('setCapBytes runs an LRU sweep against the NEW cap immediately', async () => {
      const MB = 1024 * 1024;
      const service = TestBed.inject(CacheManagerService);
      await service.ready;
      await putBlob('h1', 150 * MB); // fits under the default 500 MB cap
      await service.setCapBytes(CACHE_CAP_MIN_BYTES); // clamped-minimum cap (100 MB) < h1's 150 MB

      expect(await TestBed.inject(BlobsRepository).get('h1')).toBeUndefined();
    });
  });

  describe('refreshPins', () => {
    it("pins a blob referenced by a local character's portraitThumbHash", async () => {
      const service = TestBed.inject(CacheManagerService);
      await service.ready; // settle the boot-time sweep against an EMPTY table first
      await TestBed.inject(CharactersRepository).put(
        mkCharacterRow({ portraitThumbHash: 'thumb-x' }),
      );
      await putBlob('thumb-x', 10);
      await putBlob('unrelated', 10);

      await service.refreshPins();

      expect((await TestBed.inject(BlobsRepository).get('thumb-x'))?.pinned).toBe(true);
      expect((await TestBed.inject(BlobsRepository).get('unrelated'))?.pinned).toBe(false);
    });

    it("pins a blob referenced by a locally-known campaign's party overview thumb", async () => {
      await TestBed.inject(CampaignsRepository).put(mkCampaignRow());
      await TestBed.inject(EventsRepository).append([
        mkEvent('party.overview_updated', {
          characterId: '00000000-0000-4000-8000-000000000abc',
          overview: {
            hp: 10,
            hpMax: 10,
            temp: 0,
            ac: 15,
            level: 1,
            classes: [],
            conditions: [],
            concentration: false,
            portraitThumb: 'sha256:party-thumb',
            passivePerception: 10,
          },
        }),
      ]);
      await putBlob('sha256:party-thumb', 10);

      const service = TestBed.inject(CacheManagerService);
      await service.ready;
      await service.refreshPins();

      expect((await TestBed.inject(BlobsRepository).get('sha256:party-thumb'))?.pinned).toBe(true);
    });

    it('UNPINS a blob that is no longer referenced by anything (full recompute, not additive)', async () => {
      const service = TestBed.inject(CacheManagerService);
      await service.ready; // settle the boot-time sweep against an EMPTY table first
      await putBlob('was-pinned', 10, true);

      await service.refreshPins();

      expect((await TestBed.inject(BlobsRepository).get('was-pinned'))?.pinned).toBe(false);
    });
  });

  describe('runLruSweep', () => {
    it('evicts the least-recently-used UNPINNED blob down to the current cap, never touching pinned rows', async () => {
      const MB = 1024 * 1024;
      const service = TestBed.inject(CacheManagerService);
      await service.ready; // settle the boot-time sweep against an EMPTY (still-unset-cap) table
      await service.setCapBytes(300 * MB); // a deterministic, in-range cap (no-op sweep, table empty)
      await putBlob('pinned', 150 * MB, true);
      await putBlob('unpinned', 200 * MB); // total 350 MB > 300 MB cap

      await service.runLruSweep();

      expect(await TestBed.inject(BlobsRepository).get('pinned')).toBeDefined();
      expect(await TestBed.inject(BlobsRepository).get('unpinned')).toBeUndefined();
    });

    it('is a no-op when everything already fits under the cap', async () => {
      const service = TestBed.inject(CacheManagerService);
      await service.ready; // settle the boot-time sweep against an EMPTY table first
      await putBlob('small', 10);
      await service.runLruSweep();
      expect(await TestBed.inject(BlobsRepository).get('small')).toBeDefined();
    });
  });

  describe('runOrphanSweep', () => {
    it('removes a blob referenced by nothing local', async () => {
      await putBlob('orphan', 10);
      const service = TestBed.inject(CacheManagerService);
      await service.ready;
      await service.runOrphanSweep();
      expect(await TestBed.inject(BlobsRepository).get('orphan')).toBeUndefined();
    });

    it('keeps a blob referenced by a local character', async () => {
      await TestBed.inject(CharactersRepository).put(mkCharacterRow({ portraitThumbHash: 'kept' }));
      await putBlob('kept', 10);
      const service = TestBed.inject(CacheManagerService);
      await service.ready;
      await service.runOrphanSweep();
      expect(await TestBed.inject(BlobsRepository).get('kept')).toBeDefined();
    });

    it('refreshes pins FIRST, so a STALE pinned flag on a genuinely unreferenced row is corrected and then swept (pinned is always derived, never a standalone flag)', async () => {
      const service = TestBed.inject(CacheManagerService);
      await service.ready; // settle the boot-time sweep against an EMPTY table first
      await putBlob('stale-pin', 10, true); // pinned=true with NOTHING actually referencing it

      await service.runOrphanSweep();

      expect(await TestBed.inject(BlobsRepository).get('stale-pin')).toBeUndefined();
    });

    it('records the sweep timestamp so a fresh instance does not immediately re-sweep', async () => {
      const first = TestBed.inject(CacheManagerService);
      await first.ready;
      await first.runOrphanSweep();

      await putBlob('fresh-orphan', 10);
      const second = TestBed.runInInjectionContext(() => new CacheManagerService());
      await second.ready; // boot-time weekly check should NOT fire (just swept)

      expect(await TestBed.inject(BlobsRepository).get('fresh-orphan')).toBeDefined();
    });
  });

  describe('boot-time weekly sweep', () => {
    it('runs the orphan sweep on FIRST EVER boot (no lastRun recorded)', async () => {
      await putBlob('boot-orphan', 10);
      const service = TestBed.inject(CacheManagerService);
      await service.ready;

      expect(await TestBed.inject(BlobsRepository).get('boot-orphan')).toBeUndefined();
      expect(
        await TestBed.inject(SettingsRepository).get<number>('blobOrphanSweepLastRunAt'),
      ).toBeDefined();
    });
  });
});
