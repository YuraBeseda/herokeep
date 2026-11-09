import { inject, Injectable, signal } from '@angular/core';
import { ToastService } from '@shared/components/toast/toast.service';
import { CharactersRepository } from '@shared/services/storage/characters.repository';
import { deliverHeroBundle } from './hero-delivery';
import { HeroWriterService } from './hero-writer.service';
import { zipFiles } from './zip-files';

/** The archive's file name and the extension the save picker offers for it. */
const ARCHIVE_NAME = 'herokeep-heroes.zip';
const ARCHIVE_EXTENSIONS = ['.zip'] as const;

/**
 * Settings' "Export all heroes" (board ST01, strap zone 3): builds one `.hero` bundle per hero that
 * is not archived (the same bytes a single export produces), puts them side by side in ONE `.zip`
 * (ruling R61: a save picker needs a user gesture each time, so one gesture can only save one
 * file), and hands that file to the same delivery ladder. Cancelling the picker cancels the whole
 * export. Two heroes whose files share a name get `-2`, `-3` ... before the extension.
 *
 * Toast keys live in the `settings` scope, which is loaded wherever this can be started from.
 */
@Injectable({ providedIn: 'root' })
export class ExportAllHeroesService {
  private readonly characters = inject(CharactersRepository);
  private readonly writer = inject(HeroWriterService);
  private readonly toast = inject(ToastService);

  /** Guards against a second run starting while one is still saving. */
  readonly exporting = signal(false);

  /** `pickerDescription` is the save picker's file-type label (native chrome, so already translated). */
  async run(pickerDescription: string): Promise<void> {
    if (this.exporting()) return;
    this.exporting.set(true);
    try {
      const heroes = (await this.characters.list()).filter((row) => !row.archived);
      if (heroes.length === 0) return;
      const files: Record<string, Uint8Array> = {};
      for (const hero of heroes) {
        const { blob, fileName, warnings } = await this.writer.export(hero.id);
        files[uniqueName(files, fileName)] = new Uint8Array(await blob.arrayBuffer());
        for (const warning of warnings) {
          this.toast.show(`settings.export.${warning.code}`, { pack: warning.pack });
        }
      }
      const archive = await zipFiles(files);
      const outcome = await deliverHeroBundle(
        archive,
        ARCHIVE_NAME,
        pickerDescription,
        ARCHIVE_EXTENSIONS,
      );
      if (outcome !== 'cancelled') {
        this.toast.show('settings.export.success', { count: heroes.length });
      }
    } catch {
      this.toast.show('settings.export.failure');
    } finally {
      this.exporting.set(false);
    }
  }
}

/** `name` if free in `files`, else `name-2`, `name-3` ... keeping the extension last. */
function uniqueName(files: Record<string, Uint8Array>, name: string): string {
  if (!(name in files)) return name;
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  for (let n = 2; ; n++) {
    const candidate = `${stem}-${n}${ext}`;
    if (!(candidate in files)) return candidate;
  }
}
