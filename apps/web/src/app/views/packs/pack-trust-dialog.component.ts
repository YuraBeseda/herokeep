import { Component, computed, inject, resource, signal } from '@angular/core';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import semver from 'semver';
import { DIALOG_DATA, DialogRef } from '@app/ui/dialog/dialog.service';
import { ToastService } from '@shared/components/toast/toast.service';
import type { PackImportPreview } from '@shared/services/packs/hkpack-reader.service';
import { PackImportConflictError } from '@shared/services/packs/pack-import.errors';
import { PackStore } from '@shared/stores/pack.store';
import { HkBannerComponent } from '../../ui/banner/banner.component';
import { HkButtonComponent } from '../../ui/button/button.component';
import { HkTagChipComponent } from '../../ui/tag-chip/tag-chip.component';
import { PackInfoComponent } from './pack-info.component';
import { PackUsageService } from './pack-usage.service';

/** What `DialogService.open` hands the dialog: the reader's preview plus the chosen file's facts. */
export type PackTrustData = PackImportPreview & {
  readonly fileName?: string;
  readonly fileSize?: number;
};

/** Why Install is disabled — the button's tooltip and its `aria-describedby` target. */
type InstallBlock =
  | { readonly key: 'trust.already-installed' }
  | { readonly key: 'trust.has-errors'; readonly message: string };

/**
 * The ADR-008 trust ("enable") screen for a user-initiated pack import (board PK03): everything
 * `PackInfoComponent` shows about the preview, "what it changes" against the installed previous
 * version of the same pack, then Install (`PackStore.importContent`) or Cancel. Nothing is stored
 * before Install. Opened through `DialogService` (focus trap + Escape/backdrop dismissal come from
 * the `hk-dialog` shell); closes with `true` once installed, `false` on Cancel, `undefined` on
 * Escape.
 *
 * Install is disabled, with the reason in its tooltip and wired through `aria-describedby`, when
 * the preview is already installed or carries any ERROR diagnostic (the reader refuses those before
 * a preview exists, so this is defence in depth — the first error is the reason).
 */
@Component({
  selector: 'app-pack-trust-dialog',
  imports: [
    TranslocoDirective,
    HkButtonComponent,
    HkBannerComponent,
    HkTagChipComponent,
    PackInfoComponent,
  ],
  providers: [provideTranslocoScope('packs')],
  templateUrl: './pack-trust-dialog.component.html',
  styleUrl: './pack-trust-dialog.component.scss',
})
export class PackTrustDialogComponent {
  protected readonly preview = inject<PackTrustData>(DIALOG_DATA);
  private readonly dialogRef = inject(DialogRef);
  private readonly packStore = inject(PackStore);
  private readonly packUsageService = inject(PackUsageService);
  private readonly toastService = inject(ToastService);

  protected readonly installing = signal(false);
  protected readonly file =
    this.preview.fileName !== undefined
      ? { name: this.preview.fileName, size: this.preview.fileSize ?? 0 }
      : null;

  protected readonly block = computed<InstallBlock | undefined>(() => {
    if (this.preview.alreadyInstalled) return { key: 'trust.already-installed' };
    const firstError = this.preview.diagnostics.find((d) => d.severity === 'error');
    return firstError ? { key: 'trust.has-errors', message: firstError.message } : undefined;
  });

  /** The newest installed version of the same pack id below the one being installed. */
  protected readonly previous = computed(() => {
    const incoming = this.preview.pack;
    return (this.packStore.installedContent?.() ?? [])
      .filter(
        (pack) =>
          pack.id === incoming.id &&
          semver.valid(pack.version) !== null &&
          semver.valid(incoming.version) !== null &&
          semver.lt(pack.version, incoming.version),
      )
      .sort((a, b) => semver.rcompare(a.version, b.version))[0];
  });

  /** Entries the incoming version adds on top of the previous one (by entity id). */
  protected readonly added = computed(() => {
    const previous = this.previous();
    if (!previous) return 0;
    const known = new Set(previous.entities.map((entity) => entity.id));
    return this.preview.pack.entities.filter((entity) => !known.has(entity.id)).length;
  });

  /** Heroes that keep the previous version until they review the update on their Build tab. */
  protected readonly staying = resource({
    params: () => this.previous(),
    loader: ({ params }) => this.packUsageService.countPinning(params.id, params.version),
  });

  /** The translated reason Install is unavailable (its tooltip and accessible description). */
  protected blockReason(
    t: (key: string, params?: Record<string, unknown>) => string,
  ): string | null {
    const block = this.block();
    if (!block) return null;
    return block.key === 'trust.has-errors'
      ? t(block.key, { message: block.message })
      : t(block.key);
  }

  protected async install(): Promise<void> {
    if (this.block() || this.installing()) return;
    this.installing.set(true);
    try {
      await this.packStore.importContent(this.preview);
      this.toastService.show('packs.import-success');
      this.dialogRef.close(true);
    } catch (error) {
      // A write-time conflict (`PackStore.importContent`'s re-check) carries its own toast key.
      this.toastService.show(
        error instanceof PackImportConflictError ? error.code : 'packs.install-failed',
      );
    } finally {
      this.installing.set(false);
    }
  }

  protected cancel(): void {
    this.dialogRef.close(false);
  }
}
