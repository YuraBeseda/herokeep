import { TestBed } from '@angular/core/testing';
import { strFromU8, unzipSync } from 'fflate';
import { parseEvent, type Event } from '@hk/protocol';
import { BlobsRepository } from '@shared/services/storage/blobs.repository';
import { HkDb } from '@shared/services/storage/dexie.db';
import { EventsRepository } from '@shared/services/storage/events.repository';
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
