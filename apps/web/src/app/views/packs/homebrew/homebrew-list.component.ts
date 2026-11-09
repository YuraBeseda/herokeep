import { HkTooltipDirective } from '../../../ui/tooltip/tooltip.directive';
import { Component, DestroyRef, computed, effect, inject, resource, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { parseEntityId, type Entity } from '@hk/protocol';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import semver from 'semver';
import { DIALOG_DATA, DialogRef, DialogService } from '@app/ui/dialog/dialog.service';
import { ToastService } from '@shared/components/toast/toast.service';
import { EngineFacade } from '@shared/services/engine/engine.facade';
import { LocaleService } from '@shared/services/i18n/locale.service';
import { HkpackDelivery } from '@shared/services/packs/hkpack-delivery';
import { HomebrewService } from '@shared/services/packs/homebrew.service';
import {
  HkpackAssetsMissingError,
  HkpackWriter,
} from '@shared/services/packs/hkpack-writer.service';
import { IconComponent } from '../../../shared/icons/icon.component';
import { ActionStrapService } from '../../../ui/action-strap/action-strap.service';
import { HkButtonComponent } from '../../../ui/button/button.component';
import { HkLeafComponent } from '../../../ui/leaf/leaf.component';
import { NavHistoryService } from '../../../ui/nav/nav-history.service';
import { HkTagChipComponent } from '../../../ui/tag-chip/tag-chip.component';
import { PackUsageService } from '../pack-usage.service';
import {
  harvestVocabulary,
  HOMEBREW_FORM_TYPES,
  type HomebrewFormType,
} from './entity-form.helpers';
import { HomebrewNewChooserComponent } from './homebrew-new-chooser.component';
import { buildHomebrewListStrap } from './homebrew-list-strap';
import { entrySummary } from './homebrew-summary';

export interface HomebrewDeleteConfirmData {
  readonly name: string;
}

/** `DialogService.open()` content for Delete: closes `true` to delete. */
@Component({
  selector: 'app-homebrew-delete-confirm',
  imports: [TranslocoDirective, HkButtonComponent],
  providers: [provideTranslocoScope('packs')],
  template: `
    <ng-container *transloco="let t; read: 'packs'">
      <h2 class="hb-delete-confirm__title" data-dialog-title>
        {{ t('homebrew.delete-confirm.title', { name: data.name }) }}
      </h2>
      <p class="hb-delete-confirm__body">{{ t('homebrew.delete-confirm.body') }}</p>
      <div class="hb-delete-confirm__actions" data-dialog-actions>
        <button
          hk-button
          [variant]="'ghost-leather'"
          type="button"
          class="hb-delete-confirm__cancel"
          (click)="close(false)"
        >
          {{ t('homebrew.delete-confirm.cancel') }}
        </button>
        <button
          hk-button
          [variant]="'ember'"
          type="button"
          class="hb-delete-confirm__confirm"
          (click)="close(true)"
        >
          {{ t('homebrew.delete-confirm.confirm') }}
        </button>
      </div>
    </ng-container>
  `,
  styles: `
    :host {
      display: block;
      min-inline-size: min(100%, 380px);
    }

    .hb-delete-confirm__body {
      margin: 0 0 var(--space-3);
    }
  `,
})
export class HomebrewDeleteConfirmComponent {
  protected readonly data = inject(DIALOG_DATA) as HomebrewDeleteConfirmData;
  private readonly dialogRef = inject(DialogRef);

  protected close(confirmed: boolean): void {
    this.dialogRef.close(confirmed);
  }
}

interface EntityGroup {
  readonly type: HomebrewFormType;
  readonly entities: readonly Entity[];
}

const GROUP_ICONS: Record<HomebrewFormType, string> = {
  item: 'ui:bag',
  spell: 'ui:spells',
  feat: 'ui:features',
  species: 'ui:heroes',
};

/**
 * `/packs/homebrew` (board PK04) — the local homebrew pack's entities grouped by type (item,
 * spell, feat, species), each with Edit (the type's form) and Delete (asks first, then
 * `HomebrewService.remove` — characters using the entity are left with an Update to review instead
 * of being changed). The side column shows the heroes that pin the pack, the export card and what
 * an entry can be. Entity names are pack data, shown as typed.
 *
 * Strap: Back, New (a chooser over the four forms) and Export as .hkpack (`HkpackWriter`).
 */
@Component({
  selector: 'app-homebrew-list',
  imports: [
    TranslocoDirective,
    RouterLink,
    HkButtonComponent,
    HkLeafComponent,
    HkTagChipComponent,
    HkTooltipDirective,
    IconComponent,
  ],
  providers: [provideTranslocoScope('packs')],
  templateUrl: './homebrew-list.component.html',
  styleUrl: './homebrew-list.component.scss',
})
export class HomebrewListComponent {
  private readonly homebrewService = inject(HomebrewService);
  private readonly dialogService = inject(DialogService);
  private readonly toastService = inject(ToastService);
  private readonly router = inject(Router);
  private readonly navHistory = inject(NavHistoryService);
  private readonly strap = inject(ActionStrapService);
  private readonly packUsageService = inject(PackUsageService);
  private readonly hkpackWriter = inject(HkpackWriter);
  private readonly hkpackDelivery = inject(HkpackDelivery);
  private readonly engineFacade = inject(EngineFacade);
  private readonly localeService = inject(LocaleService);

  protected readonly pack = this.homebrewService.pack;
  protected readonly types = HOMEBREW_FORM_TYPES;
  protected readonly groupIcons = GROUP_ICONS;
  protected readonly groups = computed<EntityGroup[]>(() => {
    const entities = this.pack()?.entities ?? [];
    return this.types.map((type) => ({
      type,
      entities: entities.filter((entity) => entity.type === type),
    }));
  });
  protected readonly entryCount = computed(() => this.pack()?.entities.length ?? 0);
  protected readonly removing = signal<string | null>(null);
  protected readonly exporting = signal(false);

  private readonly classes = computed(
    () => harvestVocabulary(this.engineFacade.index(), this.engineFacade.localizer()).classes,
  );

  /** Every stored character with its pins (read once per visit). */
  private readonly heroes = resource({ loader: () => this.packUsageService.heroPins() });

  /** Heroes pinning this device's homebrew pack, and whether a newer saved version waits for them. */
  protected readonly users = computed(() => {
    const pack = this.pack();
    if (!pack || !this.heroes.hasValue()) return [];
    return this.heroes
      .value()
      .filter((hero) => hero.pins[pack.id] !== undefined)
      .map((hero) => {
        const pinned = hero.pins[pack.id];
        const behind =
          semver.valid(pinned) !== null &&
          semver.valid(pack.version) !== null &&
          semver.lt(pinned, pack.version);
        return { id: hero.id, name: hero.name, pinned, behind };
      });
  });

  /** Why Export is unavailable (full i18n key), or `null`. */
  protected readonly exportReason = computed<string | null>(() => {
    if (!this.pack()) return 'shell.strap.packs-export-none';
    return this.exporting() ? 'shell.strap.packs-export-busy' : null;
  });

  constructor() {
    effect(() =>
      this.strap.set(
        buildHomebrewListStrap({
          back: () => this.navHistory.back(['/packs']),
          newEntry: () => void this.newEntry(),
          exportPack: () => void this.exportPack(),
          exportReason: this.exportReason(),
        }),
      ),
    );
    inject(DestroyRef).onDestroy(() => this.strap.clear());
  }

  protected slugOf(entity: Entity): string {
    return parseEntityId(entity.id)?.slug ?? '';
  }

  /** The facts line under an entry's name, as translated parts (joined by the view). */
  protected summary(
    entity: Entity,
    t: (key: string, params?: Record<string, unknown>) => string,
  ): readonly string[] {
    return entrySummary(entity, t, this.classes(), (parts) => this.formatList(parts));
  }

  /** Joins translated parts the way the active locale lists things. */
  private formatList(parts: readonly string[]): string {
    return new Intl.ListFormat(this.localeService.locale(), {
      style: 'narrow',
      type: 'unit',
    }).format(parts);
  }

  protected attunes(entity: Entity): boolean {
    return entity.type === 'item' && entity.attunement?.required === true;
  }

  protected back(): void {
    this.navHistory.back(['/packs']);
  }

  protected openBuild(id: string): void {
    void this.router.navigate(['/c', id, 'build']);
  }

  protected async newEntry(): Promise<void> {
    const type = await this.dialogService.open(HomebrewNewChooserComponent).closed;
    if (typeof type === 'string') await this.router.navigate(['/packs/homebrew/new', type]);
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

  protected async remove(entity: Entity): Promise<void> {
    if (this.removing() !== null) return;
    const handle = this.dialogService.open(HomebrewDeleteConfirmComponent, {
      data: { name: entity.name } satisfies HomebrewDeleteConfirmData,
    });
    if ((await handle.closed) !== true) return;

    this.removing.set(entity.id);
    try {
      const result = await this.homebrewService.remove(entity.id);
      this.toastService.show('packs.homebrew.removed', { updated: result.fastForwarded.length });
      if (result.pending.length > 0) {
        this.toastService.show('packs.homebrew.pending', { count: result.pending.length });
      }
      if (result.updateCheckFailed) this.toastService.show('packs.homebrew.update-check-failed');
    } catch {
      this.toastService.show('packs.homebrew.remove-failed');
    } finally {
      this.removing.set(null);
    }
  }
}
