import { Component, computed, inject, resource } from '@angular/core';
import { Router } from '@angular/router';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { ButtonComponent } from '@shared/components/button/button.component';
import { CardComponent } from '@shared/components/card/card.component';
import { DIALOG_DATA, DialogRef, DialogService } from '@shared/components/dialog/dialog.service';
import { SkeletonComponent } from '@shared/components/skeleton/skeleton.component';
import { ToastService } from '@shared/components/toast/toast.service';
import { CharactersRepository } from '@shared/services/storage/characters.repository';
import type { CharacterRow } from '@shared/services/storage/dexie.db';
import { CharacterStore, CharacterStoreNotLeaderError } from '@shared/stores/character.store';

const SKELETON_ROW_COUNT = 4;
const GENERIC_DELETE_FAILURE_KEY = 'characters.list.toast.delete-failed';

/**
 * One-off content component for the delete confirmation dialog (per `hk-dialog`'s "wrap it in a
 * tiny component" guidance — the shell has no templates-as-content API). `DialogService.open()`
 * attaches this under a NEW injector rooted at the app's root injector, not this file's own
 * `CharactersListComponent` instance, so it can NOT rely on that component's own
 * `provideTranslocoScope('characters')` — it renders through the global (unscoped) `*transloco`
 * lookup instead (same reasoning as `hk-toast`'s SKILL.md), which is safe here because the
 * `characters` scope is always already loaded by the time this dialog can be opened (its only
 * caller, `CharactersListComponent`, provides and reads that scope itself first).
 */
@Component({
  selector: 'app-characters-delete-confirm',
  imports: [TranslocoDirective, ButtonComponent],
  template: `
    <ng-container *transloco="let t">
      <h2 class="characters-delete-confirm__title">
        {{ t('characters.list.deleteConfirm.title', { name: data.name }) }}
      </h2>
      <p class="characters-delete-confirm__body">{{ t('characters.list.deleteConfirm.body') }}</p>
      <div class="characters-delete-confirm__actions">
        <button
          hk-button
          [variant]="'ghost'"
          type="button"
          class="characters-delete-confirm__cancel"
          (click)="cancel()"
        >
          {{ t('characters.list.deleteConfirm.cancel') }}
        </button>
        <button
          hk-button
          [variant]="'danger'"
          type="button"
          class="characters-delete-confirm__confirm"
          (click)="confirm()"
        >
          {{ t('characters.list.deleteConfirm.confirm') }}
        </button>
      </div>
    </ng-container>
  `,
})
export class CharactersDeleteConfirmComponent {
  protected readonly data = inject<{ name: string }>(DIALOG_DATA);
  private readonly dialogRef = inject(DialogRef);

  protected confirm(): void {
    this.dialogRef.close(true);
  }

  protected cancel(): void {
    this.dialogRef.close(false);
  }
}

/**
 * `/characters` — the character-list view (plan-5 Task 3): every `CharactersRepository` row,
 * newest-first (the repository's own `list()` order), a "create" action to `/characters/new`
 * (T5), each row opening `/c/<id>` (T10), and a delete flow (confirm dialog →
 * `CharacterStore.deleteCharacter`, which removes the row, its snapshot, and its whole event
 * stream). Reads straight from `CharactersRepository` rather than `CharacterStore` — the index
 * rows (`{id, name, system, archived, updatedAt, portraitThumbHash?}`) are all a list needs; no
 * reason to load/reduce any character's full event stream just to show its name.
 */
@Component({
  selector: 'app-characters-list',
  imports: [TranslocoDirective, CardComponent, ButtonComponent, SkeletonComponent],
  providers: [provideTranslocoScope('characters')],
  templateUrl: './characters-list.component.html',
  styleUrl: './characters-list.component.scss',
})
export class CharactersListComponent {
  private readonly charactersRepository = inject(CharactersRepository);
  private readonly characterStore = inject(CharacterStore);
  private readonly dialogService = inject(DialogService);
  private readonly toastService = inject(ToastService);
  private readonly router = inject(Router);

  // Template-facing state
  protected readonly skeletonRows: readonly number[] = Array.from(
    { length: SKELETON_ROW_COUNT },
    (_, index) => index,
  );

  // No `params` — this is a one-shot load re-triggered only by an explicit `.reload()` (after a
  // successful delete), never by a reactive request value (see BaseResourceOptions's own doc).
  private readonly charactersResource = resource({
    loader: () => this.charactersRepository.list(),
  });

  protected readonly rows = computed(() => this.charactersResource.value() ?? []);
  protected readonly loading = this.charactersResource.isLoading;

  // Methods
  protected create(): void {
    void this.router.navigate(['/characters/new']);
  }

  protected open(id: string): void {
    void this.router.navigate(['/c', id]);
  }

  protected async delete(row: CharacterRow): Promise<void> {
    const handle = this.dialogService.open(CharactersDeleteConfirmComponent, {
      data: { name: row.name },
    });
    const confirmed = await handle.closed;
    if (confirmed !== true) return;

    try {
      await this.characterStore.deleteCharacter(row.id);
      this.charactersResource.reload();
      this.toastService.show('characters.list.toast.deleted', { name: row.name });
    } catch (error) {
      const key =
        error instanceof CharacterStoreNotLeaderError ? error.code : GENERIC_DELETE_FAILURE_KEY;
      this.toastService.show(key);
    }
  }
}
