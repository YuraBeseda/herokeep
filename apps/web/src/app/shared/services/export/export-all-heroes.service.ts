import { inject, Injectable, signal } from '@angular/core';
import { ToastService } from '@shared/components/toast/toast.service';
import { CharactersRepository } from '@shared/services/storage/characters.repository';
import { deliverHeroBundle } from './hero-delivery';
import { HeroWriterService } from './hero-writer.service';

/**
 * Settings' "Export all heroes as .hero files" (board ST01, strap zone 3): builds one `.hero`
 * bundle per hero that is not archived, newest first, and hands each to the same delivery ladder a
 * single export uses. Cancelling any save picker stops the run (the person has changed their
 * mind); what was already saved stays saved and is counted.
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
      let exported = 0;
      for (const hero of heroes) {
        const { blob, fileName, warnings } = await this.writer.export(hero.id);
        const outcome = await deliverHeroBundle(blob, fileName, pickerDescription);
        if (outcome === 'cancelled') break;
        exported += 1;
        for (const warning of warnings) {
          this.toast.show(`settings.export.${warning.code}`, { pack: warning.pack });
        }
      }
      if (exported > 0) this.toast.show('settings.export.success', { count: exported });
    } catch {
      this.toast.show('settings.export.failure');
    } finally {
      this.exporting.set(false);
    }
  }
}
