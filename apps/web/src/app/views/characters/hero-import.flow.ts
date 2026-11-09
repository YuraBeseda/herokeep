import { inject, Injectable, signal } from '@angular/core';
import { ToastService } from '@shared/components/toast/toast.service';
import {
  HeroImportBadEventError,
  HeroImportBadManifestError,
  HeroImportBadPackError,
  HeroImportBadZipError,
  HeroImportHashMismatchError,
  HeroImportPackConflictError,
  HeroImportSyncedStreamError,
  HeroReaderService,
  type ImportResult,
} from '@shared/services/export/hero-reader.service';
import { CharacterStoreNotLeaderError } from '@shared/stores/character.store';

const GENERIC_IMPORT_FAILURE_KEY = 'characters.list.toast.import-failed-generic';
/** `.hero` files only — the extension `HeroWriterService.export` names its downloads with. */
export const HERO_IMPORT_ACCEPT = '.hero';

/**
 * The `.hero` import flow shared by the screens that offer Import in their action strap (Home and
 * the heroes list): hand it the file the user picked, it imports through `HeroReaderService` and
 * toasts the outcome (created / merged / the typed failure's own message). Each screen owns its
 * own hidden file input and strap action; this owns what happens next.
 *
 * `importing` guards a second pick racing an in-flight import (the screens disable Import while
 * it is true) and `importFile` itself ignores a queued second call.
 */
@Injectable({ providedIn: 'root' })
export class HeroImportFlow {
  private readonly heroReaderService = inject(HeroReaderService);
  private readonly toastService = inject(ToastService);

  private readonly importingState = signal(false);
  readonly importing = this.importingState.asReadonly();

  /** Resolves with the result on success, `undefined` for a failure (already toasted) or a call
   * that was ignored. */
  async importFile(file: File): Promise<ImportResult | undefined> {
    if (this.importingState()) return undefined;
    this.importingState.set(true);
    try {
      const result = await this.heroReaderService.import(file);
      const key =
        result.mode === 'created'
          ? 'characters.list.toast.import-created'
          : 'characters.list.toast.import-merged';
      this.toastService.show(key, {
        name: result.name,
        imported: result.imported,
        skippedDuplicates: result.skippedDuplicates,
      });
      return result;
    } catch (error) {
      this.toastService.show(...this.failureToastArgs(error));
      return undefined;
    } finally {
      this.importingState.set(false);
    }
  }

  /** Maps every `HeroReaderService.import` failure mode to its toast `show(key, params?)` args —
   * each typed error already carries its own full, global i18n key as `code` (same pattern as
   * `CharacterStoreNotLeaderError`, checked here too: a non-leader tab can't import either).
   * `HeroImportBadEventError`'s 0-based `index` is shown 1-based. */
  private failureToastArgs(error: unknown): [string, Record<string, unknown>?] {
    if (error instanceof HeroImportBadEventError) {
      return [error.code, { index: error.index + 1 }];
    }
    // Plan 15 Task 6: a carried content pack that cannot be installed names its `id@version`.
    if (error instanceof HeroImportBadPackError || error instanceof HeroImportPackConflictError) {
      return [error.code, { pack: error.packKey }];
    }
    if (
      error instanceof HeroImportBadZipError ||
      error instanceof HeroImportBadManifestError ||
      error instanceof HeroImportHashMismatchError ||
      error instanceof HeroImportSyncedStreamError ||
      error instanceof CharacterStoreNotLeaderError
    ) {
      return [error.code];
    }
    return [GENERIC_IMPORT_FAILURE_KEY];
  }
}
