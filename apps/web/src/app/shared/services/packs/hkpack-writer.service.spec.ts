import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TestBed } from '@angular/core/testing';
import { parsePack, type Pack } from '@hk/protocol';
import { unzipSync, strFromU8 } from 'fflate';
import { signal } from '@angular/core';
import { PACK_ID, PACK_VERSION } from '@hk/content/version';
import { PackStore } from '@shared/stores/pack.store';
import { BlobsRepository } from '../storage/blobs.repository';
import { HkpackReader } from './hkpack-reader.service';
import { canonicalJson } from './canonical-json';
import { HkpackAssetsMissingError, HkpackWriter } from './hkpack-writer.service';

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, '..', '..', '..', '..', 'testing', 'fixtures', 'packs');
const parsed = parsePack(
  JSON.parse(readFileSync(join(fixturesDir, 'sample-content.json'), 'utf8')),
);
if (!parsed.ok) throw new Error('sample pack fixture no longer parses');
const pack: Pack = parsed.pack;
const iconBytes = new Uint8Array(readFileSync(join(fixturesDir, 'sample-icon.webp')));

function configure(blobs: Map<string, Uint8Array>): void {
  TestBed.configureTestingModule({
    providers: [
      {
        provide: BlobsRepository,
        useValue: {
          get: (hash: string) =>
            Promise.resolve(blobs.has(hash) ? { hash, bytes: blobs.get(hash) } : undefined),
        },
      },
    ],
  });
}

describe('HkpackWriter', () => {
  it('writes the canonical pack.json and one assets/<hex> entry per declared asset', async () => {
    const blobs = new Map(pack.assets.map((asset) => [asset.hash, iconBytes] as const));
    configure(blobs);
    const { blob, fileName } = await TestBed.inject(HkpackWriter).export(pack);

    expect(fileName).toBe(`${pack.id}-${pack.version}.hkpack`);
    const entries = unzipSync(new Uint8Array(await blob.arrayBuffer()));
    expect(strFromU8(entries['pack.json'])).toBe(canonicalJson(pack));
    const assetEntries = Object.keys(entries).filter((name) => name.startsWith('assets/'));
    expect(assetEntries.sort()).toEqual(
      pack.assets.map((asset) => `assets/${asset.hash.slice('sha256:'.length)}`).sort(),
    );
    expect(entries[assetEntries[0]]).toEqual(iconBytes);
  });

  it('refuses to build an archive the reader would reject when an image blob is missing', async () => {
    expect(pack.assets.length).toBeGreaterThan(0);
    configure(new Map());
    await expect(TestBed.inject(HkpackWriter).export(pack)).rejects.toBeInstanceOf(
      HkpackAssetsMissingError,
    );
  });

  it('round trip: what it writes is accepted by the HkpackReader with the same content', async () => {
    const core = parsePack(
      JSON.parse(
        readFileSync(
          join(
            here,
            '..',
            '..',
            '..',
            '..',
            '..',
            '..',
            '..',
            'packages/content/dist/packs',
            PACK_ID,
            PACK_VERSION,
            'pack.json',
          ),
          'utf8',
        ),
      ),
    );
    if (!core.ok) throw new Error('core pack fixture no longer parses');
    const blobs = new Map(pack.assets.map((asset) => [asset.hash, iconBytes] as const));
    configure(blobs);
    TestBed.overrideProvider(PackStore, {
      useValue: {
        corePack: signal(core.pack),
        installedContent: signal<Pack[]>([]),
        translationPacks: signal<Pack[]>([]),
      },
    });
    const { blob, fileName } = await TestBed.inject(HkpackWriter).export(pack);
    const file = new File([blob], fileName);

    const preview = await TestBed.inject(HkpackReader).read(file);
    expect(preview.pack).toEqual(pack);
    expect(preview.alreadyInstalled).toBe(false);
    expect(preview.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect([...preview.assets.keys()].sort()).toEqual(pack.assets.map((a) => a.hash).sort());
    expect(preview.canonicalJson).toBe(canonicalJson(pack));
  });
});
