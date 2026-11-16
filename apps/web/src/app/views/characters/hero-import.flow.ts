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
  HeroImportTooLargeError,
  HeroReaderService,
  type ImportResult,
} from '@shared/services/export/hero-reader.service';
import { CharacterStoreNotLeaderError } from '@shared/stores/character.store';

const GENERIC_IMPORT_FAILURE_KEY = 'characters.list.toast.import-failed-generic';
const NOT_HERO_OR_EXPORT_KEY = 'characters.list.toast.import-failed-not-hero-or-export';
/** `.hero` files, and the `.zip` Settings' "Export all heroes" writes. */
export const HERO_IMPORT_ACCEPT = '.hero,.zip';

/** Export-all zip limits, read from the zip directory before anything is inflated (R61). */
const EXPORT_ALL_MAX_HEROES = 500;
/** One `.hero` inside the archive. The reader caps each part (events 16 MiB, images, packs) but
 * not the whole file, so this is a generous per-file ceiling. */
const EXPORT_ALL_MAX_HERO_BYTES = 64 * 1024 * 1024;
const EXPORT_ALL_MAX_TOTAL_BYTES = 512 * 1024 * 1024;

export interface ImportAllResult {
  readonly imported: string[];
  readonly merged: string[];
  readonly skipped: { name: string; reason: 'synced' | 'invalid' }[];
}

/** A zip with neither a manifest nor any `.hero` entry. */
class HeroImportNotHeroError extends Error {}

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
  async importFile(file: File): Promise<ImportResult | ImportAllResult | undefined> {
    if (this.importingState()) return undefined;
    this.importingState.set(true);
    try {
      const heroFiles = await this.exportAllEntries(file);
      if (heroFiles) {
        const summary = await this.importEach(heroFiles);
        this.toastService.show('characters.list.toast.import-all-summary', {
          imported: summary.imported.length,
          merged: summary.merged.length,
          skipped: summary.skipped.length,
        });
        return summary;
      }
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

  /** The `.hero` entries of an export-all zip, or `undefined` when `file` is a single `.hero` (a
   * `manifest.json` at the root) or not a zip at all (the reader reports that). Limits are checked
   * on a first pass that inflates nothing; `HeroImportTooLargeError` surfaces as the bad-zip toast. */
  private async exportAllEntries(file: File): Promise<File[] | undefined> {
    const { unzipSync } = await import('fflate');
    const bytes = new Uint8Array(await file.arrayBuffer());
    const names: string[] = [];
    let total = 0;
    try {
      unzipSync(bytes, {
        filter: ({ name, size, originalSize }) => {
          if (names.length >= EXPORT_ALL_MAX_HEROES + 1) {
            throw new HeroImportTooLargeError('entries', names.length, EXPORT_ALL_MAX_HEROES);
          }
          names.push(name);
          if (name.endsWith('.hero')) {
            const declared = Math.max(size, originalSize);
            total += declared;
            if (declared > EXPORT_ALL_MAX_HERO_BYTES) {
              throw new HeroImportTooLargeError('image-bytes', declared, EXPORT_ALL_MAX_HERO_BYTES);
            }
            if (total > EXPORT_ALL_MAX_TOTAL_BYTES) {
              throw new HeroImportTooLargeError('image-bytes', total, EXPORT_ALL_MAX_TOTAL_BYTES);
            }
          }
          return false;
        },
      });
    } catch (error) {
      if (error instanceof HeroImportTooLargeError) throw error;
      return undefined; // not a readable zip: the reader's own bad-zip error says so
    }
    if (names.includes('manifest.json')) return undefined;
    const heroNames = names.filter((name) => name.endsWith('.hero'));
    if (heroNames.length === 0) throw new HeroImportNotHeroError();
    if (heroNames.length > EXPORT_ALL_MAX_HEROES) {
      throw new HeroImportTooLargeError('entries', heroNames.length, EXPORT_ALL_MAX_HEROES);
    }
    const wanted = new Set(heroNames);
    const inflated = unzipSync(bytes, { filter: ({ name }) => wanted.has(name) });
    return heroNames.map(
      (name) => new File([inflated[name]], name.slice(name.lastIndexOf('/') + 1)),
    );
  }

  /** One `HeroReaderService.import` per entry; a failing entry is recorded, never thrown. */
  private async importEach(files: File[]): Promise<ImportAllResult> {
    const summary: ImportAllResult = { imported: [], merged: [], skipped: [] };
    for (const entry of files) {
      try {
        const result = await this.heroReaderService.import(entry);
        (result.mode === 'created' ? summary.imported : summary.merged).push(result.name);
      } catch (error) {
        if (error instanceof CharacterStoreNotLeaderError) throw error;
        summary.skipped.push({
          name: entry.name,
          reason: error instanceof HeroImportSyncedStreamError ? 'synced' : 'invalid',
        });
      }
    }
    return summary;
  }

  /** Maps every `HeroReaderService.import` failure mode to its toast `show(key, params?)` args вЂ”
   * each typed error already carries its own full, global i18n key as `code` (same pattern as
   * `CharacterStoreNotLeaderError`, checked here too: a non-leader tab can't import either).
   * `HeroImportBadEventError`'s 0-based `index` is shown 1-based. */
  private failureToastArgs(error: unknown): [string, Record<string, unknown>?] {
    if (error instanceof HeroImportNotHeroError) return [NOT_HERO_OR_EXPORT_KEY];
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
