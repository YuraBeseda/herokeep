import { Component, computed, inject, signal } from '@angular/core';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { ButtonComponent } from '@shared/components/button/button.component';
import { DIALOG_DATA, DialogRef } from '@shared/components/dialog/dialog.service';
import { ToastService } from '@shared/components/toast/toast.service';
import type { PackImportPreview } from '@shared/services/packs/hkpack-reader.service';
import { PackStore } from '@shared/stores/pack.store';
import { PackInfoComponent } from './pack-info.component';

/** Why Install is disabled — rendered as the button's `aria-describedby` target. */
type InstallBlock =
  | { readonly key: 'trust.already-installed' }
  | { readonly key: 'trust.has-errors'; readonly message: string };

let nextReasonId = 0;

/**
 * The ADR-008 trust ("enable") screen for a user-initiated pack import: everything
 * `PackInfoComponent` shows about the preview, then Install (`PackStore.importContent`) or Cancel.
 * Nothing is stored before Install. Opened through `DialogService` (focus trap + Escape/backdrop
 * dismissal come from the `hk-dialog` shell); closes with `true` once installed, `false` on
 * Cancel, `undefined` on Escape.
 *
 * Install is disabled, with the reason wired through `aria-describedby`, when the preview is
 * already installed or carries any ERROR diagnostic (the reader refuses those before a preview
 * exists, so this is defence in depth — the first error is the reason).
 */
@Component({
  selector: 'app-pack-trust-dialog',
  imports: [TranslocoDirective, ButtonComponent, PackInfoComponent],
  providers: [provideTranslocoScope('packs')],
  templateUrl: './pack-trust-dialog.component.html',
  styleUrl: './pack-trust-dialog.component.scss',
})
export class PackTrustDialogComponent {
  protected readonly preview = inject<PackImportPreview>(DIALOG_DATA);
  private readonly dialogRef = inject(DialogRef);
  private readonly packStore = inject(PackStore);
  private readonly toastService = inject(ToastService);

  protected readonly reasonId = `pack-trust-reason-${nextReasonId++}`;
  protected readonly installing = signal(false);

  protected readonly block = computed<InstallBlock | undefined>(() => {
    if (this.preview.alreadyInstalled) return { key: 'trust.already-installed' };
    const firstError = this.preview.diagnostics.find((d) => d.severity === 'error');
    return firstError ? { key: 'trust.has-errors', message: firstError.message } : undefined;
  });

  protected async install(): Promise<void> {
    if (this.block() || this.installing()) return;
    this.installing.set(true);
    try {
      await this.packStore.importContent(this.preview);
      this.toastService.show('packs.import-success');
      this.dialogRef.close(true);
    } catch {
      this.toastService.show('packs.install-failed');
    } finally {
      this.installing.set(false);
    }
  }

  protected cancel(): void {
    this.dialogRef.close(false);
  }
}
