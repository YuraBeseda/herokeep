import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TestBed } from '@angular/core/testing';
import { PACK_ID, PACK_VERSION } from '@hk/content/version';
import { HKPACK_LIMITS, parsePack, type Pack } from '@hk/protocol';
import { strToU8, zipSync } from 'fflate';
import { ToastService } from '@shared/components/toast/toast.service';
import { PackLoader } from '@shared/services/engine/pack-loader';
import { sha256Hex } from '@shared/services/images/image-pipeline.service';
import { HkpackReader } from '@shared/services/packs/hkpack-reader.service';
import { PackImportError } from '@shared/services/packs/pack-import.errors';
import { BlobsRepository } from '@shared/services/storage/blobs.repository';
import { HkDb } from '@shared/services/storage/dexie.db';
import { PacksRepository } from '@shared/services/storage/packs.repository';
import { PackStore } from './pack.store';

function corePack(overrides: Partial<Pack> = {}): Pack {
  return {
    format: 1,
    id: 'srd-5e-2024',
    version: '0.1.0',
    kind: 'core',
    name: 'SRD core',
    authors: [],
    dependencies: [],
    locale: 'en',
    entities: [],
    overrides: [],
    assets: [],
    i18n: {},
    ...overrides,
  };
}

function translationPack(overrides: Partial<Pack> = {}): Pack {
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
    strings: {},
    ...overrides,
  };
}

/** Configures the TestBed with stubbed I/O collaborators; returns the store and spies. */
function configure(options: { loadCore?: () => Promise<Pack>; getAll?: () => Promise<Pack[]> }) {
  const show = vi.fn();
  TestBed.configureTestingModule({
    providers: [
      {
        provide: PackLoader,
        useValue: { loadCore: options.loadCore ?? (() => Promise.resolve(corePack())) },
      },
      {
        provide: PacksRepository,
        useValue: { getAll: options.getAll ?? (() => Promise.resolve([])) },
      },
      { provide: ToastService, useValue: { show } },
    ],
  });
  return { store: TestBed.inject(PackStore), show };
}

describe('PackStore.init', () => {
  it('loads the core pack and valid persisted translations', async () => {
    const { store } = configure({ getAll: () => Promise.resolve([translationPack()]) });

    await store.init();

    expect(store.ready()).toBe(true);
    expect(store.coreLoadFailed()).toBe(false);
    expect(store.corePack()?.id).toBe('srd-5e-2024');
    expect(store.translationPacks()).toHaveLength(1);
  });

  it('survives a translation-load (Dexie) failure: empty translations, still ready, non-fatal notice', async () => {
    const { store, show } = configure({
      getAll: () => Promise.reject(new Error('Dexie open failed')),
    });

    await expect(store.init()).resolves.toBeUndefined();

    expect(store.ready()).toBe(true);
    expect(store.corePack()).toBeDefined();
    expect(store.translationPacks()).toEqual([]);
    expect(show).toHaveBeenCalledWith('settings.packs.translations-load-failed');
  });

  it('flags a core-pack load failure instead of rejecting, and never becomes ready', async () => {
    const { store } = configure({ loadCore: () => Promise.reject(new Error('fetch failed')) });

    await expect(store.init()).resolves.toBeUndefined();

    expect(store.coreLoadFailed()).toBe(true);
    expect(store.ready()).toBe(false);
    expect(store.corePack()).toBeUndefined();
  });

  it('drops a persisted translation that no longer validates against the loaded core pack', async () => {
    // A malformed string key (no `type/slug` shape) can never resolve to an entity, so
    // `validatePack` always reports it as `i18n.unknownKey` — a deterministic stand-in for "a
    // service-worker update shipped a core pack this stored translation no longer matches".
    const stale = translationPack({ strings: { 'not-a-valid-entity-key': { name: 'x' } } });
    const { store } = configure({ getAll: () => Promise.resolve([stale]) });

    await store.init();

    expect(store.ready()).toBe(true);
    expect(store.translationPacks()).toEqual([]);
  });

  it('keeps a valid persisted translation alongside a dropped stale one', async () => {
    const valid = translationPack();
    const stale = translationPack({
      id: 'srd-5e-2024-uk-sample',
      locale: 'uk',
      strings: { 'not-a-valid-entity-key': { name: 'x' } },
    });
    const { store } = configure({ getAll: () => Promise.resolve([valid, stale]) });

    await store.init();

    expect(store.translationPacks()).toEqual([valid]);
  });

  it('drops a structurally corrupted persisted row instead of failing init', async () => {
    // A row whose json is not Pack-shaped at all — validatePack would throw on it.
    const brokenRow = { kind: 'translation' };
    const validRuTranslation = translationPack();
    const { store } = configure({
      getAll: () => Promise.resolve([brokenRow as unknown as Pack, validRuTranslation]),
    });

    await store.init();

    expect(store.ready()).toBe(true);
    expect(store.translationPacks().map((p) => p.id)).toEqual([validRuTranslation.id]);
  });
});

// --- content packs (plan 15 Task 2) ---------------------------------------------------------------
// Real core pack + real Dexie (fake-indexeddb) + the real reader, same fixture loading as
// `hkpack-reader.service.spec.ts`.
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..', '..', '..', '..');
const fixturesDir = join(repoRoot, 'apps/web/src/testing/fixtures/packs');

function readPack(path: string): Pack {
  const result = parsePack(JSON.parse(readFileSync(path, 'utf8')));
  if (!result.ok) throw new Error(`fixture pack at ${path} failed validation`);
  return result.pack;
}

const realCore = readPack(
  join(repoRoot, 'packages/content/dist/packs', PACK_ID, PACK_VERSION, 'pack.json'),
);
const sampleJson = readFileSync(join(fixturesDir, 'sample-content.json'), 'utf8');
const iconBytes = new Uint8Array(readFileSync(join(fixturesDir, 'sample-icon.webp')));
const ICON_HASH = 'sha256:86be52bdb7547413cafb3ed175a806a798c65de98b40849e0b974c47d187de65';
const ICON_ENTRY = `assets/${ICON_HASH.slice('sha256:'.length)}`;

function sample(): Record<string, unknown> & { entities: Record<string, unknown>[] } {
  return JSON.parse(sampleJson) as Record<string, unknown> & {
    entities: Record<string, unknown>[];
  };
}

/** A second content pack (no entities) that ships the SAME icon asset as the sample. */
function iconOnlyPack(): Record<string, unknown> {
  return {
    format: 1,
    id: 'sample-icons',
    version: '1.0.0',
    kind: 'content',
    system: realCore.system,
    name: 'Sample icons',
    dependencies: [{ id: 'srd-5e-2024', range: '^0.1.0' }],
    assets: sample()['assets'],
  };
}

function hkpack(
  packJson: unknown,
  assets: Record<string, Uint8Array> = { [ICON_ENTRY]: iconBytes },
): File {
  const files: Record<string, Uint8Array> = { ...assets };
  if (packJson !== undefined) files['pack.json'] = strToU8(JSON.stringify(packJson));
  return new File([zipSync(files)], 'pack.hkpack', { type: 'application/zip' });
}

async function configureReal(): Promise<{ store: PackStore; reader: HkpackReader; db: HkDb }> {
  TestBed.configureTestingModule({
    providers: [
      { provide: PackLoader, useValue: { loadCore: () => Promise.resolve(realCore) } },
      { provide: ToastService, useValue: { show: vi.fn() } },
    ],
  });
  const db = TestBed.inject(HkDb);
  await Promise.all([db.packs.clear(), db.blobs.clear()]);
  const store = TestBed.inject(PackStore);
  await store.init();
  return { store, reader: TestBed.inject(HkpackReader), db };
}

describe('PackStore content packs', () => {
  it('init() keeps a persisted content pack and lists it in installed() and packs()', async () => {
    const { store, db } = await configureReal();
    await TestBed.inject(PacksRepository).putPack(
      readPack(join(fixturesDir, 'sample-content.json')),
    );
    expect(await db.packs.count()).toBe(1);

    await store.init();

    expect(store.installedContent().map((p) => p.id)).toEqual(['sample-content']);
    expect(store.packs().map((p) => p.id)).toEqual(['srd-5e-2024', 'sample-content']);
    expect(store.installed()).toEqual([
      { id: 'srd-5e-2024', version: '0.1.0' },
      { id: 'sample-content', version: '1.0.0' },
    ]);
  });

  it('init() drops a persisted content pack that now has validation errors', async () => {
    const { store } = await configureReal();
    const broken = readPack(join(fixturesDir, 'sample-content.json'));
    broken.entities[2].grants = [{ feature: 'sample-content:feature/missing' }];
    await TestBed.inject(PacksRepository).putPack(broken);

    await store.init();

    expect(store.installedContent()).toEqual([]);
  });

  it('importContent() writes the pack row, then each asset as an origin "pack" blob', async () => {
    const { store, reader } = await configureReal();
    const preview = await reader.read(hkpack(sample()));

    await store.importContent(preview);

    const stored = await TestBed.inject(PacksRepository).getAll();
    expect(stored.map((p) => `${p.id}@${p.version}`)).toEqual(['sample-content@1.0.0']);
    const blob = await TestBed.inject(BlobsRepository).get(ICON_HASH);
    expect(blob).toMatchObject({
      hash: ICON_HASH,
      mime: 'image/webp',
      kind: 'icon',
      origin: 'pack',
      pinned: false,
      size: iconBytes.byteLength,
    });
    expect(store.installedContent().map((p) => p.id)).toEqual(['sample-content']);
  });

  it('importContent() of an alreadyInstalled preview is a no-op', async () => {
    const { store, reader, db } = await configureReal();
    await store.importContent(await reader.read(hkpack(sample())));
    const again = await reader.read(hkpack(sample()));
    expect(again.alreadyInstalled).toBe(true);

    await store.importContent(again);

    expect(await db.packs.count()).toBe(1);
    expect(await db.blobs.count()).toBe(1);
    expect(store.installedContent()).toHaveLength(1);
  });

  it('importContent() writes no blob when the pack row write fails', async () => {
    const { store, reader, db } = await configureReal();
    const preview = await reader.read(hkpack(sample()));
    vi.spyOn(TestBed.inject(PacksRepository), 'putPack').mockRejectedValue(new Error('quota'));

    await expect(store.importContent(preview)).rejects.toThrow('quota');

    expect(await db.blobs.count()).toBe(0);
    expect(store.installedContent()).toEqual([]);
  });

  it('importContent() rolls the pack row back when an asset write fails', async () => {
    const { store, reader, db } = await configureReal();
    const preview = await reader.read(hkpack(sample()));
    vi.spyOn(TestBed.inject(BlobsRepository), 'put').mockRejectedValue(new Error('quota'));

    await expect(store.importContent(preview)).rejects.toThrow('quota');

    expect(await db.packs.count()).toBe(0);
    expect(await db.blobs.count()).toBe(0);
    expect(store.installedContent()).toEqual([]);
  });

  it('importContent() removes the blobs it already created when a LATER asset write fails', async () => {
    const { store, reader, db } = await configureReal();
    // A second, distinct webp asset: same RIFF/WEBP header, one payload byte flipped.
    const secondBytes = iconBytes.slice();
    secondBytes[secondBytes.length - 1] = secondBytes[secondBytes.length - 1] ^ 0xff;
    const secondHash = await sha256Hex(secondBytes);
    const raw = sample();
    raw['assets'] = [
      ...(raw['assets'] as unknown[]),
      { hash: secondHash, kind: 'token', mime: 'image/webp', size: secondBytes.byteLength },
    ];
    const preview = await reader.read(
      hkpack(raw, {
        [ICON_ENTRY]: iconBytes,
        [`assets/${secondHash.slice('sha256:'.length)}`]: secondBytes,
      }),
    );
    expect(preview.assets.size).toBe(2);
    const blobs = TestBed.inject(BlobsRepository);
    const realPut = blobs.put.bind(blobs);
    let calls = 0;
    vi.spyOn(blobs, 'put').mockImplementation((...args: Parameters<BlobsRepository['put']>) => {
      calls++;
      return calls === 2 ? Promise.reject(new Error('quota')) : realPut(...args);
    });

    await expect(store.importContent(preview)).rejects.toThrow('quota');

    expect(calls).toBe(2);
    expect(await db.blobs.get(ICON_HASH)).toBeUndefined();
    expect(await db.blobs.count()).toBe(0);
    expect(await db.packs.count()).toBe(0);
    expect(store.installedContent()).toEqual([]);
  });

  it('removeContent() removes the pack and its orphan assets, keeping assets another pack uses', async () => {
    const { store, reader, db } = await configureReal();
    await store.importContent(await reader.read(hkpack(sample())));
    await store.importContent(await reader.read(hkpack(iconOnlyPack())));

    await store.removeContent('sample-content@1.0.0');

    expect((await TestBed.inject(PacksRepository).getAll()).map((p) => p.id)).toEqual([
      'sample-icons',
    ]);
    expect(store.installedContent().map((p) => p.id)).toEqual(['sample-icons']);
    expect(await db.blobs.get(ICON_HASH)).toBeDefined();

    await store.removeContent('sample-icons@1.0.0');

    expect(await db.packs.count()).toBe(0);
    expect(await db.blobs.count()).toBe(0);
    expect(store.installedContent()).toEqual([]);
  });

  it('removeContent() never deletes a blob that did not come from a pack', async () => {
    const { store, reader, db } = await configureReal();
    await TestBed.inject(BlobsRepository).put(ICON_HASH, 'image/webp', iconBytes, {
      kind: 'portrait',
    });
    await store.importContent(await reader.read(hkpack(sample())));

    await store.removeContent('sample-content@1.0.0');

    expect((await db.blobs.get(ICON_HASH))?.origin).toBe('upload');
  });

  // Review Focus 2: a malformed import stores NOTHING.
  it('leaves the packs and blobs tables unchanged after every refusal class', async () => {
    const { store, reader, db } = await configureReal();
    await store.importContent(await reader.read(hkpack(iconOnlyPack())));
    const packsBefore = await TestBed.inject(PacksRepository).getAll();
    const blobsBefore = await db.blobs.count();

    const oversize = hkpack(sample());
    Object.defineProperty(oversize, 'size', { value: HKPACK_LIMITS.maxZipBytes + 1 });
    const dangling = sample();
    dangling.entities[2]['grants'] = [{ feature: 'sample-content:feature/missing' }];
    const tooLarge = sample();
    (tooLarge['assets'] as { size: number }[])[0].size = 10;
    const wrongMime = sample();
    (wrongMime['assets'] as { mime: string }[])[0].mime = 'image/png';
    const tampered = iconBytes.slice();
    tampered[tampered.length - 1] = tampered[tampered.length - 1] ^ 0xff;
    const conflicting = iconOnlyPack();
    conflicting['name'] = 'Sample icons (edited)';

    const refusals: Record<string, File> = {
      'too-large': oversize,
      'bad-zip': new File([new Uint8Array([1, 2, 3])], 'broken.hkpack'),
      'missing-pack-json': hkpack(undefined),
      'bad-schema': hkpack({ ...sample(), sneaky: true }),
      invalid: hkpack(dangling),
      'asset-missing': hkpack(sample(), {}),
      'asset-too-large': hkpack(tooLarge),
      'asset-mime-mismatch': hkpack(wrongMime),
      'asset-hash-mismatch': hkpack(sample(), { [ICON_ENTRY]: tampered }),
      conflict: hkpack(conflicting),
    };
    for (const [refusal, file] of Object.entries(refusals)) {
      const error = await reader.read(file).catch((e: unknown) => e);
      expect(error, refusal).toBeInstanceOf(PackImportError);
      expect((error as PackImportError).code, refusal).toBe(`packs.import-failed-${refusal}`);
      expect(await TestBed.inject(PacksRepository).getAll(), refusal).toEqual(packsBefore);
      expect(await db.blobs.count(), refusal).toBe(blobsBefore);
    }
  });
});
