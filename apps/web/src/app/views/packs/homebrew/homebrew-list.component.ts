import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { parseEntityId, type Entity } from '@hk/protocol';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { ButtonComponent } from '@shared/components/button/button.component';
import { CardComponent } from '@shared/components/card/card.component';
import { DIALOG_DATA, DialogRef, DialogService } from '@shared/components/dialog/dialog.service';
import { ToastService } from '@shared/components/toast/toast.service';
import { HomebrewService } from '@shared/services/packs/homebrew.service';
import { HOMEBREW_FORM_TYPES, type HomebrewFormType } from './entity-form.helpers';

export interface HomebrewDeleteConfirmData {
  readonly name: string;
}

/** `DialogService.open()` content for Delete: closes `true` to delete. */
@Component({
  selector: 'app-homebrew-delete-confirm',
  imports: [TranslocoDirective, ButtonComponent],
  providers: [provideTranslocoScope('packs')],
  template: `
    <ng-container *transloco="let t; read: 'packs'">
      <h2 class="hb-delete-confirm__title" data-dialog-title>
        {{ t('homebrew.delete-confirm.title', { name: data.name }) }}
      </h2>
      <p class="hb-delete-confirm__body">{{ t('homebrew.delete-confirm.body') }}</p>
      <div class="hb-delete-confirm__actions">
        <button
          hk-button
          [variant]="'ghost'"
          type="button"
          class="hb-delete-confirm__cancel"
          (click)="close(false)"
        >
          {{ t('homebrew.delete-confirm.cancel') }}
        </button>
        <button
          hk-button
          [variant]="'danger'"
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
    .hb-delete-confirm__title {
      margin: 0 0 var(--space-2);
      font-size: 1.125rem;
    }
    .hb-delete-confirm__body {
      margin: 0 0 var(--space-4);
      color: var(--text-2);
    }
    .hb-delete-confirm__actions {
      display: flex;
      flex-wrap: wrap;
      justify-content: flex-end;
      gap: var(--space-2);
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

/**
 * `/packs/homebrew` — the local homebrew pack's entities grouped by type (item, spell, feat,
 * species), each with Edit (the type's form) and Delete (asks first, then `HomebrewService.remove`
 * — characters using the entity are left with an Update to review instead of being changed), plus
 * one "New …" link per type. Entity names are pack data, shown as typed.
 */
@Component({
  selector: 'app-homebrew-list',
  imports: [TranslocoDirective, RouterLink, ButtonComponent, CardComponent],
  providers: [provideTranslocoScope('packs')],
  templateUrl: './homebrew-list.component.html',
  styleUrl: './homebrew-list.component.scss',
})
export class HomebrewListComponent {
  private readonly homebrewService = inject(HomebrewService);
  private readonly dialogService = inject(DialogService);
  private readonly toastService = inject(ToastService);

  protected readonly pack = this.homebrewService.pack;
  protected readonly types = HOMEBREW_FORM_TYPES;
  protected readonly groups = computed<EntityGroup[]>(() => {
    const entities = this.pack()?.entities ?? [];
    return this.types.map((type) => ({
      type,
      entities: entities.filter((entity) => entity.type === type),
    }));
  });
  protected readonly removing = signal<string | null>(null);

  protected slugOf(entity: Entity): string {
    return parseEntityId(entity.id)?.slug ?? '';
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
    } catch {
      this.toastService.show('packs.homebrew.remove-failed');
    } finally {
      this.removing.set(null);
    }
  }
}
