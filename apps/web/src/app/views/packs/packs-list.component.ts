import { HkTooltipDirective } from '../../ui/tooltip/tooltip.directive';
import {
  Component,
  DestroyRef,
  type ElementRef,
  computed,
  effect,
  inject,
  resource,
  signal,
  viewChild,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import type { Pack } from '@hk/protocol';
import { HKPACK_LIMITS } from '@hk/protocol';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { DialogService } from '@app/ui/dialog/dialog.service';
import { ToastService } from '@shared/components/toast/toast.service';
import { formatBytes } from '@shared/helpers/format-bytes';
import { LocaleService } from '@shared/services/i18n/locale.service';
import { HkpackReader } from '@shared/services/packs/hkpack-reader.service';
import { HomebrewIdService, isHomebrewPackId } from '@shared/services/packs/homebrew-id';
import { updatesFor } from '@shared/services/packs/pack-updates';
import {
  PackImportBadSchemaError,
  PackImportError,
  PackImportInvalidError,
} from '@shared/services/packs/pack-import.errors';
import { StoragePersistService } from '@shared/services/pwa/storage-persist.service';
import { CampaignsRepository } from '@shared/services/storage/campaigns.repository';
import { CampaignStore } from '@shared/stores/campaign.store';
import { PackStore } from '@shared/stores/pack.store';
import { IconComponent } from '../../shared/icons/icon.component';
import { ActionStrapService } from '../../ui/action-strap/action-strap.service';
import { HkButtonComponent } from '../../ui/button/button.component';
import { HkLeafComponent } from '../../ui/leaf/leaf.component';
import { HkTagChipComponent } from '../../ui/tag-chip/tag-chip.component';
import { HomebrewNewChooserComponent } from './homebrew/homebrew-new-chooser.component';
import { PackTrustDialogComponent, type PackTrustData } from './pack-trust-dialog.component';
import { packBytesOf, packKey, entityCountRows, summarizePack } from './pack-summary';
import { PackUsageService } from './pack-usage.service';
import { buildPacksListStrap } from './packs-list-strap';

/** The file picker's `accept` — a `.hkpack` archive or a bare `pack.json` (plan 15 ruling 1). */
const IMPORT_ACCEPT = '.hkpack,.json';

/** Generic refusal key for anything that is not a typed `PackImportError` (an I/O failure). */
const UNKNOWN_FAILURE_KEY = 'packs.import-failed-unknown';

/** One installed content or core pack as the list draws it. */
interface PackRowView {
  readonly pack: Pack;
  readonly key: string;
  readonly core: boolean;
  readonly thisDevice: boolean;
  readonly otherDevice: boolean;
  readonly updateVersion: string | null;
  readonly entries: number;
  readonly images: number;
  readonly usedBy: number;
  /** Names of the campaigns that share exactly this pack version. */
  readonly campaigns: readonly string[];
  /** Heroes pinning an older version of this pack than the one installed (an update to review). */
  readonly toReview: number;
  readonly breakdown: readonly { readonly type: string; readonly count: number }[];
}

/**
 * `/packs` (board PK01) — the installed pack list: the core rules pack, installed content packs
 * (each linking to `/packs/:key`) and translation packs (removable), the import card with a drop
 * zone, the homebrew card and the storage card.
 *
 * Import reads the chosen or dropped file with `HkpackReader` (which validates and stores nothing),
 * then opens the trust dialog with the preview; only its Install writes. A refusal toasts the
 * error's i18n `code` and, when the error carries schema `issues` or validation `diagnostics`,
 * lists them in a dismissible panel (validator output, shown as data).
 *
 * "Update available" (plan 15 Task 5): a row is badged when it is the version some stored
 * character could update to (`updatesFor` over that character's pins). The pins come from
 * `PackUsageService.heroPins` — one event-log fold per stored character, read once per visit.
 */
@Component({
  selector: 'app-packs-list',
  imports: [
    TranslocoDirective,
    NgTemplateOutlet,
    RouterLink,
    HkButtonComponent,
    HkLeafComponent,
    HkTagChipComponent,
    HkTooltipDirective,
    IconComponent,
  ],
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
  private readonly localeService = inject(LocaleService);
  private readonly storagePersist = inject(StoragePersistService);
  private readonly router = inject(Router);
  private readonly campaignStore = inject(CampaignStore);
  private readonly campaignsRepository = inject(CampaignsRepository);
  private readonly strap = inject(ActionStrapService);

  protected readonly importAccept = IMPORT_ACCEPT;
  protected readonly corePack = this.packStore.corePack;
  protected readonly translationPacks = this.packStore.translationPacks;
  protected readonly importing = signal(false);
  protected readonly dragging = signal(false);
  /** Issue/diagnostic lines of the last refused import, if it carried any. */
  protected readonly importDetails = signal<readonly string[]>([]);
  protected readonly packKey = packKey;

  /** Every stored character's pins (read once; installing a pack recomputes the rows). */
  private readonly storedPins = resource({ loader: () => this.packUsageService.heroPins() });

  private readonly campaignRows = resource({ loader: () => this.campaignsRepository.list() });

  private readonly installedAll = computed<Pack[]>(() => {
    const core = this.corePack();
    return core ? [core, ...this.packStore.installedContent()] : [];
  });

  /** `id@version` keys of the installed versions some stored character could update to. */
  protected readonly updateTargets = computed<ReadonlyMap<string, number>>(() => {
    const core = this.corePack();
    const heroes = this.storedPins.hasValue() ? this.storedPins.value() : [];
    const counts = new Map<string, number>();
    if (!core) return counts;
    for (const hero of heroes) {
      for (const update of updatesFor(hero.pins, this.installedAll(), core)) {
        const key = packKey({ id: update.packId, version: update.to });
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
    return counts;
  });

  private view(pack: Pack, core: boolean): PackRowView {
    const heroes = this.storedPins.hasValue() ? this.storedPins.value() : [];
    const key = packKey(pack);
    const homebrew = isHomebrewPackId(pack.id);
    const own = homebrew && pack.id === this.homebrewIdService.id();
    return {
      pack,
      key,
      core,
      thisDevice: own,
      otherDevice: homebrew && !own,
      updateVersion: this.updateTargets().has(key) ? pack.version : null,
      entries: pack.entities.length,
      images: pack.assets.length,
      campaigns: this.campaignNames(pack),
      usedBy: heroes.filter((hero) => hero.pins[pack.id] === pack.version).length,
      toReview: this.updateTargets().get(key) ?? 0,
      breakdown: entityCountRows(summarizePack(pack).entityCounts),
    };
  }

  /** The campaigns whose enabled set holds exactly `pack` (id and version). */
  private campaignNames(pack: Pack): readonly string[] {
    const rows = this.campaignRows.hasValue() ? this.campaignRows.value() : [];
    const enabled = this.campaignStore.enabledPacks();
    return rows
      .filter((row) => enabled.get(row.id)?.get(pack.id)?.version === pack.version)
      .map((row) => row.name);
  }

  protected readonly coreRow = computed(() => {
    const core = this.corePack();
    return core ? this.view(core, true) : undefined;
  });
  protected readonly contentRows = computed(() =>
    this.packStore.installedContent().map((pack) => this.view(pack, false)),
  );
  protected readonly packCount = computed(
    () => (this.corePack() ? 1 : 0) + this.packStore.installedContent().length,
  );
  protected readonly updateCount = computed(() => this.updateTargets().size);
  protected readonly homebrewPack = computed(() =>
    this.packStore.installedContent().find((pack) => pack.id === this.homebrewIdService.id()),
  );

  // Storage card: what the installed packs weigh (declared asset sizes + the pack JSON is small).
  protected readonly packBytes = computed(() => packBytesOf(this.installedAll()));
  protected readonly packSize = computed(() =>
    formatBytes(this.packBytes(), this.localeService.locale()),
  );
  protected readonly limitSize = computed(() =>
    formatBytes(HKPACK_LIMITS.maxZipBytes, this.localeService.locale()),
  );
  protected readonly usage = computed(() => {
    const estimate = this.storagePersist.estimate();
    if (!estimate) return undefined;
    const locale = this.localeService.locale();
    return {
      used: formatBytes(estimate.usage ?? 0, locale),
      quota: formatBytes(estimate.quota ?? 0, locale),
    };
  });
  protected readonly persisted = this.storagePersist.persisted;
  /** Share of the quota the packs take, for the bar (at least a sliver so it is visible). */
  protected readonly barPercent = computed(() => {
    const quota = this.storagePersist.estimate()?.quota;
    if (!quota) return 0;
    return Math.min(100, Math.max(1, (this.packBytes() / quota) * 100));
  });

  constructor() {
    effect(() =>
      this.strap.set(
        buildPacksListStrap({
          importPack: () => this.openFilePicker(),
          newHomebrew: () => void this.newHomebrew(),
          importing: this.importing(),
        }),
      ),
    );
    inject(DestroyRef).onDestroy(() => this.strap.clear());
  }

  private readonly fileInput = viewChild<ElementRef<HTMLInputElement>>('importInput');

  protected go(path: string): void {
    void this.router.navigate([path]);
  }

  protected openFilePicker(): void {
    this.fileInput()?.nativeElement.click();
  }

  protected async newHomebrew(): Promise<void> {
    const type = await this.dialogService.open(HomebrewNewChooserComponent).closed;
    if (typeof type === 'string') await this.router.navigate(['/packs/homebrew/new', type]);
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
    if (file) await this.importFile(file);
  }

  protected onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(true);
  }

  protected onDragLeave(): void {
    this.dragging.set(false);
  }

  protected async onDrop(event: DragEvent): Promise<void> {
    event.preventDefault();
    this.dragging.set(false);
    const file = event.dataTransfer?.files?.[0];
    if (file) await this.importFile(file);
  }

  private async importFile(file: File): Promise<void> {
    if (this.importing()) return;
    this.importing.set(true);
    this.importDetails.set([]);
    try {
      const preview = await this.hkpackReader.read(file);
      this.dialogService.open(PackTrustDialogComponent, {
        data: { ...preview, fileName: file.name, fileSize: file.size } satisfies PackTrustData,
        size: 'wide',
      });
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

  /** The homebrew sub-line: "4 entries: Items 3, Spells 1" — each part and the join are the locale's. */
  protected breakdownText(
    row: PackRowView,
    t: (key: string, params?: Record<string, unknown>) => string,
  ): string {
    const parts = row.breakdown.map((part) =>
      t('list.row.part', { type: t('entity-type.' + part.type), count: part.count }),
    );
    return t('list.row.breakdown', {
      entries: t('list.row.entries', { count: row.entries }),
      parts: this.formatList(parts),
    });
  }

  protected formatList(parts: readonly string[]): string {
    return new Intl.ListFormat(this.localeService.locale(), {
      style: 'narrow',
      type: 'unit',
    }).format(parts);
  }
}
