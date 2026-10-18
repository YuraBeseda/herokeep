import { computed, inject, Injectable, signal, type Signal } from '@angular/core';
import { validatePack, type Diagnostic } from '@hk/engine';
import type { Pack } from '@hk/protocol';
import { ToastService } from '../components/toast/toast.service';
import { PackLoader } from '../services/engine/pack-loader';
import type { PackImportPreview } from '../services/packs/hkpack-reader.service';
import type { PackImportAsset } from '../services/packs/pack-assets';
import { BlobsRepository } from '../services/storage/blobs.repository';
import { PacksRepository } from '../services/storage/packs.repository';

function packKey(pack: Pack): string {
  return `${pack.id}@${pack.version}`;
}

/**
 * Installed packs: the core content pack (fetched from the static `/packs/**` asset, never
 * persisted — it ships with the app/service-worker cache) plus user-imported content packs
 * (plan 15: `.hkpack`/`pack.json` via `HkpackReader`, assets in the blob store with
 * `origin: 'pack'`) and translation packs (both persisted in Dexie via `PacksRepository`). Call `init()` once, from the app root
 * (`provideAppInitializer`) — see `engine.facade.ts` for why.
 */
@Injectable({ providedIn: 'root' })
export class PackStore {
  private readonly packLoader = inject(PackLoader);
  private readonly packsRepository = inject(PacksRepository);
  private readonly blobsRepository = inject(BlobsRepository);
  private readonly toastService = inject(ToastService);

  // Properties
  private readonly coreState = signal<Pack | undefined>(undefined);
  private readonly contentState = signal<Pack[]>([]);
  private readonly translationsState = signal<Pack[]>([]);
  private readonly readyState = signal(false);
  private readonly coreLoadFailedState = signal(false);

  readonly corePack: Signal<Pack | undefined> = this.coreState.asReadonly();
  readonly installedContent: Signal<Pack[]> = this.contentState.asReadonly();
  readonly translationPacks: Signal<Pack[]> = this.translationsState.asReadonly();
  readonly ready: Signal<boolean> = this.readyState.asReadonly();
  readonly coreLoadFailed: Signal<boolean> = this.coreLoadFailedState.asReadonly();
  readonly packs = computed<Pack[]>(() => {
    const core = this.coreState();
    return core ? [core, ...this.contentState(), ...this.translationsState()] : [];
  });
  /** Every installed `id@version` (core, content, translations) — what a character's pins are
   * compared against (missing-pack banner, plan 15 ruling 8). */
  readonly installed = computed<{ id: string; version: string }[]>(() =>
    this.packs().map((pack) => ({ id: pack.id, version: pack.version })),
  );

  // I/O boundary: fetches the core pack asset and reads persisted translation packs from Dexie.
  // Never rejects, so `provideAppInitializer` always resolves and the shell always renders:
  // a core-pack failure (bad network, first-visit fetch miss) flags `coreLoadFailed` instead —
  // the shell shows a retry state rather than hanging blank forever — while a Dexie read
  // failure (restrictive privacy modes) degrades to an empty translation list with a toast,
  // since translations are optional and the core pack is not. Persisted translations are
  // re-validated against the freshly loaded core pack (a service-worker update may have shipped
  // one a stored translation no longer matches) and dropped, silently, on failure — the same bar
  // `importTranslation` already holds them to, just re-checked on every load instead of trusted
  // forever from import time. Persisted content packs get the same re-check against the core plus
  // the other content packs (their possible dependencies), but only ERROR diagnostics drop one —
  // the importer accepts warnings too. Unknown kinds are dropped.
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
    const content = stored.filter((pack) => pack.kind === 'content');
    const survivesValidation = (pack: Pack): boolean => {
      try {
        return validatePack(pack, [core]).length === 0;
      } catch {
        return false; // structurally corrupted row — same outcome as failed validation: drop it
      }
    };
    const contentSurvives = (pack: Pack): boolean => {
      try {
        return !validatePack(pack, [core, ...content]).some((d) => d.severity === 'error');
      } catch {
        return false;
      }
    };
    this.contentState.set(content.filter(contentSurvives));
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

  // I/O boundary: installs a content pack the `HkpackReader` already fully validated (the reader
  // stores nothing; this is the only write). The pack row goes first — if it fails, nothing else is
  // written. Each asset then lands in the blob store as `origin: 'pack'` (a hash the device already
  // holds keeps its own origin/pin — `BlobsRepository.put`'s preserve rule). Should an asset write
  // fail, the pack row and every blob this call newly created are removed again before rethrowing,
  // so a half-installed pack never survives. An `alreadyInstalled` preview is a no-op.
  async importContent(preview: PackImportPreview): Promise<void> {
    if (!this.coreState()) {
      throw new Error('PackStore.importContent: call init() before importing packs');
    }
    if (preview.alreadyInstalled) return;
    await this.installContent(preview.pack, preview.assets);
  }

  // I/O boundary: the write behind `importContent`, shared with the `.hero` importer (plan 15
  // Task 6), which validates a carried pack itself (same checks as `HkpackReader`) and installs
  // it without a trust dialog (ruling 9). `pack` and `assets` MUST already be fully validated —
  // this method writes, it does not check. Same order and rollback as `importContent`.
  async installContent(pack: Pack, assets: ReadonlyMap<string, PackImportAsset>): Promise<void> {
    if (!this.coreState()) {
      throw new Error('PackStore.installContent: call init() before installing packs');
    }
    const key = packKey(pack);
    await this.packsRepository.putPack(pack);
    const created: string[] = [];
    try {
      for (const [hash, asset] of assets) {
        const existed = (await this.blobsRepository.get(hash)) !== undefined;
        await this.blobsRepository.put(hash, asset.mime, asset.bytes, {
          kind: asset.kind,
          origin: 'pack',
        });
        if (!existed) created.push(hash);
      }
    } catch (error) {
      for (const hash of created) await this.blobsRepository.remove(hash);
      await this.packsRepository.remove(key);
      throw error;
    }
    this.contentState.update((packs) => [...packs.filter((p) => packKey(p) !== key), pack]);
  }

  // I/O boundary: removes an installed content pack by its `<id>@<version>` key, plus every asset
  // blob it listed that no other installed pack lists. Only blobs whose origin is `'pack'` are
  // deleted — a hash that first arrived as an upload/peer/import blob belongs to that owner.
  async removeContent(key: string): Promise<void> {
    const pack =
      this.contentState().find((p) => packKey(p) === key) ??
      (await this.packsRepository.getAll()).find((p) => packKey(p) === key);
    await this.packsRepository.remove(key);
    const remaining = this.contentState().filter((p) => packKey(p) !== key);
    const core = this.coreState();
    const stillListed = new Set(
      [...(core ? [core] : []), ...remaining, ...this.translationsState()].flatMap((p) =>
        p.assets.map((a) => a.hash),
      ),
    );
    for (const asset of pack?.assets ?? []) {
      if (stillListed.has(asset.hash)) continue;
      const row = await this.blobsRepository.get(asset.hash);
      if (row?.origin === 'pack') await this.blobsRepository.remove(asset.hash);
    }
    this.contentState.set(remaining);
  }
}
