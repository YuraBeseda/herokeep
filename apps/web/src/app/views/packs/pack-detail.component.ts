import { Component, computed, inject, resource, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { validatePack } from '@hk/engine';
import type { Pack } from '@hk/protocol';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { map } from 'rxjs';
import { ButtonComponent } from '@shared/components/button/button.component';
import { DIALOG_DATA, DialogRef, DialogService } from '@shared/components/dialog/dialog.service';
import { ToastService } from '@shared/components/toast/toast.service';
import { PackStore } from '@shared/stores/pack.store';
import { PackInfoComponent } from './pack-info.component';
import { packKey, summarizePack } from './pack-summary';
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
  imports: [TranslocoDirective, ButtonComponent],
  providers: [provideTranslocoScope('packs')],
  template: `
    <ng-container *transloco="let t; read: 'packs'">
      <h2 class="pack-remove-confirm__title" data-dialog-title>
        {{ t('remove-confirm.title', { name: data.name }) }}
      </h2>
      <p class="pack-remove-confirm__body">
        {{ t('remove-confirm.body', { count: data.count }) }}
      </p>
      <div class="pack-remove-confirm__actions">
        <button
          hk-button
          [variant]="'ghost'"
          type="button"
          class="pack-remove-confirm__cancel"
          (click)="cancel()"
        >
          {{ t('remove-confirm.cancel') }}
        </button>
        <button
          hk-button
          [variant]="'danger'"
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
    .pack-remove-confirm__title {
      margin: 0 0 var(--space-3);
      font-family: var(--font-display);
    }

    .pack-remove-confirm__body {
      margin: 0 0 var(--space-3);
    }

    .pack-remove-confirm__actions {
      display: flex;
      justify-content: flex-end;
      gap: var(--space-3);
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

/**
 * `/packs/:key` (`key = id@version`): what the trust screen showed, for an installed pack, plus
 * "Used by N characters" and Remove. The core pack is shown too but is never removable. Unknown
 * keys (including translation packs, which are managed from the list's chips) show not-found.
 *
 * Validation warnings are recomputed against the core and the other installed content packs —
 * the same context the importer used (`HkpackReader`), minus this pack itself.
 */
@Component({
  selector: 'app-pack-detail',
  imports: [TranslocoDirective, RouterLink, ButtonComponent, PackInfoComponent],
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

  protected readonly usage = resource({
    params: () => {
      const pack = this.pack();
      return pack ? { id: pack.id, version: pack.version } : undefined;
    },
    loader: ({ params }) => this.packUsageService.countPinning(params.id, params.version),
  });

  protected readonly removing = signal(false);

  protected async remove(): Promise<void> {
    const pack = this.pack();
    if (!pack || this.isCore() || this.removing()) return;

    this.removing.set(true);
    try {
      // `value()` throws while the resource is in its error state, so check `hasValue()` first.
      const count = this.usage.hasValue()
        ? this.usage.value()
        : await this.packUsageService.countPinning(pack.id, pack.version);
      const handle = this.dialogService.open(PackRemoveConfirmComponent, {
        data: { name: pack.name, count } satisfies PackRemoveConfirmData,
      });
      if ((await handle.closed) !== true) return;

      await this.packStore.removeContent(packKey(pack));
      this.toastService.show('packs.remove-success');
      await this.router.navigate(['/packs']);
    } catch {
      this.toastService.show('packs.remove-failed');
    } finally {
      this.removing.set(false);
    }
  }
}
