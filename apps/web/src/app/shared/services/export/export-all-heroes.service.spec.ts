import { TestBed } from '@angular/core/testing';
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

/** The first rung of the real delivery ladder: a save picker that records what it was given. */
function stubSavePicker(behaviour: (name: string) => 'save' | 'abort' = () => 'save') {
  const saved: string[] = [];
  const picker: SavePicker = (options) => {
    const name = options?.suggestedName ?? '';
    if (behaviour(name) === 'abort') {
      return Promise.reject(new DOMException('cancelled', 'AbortError'));
    }
    return Promise.resolve({
      createWritable: () =>
        Promise.resolve({
          write: () => {
            saved.push(name);
            return Promise.resolve();
          },
          close: () => Promise.resolve(),
        }),
    });
  };
  (window as unknown as { showSaveFilePicker?: SavePicker }).showSaveFilePicker = picker;
  return saved;
}

async function setup(
  rows: CharacterRow[],
  exportImpl?: (id: string) => ReturnType<HeroWriterService['export']>,
) {
  const show = vi.fn();
  const exportHero = vi.fn(
    exportImpl ??
      ((id: string) =>
        Promise.resolve({ blob: new Blob(['x']), fileName: `${id}.hero`, warnings: [] })),
  );
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

  it('exports every hero that is not archived, one bundle each, and toasts the count', async () => {
    const saved = stubSavePicker();
    const { service, exportHero, show } = await setup([
      row('char:a', { updatedAt: 3 }),
      row('char:b', { updatedAt: 2 }),
      row('char:old', { archived: true, updatedAt: 1 }),
    ]);

    await service.run('Herokeep character');

    expect(exportHero.mock.calls.map((c) => c[0])).toEqual(['char:a', 'char:b']);
    expect(saved).toEqual(['char:a.hero', 'char:b.hero']);
    expect(show).toHaveBeenCalledWith('settings.export.success', { count: 2 });
    expect(service.exporting()).toBe(false);
  });

  it('stops at the first cancelled save and toasts nothing for the rest', async () => {
    const saved = stubSavePicker((name) => (name === 'char:b.hero' ? 'abort' : 'save'));
    const { service, exportHero, show } = await setup([
      row('char:a', { updatedAt: 3 }),
      row('char:b', { updatedAt: 2 }),
      row('char:c', { updatedAt: 1 }),
    ]);

    await service.run('Herokeep character');

    expect(exportHero).toHaveBeenCalledTimes(2);
    expect(saved).toEqual(['char:a.hero']);
    expect(show).toHaveBeenCalledWith('settings.export.success', { count: 1 });
    expect(show).not.toHaveBeenCalledWith('settings.export.failure');
  });

  it('toasts the failure when a bundle cannot be built, and frees the guard', async () => {
    stubSavePicker();
    const { service, show } = await setup([row('char:a')], () =>
      Promise.reject(new Error('corrupt stream')),
    );

    await service.run('Herokeep character');

    expect(show).toHaveBeenCalledWith('settings.export.failure');
    expect(service.exporting()).toBe(false);
  });

  it('carries a writer warning to the user, per hero', async () => {
    stubSavePicker();
    const { service, show } = await setup([row('char:a')], (id) =>
      Promise.resolve({
        blob: new Blob(['x']),
        fileName: `${id}.hero`,
        warnings: [{ code: 'pack-assets-missing' as const, pack: 'sample@1.0.0' }],
      }),
    );

    await service.run('Herokeep character');

    expect(show).toHaveBeenCalledWith('settings.export.pack-assets-missing', {
      pack: 'sample@1.0.0',
    });
  });

  it('ignores a second run while one is in flight', async () => {
    stubSavePicker();
    const { service, exportHero } = await setup([row('char:a')]);

    const first = service.run('d');
    const second = service.run('d');
    await Promise.all([first, second]);

    expect(exportHero).toHaveBeenCalledTimes(1);
  });
});
