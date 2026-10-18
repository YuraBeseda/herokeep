import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TestBed } from '@angular/core/testing';
import { validatePack } from '@hk/engine';
import { PACK_ID, PACK_VERSION } from '@hk/content/version';
import { HKPACK_LIMITS, PACK_LIMITS, parsePack, type Pack } from '@hk/protocol';
import { strToU8, zipSync } from 'fflate';
import { ToastService } from '@shared/components/toast/toast.service';
import { PackLoader } from '@shared/services/engine/pack-loader';
import { sha256Hex } from '@shared/services/images/image-pipeline.service';
import { HkDb } from '@shared/services/storage/dexie.db';
import { PacksRepository } from '@shared/services/storage/packs.repository';
import { PackStore } from '@shared/stores/pack.store';
import { HkpackReader } from './hkpack-reader.service';
import {
  PackImportAssetHashMismatchError,
  PackImportAssetMimeMismatchError,
  PackImportAssetMissingError,
  PackImportAssetTooLargeError,
  PackImportBadSchemaError,
  PackImportBadZipError,
  PackImportConflictError,
  PackImportInvalidError,
  PackImportMissingPackJsonError,
  PackImportTooLargeError,
} from './pack-import.errors';

// Same fixture-loading approach as `hero-reader.service.spec.ts`: the `pretest` script builds the
// real core pack before this file runs.
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..', '..', '..', '..', '..');
const fixturesDir = join(repoRoot, 'apps/web/src/testing/fixtures/packs');

function readPack(path: string): Pack {
  const result = parsePack(JSON.parse(readFileSync(path, 'utf8')));
  if (!result.ok) throw new Error(`fixture pack at ${path} failed validation`);
  return result.pack;
}

const corePack = readPack(
  join(repoRoot, 'packages/content/dist/packs', PACK_ID, PACK_VERSION, 'pack.json'),
);
const sampleJson = readFileSync(join(fixturesDir, 'sample-content.json'), 'utf8');
const iconBytes = new Uint8Array(readFileSync(join(fixturesDir, 'sample-icon.webp')));
const ICON_HASH = 'sha256:86be52bdb7547413cafb3ed175a806a798c65de98b40849e0b974c47d187de65';
const ICON_ENTRY = `assets/${ICON_HASH.slice('sha256:'.length)}`;

/** A fresh mutable copy of the sample pack JSON (raw, pre-parse). */
function sample(): Record<string, unknown> & { entities: Record<string, unknown>[] } {
  return JSON.parse(sampleJson) as Record<string, unknown> & {
    entities: Record<string, unknown>[];
  };
}

/** The sample with no assets (and no icon referencing one) — importable as a bare pack.json. */
function sampleWithoutAssets(): Record<string, unknown> {
  const raw = sample();
  raw['assets'] = [];
  delete raw.entities[0]['icon'];
  return raw;
}

function hkpack(
  packJson: unknown,
  assets: Record<string, Uint8Array> = { [ICON_ENTRY]: iconBytes },
): File {
  const files: Record<string, Uint8Array> = { ...assets };
  if (packJson !== undefined) files['pack.json'] = strToU8(JSON.stringify(packJson));
  return new File([zipSync(files)], 'sample-content-1.0.0.hkpack', { type: 'application/zip' });
}

function jsonFile(packJson: unknown, name = 'pack.json'): File {
  return new File([JSON.stringify(packJson)], name, { type: 'application/json' });
}

function withFakeSize(file: File, size: number): File {
  Object.defineProperty(file, 'size', { value: size });
  return file;
}

async function clearDb(db: HkDb): Promise<void> {
  await Promise.all([db.packs.clear(), db.blobs.clear()]);
}

async function setup(): Promise<{ reader: HkpackReader; store: PackStore }> {
  TestBed.configureTestingModule({
    providers: [
      { provide: PackLoader, useValue: { loadCore: () => Promise.resolve(corePack) } },
      { provide: ToastService, useValue: { show: vi.fn() } },
    ],
  });
  await clearDb(TestBed.inject(HkDb));
  const store = TestBed.inject(PackStore);
  await store.init();
  return { reader: TestBed.inject(HkpackReader), store };
}

/** Seeds an installed copy of the sample pack the way a later app start sees it: a stored row,
 * then `PackStore.init()` re-reading the repository. */
async function installSample(store: PackStore): Promise<void> {
  await TestBed.inject(PacksRepository).putPack(readPack(join(fixturesDir, 'sample-content.json')));
  await store.init();
}

describe('sample-content fixture', () => {
  it('parses and validates against the core pack with no errors', () => {
    const pack = readPack(join(fixturesDir, 'sample-content.json'));
    const errors = validatePack(pack, [corePack]).filter((d) => d.severity === 'error');
    expect(errors).toEqual([]);
    expect(pack.system).toBe(corePack.system);
  });

  it('declares the real sha256 and size of the sibling icon file', async () => {
    const pack = readPack(join(fixturesDir, 'sample-content.json'));
    expect(pack.assets).toHaveLength(1);
    expect(await sha256Hex(iconBytes)).toBe(pack.assets[0].hash);
    expect(pack.assets[0].size).toBe(iconBytes.byteLength);
  });
});

describe('HkpackReader.read', () => {
  it('previews a valid .hkpack: summary, assets, no storage writes', async () => {
    const { reader } = await setup();

    const preview = await reader.read(hkpack(sample()));

    expect(preview.pack.id).toBe('sample-content');
    expect(preview.alreadyInstalled).toBe(false);
    expect(preview.summary).toEqual({
      entityCounts: { item: 1, spell: 1, feat: 1, species: 1 },
      overrides: [],
      assetCount: 1,
      assetBytes: iconBytes.byteLength,
      dependencies: [{ id: 'srd-5e-2024', range: '^0.1.0' }],
    });
    expect(preview.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    const asset = preview.assets.get(ICON_HASH);
    expect(asset?.kind).toBe('icon');
    expect(asset?.mime).toBe('image/webp');
    expect(asset?.bytes).toEqual(iconBytes);
    expect(JSON.parse(preview.canonicalJson)).toEqual(preview.pack);
    expect(await TestBed.inject(PacksRepository).getAll()).toEqual([]);
    expect(await TestBed.inject(HkDb).blobs.count()).toBe(0);
  });

  it('imports a bare pack.json (no assets) through the same pipeline', async () => {
    const { reader } = await setup();

    const preview = await reader.read(jsonFile(sampleWithoutAssets(), 'sample-content.json'));

    expect(preview.pack.id).toBe('sample-content');
    expect(preview.summary.assetCount).toBe(0);
    expect(preview.assets.size).toBe(0);
  });

  it('refuses a bare pack.json that declares assets (it cannot carry them)', async () => {
    const { reader } = await setup();

    await expect(reader.read(jsonFile(sample()))).rejects.toBeInstanceOf(
      PackImportAssetMissingError,
    );
  });

  it('refuses a zip over HKPACK_LIMITS.maxZipBytes before reading it', async () => {
    const { reader } = await setup();
    const file = withFakeSize(hkpack(sample()), HKPACK_LIMITS.maxZipBytes + 1);

    const error = await reader.read(file).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(PackImportTooLargeError);
    expect((error as PackImportTooLargeError).detail).toBe('zip-bytes');
    expect((error as PackImportTooLargeError).code).toBe('packs.import-failed-too-large');
  });

  it('refuses a bare pack.json over PACK_LIMITS.maxBytes', async () => {
    const { reader } = await setup();
    const file = withFakeSize(jsonFile(sampleWithoutAssets()), PACK_LIMITS.maxBytes + 1);

    const error = await reader.read(file).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(PackImportTooLargeError);
    expect((error as PackImportTooLargeError).detail).toBe('pack-json-bytes');
  });

  it(`refuses a zip with more than ${HKPACK_LIMITS.maxEntries} entries`, async () => {
    const { reader } = await setup();
    const assets: Record<string, Uint8Array> = {};
    for (let i = 0; i < HKPACK_LIMITS.maxEntries; i++) assets[`assets/x${i}`] = new Uint8Array(1);

    const error = await reader.read(hkpack(sample(), assets)).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(PackImportTooLargeError);
    expect((error as PackImportTooLargeError).detail).toBe('entries');
  });

  it('refuses a zip whose asset entries total more than maxAssetBytesTotal', async () => {
    const { reader } = await setup();
    const chunk = new Uint8Array(400 * 1024);
    const assets: Record<string, Uint8Array> = {};
    const count = Math.floor(HKPACK_LIMITS.maxAssetBytesTotal / chunk.byteLength) + 1;
    for (let i = 0; i < count; i++) assets[`assets/${i.toString(16).padStart(64, '0')}`] = chunk;

    const error = await reader.read(hkpack(sample(), assets)).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(PackImportTooLargeError);
    expect((error as PackImportTooLargeError).detail).toBe('asset-bytes-total');
  });

  it('refuses corrupt bytes as a bad zip', async () => {
    const { reader } = await setup();
    const file = new File([new Uint8Array([1, 2, 3, 4, 5])], 'broken.hkpack');

    const error = await reader.read(file).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(PackImportBadZipError);
    expect((error as PackImportBadZipError).code).toBe('packs.import-failed-bad-zip');
  });

  it('refuses a zip without pack.json', async () => {
    const { reader } = await setup();

    await expect(reader.read(hkpack(undefined))).rejects.toBeInstanceOf(
      PackImportMissingPackJsonError,
    );
  });

  it('refuses a pack.json that fails the strict schema (unknown top-level key), with issues', async () => {
    const { reader } = await setup();

    const error = await reader.read(hkpack({ ...sample(), sneaky: true })).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(PackImportBadSchemaError);
    expect((error as PackImportBadSchemaError).code).toBe('packs.import-failed-bad-schema');
    expect((error as PackImportBadSchemaError).issues.length).toBeGreaterThan(0);
  });

  it('refuses pack.json that is not JSON as a schema failure', async () => {
    const { reader } = await setup();
    const file = new File([zipSync({ 'pack.json': strToU8('{ nope') })], 'x.hkpack');

    await expect(reader.read(file)).rejects.toBeInstanceOf(PackImportBadSchemaError);
  });

  it('refuses a non-content pack kind as a schema failure', async () => {
    const { reader } = await setup();
    const translation = {
      format: 1,
      id: 'sample-translation',
      version: '1.0.0',
      kind: 'translation',
      name: 'X',
      locale: 'ru',
      translates: { id: 'srd-5e-2024', range: '^0.1.0' },
      strings: {},
    };

    await expect(reader.read(jsonFile(translation))).rejects.toBeInstanceOf(
      PackImportBadSchemaError,
    );
  });

  it('refuses a dangling reference as invalid, carrying the error diagnostics', async () => {
    const { reader } = await setup();
    const raw = sample();
    raw.entities[2]['grants'] = [{ feature: 'sample-content:feature/missing' }];

    const error = await reader.read(hkpack(raw)).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(PackImportInvalidError);
    expect((error as PackImportInvalidError).code).toBe('packs.import-failed-invalid');
    const codes = (error as PackImportInvalidError).diagnostics.map((d) => d.code);
    expect(codes).toContain('ref.missing');
    expect((error as PackImportInvalidError).diagnostics.every((d) => d.severity === 'error')).toBe(
      true,
    );
  });

  it('refuses an asset listed in pack.json but absent from the zip', async () => {
    const { reader } = await setup();

    const error = await reader.read(hkpack(sample(), {})).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(PackImportAssetMissingError);
    expect((error as PackImportAssetMissingError).hash).toBe(ICON_HASH);
  });

  it('refuses asset bytes larger than the declared size', async () => {
    const { reader } = await setup();
    const raw = sample();
    (raw['assets'] as { size: number }[])[0].size = 10;

    await expect(reader.read(hkpack(raw))).rejects.toBeInstanceOf(PackImportAssetTooLargeError);
  });

  it('refuses an asset entry over the AssetSchema per-asset cap', async () => {
    const { reader } = await setup();
    const big = new Uint8Array(400 * 1024 + 1);
    big.set(iconBytes);

    await expect(reader.read(hkpack(sample(), { [ICON_ENTRY]: big }))).rejects.toBeInstanceOf(
      PackImportAssetTooLargeError,
    );
  });

  it('refuses asset bytes that are not the declared image format', async () => {
    const { reader } = await setup();
    const raw = sample();
    (raw['assets'] as { mime: string }[])[0].mime = 'image/png';

    await expect(reader.read(hkpack(raw))).rejects.toBeInstanceOf(PackImportAssetMimeMismatchError);
  });

  it('refuses asset bytes whose sha256 does not match the declared hash', async () => {
    const { reader } = await setup();
    const tampered = iconBytes.slice();
    tampered[tampered.length - 1] = tampered[tampered.length - 1] ^ 0xff;

    const error = await reader
      .read(hkpack(sample(), { [ICON_ENTRY]: tampered }))
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(PackImportAssetHashMismatchError);
    expect((error as PackImportAssetHashMismatchError).code).toBe(
      'packs.import-failed-asset-hash-mismatch',
    );
  });

  it('refuses the same id@version installed with a different canonical JSON', async () => {
    const { reader, store } = await setup();
    await installSample(store);
    const changed = sample();
    changed['name'] = 'Sample content (edited)';

    const error = await reader.read(hkpack(changed)).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(PackImportConflictError);
    expect((error as PackImportConflictError).code).toBe('packs.import-failed-conflict');
  });

  it('refuses a content pack that reuses the core pack id', async () => {
    const { reader } = await setup();
    const raw = sampleWithoutAssets();
    raw['id'] = corePack.id;
    raw['version'] = '9.0.0';
    raw['dependencies'] = [];
    raw['entities'] = [];

    await expect(reader.read(jsonFile(raw))).rejects.toBeInstanceOf(PackImportConflictError);
  });

  it('flags an identical re-import as alreadyInstalled (key order does not matter)', async () => {
    const { reader, store } = await setup();
    await installSample(store);
    const reordered = Object.fromEntries(Object.entries(sample()).reverse());

    const preview = await reader.read(hkpack(reordered));

    expect(preview.alreadyInstalled).toBe(true);
  });
});

describe('pack import error codes', () => {
  it('every refusal code has an en/ru/uk string in the packs scope', () => {
    const errors = [
      new PackImportTooLargeError('entries', 2, 1),
      new PackImportBadZipError(),
      new PackImportMissingPackJsonError(),
      new PackImportBadSchemaError([]),
      new PackImportInvalidError([]),
      new PackImportAssetMissingError(ICON_HASH),
      new PackImportAssetTooLargeError(ICON_HASH, 2, 1),
      new PackImportAssetMimeMismatchError(ICON_HASH, 'image/png'),
      new PackImportAssetHashMismatchError(ICON_HASH),
      new PackImportConflictError('x@1.0.0'),
    ];
    for (const lang of ['en', 'ru', 'uk']) {
      const strings = JSON.parse(
        readFileSync(join(repoRoot, `apps/web/src/assets/i18n/packs/${lang}.json`), 'utf8'),
      ) as Record<string, string>;
      for (const error of errors) {
        expect(error.code.startsWith('packs.')).toBe(true);
        expect(strings[error.code.slice('packs.'.length)], `${lang}: ${error.code}`).toBeTruthy();
      }
      expect(strings['import-success'], `${lang}: packs.import-success`).toBeTruthy();
    }
  });
});
