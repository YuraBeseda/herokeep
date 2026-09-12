import { computed, inject, Injectable, signal, type Signal } from '@angular/core';
import { validatePack, type Diagnostic } from '@hk/engine';
import type { Pack } from '@hk/protocol';
import { ToastService } from '../components/toast/toast.service';
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
  private readonly toastService = inject(ToastService);

  // Properties
  private readonly coreState = signal<Pack | undefined>(undefined);
  private readonly translationsState = signal<Pack[]>([]);
  private readonly readyState = signal(false);
  private readonly coreLoadFailedState = signal(false);

  readonly corePack: Signal<Pack | undefined> = this.coreState.asReadonly();
  readonly translationPacks: Signal<Pack[]> = this.translationsState.asReadonly();
  readonly ready: Signal<boolean> = this.readyState.asReadonly();
  readonly coreLoadFailed: Signal<boolean> = this.coreLoadFailedState.asReadonly();
  readonly packs = computed<Pack[]>(() => {
    const core = this.coreState();
    return core ? [core, ...this.translationsState()] : [];
  });

  // I/O boundary: fetches the core pack asset and reads persisted translation packs from Dexie.
  // Never rejects, so `provideAppInitializer` always resolves and the shell always renders:
  // a core-pack failure (bad network, first-visit fetch miss) flags `coreLoadFailed` instead —
  // the shell shows a retry state rather than hanging blank forever — while a Dexie read
  // failure (restrictive privacy modes) degrades to an empty translation list with a toast,
  // since translations are optional and the core pack is not. Persisted translations are
  // re-validated against the freshly loaded core pack (a service-worker update may have shipped
  // one a stored translation no longer matches) and dropped, silently, on failure — the same bar
  // `importTranslation` already holds them to, just re-checked on every load instead of trusted
  // forever from import time.
  async init(): Promise<void> {
    let core: Pack;
    try {
      core = await this.packLoader.loadCore();
    } catch {
      this.coreLoadFailedState.set(true);
      return;
    }
    this.coreState.set(core);

    let stored: Pack[] = [];
    try {
      stored = await this.packsRepository.getAll();
    } catch {
      this.toastService.show('settings.packs.translations-load-failed');
    }
    const translations = stored.filter((pack) => pack.kind === 'translation');
    const survivesValidation = (pack: Pack): boolean => {
      try {
        return validatePack(pack, [core]).length === 0;
      } catch {
        return false; // structurally corrupted row — same outcome as failed validation: drop it
      }
    };
    this.translationsState.set(translations.filter(survivesValidation));
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
