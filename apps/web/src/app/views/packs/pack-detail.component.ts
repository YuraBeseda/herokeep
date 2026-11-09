import { HkTooltipDirective } from '../../ui/tooltip/tooltip.directive';
import { Component, DestroyRef, computed, effect, inject, resource, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { validatePack } from '@hk/engine';
import type { Pack } from '@hk/protocol';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import semver from 'semver';
import { map } from 'rxjs';
import { DIALOG_DATA, DialogRef, DialogService } from '@app/ui/dialog/dialog.service';
import { ToastService } from '@shared/components/toast/toast.service';
import { HkpackDelivery } from '@shared/services/packs/hkpack-delivery';
import {
  HkpackAssetsMissingError,
  HkpackWriter,
} from '@shared/services/packs/hkpack-writer.service';
import { isHomebrewPackId } from '@shared/services/packs/homebrew-id';
import { BlobUrlPipe } from '@shared/pipes/blob-url.pipe';
import { CampaignPacksService } from '@shared/services/campaigns/campaign-packs.service';
import { EngineFacade } from '@shared/services/engine/engine.facade';
import { CampaignsRepository } from '@shared/services/storage/campaigns.repository';
import { CampaignStore } from '@shared/stores/campaign.store';
import { PackRemoveDependentsError, PackStore } from '@shared/stores/pack.store';
import { HeroSummaryService } from '../characters/hero-summary.service';
import { heroClassLine } from '../characters/hero-class-line';
import { IconComponent } from '../../shared/icons/icon.component';
import { ActionStrapService } from '../../ui/action-strap/action-strap.service';
import { HkButtonComponent } from '../../ui/button/button.component';
import { HkLeafComponent } from '../../ui/leaf/leaf.component';
import { HkPortraitFrameComponent } from '../../ui/portrait-frame/portrait-frame.component';
import { NavHistoryService } from '../../ui/nav/nav-history.service';
import { HkTagChipComponent } from '../../ui/tag-chip/tag-chip.component';
import { buildPackDetailStrap } from './pack-detail-strap';
import { PackInfoComponent } from './pack-info.component';
import { packKey, summarizePack } from './pack-summary';
import { resolveDependencies } from './pack-dependencies';
import { PackUsageService } from './pack-usage.service';

export interface PackRemoveConfirmData {
  readonly name: string;
  /** Stored characters pinning the pack (`PackUsageService.countPinning`). */
  readonly count: number;
}

/**
 * `DialogService.open()` content for the detail screen's Remove: warns that characters pinning
 * the pack will show unresolved references once it is gone. Closes `true` to remove.
 */
@Component({
  selector: 'app-pack-remove-confirm',
  imports: [TranslocoDirective, HkButtonComponent],
  providers: [provideTranslocoScope('packs')],
  template: `
    <ng-container *transloco="let t; read: 'packs'">
      <h2 class="pack-remove-confirm__title" data-dialog-title>
        {{ t('remove-confirm.title', { name: data.name }) }}
      </h2>
      <p class="pack-remove-confirm__body">
        {{ t('remove-confirm.body', { count: data.count }) }}
      </p>
      <div class="pack-remove-confirm__actions" data-dialog-actions>
        <button
          hk-button
          [variant]="'ghost-leather'"
          type="button"
          class="pack-remove-confirm__cancel"
          (click)="cancel()"
        >
          {{ t('remove-confirm.cancel') }}
        </button>
        <button
          hk-button
          [variant]="'ember'"
          type="button"
          class="pack-remove-confirm__confirm"
          (click)="confirm()"
        >
          {{ t('remove-confirm.confirm') }}
        </button>
      </div>
    </ng-container>
  `,
  styles: `
    :host {
      display: block;
      min-inline-size: min(100%, 380px);
    }

    .pack-remove-confirm__body {
      margin: 0 0 var(--space-3);
    }
  `,
})
export class PackRemoveConfirmComponent {
  protected readonly data = inject<PackRemoveConfirmData>(DIALOG_DATA);
  private readonly dialogRef = inject(DialogRef);

  protected confirm(): void {
    this.dialogRef.close(true);
  }

  protected cancel(): void {
    this.dialogRef.close(false);
  }
}

/** One installed version of the shown pack's id, and how many stored heroes pin it. */
interface VersionRow {
  readonly version: string;
  readonly pinnedBy: number;
  readonly current: boolean;
}

/**
 * `/packs/:key` (`key = id@version`, board PK02): what the trust screen showed, for an installed
 * pack, plus "Used by N heroes", the versions kept on this device, dependencies in both
 * directions, and Remove in a danger block. The core pack is shown too but is never removable.
 * Unknown keys (including translation packs, which are managed from the list) show not-found.
 *
 * Validation warnings are recomputed against the core and the other installed content packs —
 * the same context the importer used (`HkpackReader`), minus this pack itself.
 *
 * Strap: Back, an "Update pack" slot that is drawn disabled (updates are installed versions that
 * heroes adopt from their Build tab, so the pack screen has nothing to start), Export as .hkpack
 * (`HkpackWriter`) and a disabled "Browse in the library" (the library has no pack filter).
 */
@Component({
  selector: 'app-pack-detail',
  imports: [
    TranslocoDirective,
    HkButtonComponent,
    HkLeafComponent,
    HkTagChipComponent,
    HkTooltipDirective,
    HkPortraitFrameComponent,
    BlobUrlPipe,
    IconComponent,
    PackInfoComponent,
  ],
  providers: [provideTranslocoScope('packs')],
  templateUrl: './pack-detail.component.html',
  styleUrl: './pack-detail.component.scss',
})
export class PackDetailComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly packStore = inject(PackStore);
  private readonly packUsageService = inject(PackUsageService);
  private readonly dialogService = inject(DialogService);
  private readonly toastService = inject(ToastService);
  private readonly navHistory = inject(NavHistoryService);
  private readonly strap = inject(ActionStrapService);
  private readonly hkpackWriter = inject(HkpackWriter);
  private readonly hkpackDelivery = inject(HkpackDelivery);
  private readonly campaignStore = inject(CampaignStore);
  private readonly campaignsRepository = inject(CampaignsRepository);
  private readonly campaignPacks = inject(CampaignPacksService);
  private readonly heroSummaryService = inject(HeroSummaryService);
  private readonly engineFacade = inject(EngineFacade);

  protected readonly key = toSignal(
    this.route.paramMap.pipe(map((params) => params.get('key') ?? '')),
    { initialValue: this.route.snapshot.paramMap.get('key') ?? '' },
  );

  private readonly core = computed(() => {
    const core = this.packStore.corePack();
    return core && packKey(core) === this.key() ? core : undefined;
  });

  protected readonly pack = computed<Pack | undefined>(
    () => this.core() ?? this.packStore.installedContent().find((p) => packKey(p) === this.key()),
  );
  protected readonly isCore = computed(() => this.core() !== undefined);
  protected readonly isHomebrew = computed(() => {
    const pack = this.pack();
    return pack !== undefined && isHomebrewPackId(pack.id);
  });
  protected readonly summary = computed(() => {
    const pack = this.pack();
    return pack ? summarizePack(pack) : undefined;
  });
  protected readonly diagnostics = computed(() => {
    const pack = this.pack();
    const core = this.packStore.corePack();
    if (!pack || !core || this.isCore()) return [];
    const others = this.packStore.installedContent().filter((p) => p !== pack);
    return validatePack(pack, [core, ...others]).filter((d) => d.severity !== 'error');
  });

  /** Every stored character with its pins (read once per visit). */
  protected readonly heroes = resource({ loader: () => this.packUsageService.heroPins() });

  /** Campaigns that share exactly this pack version, with the state of its sha256 check here. */
  private readonly campaignRows = resource({ loader: () => this.campaignsRepository.list() });
  protected readonly campaignShares = computed(() => {
    const pack = this.pack();
    if (!pack || !this.campaignRows.hasValue()) return [];
    const enabled = this.campaignStore.enabledPacks();
    return this.campaignRows.value().flatMap((row) => {
      const entry = enabled.get(row.id)?.get(pack.id);
      if (entry?.version !== pack.version) return [];
      const state = this.campaignPacks.installStatus(row.id)().get(pack.id)?.state ?? 'installing';
      return [{ id: row.id, name: row.name, state }];
    });
  });

  /** The stored heroes pinning exactly this pack version. */
  protected readonly users = computed(() => {
    const pack = this.pack();
    if (!pack || !this.heroes.hasValue()) return [];
    return this.heroes.value().filter((hero) => hero.pins[pack.id] === pack.version);
  });
  protected readonly usedBy = computed(() => (this.heroes.hasValue() ? this.users().length : null));

  /** Class lines and campaigns of the heroes in `users`, as the hero cards show them. */
  private readonly summaries = resource({
    params: () => this.users().map((hero) => hero.id),
    loader: ({ params }) => this.heroSummaryService.summarize(params),
  });

  protected classLine(
    hero: { id: string; system: string },
    t: (key: string, params?: Record<string, unknown>) => string,
  ): string {
    const summary = this.summaries.hasValue() ? this.summaries.value().get(hero.id) : undefined;
    return heroClassLine(summary, hero.system, this.engineFacade.localizer(), (_key, params) =>
      t('detail.class-level', params),
    );
  }

  /** Installed versions of this pack id on the device, newest first. */
  protected readonly versions = computed<readonly VersionRow[]>(() => {
    const pack = this.pack();
    if (!pack) return [];
    const core = this.packStore.corePack();
    const all = [...(core ? [core] : []), ...this.packStore.installedContent()].filter(
      (p) => p.id === pack.id,
    );
    const versions = all
      .map((p) => p.version)
      .sort((a, b) => (semver.valid(a) && semver.valid(b) ? semver.rcompare(a, b) : 0));
    const heroes = this.heroes.hasValue() ? this.heroes.value() : [];
    return versions.map((version, index) => ({
      version,
      pinnedBy: heroes.filter((hero) => hero.pins[pack.id] === version).length,
      current: index === 0,
    }));
  });

  /** Installed content packs that need this one (`PackStore.dependentsOf`): Remove stays disabled
   * until they are removed (plan 15 final fix wave B6). */
  protected readonly dependents = computed<Pack[]>(() => {
    const pack = this.pack();
    if (!pack || this.isCore()) return [];
    this.packStore.installedContent(); // re-run when the installed set changes
    return this.packStore.dependentsOf(packKey(pack));
  });

  /** The packs this one requires, with the installed one that satisfies each. */
  protected readonly needs = computed(() => {
    const pack = this.pack();
    if (!pack) return [];
    const core = this.packStore.corePack();
    return resolveDependencies(pack.dependencies, [
      ...(core ? [core] : []),
      ...this.packStore.installedContent(),
    ]);
  });

  protected readonly removing = signal(false);
  protected readonly exporting = signal(false);

  /** Why Export is unavailable: the key of the reason, or `null`. */
  protected readonly exportReason = computed<string | null>(() => {
    const pack = this.pack();
    if (!pack) return 'shell.strap.packs-export-none';
    if (this.isCore()) return 'shell.strap.packs-export-core';
    if (this.exporting()) return 'shell.strap.packs-export-busy';
    const core = this.packStore.corePack();
    const others = this.packStore.installedContent().filter((p) => p !== pack);
    const refused =
      pack.kind !== 'content' ||
      (core !== undefined &&
        validatePack(pack, [core, ...others]).some(
          (diagnostic) => diagnostic.severity === 'error',
        ));
    return refused ? 'shell.strap.packs-export-invalid' : null;
  });

  constructor() {
    effect(() => {
      this.strap.set(
        buildPackDetailStrap({
          back: () => this.back(),
          exportPack: () => void this.exportPack(),
          exportReason: this.exportReason(),
        }),
      );
    });
    inject(DestroyRef).onDestroy(() => this.strap.clear());
  }

  protected back(): void {
    this.navHistory.back(['/packs']);
  }

  protected openSheet(id: string): void {
    void this.router.navigate(['/c', id]);
  }

  protected async exportPack(): Promise<void> {
    const pack = this.pack();
    if (!pack || this.exportReason() !== null) return;
    this.exporting.set(true);
    try {
      const { blob, fileName } = await this.hkpackWriter.export(pack);
      await this.hkpackDelivery.deliver(blob, fileName, pack.name);
    } catch (error) {
      this.toastService.show(
        error instanceof HkpackAssetsMissingError ? error.code : 'packs.export-failed',
      );
    } finally {
      this.exporting.set(false);
    }
  }

  protected async remove(): Promise<void> {
    const pack = this.pack();
    if (!pack || this.isCore() || this.removing() || this.dependents().length > 0) return;

    this.removing.set(true);
    try {
      const count = this.heroes.hasValue()
        ? this.users().length
        : await this.packUsageService.countPinning(pack.id, pack.version);
      const handle = this.dialogService.open(PackRemoveConfirmComponent, {
        data: { name: pack.name, count } satisfies PackRemoveConfirmData,
      });
      if ((await handle.closed) !== true) return;

      await this.packStore.removeContent(packKey(pack));
      this.toastService.show('packs.remove-success');
      await this.router.navigate(['/packs']);
    } catch (error) {
      this.toastService.show(
        error instanceof PackRemoveDependentsError ? error.code : 'packs.remove-failed',
      );
    } finally {
      this.removing.set(false);
    }
  }
}
