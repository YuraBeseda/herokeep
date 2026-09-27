import { Component, inject, signal } from '@angular/core';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { ButtonComponent } from '@shared/components/button/button.component';
import { DIALOG_DATA, DialogRef } from '@shared/components/dialog/dialog.service';
import { ToastService } from '@shared/components/toast/toast.service';
import { deliverHeroBundle } from '@shared/services/export/hero-delivery';
import { CampaignWriterService } from '@shared/services/export/campaign-writer.service';

export interface CampaignExportDialogData {
  readonly campaignId: string;
  readonly name: string;
}

/** `.herocampaign` extension for `deliverHeroBundle`'s save-picker `accept` list (plan-10 Task
 * 15) — distinct from `HeroWriterService`'s `.hero` default, so the browser's save dialog offers
 * (and doesn't silently coerce the filename to) the right extension for a campaign bundle. */
const CAMPAIGN_BUNDLE_EXTENSIONS = ['.herocampaign'] as const;

/**
 * `CampaignSettingsComponent`'s "Export campaign" action (task-15-brief.md, ruling 9): DM-only,
 * opened via `DialogService.open()` from Settings. States what's included/excluded in ONE body
 * paragraph (`export.body`, i18n ×3) rather than splitting it across several keys — ruling 9's own
 * three facts (campaign-stream-only backup; no member character sheets, ownership/privacy; no
 * import route exists yet) read naturally as one sentence-group, and this is explicitly a "small,
 * tight" task (task-15-brief.md).
 *
 * Mirrors `SheetShellComponent.onExport`'s own build-then-deliver shape (`CampaignWriterService`
 * is this task's writer, `deliverHeroBundle` is REUSED verbatim — see that file's own doc comment
 * for why a `.herocampaign` bundle needed one small additive parameter, not a fork). Unlike that
 * character-sheet flow (a bare button, no dialog), this lives inside a dialog, so outcomes are
 * reflected in the dialog itself: `'cancelled'` (the user backed out of the save picker/share
 * sheet) is a normal no-op — no toast, dialog stays open so they can try again or close manually;
 * any other successful outcome (`'saved'`/`'shared'`/`'downloaded'`) toasts success AND closes the
 * dialog; a thrown error (a storage read failure — shouldn't happen, but `CampaignWriterService`
 * CAN throw) toasts the generic failure key and leaves the dialog open, same posture every other
 * dialog in this view takes on a failed action.
 */
@Component({
  selector: 'app-campaign-export-dialog',
  imports: [TranslocoDirective, ButtonComponent],
  providers: [provideTranslocoScope('campaigns')],
  templateUrl: './campaign-export-dialog.component.html',
  styleUrl: './campaign-export-dialog.component.scss',
})
export class CampaignExportDialogComponent {
  private readonly data = inject<CampaignExportDialogData>(DIALOG_DATA);
  private readonly dialogRef = inject(DialogRef);
  private readonly campaignWriterService = inject(CampaignWriterService);
  private readonly toastService = inject(ToastService);

  protected readonly exporting = signal(false);

  protected cancel(): void {
    this.dialogRef.close(false);
  }

  /** `t` (same convention as `SheetShellComponent.onExport`'s own doc comment): the save-picker's
   * file-type label is native browser/OS chrome, not this component's own template, so it needs a
   * resolved STRING — the template passes its own scoped `t` (`*transloco="let t; read:
   * 'campaigns'"`) in at click time rather than resolving via an injected, unscoped
   * `TranslocoService`. */
  protected async onExport(
    t: (key: string, params?: Record<string, unknown>) => string,
  ): Promise<void> {
    if (this.exporting()) return;
    this.exporting.set(true);
    try {
      const { blob, fileName } = await this.campaignWriterService.export(
        this.data.campaignId,
        this.data.name,
      );
      const description = t('export.pickerDescription');
      const outcome = await deliverHeroBundle(
        blob,
        fileName,
        description,
        CAMPAIGN_BUNDLE_EXTENSIONS,
      );
      if (outcome !== 'cancelled') {
        this.toastService.show('campaigns.export.success');
        this.dialogRef.close(true);
      }
    } catch {
      this.toastService.show('campaigns.export.failure');
    } finally {
      this.exporting.set(false);
    }
  }
}
