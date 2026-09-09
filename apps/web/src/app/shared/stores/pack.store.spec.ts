import { TestBed } from '@angular/core/testing';
import type { Pack } from '@hk/protocol';
import { ToastService } from '@shared/components/toast/toast.service';
import { PackLoader } from '@shared/services/engine/pack-loader';
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
});
