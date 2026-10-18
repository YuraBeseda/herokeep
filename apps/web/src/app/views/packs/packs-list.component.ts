import { Component, computed, inject, resource, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { Pack } from '@hk/protocol';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { ButtonComponent } from '@shared/components/button/button.component';
import { CardComponent } from '@shared/components/card/card.component';
import { ChipComponent } from '@shared/components/chip/chip.component';
import { DialogService } from '@shared/components/dialog/dialog.service';
import { ToastService } from '@shared/components/toast/toast.service';
import { HkpackReader } from '@shared/services/packs/hkpack-reader.service';
import { HomebrewIdService, isHomebrewPackId } from '@shared/services/packs/homebrew-id';
import { updatesFor } from '@shared/services/packs/pack-updates';
import {
  PackImportBadSchemaError,
  PackImportError,
  PackImportInvalidError,
} from '@shared/services/packs/pack-import.errors';
import { PackStore } from '@shared/stores/pack.store';
import { PackTrustDialogComponent } from './pack-trust-dialog.component';
import { packKey } from './pack-summary';
import { PackUsageService } from './pack-usage.service';

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
 *
 * "Update available" (plan 15 Task 5): a row is badged when it is the version some stored
 * character could update to (`updatesFor` over that character's pins), i.e. a character pins an
 * older version of that pack id (or, for the core, another core version). The pins come from
 * `PackUsageService.pinSets` — one event-log fold per stored character, read once per visit.
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
  private readonly packUsageService = inject(PackUsageService);
  private readonly homebrewIdService = inject(HomebrewIdService);

  protected readonly importAccept = IMPORT_ACCEPT;
  protected readonly corePack = this.packStore.corePack;
  protected readonly contentPacks = this.packStore.installedContent;
  protected readonly translationPacks = this.packStore.translationPacks;
  protected readonly importing = signal(false);
  /** Issue/diagnostic lines of the last refused import, if it carried any. */
  protected readonly importDetails = signal<readonly string[]>([]);

  protected readonly packKey = packKey;

  /** Every stored character's pins (read once; installing a pack recomputes `updateTargets`). */
  private readonly storedPins = resource({ loader: () => this.packUsageService.pinSets() });

  /** `id@version` keys of the installed versions some stored character could update to. */
  protected readonly updateTargets = computed<ReadonlySet<string>>(() => {
    const core = this.corePack();
    const pinSets = this.storedPins.hasValue() ? this.storedPins.value() : [];
    const keys = new Set<string>();
    if (!core) return keys;
    const installed = [core, ...this.contentPacks()];
    for (const pins of pinSets) {
      for (const update of updatesFor(pins, installed, core)) {
        keys.add(packKey({ id: update.packId, version: update.to }));
      }
    }
    return keys;
  });

  /** Another device's homebrew pack (a `homebrew-<hex>` id that is not this device's line, e.g.
   * carried in by a `.hero`): an ordinary content pack, hinted so it is not mistaken for ours. */
  protected isOtherDeviceHomebrew(pack: Pack): boolean {
    return isHomebrewPackId(pack.id) && pack.id !== this.homebrewIdService.id();
  }

  protected async removeTranslation(pack: Pack): Promise<void> {
    try {
      await this.packStore.removeTranslation(packKey(pack));
    } catch {
      this.toastService.show('packs.remove-failed');
    }
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
