import { computed, inject, Injectable, signal, type Signal } from '@angular/core';
import { validatePack, type Diagnostic } from '@hk/engine';
import type { Pack } from '@hk/protocol';
import { PackLoader } from '../services/engine/pack-loader';
import { PacksRepository } from '../services/storage/packs.repository';

function packKey(pack: Pack): string {
  return `${pack.id}@${pack.version}`;
}

/**
 * Installed packs: the core content pack (fetched from the static `/packs/**` asset, never
 * persisted — it ships with the app/service-worker cache) plus user-imported translation packs
 * (persisted in Dexie via `PacksRepository`). Call `init()` once, from the app root
 * (`provideAppInitializer`) — see `engine.facade.ts` for why.
 */
@Injectable({ providedIn: 'root' })
export class PackStore {
  private readonly packLoader = inject(PackLoader);
  private readonly packsRepository = inject(PacksRepository);

  // Properties
  private readonly coreState = signal<Pack | undefined>(undefined);
  private readonly translationsState = signal<Pack[]>([]);
  private readonly readyState = signal(false);

  readonly corePack: Signal<Pack | undefined> = this.coreState.asReadonly();
  readonly translationPacks: Signal<Pack[]> = this.translationsState.asReadonly();
  readonly ready: Signal<boolean> = this.readyState.asReadonly();
  readonly packs = computed<Pack[]>(() => {
    const core = this.coreState();
    return core ? [core, ...this.translationsState()] : [];
  });

  // I/O boundary: fetches the core pack asset and reads persisted translation packs from Dexie.
  async init(): Promise<void> {
    const [core, stored] = await Promise.all([
      this.packLoader.loadCore(),
      this.packsRepository.getAll(),
    ]);
    this.coreState.set(core);
    this.translationsState.set(stored.filter((pack) => pack.kind === 'translation'));
    this.readyState.set(true);
  }

  // I/O boundary: validates `pack` against the loaded core pack; persists and updates the
  // signal only when it is clean. Returns the diagnostics (for a toast) instead of persisting
  // when it is not.
  async importTranslation(pack: Pack): Promise<Diagnostic[] | null> {
    const core = this.coreState();
    if (!core) throw new Error('PackStore.importTranslation: call init() before importing packs');
    const diagnostics = validatePack(pack, [core]);
    if (diagnostics.length > 0) return diagnostics;
    await this.packsRepository.putPack(pack);
    this.translationsState.update((packs) => [
      ...packs.filter((p) => packKey(p) !== packKey(pack)),
      pack,
    ]);
    return null;
  }

  // I/O boundary: removes a persisted translation pack by its `<id>@<version>` key.
  async removeTranslation(key: string): Promise<void> {
    await this.packsRepository.remove(key);
    this.translationsState.update((packs) => packs.filter((p) => packKey(p) !== key));
  }
}
