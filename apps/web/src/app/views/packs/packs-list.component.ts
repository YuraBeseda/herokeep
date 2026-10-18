import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { Pack } from '@hk/protocol';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { ButtonComponent } from '@shared/components/button/button.component';
import { CardComponent } from '@shared/components/card/card.component';
import { ChipComponent } from '@shared/components/chip/chip.component';
import { DialogService } from '@shared/components/dialog/dialog.service';
import { ToastService } from '@shared/components/toast/toast.service';
import { HkpackReader } from '@shared/services/packs/hkpack-reader.service';
import {
  PackImportBadSchemaError,
  PackImportError,
  PackImportInvalidError,
} from '@shared/services/packs/pack-import.errors';
import { PackStore } from '@shared/stores/pack.store';
import { PackTrustDialogComponent } from './pack-trust-dialog.component';
import { packKey } from './pack-summary';

/** The file picker's `accept` — a `.hkpack` archive or a bare `pack.json` (plan 15 ruling 1). */
const IMPORT_ACCEPT = '.hkpack,.json';

/** Generic refusal key for anything that is not a typed `PackImportError` (an I/O failure). */
const UNKNOWN_FAILURE_KEY = 'packs.import-failed-unknown';

/**
 * `/packs` — the installed pack list (frontend architecture: `packs/ installed, import, …`):
 * the core rules pack, installed content packs (each linking to `/packs/:key`) and translation
 * packs (removable chips, same store call the Settings card uses), plus Import.
 *
 * Import reads the chosen file with `HkpackReader` (which validates and stores nothing), then
 * opens the trust dialog with the preview; only its Install writes. A refusal toasts the error's
 * i18n `code` and, when the error carries schema `issues` or validation `diagnostics`, lists them
 * in a dismissible panel below the actions (those lines are validator output, shown as data).
 */
@Component({
  selector: 'app-packs-list',
  imports: [TranslocoDirective, RouterLink, ButtonComponent, CardComponent, ChipComponent],
  providers: [provideTranslocoScope('packs')],
  templateUrl: './packs-list.component.html',
  styleUrl: './packs-list.component.scss',
})
export class PacksListComponent {
  private readonly packStore = inject(PackStore);
  private readonly hkpackReader = inject(HkpackReader);
  private readonly dialogService = inject(DialogService);
  private readonly toastService = inject(ToastService);

  protected readonly importAccept = IMPORT_ACCEPT;
  protected readonly corePack = this.packStore.corePack;
  protected readonly contentPacks = this.packStore.installedContent;
  protected readonly translationPacks = this.packStore.translationPacks;
  protected readonly importing = signal(false);
  /** Issue/diagnostic lines of the last refused import, if it carried any. */
  protected readonly importDetails = signal<readonly string[]>([]);

  protected readonly packKey = packKey;

  protected async removeTranslation(pack: Pack): Promise<void> {
    await this.packStore.removeTranslation(packKey(pack));
  }

  protected async onImportFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    // Reset so choosing the same file again still fires `change`.
    input.value = '';
    if (!file || this.importing()) return;

    this.importing.set(true);
    this.importDetails.set([]);
    try {
      const preview = await this.hkpackReader.read(file);
      this.dialogService.open(PackTrustDialogComponent, { data: preview });
    } catch (error) {
      this.showImportFailure(error);
    } finally {
      this.importing.set(false);
    }
  }

  protected dismissImportDetails(): void {
    this.importDetails.set([]);
  }

  private showImportFailure(error: unknown): void {
    if (!(error instanceof PackImportError)) {
      this.toastService.show(UNKNOWN_FAILURE_KEY);
      return;
    }
    this.toastService.show(error.code);
    if (error instanceof PackImportBadSchemaError) {
      this.importDetails.set(error.issues);
    } else if (error instanceof PackImportInvalidError) {
      this.importDetails.set(error.diagnostics.map((d) => `${d.code}: ${d.message}`));
    }
  }
}
