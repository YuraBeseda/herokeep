import { inject, Injectable, signal } from '@angular/core';
import { ToastService } from '@shared/components/toast/toast.service';
import { deliverHeroBundle } from '@shared/services/export/hero-delivery';
import { HeroWriterService } from '@shared/services/export/hero-writer.service';
import { CharacterStore } from '@shared/stores/character.store';

/**
 * The sheet-level actions that more than one surface offers — the action strap (desktop/tablet)
 * and the phone's More tab: Export, Notes and the Roll log. Notes and the Roll log are drawers the
 * sheet shell hosts (one instance each); this service holds their open state and their opener, so
 * every entry point opens the same drawer and only one of the two is open at a time.
 */
@Injectable({ providedIn: 'root' })
export class SheetChromeService {
  private readonly characterStore = inject(CharacterStore);
  private readonly heroWriterService = inject(HeroWriterService);
  private readonly toastService = inject(ToastService);

  /** Guards Export against a double-click firing two concurrent exports/deliveries. */
  readonly exporting = signal(false);

  /**
   * Builds the bundle (`HeroWriterService.export`, pure) then hands it to the delivery ladder
   * (`deliverHeroBundle`, design ruling 5). A `'cancelled'` outcome is a normal no-op, not a
   * failure: no toast either way. Any other outcome toasts success; a thrown error toasts the
   * generic failure key. `t` is the caller's scoped translator: the save picker's file-type label
   * is native browser chrome, so it needs a resolved STRING.
   */
  async exportHero(t: (key: string, params?: Record<string, unknown>) => string): Promise<void> {
    const characterId = this.characterStore.streamId();
    if (!characterId || this.exporting()) return;

    this.exporting.set(true);
    try {
      const { blob, fileName, warnings } = await this.heroWriterService.export(characterId);
      const description = t('sheet.export.pickerDescription');
      const outcome = await deliverHeroBundle(blob, fileName, description);
      if (outcome !== 'cancelled') {
        this.toastService.show('characters.sheet.export.success');
        // Plan 15 final fix wave C1: a pinned pack the bundle could not carry.
        for (const warning of warnings) {
          this.toastService.show(`characters.sheet.export.${warning.code}`, {
            pack: warning.pack,
          });
        }
      }
    } catch {
      this.toastService.show('characters.sheet.export.failure');
    } finally {
      this.exporting.set(false);
    }
  }

  /** Open state of the notes drawer (`app-notes-drawer`, hosted by the sheet shell). */
  readonly notesOpen = signal(false);
  /** Open state of the roll-log drawer (`app-roll-log-drawer`, hosted by the sheet shell). */
  readonly rollLogOpen = signal(false);
  /** The control that opened each drawer: focus returns to it, and pressing it never counts as outside. */
  readonly notesOpener = signal<HTMLElement | null>(null);
  readonly rollLogOpener = signal<HTMLElement | null>(null);

  openNotes(opener: HTMLElement | null = null): void {
    this.rollLogOpen.set(false);
    this.notesOpener.set(opener);
    this.notesOpen.set(true);
  }

  openRollLog(opener: HTMLElement | null = null): void {
    this.notesOpen.set(false);
    this.rollLogOpener.set(opener);
    this.rollLogOpen.set(true);
  }

  /** The strap's Notes button: opens the drawer, or closes it when it is already open. */
  toggleNotes(opener: HTMLElement | null = null): void {
    if (this.notesOpen()) this.notesOpen.set(false);
    else this.openNotes(opener);
  }

  /** The strap's Roll log button: opens the drawer, or closes it when it is already open. */
  toggleRollLog(opener: HTMLElement | null = null): void {
    if (this.rollLogOpen()) this.rollLogOpen.set(false);
    else this.openRollLog(opener);
  }
}
