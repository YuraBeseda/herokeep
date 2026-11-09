import { inject, Injectable, signal } from '@angular/core';
import { DialogService } from '@app/ui/dialog/dialog.service';
import { ToastService } from '@shared/components/toast/toast.service';
import { deliverHeroBundle } from '@shared/services/export/hero-delivery';
import { HeroWriterService } from '@shared/services/export/hero-writer.service';
import { CharacterStore } from '@shared/stores/character.store';
import { NotesDialogComponent } from './play/notes-dialog.component';
import { RollLogDialogComponent } from './play/roll-log-dialog.component';

/**
 * The sheet-level actions that more than one surface offers — the action strap (desktop/tablet)
 * and the phone's More tab: Export, Notes and the Roll log. Notes and the Roll log open the
 * existing note list and roll-log panel in dialogs for now; B9b swaps them for the drawers.
 */
@Injectable({ providedIn: 'root' })
export class SheetChromeService {
  private readonly characterStore = inject(CharacterStore);
  private readonly heroWriterService = inject(HeroWriterService);
  private readonly toastService = inject(ToastService);
  private readonly dialogService = inject(DialogService);

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

  openNotes(): void {
    this.dialogService.open(NotesDialogComponent);
  }

  openRollLog(): void {
    this.dialogService.open(RollLogDialogComponent);
  }
}
