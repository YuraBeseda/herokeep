import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { reduce } from '@hk/engine';
import { PACK_ID, PACK_VERSION } from '@hk/content/version';
import { parsePack, type Event, type Pack } from '@hk/protocol';
import { provideTransloco, type TranslocoLoader } from '@jsverse/transloco';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { of } from 'rxjs';
import { IMAGE_BYTE_CAPS, sha256Hex } from '@shared/services/images/image-pipeline.service';
import { BlobsRepository } from '@shared/services/storage/blobs.repository';
import { CharactersRepository } from '@shared/services/storage/characters.repository';
import { HkDb } from '@shared/services/storage/dexie.db';
import { EventsRepository } from '@shared/services/storage/events.repository';
import { LeaderService } from '@shared/services/storage/leader.service';
import { CharacterStore, CharacterStoreNotLeaderError } from '@shared/stores/character.store';
import { PackStore } from '@shared/stores/pack.store';
import { extensionForMime, hexOfHash, HeroWriterService } from './hero-writer.service';
import {
  HeroImportBadEventError,
  HeroImportBadManifestError,
  HeroImportBadZipError,
  HeroImportHashMismatchError,
  HeroImportSyncedStreamError,
  HeroReaderService,
  mergeEventsBySeq,
} from './hero-reader.service';

// The `pretest` script (apps/web/package.json) runs `pnpm --filter @hk/content build:pack` first,
// so the real built pack is always on disk before this file runs — same fixture-loading approach
// as `character.store.spec.ts` (this file needs a REAL core pack too: `CharacterStore.load`, used
// by the "reload the currently-loaded character" spec below, derives through the real engine
// index, which a fake/partial `Pack` object would fail to build).
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..', '..', '..', '..', '..');

function readPack(path: string): Pack {
  const raw: unknown = JSON.parse(readFileSync(path, 'utf8'));
  const result = parsePack(raw);
  if (!result.ok) {
    throw new Error(
      `fixture pack at ${path} failed validation: ${result.issues.map((i) => i.message).join('; ')}`,
    );
  }
  return result.pack;
}

const corePack = readPack(
  join(repoRoot, 'packages/content/dist/packs', PACK_ID, PACK_VERSION, 'pack.json'),
);

class StubLoader implements TranslocoLoader {
  getTranslation() {
    return of({});
  }
}

function uuid(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

const streamId = `char:${uuid(1)}`;

function mkEvent(id: string, type: string, payload: unknown, extra: Partial<Event> = {}): Event {
  return {
    id,
    stream: streamId,
    ts: '2026-09-13T00:00:00.000Z',
    actor: { userId: 'u', deviceId: 'd', role: 'owner' },
    type,
    v: 1,
    payload,
    ...extra,
  };
}

function createdPayload(name: string, corePackOverride?: { id: string; version: string }): unknown {
  return {
    name,
    system: corePack.id,
    corePack: corePackOverride ?? { id: corePack.id, version: corePack.version },
    engineVersion: '0.1.0',
    grammaticalGender: 'masculine',
  };
}

function bundleFile(blob: Blob, name = 'bundle.hero'): File {
  return new File([blob], name, { type: blob.type });
}

function buildZip(files: Record<string, Uint8Array>): File {
  return new File([zipSync(files)], 'bundle.hero', { type: 'application/zip' });
}

/** A minimal, schema-valid `manifest.json` payload (fix-wave review specs below): every field
 * `HeroBundleManifestSchema` requires, at an innocuous default — each new test overrides only the
 * one or two fields it's actually exercising, same "hand-rolled zip" shape the existing "invalid
 * events.json entry"/"schema validation" specs above already build inline. */
function minimalManifest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    format: 1,
    kind: 'hero',
    characterId: streamId,
    name: 'X',
    exportedAt: new Date().toISOString(),
    engineVersion: '0.1.0',
    appVersion: '0.1.0',
    pins: {},
    eventCount: 0,
    images: [],
    ...overrides,
  };
}

async function clearDb(db: HkDb): Promise<void> {
  await Promise.all([
    db.packs.clear(),
    db.settings.clear(),
    db.events.clear(),
    db.snapshots.clear(),
    db.characters.clear(),
    db.blobs.clear(),
  ]);
}

/** `mergeEventsBySeq` is a pure, exported function (no Angular/DI) — unit-tested directly against
 * hand-built `Event` fixtures rather than through the full service, so the ordering/tie-break
 * rules (`hero-reader.service.ts`'s own doc comment on the function) get precise, isolated
 * coverage independent of the round-trip specs below. */
describe('mergeEventsBySeq', () => {
  function ev(id: string, seq: number): Event {
    return mkEvent(id, 'note.added', {}, { seq });
  }

  it('interleaves existing and incoming events by their own original seq, ascending', () => {
    const merged = mergeEventsBySeq([ev('e1', 1), ev('e3', 3)], [ev('e2', 2), ev('e4', 4)]);
    expect(merged.map((e) => e.id)).toEqual(['e1', 'e2', 'e3', 'e4']);
  });

  it('breaks a seq tie in favor of the existing side, deterministically', () => {
    const merged = mergeEventsBySeq([ev('existing-at-2', 2)], [ev('incoming-at-2', 2)]);
    expect(merged.map((e) => e.id)).toEqual(['existing-at-2', 'incoming-at-2']);
  });

  it('is stable among multiple same-seq events on the same side', () => {
    const merged = mergeEventsBySeq([ev('e-a', 5), ev('e-b', 5)], []);
    expect(merged.map((e) => e.id)).toEqual(['e-a', 'e-b']);
  });

  it('returns existing untouched when there is no new incoming event at all', () => {
    const existing = [ev('only', 1)];
    expect(mergeEventsBySeq(existing, [])).toEqual(existing);
  });
});

function configure(overrides: { leader?: boolean } = {}): void {
  TestBed.configureTestingModule({
    providers: [
      provideTransloco({
        config: {
          availableLangs: ['en', 'ru', 'uk'],
          defaultLang: 'en',
          fallbackLang: 'en',
          reRenderOnLangChange: true,
          prodMode: true,
        },
        loader: StubLoader,
      }),
      {
        provide: PackStore,
        useValue: { packs: signal([corePack]), ready: signal(true), corePack: signal(corePack) },
      },
      ...(overrides.leader === false
        ? [
            {
              provide: LeaderService,
              useValue: {
                isLeader: () => false,
                acquire: () => Promise.resolve(),
                release: () => undefined,
              },
            },
          ]
        : []),
    ],
  });
}

describe('HeroReaderService', () => {
  beforeEach(async () => {
    configure();
    await clearDb(TestBed.inject(HkDb));
  });

  afterEach(() => {
    TestBed.inject(HkDb).close();
  });

  it('creates a brand-new stream from a freshly exported bundle, with facts deep-equal to the source', async () => {
    const eventsRepository = TestBed.inject(EventsRepository);
    const charactersRepository = TestBed.inject(CharactersRepository);
    const writer = TestBed.inject(HeroWriterService);
    const reader = TestBed.inject(HeroReaderService);

    const created = mkEvent(uuid(10), 'character.created', createdPayload('Ivan'));
    const renamed = mkEvent(uuid(11), 'character.renamed', { name: 'Ivan Petrov' });
    await eventsRepository.append([created, renamed]);
    const sourceFacts = reduce(await eventsRepository.byStream(streamId));

    const { blob } = await writer.export(streamId);
    // Import into an EMPTY db: wipe this stream's own rows first, so `characterId` is genuinely
    // unknown locally, same as importing on a brand-new device.
    await eventsRepository.removeStream(streamId);
    await charactersRepository.remove(streamId);

    const result = await reader.import(bundleFile(blob, 'Ivan Petrov.hero'));

    expect(result).toMatchObject({
      characterId: streamId,
      name: 'Ivan Petrov',
      mode: 'created',
      imported: 2,
      skippedDuplicates: 0,
    });
    expect(result.warnings).toEqual([]);

    const importedEvents = await eventsRepository.byStream(streamId);
    expect(importedEvents.map((e) => e.id)).toEqual([created.id, renamed.id]);
    expect(importedEvents.map((e) => e.seq)).toEqual([1, 2]);
    expect(reduce(importedEvents)).toEqual(sourceFacts);

    const row = await charactersRepository.get(streamId);
    expect(row?.name).toBe('Ivan Petrov');
  });

  it('re-importing the identical bundle a second time merges 0 new events, all duplicates skipped', async () => {
    const eventsRepository = TestBed.inject(EventsRepository);
    const charactersRepository = TestBed.inject(CharactersRepository);
    const writer = TestBed.inject(HeroWriterService);
    const reader = TestBed.inject(HeroReaderService);

    await eventsRepository.append([
      mkEvent(uuid(20), 'character.created', createdPayload('Zara')),
      mkEvent(uuid(21), 'character.renamed', { name: 'Zara Windrunner' }),
    ]);
    const { blob } = await writer.export(streamId);
    await eventsRepository.removeStream(streamId);
    await charactersRepository.remove(streamId);

    const first = await reader.import(bundleFile(blob));
    expect(first.mode).toBe('created');

    const second = await reader.import(bundleFile(blob));
    expect(second).toMatchObject({ mode: 'merged', imported: 0, skippedDuplicates: 2 });

    const events = await eventsRepository.byStream(streamId);
    expect(events.map((e) => e.id)).toEqual([uuid(20), uuid(21)]);
    expect(events.map((e) => e.seq)).toEqual([1, 2]);
  });

  it('importing a bundle with events the local stream lacks merges them in (diverged copy)', async () => {
    const eventsRepository = TestBed.inject(EventsRepository);
    const charactersRepository = TestBed.inject(CharactersRepository);
    const writer = TestBed.inject(HeroWriterService);
    const reader = TestBed.inject(HeroReaderService);
    const db = TestBed.inject(HkDb);

    const created = mkEvent(uuid(30), 'character.created', createdPayload('Divergent'));
    const renamedA = mkEvent(uuid(31), 'character.renamed', { name: 'A' });
    const renamedB = mkEvent(uuid(32), 'character.renamed', { name: 'B' });
    const renamedC = mkEvent(uuid(33), 'character.renamed', { name: 'C' });
    await eventsRepository.append([created, renamedA, renamedB, renamedC]);
    await charactersRepository.upsertFromFacts(
      streamId,
      reduce([created, renamedA, renamedB, renamedC]),
    );

    const { blob } = await writer.export(streamId);

    // Simulate divergence: this LOCAL copy never got the last 2 events (as if this device went
    // offline before they synced) — the bundle above still has all 4.
    await db.events.where('id').anyOf([renamedB.id, renamedC.id]).delete();
    expect((await eventsRepository.byStream(streamId)).map((e) => e.id)).toEqual([
      created.id,
      renamedA.id,
    ]);

    const result = await reader.import(bundleFile(blob));

    expect(result.mode).toBe('merged');
    expect(result.imported).toBe(2);
    expect(result.skippedDuplicates).toBe(2);

    const finalEvents = await eventsRepository.byStream(streamId);
    expect(finalEvents.map((e) => e.id)).toEqual([
      created.id,
      renamedA.id,
      renamedB.id,
      renamedC.id,
    ]);
    expect(finalEvents.map((e) => e.seq)).toEqual([1, 2, 3, 4]);
  });

  it('rejects a non-zip file with HeroImportBadZipError', async () => {
    const reader = TestBed.inject(HeroReaderService);
    const file = new File([new Uint8Array([1, 2, 3, 4, 5])], 'not-a-zip.hero');

    await expect(reader.import(file)).rejects.toBeInstanceOf(HeroImportBadZipError);
  });

  it('rejects a zip missing manifest.json/events.json with HeroImportBadZipError', async () => {
    const reader = TestBed.inject(HeroReaderService);
    const file = buildZip({ 'readme.txt': strToU8('not a .hero bundle') });

    await expect(reader.import(file)).rejects.toBeInstanceOf(HeroImportBadZipError);
  });

  it('rejects a bundle whose manifest fails schema validation with HeroImportBadManifestError', async () => {
    const reader = TestBed.inject(HeroReaderService);
    const file = buildZip({
      'manifest.json': strToU8(JSON.stringify({ format: 1, kind: 'hero' })), // missing required fields
      'events.json': strToU8('[]'),
    });

    await expect(reader.import(file)).rejects.toBeInstanceOf(HeroImportBadManifestError);
  });

  it('rejects a bundle whose events.json has an invalid entry, naming its index', async () => {
    const reader = TestBed.inject(HeroReaderService);
    const validManifest = {
      format: 1,
      kind: 'hero',
      characterId: streamId,
      name: 'X',
      exportedAt: new Date().toISOString(),
      engineVersion: '0.1.0',
      appVersion: '0.1.0',
      pins: {},
      eventCount: 2,
      images: [],
    };
    const goodEvent = mkEvent(uuid(40), 'character.created', createdPayload('X'));
    const badEvent = { id: 'not-a-uuid', stream: streamId, type: 'character.renamed' };
    const file = buildZip({
      'manifest.json': strToU8(JSON.stringify(validManifest)),
      'events.json': strToU8(JSON.stringify([goodEvent, badEvent])),
    });

    let caught: unknown;
    try {
      await reader.import(file);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(HeroImportBadEventError);
    expect((caught as HeroImportBadEventError).index).toBe(1);
  });

  it('rejects a bundle whose image bytes do not match the manifest-declared hash', async () => {
    const eventsRepository = TestBed.inject(EventsRepository);
    const blobsRepository = TestBed.inject(BlobsRepository);
    const writer = TestBed.inject(HeroWriterService);
    const reader = TestBed.inject(HeroReaderService);

    const portraitBytes = new Uint8Array([1, 2, 3, 4]);
    const thumbBytes = new Uint8Array([5, 6]);
    const hash = await sha256Hex(portraitBytes);
    const thumbHash = await sha256Hex(thumbBytes);
    await blobsRepository.put(hash, 'image/webp', portraitBytes, { kind: 'portrait' });
    await blobsRepository.put(thumbHash, 'image/webp', thumbBytes, { kind: 'thumb' });
    await eventsRepository.append([
      mkEvent(uuid(50), 'character.created', createdPayload('Tamper')),
      mkEvent(uuid(51), 'portrait.set', { hash, thumbHash, mime: 'image/webp', w: 1, h: 1 }),
    ]);

    const { blob } = await writer.export(streamId);
    const zip = unzipSync(new Uint8Array(await blob.arrayBuffer()));
    // Tamper the PORTRAIT image's bytes in place, without touching its manifest-declared hash.
    zip[`images/${hash.slice('sha256:'.length)}.webp`] = new Uint8Array([9, 9, 9, 9]);
    const tampered = new File([zipSync(zip)], 'tampered.hero', { type: 'application/zip' });

    await expect(reader.import(tampered)).rejects.toBeInstanceOf(HeroImportHashMismatchError);
  });

  // --- Fix-wave review, Important/merge-blocker finding 1 -------------------------------------

  it(
    'rejects a bundle whose manifest smuggles an unsupported image mime (e.g. SVG — a stored-XSS ' +
      'vector), and never stores the blob',
    async () => {
      const blobsRepository = TestBed.inject(BlobsRepository);
      const reader = TestBed.inject(HeroReaderService);

      const svgBytes = strToU8('<svg onload="alert(1)"></svg>');
      const hash = await sha256Hex(svgBytes);
      const manifest = minimalManifest({
        images: [{ hash, mime: 'image/svg+xml', size: svgBytes.byteLength, kind: 'portrait' }],
      });
      const file = buildZip({
        'manifest.json': strToU8(JSON.stringify(manifest)),
        'events.json': strToU8('[]'),
        [`images/${hexOfHash(hash)}.${extensionForMime('image/svg+xml')}`]: svgBytes,
      });

      await expect(reader.import(file)).rejects.toBeInstanceOf(HeroImportBadManifestError);
      expect(await blobsRepository.get(hash)).toBeUndefined();
    },
  );

  // --- Fix-wave review, minor finding 2 --------------------------------------------------------

  it("rejects a bundle whose image bytes exceed its kind's byte cap", async () => {
    const reader = TestBed.inject(HeroReaderService);

    const oversizedBytes = new Uint8Array(IMAGE_BYTE_CAPS.thumb + 1).fill(7);
    const hash = await sha256Hex(oversizedBytes);
    const manifest = minimalManifest({
      images: [{ hash, mime: 'image/webp', size: oversizedBytes.byteLength, kind: 'thumb' }],
    });
    const file = buildZip({
      'manifest.json': strToU8(JSON.stringify(manifest)),
      'events.json': strToU8('[]'),
      [`images/${hexOfHash(hash)}.webp`]: oversizedBytes,
    });

    await expect(reader.import(file)).rejects.toBeInstanceOf(HeroImportBadManifestError);
  });

  it('rejects a bundle whose manifest.eventCount does not match the actual events.json length', async () => {
    const reader = TestBed.inject(HeroReaderService);

    const manifest = minimalManifest({ eventCount: 5 });
    const goodEvent = mkEvent(uuid(41), 'character.created', createdPayload('Mismatch'));
    const file = buildZip({
      'manifest.json': strToU8(JSON.stringify(manifest)),
      'events.json': strToU8(JSON.stringify([goodEvent])),
    });

    await expect(reader.import(file)).rejects.toBeInstanceOf(HeroImportBadManifestError);
  });

  it('imports the same bundle twice without growing the blobs table (deduped by hash)', async () => {
    const eventsRepository = TestBed.inject(EventsRepository);
    const charactersRepository = TestBed.inject(CharactersRepository);
    const blobsRepository = TestBed.inject(BlobsRepository);
    const writer = TestBed.inject(HeroWriterService);
    const reader = TestBed.inject(HeroReaderService);
    const db = TestBed.inject(HkDb);

    const portraitBytes = new Uint8Array([1, 2, 3]);
    const thumbBytes = new Uint8Array([4, 5]);
    const hash = await sha256Hex(portraitBytes);
    const thumbHash = await sha256Hex(thumbBytes);
    await blobsRepository.put(hash, 'image/webp', portraitBytes, { kind: 'portrait' });
    await blobsRepository.put(thumbHash, 'image/webp', thumbBytes, { kind: 'thumb' });
    await eventsRepository.append([
      mkEvent(uuid(60), 'character.created', createdPayload('Dedupe')),
      mkEvent(uuid(61), 'portrait.set', { hash, thumbHash, mime: 'image/webp', w: 1, h: 1 }),
    ]);
    const { blob } = await writer.export(streamId);
    await eventsRepository.removeStream(streamId);
    await charactersRepository.remove(streamId);
    // Force the import itself to be what (re)writes these blob rows, so this test actually
    // exercises the dedupe path on the SECOND call rather than just observing pre-seeded rows.
    await db.blobs.clear();

    await reader.import(bundleFile(blob));
    expect(await db.blobs.count()).toBe(2);

    await reader.import(bundleFile(blob));
    expect(await db.blobs.count()).toBe(2);
  });

  it('a core-pack version mismatch in pins produces a warning but still imports', async () => {
    const eventsRepository = TestBed.inject(EventsRepository);
    const writer = TestBed.inject(HeroWriterService);
    const reader = TestBed.inject(HeroReaderService);

    const mismatchedVersion = '0.0.1';
    expect(mismatchedVersion).not.toBe(corePack.version); // sanity: genuinely different
    await eventsRepository.append([
      mkEvent(
        uuid(70),
        'character.created',
        createdPayload('Mismatch', { id: corePack.id, version: mismatchedVersion }),
      ),
    ]);
    const { blob } = await writer.export(streamId);

    const result = await reader.import(bundleFile(blob));

    expect(result.mode).toBe('created');
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toContain(corePack.id);
  });

  it('reloads CharacterStore when it currently has the imported character loaded', async () => {
    const eventsRepository = TestBed.inject(EventsRepository);
    const charactersRepository = TestBed.inject(CharactersRepository);
    const writer = TestBed.inject(HeroWriterService);
    const reader = TestBed.inject(HeroReaderService);
    const characterStore = TestBed.inject(CharacterStore);

    const created = mkEvent(uuid(80), 'character.created', createdPayload('Loaded'));
    await eventsRepository.append([created]);
    await charactersRepository.upsertFromFacts(streamId, reduce([created]));
    await characterStore.load(streamId);
    expect(characterStore.streamId()).toBe(streamId);
    expect(characterStore.events()).toHaveLength(1);

    // Appended directly to storage, bypassing the store — its in-memory state goes stale (still
    // shows just the 1 event above) until something forces a reload.
    const renamed = mkEvent(uuid(81), 'character.renamed', { name: 'Loaded And Renamed' });
    await eventsRepository.append([renamed]);
    const { blob } = await writer.export(streamId);

    await reader.import(bundleFile(blob));

    expect(characterStore.events()).toHaveLength(2);
    expect(characterStore.facts()?.name).toBe('Loaded And Renamed');
  });

  it('does NOT reload CharacterStore for an unrelated character it has loaded', async () => {
    const eventsRepository = TestBed.inject(EventsRepository);
    const charactersRepository = TestBed.inject(CharactersRepository);
    const writer = TestBed.inject(HeroWriterService);
    const reader = TestBed.inject(HeroReaderService);
    const characterStore = TestBed.inject(CharacterStore);

    const otherStreamId = `char:${uuid(2)}`;
    const otherCreated: Event = {
      ...mkEvent(uuid(90), 'character.created', createdPayload('Other')),
      stream: otherStreamId,
    };
    await eventsRepository.append([otherCreated]);
    await charactersRepository.upsertFromFacts(otherStreamId, reduce([otherCreated]));
    await characterStore.load(otherStreamId);

    await eventsRepository.append([
      mkEvent(uuid(91), 'character.created', createdPayload('Imported')),
    ]);
    const { blob } = await writer.export(streamId);
    await eventsRepository.removeStream(streamId);
    await charactersRepository.remove(streamId);

    await reader.import(bundleFile(blob));

    expect(characterStore.streamId()).toBe(otherStreamId);
    expect(characterStore.facts()?.name).toBe('Other');
  });

  // --- Serialization against CharacterStore (fix-round 1, Critical finding) ------------------

  it(
    'serializes against CharacterStore.deleteCharacter: a delete issued while import is parked ' +
      'inside its exclusive section runs strictly AFTER it (queue FIFO ordering) — the character ' +
      'ends up deleted, not left half-imported or resurrected',
    async () => {
      const eventsRepository = TestBed.inject(EventsRepository);
      const charactersRepository = TestBed.inject(CharactersRepository);
      const writer = TestBed.inject(HeroWriterService);
      const reader = TestBed.inject(HeroReaderService);
      const characterStore = TestBed.inject(CharacterStore);

      await eventsRepository.append([
        mkEvent(uuid(95), 'character.created', createdPayload('Racer')),
      ]);
      const { blob } = await writer.export(streamId);
      // characterId unknown locally at import time (empty db) — the 'created' path, same as the
      // real "someone imports a fresh file, then immediately deletes the row" race the finding
      // describes; the exact create-vs-merge mode doesn't matter to what's being proven here.
      await eventsRepository.removeStream(streamId);

      // Gate the import's exclusive section at its VERY FIRST db call (the create-vs-merge
      // existence check) so it is definitely still "parked" (already enqueued, not yet finished)
      // when deleteCharacter is issued below.
      let releaseGate: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => {
        releaseGate = resolve;
      });
      let gateHit = false;
      const originalGet = charactersRepository.get.bind(charactersRepository);
      vi.spyOn(charactersRepository, 'get').mockImplementationOnce(async (id: string) => {
        gateHit = true;
        await gate;
        return originalGet(id);
      });

      const importPromise = reader.import(bundleFile(blob));
      for (let i = 0; i < 50 && !gateHit; i++) {
        await Promise.resolve();
      }
      expect(gateHit).toBe(true); // import is now parked INSIDE runExclusive, mid-flight

      // Issued while import is parked — per `CharacterStore.runExclusive`'s FIFO queue, this can
      // only run once import's own `runExclusive` callback has fully settled: it is enqueued
      // strictly behind an operation that is already in the queue.
      const deletePromise = characterStore.deleteCharacter(streamId);

      releaseGate();
      const result = await importPromise;
      await deletePromise;

      // The import itself completed successfully and unaffected (proving no interleaved
      // corruption happened DURING its own db phase) ...
      expect(result).toMatchObject({ mode: 'created', imported: 1, skippedDuplicates: 0 });
      // ... but the delete, queued to run strictly after, is what the final state reflects — this
      // is the deterministic outcome THIS queue ordering produces (delete-after-import), not an
      // interleaved/corrupted state.
      expect(await charactersRepository.get(streamId)).toBeUndefined();
      expect(await eventsRepository.byStream(streamId)).toEqual([]);
    },
  );

  // --- Final fix wave, Important finding 1 (plan-9 design item: "import-while-synced merge") ---

  it('refuses to import over an existing character whose stream is currently in sync mode, writing nothing', async () => {
    const eventsRepository = TestBed.inject(EventsRepository);
    const charactersRepository = TestBed.inject(CharactersRepository);
    const writer = TestBed.inject(HeroWriterService);
    const reader = TestBed.inject(HeroReaderService);
    const characterStore = TestBed.inject(CharacterStore);

    const created = mkEvent(uuid(100), 'character.created', createdPayload('Synced'));
    await eventsRepository.append([created]);
    await charactersRepository.upsertFromFacts(streamId, reduce([created]));
    const { blob } = await writer.export(streamId);

    // Diverge locally AFTER export, same shape the "diverged copy" merge spec above uses — so a
    // successful merge would be clearly detectable (it isn't reached here).
    const renamed = mkEvent(uuid(101), 'character.renamed', { name: 'Renamed after export' });
    await eventsRepository.append([renamed]);

    characterStore.enterSyncMode(streamId); // this stream now has a live sync session

    await expect(reader.import(bundleFile(blob))).rejects.toBeInstanceOf(
      HeroImportSyncedStreamError,
    );

    // Nothing written: the pre-import events, byte-identical — including the library-index row,
    // which is never upserted here (only `CharacterStore` normally keeps it current; this test
    // appends `renamed` directly via `EventsRepository`, bypassing that — so its own pre-import
    // value, from the ORIGINAL `upsertFromFacts` call above, is what "untouched" means here).
    const events = await eventsRepository.byStream(streamId);
    expect(events.map((e) => e.id)).toEqual([created.id, renamed.id]);
    const row = await charactersRepository.get(streamId);
    expect(row?.name).toBe('Synced');
  });

  it('still imports a bundle for an UNKNOWN local character id, even while an UNRELATED stream is in sync mode', async () => {
    const eventsRepository = TestBed.inject(EventsRepository);
    const charactersRepository = TestBed.inject(CharactersRepository);
    const writer = TestBed.inject(HeroWriterService);
    const reader = TestBed.inject(HeroReaderService);
    const characterStore = TestBed.inject(CharacterStore);

    await eventsRepository.append([
      mkEvent(uuid(102), 'character.created', createdPayload('Fresh')),
    ]);
    const { blob } = await writer.export(streamId);
    // characterId unknown locally at import time — the 'created' path, which the sync-mode guard
    // never checks (see `HeroImportSyncedStreamError`'s own doc: only the MERGE branch does).
    await eventsRepository.removeStream(streamId);
    await charactersRepository.remove(streamId);

    characterStore.enterSyncMode(streamId);

    const result = await reader.import(bundleFile(blob));
    expect(result.mode).toBe('created');
  });
});

describe('HeroReaderService when this tab is not the leader', () => {
  beforeEach(async () => {
    configure({ leader: false });
    await clearDb(TestBed.inject(HkDb));
  });

  afterEach(() => {
    TestBed.inject(HkDb).close();
  });

  it('refuses to import — the not-leader tab must never write character data', async () => {
    const reader = TestBed.inject(HeroReaderService);
    const file = new File([new Uint8Array()], 'x.hero');

    await expect(reader.import(file)).rejects.toBeInstanceOf(CharacterStoreNotLeaderError);
  });
});
