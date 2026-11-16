import { TestBed } from '@angular/core/testing';
import { ToastService } from '@shared/components/toast/toast.service';
import { zipFiles } from '@shared/services/export/zip-files';
import {
  HeroImportBadZipError,
  HeroImportSyncedStreamError,
  HeroReaderService,
  type ImportResult,
} from '@shared/services/export/hero-reader.service';
import { HeroImportFlow, type ImportAllResult } from './hero-import.flow';

const enc = (text: string): Uint8Array => new TextEncoder().encode(text);
const bytesOf = async (blob: Blob): Promise<Uint8Array<ArrayBuffer>> =>
  new Uint8Array(await blob.arrayBuffer());

/** An archive shaped like Settings' export-all output: one stand-in `.hero` per hero. */
async function archive(files: Record<string, Uint8Array>): Promise<File> {
  return new File([await bytesOf(await zipFiles(files))], 'herokeep-heroes.zip');
}

const outcome = (name: string, mode: ImportResult['mode']): ImportResult => ({
  characterId: name,
  name,
  mode,
  imported: 1,
  skippedDuplicates: 0,
  warnings: [],
});

function setup(importImpl: (file: File) => Promise<ImportResult>) {
  const importFn = vi.fn(importImpl);
  const show = vi.fn();
  TestBed.configureTestingModule({
    providers: [
      { provide: HeroReaderService, useValue: { import: importFn } },
      { provide: ToastService, useValue: { show } },
    ],
  });
  return { flow: TestBed.inject(HeroImportFlow), importFn, show };
}

const byName = (file: File) => file.name.replace('.hero', '');

describe('HeroImportFlow export-all zip', () => {
  const three = { 'a.hero': enc('a'), 'b.hero': enc('b'), 'c.hero': enc('c') };

  it('imports every hero of the archive', async () => {
    const { flow, importFn, show } = setup((f) => Promise.resolve(outcome(byName(f), 'created')));
    const result = (await flow.importFile(await archive(three))) as ImportAllResult;
    expect(result.imported).toEqual(['a', 'b', 'c']);
    expect(result.merged).toEqual([]);
    expect(importFn).toHaveBeenCalledTimes(3);
    expect(show).toHaveBeenCalledWith('characters.list.toast.import-all-summary', {
      imported: 3,
      merged: 0,
      skipped: 0,
    });
  });

  it('reports a hero already on the device as merged', async () => {
    const { flow } = setup((f) =>
      Promise.resolve(outcome(byName(f), byName(f) === 'b' ? 'merged' : 'created')),
    );
    const result = (await flow.importFile(await archive(three))) as ImportAllResult;
    expect(result.imported).toEqual(['a', 'c']);
    expect(result.merged).toEqual(['b']);
  });

  it('skips a synced hero and still imports the others', async () => {
    const { flow } = setup((f) =>
      byName(f) === 'b'
        ? Promise.reject(new HeroImportSyncedStreamError())
        : Promise.resolve(outcome(byName(f), 'created')),
    );
    const result = (await flow.importFile(await archive(three))) as ImportAllResult;
    expect(result.imported).toEqual(['a', 'c']);
    expect(result.skipped).toEqual([{ name: 'b.hero', reason: 'synced' }]);
  });

  it('skips an invalid hero without throwing', async () => {
    const { flow } = setup((f) =>
      byName(f) === 'a'
        ? Promise.reject(new HeroImportBadZipError())
        : Promise.resolve(outcome(byName(f), 'created')),
    );
    const result = (await flow.importFile(await archive(three))) as ImportAllResult;
    expect(result.skipped).toEqual([{ name: 'a.hero', reason: 'invalid' }]);
    expect(result.imported).toEqual(['b', 'c']);
  });

  it('inflates one entry at a time: a corrupt entry is skipped after the earlier ones imported', async () => {
    const { zipSync } = await import('fflate');
    const body = (c: string) => enc(c.repeat(300));
    const bytes = zipSync(
      { 'a.hero': body('a'), 'b.hero': body('b'), 'c.hero': body('c') },
      { level: 9 },
    );
    // First deflate byte of b's data → BTYPE=11 (invalid block): only b's inflate can fail.
    const nameAt = bytes.findIndex(
      (_, i) => bytes[i] === 0x62 && bytes[i + 1] === 0x2e && bytes[i + 2] === 0x68,
    );
    const extraLen = bytes[nameAt - 2] | (bytes[nameAt - 1] << 8);
    bytes[nameAt + 'b.hero'.length + extraLen] = 0xff;
    const { flow, importFn } = setup((f) => Promise.resolve(outcome(byName(f), 'created')));

    const result = (await flow.importFile(new File([bytes], 'all.zip'))) as ImportAllResult;

    expect(result.imported).toEqual(['a', 'c']);
    expect(result.skipped).toEqual([{ name: 'b.hero', reason: 'invalid' }]);
    expect(importFn).toHaveBeenCalledTimes(2);
  });

  it('refuses a zip with neither a manifest nor a .hero entry', async () => {
    const { flow, importFn, show } = setup(() => Promise.reject(new Error('unused')));
    const result = await flow.importFile(await archive({ 'a.png': enc('x'), 'b.png': enc('y') }));
    expect(result).toBeUndefined();
    expect(importFn).not.toHaveBeenCalled();
    expect(show).toHaveBeenCalledWith('characters.list.toast.import-failed-not-hero-or-export');
  });

  it('refuses an over-cap entry from the directory, before inflating it', async () => {
    const { flow, importFn, show } = setup(() => Promise.reject(new Error('unused')));
    // 65 MiB of zeros deflates to ~65 KiB: only the declared size gives it away.
    const big = new Uint8Array(65 * 1024 * 1024);
    const result = await flow.importFile(await archive({ 'big.hero': big }));
    expect(result).toBeUndefined();
    expect(importFn).not.toHaveBeenCalled();
    expect(show).toHaveBeenCalledWith('characters.list.toast.import-failed-bad-zip');
  });

  it('hands a single .hero (manifest at the root) to the reader unchanged', async () => {
    const { flow, importFn, show } = setup(() => Promise.resolve(outcome('solo', 'created')));
    const file = await archive({ 'manifest.json': enc('{}'), 'events.json': enc('[]') });
    const result = await flow.importFile(file);
    expect(importFn).toHaveBeenCalledExactlyOnceWith(file);
    expect(result).toMatchObject({ mode: 'created' });
    expect(show).toHaveBeenCalledWith(
      'characters.list.toast.import-created',
      expect.objectContaining({ name: 'solo' }),
    );
  });
  it('accepts a single .hero with more than 500 entries (the reader allows 2001)', async () => {
    const { flow, importFn } = setup(() => Promise.resolve(outcome('solo', 'created')));
    const files: Record<string, Uint8Array> = { 'manifest.json': enc('{}') };
    for (let i = 0; i < 600; i++) files[`images/${i}.png`] = enc('x');
    const file = await archive(files);
    await flow.importFile(file);
    expect(importFn).toHaveBeenCalledExactlyOnceWith(file);
  });
});
