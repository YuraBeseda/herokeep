import { TestBed } from '@angular/core/testing';
import { unzipSync } from 'fflate';
import { ToastService } from '@shared/components/toast/toast.service';
import { HkDb, type CharacterRow } from '@shared/services/storage/dexie.db';
import { ExportAllHeroesService } from './export-all-heroes.service';
import { HeroWriterService } from './hero-writer.service';

function row(id: string, overrides: Partial<CharacterRow> = {}): CharacterRow {
  return { id, name: id, system: 'srd-5e-2024', archived: false, updatedAt: 1, ...overrides };
}

type SavePicker = (options?: { suggestedName?: string }) => Promise<{
  createWritable(): Promise<{ write(blob: Blob): Promise<void>; close(): Promise<void> }>;
}>;

/** The first rung of the real delivery ladder: a save picker that records every file it is given. */
function stubSavePicker(cancel = false) {
  const saved: { name: string; blob: Blob }[] = [];
  const picker: SavePicker = (options) => {
    const name = options?.suggestedName ?? '';
    if (cancel) return Promise.reject(new DOMException('cancelled', 'AbortError'));
    return Promise.resolve({
      createWritable: () =>
        Promise.resolve({
          write: (blob: Blob) => {
            saved.push({ name, blob });
            return Promise.resolve();
          },
          close: () => Promise.resolve(),
        }),
    });
  };
  (window as unknown as { showSaveFilePicker?: SavePicker }).showSaveFilePicker = picker;
  return saved;
}

const bytesOf = async (blob: Blob): Promise<Uint8Array> => new Uint8Array(await blob.arrayBuffer());

/** What the (stubbed) single-hero export builds for `id`: distinct, deterministic bytes. */
const heroBundle = (id: string): { blob: Blob; fileName: string; warnings: never[] } => ({
  blob: new Blob([`hero-bundle-bytes:${id}`], { type: 'application/zip' }),
  fileName: `${id.replace(':', '-')}.hero`,
  warnings: [],
});

async function setup(
  rows: CharacterRow[],
  exportImpl?: (id: string) => ReturnType<HeroWriterService['export']>,
) {
  const show = vi.fn();
  const exportHero = vi.fn(exportImpl ?? ((id: string) => Promise.resolve(heroBundle(id))));
  TestBed.configureTestingModule({
    providers: [
      { provide: HeroWriterService, useValue: { export: exportHero } },
      { provide: ToastService, useValue: { show } },
    ],
  });
  const db = TestBed.inject(HkDb);
  await db.characters.clear();
  await db.characters.bulkPut(rows);
  return { service: TestBed.inject(ExportAllHeroesService), exportHero, show };
}

describe('ExportAllHeroesService', () => {
  afterEach(() => {
    delete (window as unknown as { showSaveFilePicker?: SavePicker }).showSaveFilePicker;
  });

  it('writes ONE .zip from ONE save, holding every hero file byte-equal to the single-hero export', async () => {
    const saved = stubSavePicker();
    const { service, show } = await setup([
      row('char:a', { updatedAt: 3 }),
      row('char:b', { updatedAt: 2 }),
      row('char:old', { archived: true, updatedAt: 1 }),
    ]);

    await service.run('Herokeep character');

    expect(saved).toHaveLength(1);
    expect(saved[0].name).toBe('herokeep-heroes.zip');
    const entries = unzipSync(await bytesOf(saved[0].blob));
    expect(Object.keys(entries).sort()).toEqual(['char-a.hero', 'char-b.hero']);
    expect(entries['char-a.hero']).toEqual(await bytesOf(heroBundle('char:a').blob));
    expect(entries['char-b.hero']).toEqual(await bytesOf(heroBundle('char:b').blob));
    expect(show).toHaveBeenCalledWith('settings.export.success', { count: 2 });
    expect(service.exporting()).toBe(false);
  });

  it('keeps two heroes whose files share a name apart in the archive', async () => {
    const saved = stubSavePicker();
    const { service } = await setup([row('char:a'), row('char:b', { updatedAt: 0 })], (id) =>
      Promise.resolve({ ...heroBundle(id), fileName: 'Aldric.hero' }),
    );

    await service.run('d');

    const entries = unzipSync(await bytesOf(saved[0].blob));
    expect(Object.keys(entries).sort()).toEqual(['Aldric-2.hero', 'Aldric.hero']);
  });

  it('cancelling the save picker cancels the whole export: nothing is saved and no success toast', async () => {
    const saved = stubSavePicker(true);
    const { service, show } = await setup([row('char:a'), row('char:b', { updatedAt: 0 })]);

    await service.run('d');

    expect(saved).toEqual([]);
    expect(show).not.toHaveBeenCalled();
    expect(service.exporting()).toBe(false);
  });

  it('toasts the failure when a hero bundle cannot be built, and frees the guard', async () => {
    stubSavePicker();
    const { service, show } = await setup([row('char:a')], () =>
      Promise.reject(new Error('corrupt stream')),
    );

    await service.run('d');

    expect(show).toHaveBeenCalledWith('settings.export.failure');
    expect(service.exporting()).toBe(false);
  });

  it('carries a writer warning to the user', async () => {
    stubSavePicker();
    const { service, show } = await setup([row('char:a')], (id) =>
      Promise.resolve({
        ...heroBundle(id),
        warnings: [{ code: 'pack-assets-missing' as const, pack: 'sample@1.0.0' }],
      }),
    );

    await service.run('d');

    expect(show).toHaveBeenCalledWith('settings.export.pack-assets-missing', {
      pack: 'sample@1.0.0',
    });
  });

  it('ignores a second run while one is in flight', async () => {
    stubSavePicker();
    const { service, exportHero } = await setup([row('char:a')]);

    await Promise.all([service.run('d'), service.run('d')]);

    expect(exportHero).toHaveBeenCalledTimes(1);
  });
});
