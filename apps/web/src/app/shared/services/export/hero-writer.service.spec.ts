import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TestBed } from '@angular/core/testing';
import { strFromU8, unzipSync } from 'fflate';
import { PACK_ID, PACK_VERSION } from '@hk/content/version';
import { parseEvent, parsePack, type Event, type Pack } from '@hk/protocol';
import { ToastService } from '@shared/components/toast/toast.service';
import { PackLoader } from '@shared/services/engine/pack-loader';
import { sha256Hex } from '@shared/services/images/image-pipeline.service';
import { canonicalJson } from '@shared/services/packs/canonical-json';
import { BlobsRepository } from '@shared/services/storage/blobs.repository';
import { HkDb } from '@shared/services/storage/dexie.db';
import { EventsRepository } from '@shared/services/storage/events.repository';
import { PacksRepository } from '@shared/services/storage/packs.repository';
import { PackStore } from '@shared/stores/pack.store';
import { HeroWriterService, sanitizeHeroFileName } from './hero-writer.service';

function uuid(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

const streamId = `char:${uuid(1)}`;

function mkEvent(id: string, type: string, payload: unknown): Event {
  return {
    id,
    stream: streamId,
    ts: '2026-09-13T00:00:00.000Z',
    actor: { userId: 'u', deviceId: 'd', role: 'owner' },
    type,
    v: 1,
    payload,
  };
}

function createdPayload(name: string): unknown {
  return {
    name,
    system: 'srd-5e-2024',
    corePack: { id: 'srd-5e-2024', version: '0.1.0' },
    engineVersion: '0.1.0',
    grammaticalGender: 'masculine',
  };
}

async function unzipBlob(blob: Blob): Promise<Record<string, Uint8Array>> {
  return unzipSync(new Uint8Array(await blob.arrayBuffer()));
}

describe('HeroWriterService', () => {
  // fake-indexeddb's `indexedDB` is captured once, at `dexie`'s own module-top-level scope (see
  // `apps/web/src/test-setup.ts`) — clearing the tables (rather than swapping the global) is what
  // actually isolates each test, same as every other `*.repository.spec.ts`.
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

  it('builds a manifest with exact name/pins/eventCount, and events.json round-trips event-for-event through parseEvent', async () => {
    const eventsRepository = TestBed.inject(EventsRepository);
    const created = mkEvent(uuid(10), 'character.created', createdPayload('Ivan'));
    const renamed = mkEvent(uuid(11), 'character.renamed', { name: 'Ivan Petrov' });
    await eventsRepository.append([created, renamed]);

    const writer = TestBed.inject(HeroWriterService);
    const { blob, fileName } = await writer.export(streamId);

    expect(fileName).toBe('Ivan Petrov.hero');
    expect(blob.type).toBe('application/zip');

    const zip = await unzipBlob(blob);
    expect(zip['manifest.json']).toBeDefined();
    expect(zip['events.json']).toBeDefined();

    const manifest = JSON.parse(strFromU8(zip['manifest.json'])) as Record<string, unknown>;
    expect(manifest).toMatchObject({
      format: 1,
      kind: 'hero',
      characterId: streamId,
      name: 'Ivan Petrov',
      engineVersion: '0.1.0',
      pins: { 'srd-5e-2024': '0.1.0' },
      eventCount: 2,
      images: [],
    });
    expect(typeof manifest['exportedAt']).toBe('string');
    expect(typeof manifest['appVersion']).toBe('string');

    const roundTripped = JSON.parse(strFromU8(zip['events.json'])) as Event[];
    expect(roundTripped).toHaveLength(2);
    for (const raw of roundTripped) {
      const result = parseEvent(raw);
      expect(result.ok, JSON.stringify(result)).toBe(true);
    }
    expect(roundTripped.map((e) => e.id)).toEqual([created.id, renamed.id]);
  });

  it('includes the portrait and thumb blobs as images/<hash-hex>.<ext>, with matching manifest entries', async () => {
    const eventsRepository = TestBed.inject(EventsRepository);
    const blobsRepository = TestBed.inject(BlobsRepository);
    const hash = `sha256:${'a'.repeat(64)}`;
    const thumbHash = `sha256:${'b'.repeat(64)}`;
    await blobsRepository.put(hash, 'image/webp', new Uint8Array([1, 2, 3, 4]), {
      kind: 'portrait',
      width: 1024,
      height: 1024,
    });
    await blobsRepository.put(thumbHash, 'image/webp', new Uint8Array([5, 6]), {
      kind: 'thumb',
      width: 256,
      height: 256,
    });
    await eventsRepository.append([
      mkEvent(uuid(20), 'character.created', createdPayload('Ivan')),
      mkEvent(uuid(21), 'portrait.set', { hash, thumbHash, mime: 'image/webp', w: 1024, h: 1024 }),
    ]);

    const writer = TestBed.inject(HeroWriterService);
    const { blob } = await writer.export(streamId);
    const zip = await unzipBlob(blob);

    const portraitFile = zip[`images/${'a'.repeat(64)}.webp`];
    const thumbFile = zip[`images/${'b'.repeat(64)}.webp`];
    expect(portraitFile).toBeDefined();
    expect(thumbFile).toBeDefined();
    expect(Array.from(portraitFile)).toEqual([1, 2, 3, 4]);
    expect(Array.from(thumbFile)).toEqual([5, 6]);

    const manifest = JSON.parse(strFromU8(zip['manifest.json'])) as { images: unknown[] };
    expect(manifest.images).toEqual(
      expect.arrayContaining([
        { hash, mime: 'image/webp', size: 4, kind: 'portrait' },
        { hash: thumbHash, mime: 'image/webp', size: 2, kind: 'thumb' },
      ]),
    );
    expect(manifest.images).toHaveLength(2);
  });

  it('skips a portrait/thumb hash with no local blob row (best-effort export — tokens are never exported, scope cut)', async () => {
    const eventsRepository = TestBed.inject(EventsRepository);
    await eventsRepository.append([
      mkEvent(uuid(30), 'character.created', createdPayload('Ivan')),
      mkEvent(uuid(31), 'portrait.set', {
        hash: `sha256:${'c'.repeat(64)}`,
        thumbHash: `sha256:${'d'.repeat(64)}`,
        mime: 'image/webp',
        w: 1024,
        h: 1024,
      }),
    ]);

    const writer = TestBed.inject(HeroWriterService);
    const { blob } = await writer.export(streamId);
    const zip = await unzipBlob(blob);

    const manifest = JSON.parse(strFromU8(zip['manifest.json'])) as { images: unknown[] };
    expect(manifest.images).toEqual([]);
    expect(Object.keys(zip).filter((k) => k.startsWith('images/'))).toEqual([]);
  });
});

// --- Plan 15 Task 6: `.hero` bundles carry the character's pinned (non-core) content packs ------

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..', '..', '..', '..', '..');
const fixturesDir = join(repoRoot, 'apps/web/src/testing/fixtures/packs');

function readPack(path: string): Pack {
  const result = parsePack(JSON.parse(readFileSync(path, 'utf8')));
  if (!result.ok) throw new Error(`fixture pack at ${path} failed validation`);
  return result.pack;
}

describe('HeroWriterService — pinned content packs (plan 15 Task 6)', () => {
  const corePack = readPack(
    join(repoRoot, 'packages/content/dist/packs', PACK_ID, PACK_VERSION, 'pack.json'),
  );
  const sample = readPack(join(fixturesDir, 'sample-content.json'));
  const iconBytes = new Uint8Array(readFileSync(join(fixturesDir, 'sample-icon.webp')));
  const ICON_HEX = sample.assets[0].hash.slice('sha256:'.length);

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        { provide: PackLoader, useValue: { loadCore: () => Promise.resolve(corePack) } },
        { provide: ToastService, useValue: { show: vi.fn() } },
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
    ]);
  });

  afterEach(() => {
    TestBed.inject(HkDb).close();
  });

  /** The sample pack installed the way a later app start sees it: a stored row, its icon in the
   * blob store as a pack asset, then `PackStore.init()`. */
  async function installSample(): Promise<void> {
    await TestBed.inject(PacksRepository).putPack(sample);
    await TestBed.inject(BlobsRepository).put(sample.assets[0].hash, 'image/webp', iconBytes, {
      kind: 'icon',
      origin: 'pack',
    });
    await TestBed.inject(PackStore).init();
  }

  it('carries a pinned installed content pack as packs/<id>@<version>.json (canonical JSON), its assets under assets/<hex>, and a manifest packs[] row with the sha256 of those bytes', async () => {
    await installSample();
    await TestBed.inject(EventsRepository).append([
      mkEvent(uuid(200), 'character.created', createdPayload('Aria')),
      mkEvent(uuid(201), 'pack.pinned', { packId: sample.id, version: sample.version }),
    ]);

    const { blob } = await TestBed.inject(HeroWriterService).export(streamId);
    const zip = await unzipBlob(blob);

    const path = `packs/${sample.id}@${sample.version}.json`;
    const packEntry = zip[path];
    expect(packEntry).toBeDefined();
    expect(strFromU8(packEntry)).toBe(canonicalJson(sample));
    expect(Array.from(zip[`assets/${ICON_HEX}`])).toEqual(Array.from(iconBytes));

    const manifest = JSON.parse(strFromU8(zip['manifest.json'])) as Record<string, unknown>;
    expect(manifest['pins']).toEqual({
      [corePack.id]: corePack.version,
      [sample.id]: sample.version,
    });
    expect(manifest['packs']).toEqual([
      { id: sample.id, version: sample.version, path, sha256: await sha256Hex(packEntry) },
    ]);
    // The core pack is never carried — every device ships it.
    expect(Object.keys(zip).filter((k) => k.startsWith('packs/'))).toEqual([path]);
  });

  it('a core-only character: the manifest has NO packs key and the zip holds exactly the pre-plan-15 entries', async () => {
    await installSample(); // installed, but this character does not pin it
    await TestBed.inject(EventsRepository).append([
      mkEvent(uuid(210), 'character.created', createdPayload('Core Only')),
    ]);

    const { blob } = await TestBed.inject(HeroWriterService).export(streamId);
    const zip = await unzipBlob(blob);

    expect(Object.keys(zip).sort()).toEqual(['events.json', 'manifest.json']);
    const manifest = JSON.parse(strFromU8(zip['manifest.json'])) as Record<string, unknown>;
    expect(Object.keys(manifest)).toEqual([
      'format',
      'kind',
      'characterId',
      'name',
      'exportedAt',
      'engineVersion',
      'appVersion',
      'pins',
      'eventCount',
      'images',
    ]);
  });

  it('omits a pinned pack that is not installed on this device (the importer warns about it instead)', async () => {
    await TestBed.inject(PackStore).init();
    await TestBed.inject(EventsRepository).append([
      mkEvent(uuid(220), 'character.created', createdPayload('Aria')),
      mkEvent(uuid(221), 'pack.pinned', { packId: sample.id, version: sample.version }),
    ]);

    const { blob, warnings } = await TestBed.inject(HeroWriterService).export(streamId);
    const zip = await unzipBlob(blob);

    expect(warnings).toEqual([]); // not installed: the importer's pin warning covers it
    expect(Object.keys(zip).sort()).toEqual(['events.json', 'manifest.json']);
    const manifest = JSON.parse(strFromU8(zip['manifest.json'])) as Record<string, unknown>;
    expect(manifest).not.toHaveProperty('packs');
    expect(manifest['pins']).toEqual({
      [corePack.id]: corePack.version,
      [sample.id]: sample.version,
    });
  });

  it('omits a pinned pack whose asset blob is missing locally (a bundle it could not re-import)', async () => {
    await TestBed.inject(PacksRepository).putPack(sample);
    await TestBed.inject(PackStore).init(); // pack row only — no icon blob
    await TestBed.inject(EventsRepository).append([
      mkEvent(uuid(230), 'character.created', createdPayload('Aria')),
      mkEvent(uuid(231), 'pack.pinned', { packId: sample.id, version: sample.version }),
    ]);

    const { blob, warnings } = await TestBed.inject(HeroWriterService).export(streamId);
    const zip = await unzipBlob(blob);

    expect(Object.keys(zip).sort()).toEqual(['events.json', 'manifest.json']);
    // Plan 15 final fix wave C1: the omission is surfaced, not silent.
    expect(warnings).toEqual([
      { code: 'pack-assets-missing', pack: `${sample.id}@${sample.version}` },
    ]);
  });
});

describe('sanitizeHeroFileName', () => {
  it('strips path-unsafe characters and trims trailing dots/spaces', () => {
    expect(sanitizeHeroFileName('Ivan/Petrov: "The Bold" *?<>|')).toBe('IvanPetrov The Bold');
    expect(sanitizeHeroFileName('Elowen...')).toBe('Elowen');
  });

  it('falls back to "character" for an empty or all-unsafe name', () => {
    expect(sanitizeHeroFileName('')).toBe('character');
    expect(sanitizeHeroFileName('///:::')).toBe('character');
  });
});
