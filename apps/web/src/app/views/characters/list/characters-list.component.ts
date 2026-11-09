import {
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  resource,
  viewChild,
  type ElementRef,
} from '@angular/core';
import { Router } from '@angular/router';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { DIALOG_DATA, DialogRef, DialogService } from '@app/ui/dialog/dialog.service';
import { SkeletonComponent } from '@shared/components/skeleton/skeleton.component';
import { ToastService } from '@shared/components/toast/toast.service';
import { AuthService } from '@shared/services/auth/auth.service';
import { CharactersRepository } from '@shared/services/storage/characters.repository';
import type { CharacterRow } from '@shared/services/storage/dexie.db';
import { SyncService } from '@shared/services/sync/sync.service';
import { CharacterStoreNotLeaderError } from '@shared/stores/character.store';
import { ActionStrapService } from '../../../ui/action-strap/action-strap.service';
import { HkButtonComponent } from '../../../ui/button/button.component';
import { HkLeafComponent } from '../../../ui/leaf/leaf.component';
import { HeroCardComponent, type HeroSyncBucket } from '../hero-card/hero-card.component';
import { HERO_IMPORT_ACCEPT, HeroImportFlow } from '../hero-import.flow';
import { HeroSummaryService, type HeroSummary } from '../hero-summary.service';
import { InstallBannerComponent } from './install-banner.component';

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
  imports: [TranslocoDirective, HkButtonComponent],
  template: `
    <ng-container *transloco="let t">
      <h2 class="characters-delete-confirm__title" data-dialog-title>
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
          [variant]="'ember'"
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
 * `/heroes` list (route `/characters`, board H01): every `CharactersRepository` row, newest-first
 * (the repository's own `list()` order), as hero cards (`HeroCardComponent`) that open `/c/<id>`,
 * with the delete flow behind each card's "more" menu (confirm dialog →
 * `SyncService.deleteEverywhere`, task-8-brief.md — stops any live sync session for the row,
 * removes it locally via `CharacterStore.deleteCharacter` (its snapshot and whole event stream),
 * then a best-effort `DELETE /api/characters/:id` when authed; a no-op past the local delete when
 * anon/offline).
 *
 * New hero and Import live in the action strap (zone 2, spec §3) — set here while the list is
 * open and released when it closes; Import opens this screen's hidden `.hero` file input and hands
 * the file to the shared `HeroImportFlow`. Reads the Library index rows plus a per-hero summary
 * (classes, campaign) from `HeroSummaryService`; no hero is loaded into `CharacterStore` to be
 * listed.
 */
@Component({
  selector: 'app-characters-list',
  imports: [
    TranslocoDirective,
    HkLeafComponent,
    SkeletonComponent,
    HeroCardComponent,
    InstallBannerComponent,
  ],
  providers: [provideTranslocoScope('characters')],
  templateUrl: './characters-list.component.html',
  styleUrl: './characters-list.component.scss',
})
export class CharactersListComponent {
  private readonly charactersRepository = inject(CharactersRepository);
  private readonly syncService = inject(SyncService);
  private readonly dialogService = inject(DialogService);
  private readonly toastService = inject(ToastService);
  private readonly router = inject(Router);
  private readonly actionStrap = inject(ActionStrapService);
  private readonly heroImportFlow = inject(HeroImportFlow);
  private readonly heroSummaryService = inject(HeroSummaryService);
  protected readonly authService = inject(AuthService);

  // Template-facing state
  protected readonly skeletonRows: readonly number[] = Array.from(
    { length: SKELETON_ROW_COUNT },
    (_, index) => index,
  );

  // No `params` — this is a one-shot load re-triggered only by an explicit `.reload()` (after a
  // successful delete or import), never by a reactive request value (see BaseResourceOptions's
  // own doc).
  private readonly charactersResource = resource({
    loader: () => this.charactersRepository.list(),
  });

  protected readonly rows = computed(() => this.charactersResource.value() ?? []);
  protected readonly loading = this.charactersResource.isLoading;

  /** Classes and campaign per hero; empty until the rows (and then their streams) are read, so a
   * card first paints with its index-row facts and fills in. */
  private readonly summaryResource = resource({
    params: () => this.rows().map((row) => row.id),
    loader: ({ params }) => this.heroSummaryService.summarize(params),
  });
  protected readonly summaries = computed(
    () => this.summaryResource.value() ?? new Map<string, HeroSummary>(),
  );

  /** Sync state per hero, read once per change rather than per template evaluation. `null` for a
   * signed-out user (solo mode looks exactly as before: no chip at all). */
  protected readonly syncByRow = computed(() => {
    const authed = this.authService.status() === 'authed';
    return new Map(
      this.rows().map((row) => [row.id, authed ? this.syncOf(row.id) : null] as const),
    );
  });

  protected readonly importing = this.heroImportFlow.importing;

  constructor() {
    // Zone 2 of the strap: New hero, Import. Re-set when `importing` changes (Import is disabled
    // while a file is being read); released when the list closes.
    effect(() => {
      const importing = this.importing();
      this.actionStrap.set({
        primary: [
          {
            id: 'new-hero',
            label: 'shell.strap.new-hero',
            icon: 'add',
            kind: 'primary',
            run: () => this.create(),
          },
          {
            id: 'import',
            label: 'shell.strap.import',
            icon: 'import',
            kind: 'parchment',
            disabled: importing,
            run: () => this.onImportClick(),
          },
        ],
        scope: ['/characters'],
      });
    });
    inject(DestroyRef).onDestroy(() => this.actionStrap.clear());
  }

  // Methods
  protected create(): void {
    void this.router.navigate(['/characters/new']);
  }

  protected open(id: string): void {
    void this.router.navigate(['/c', id]);
  }

  // --- `.hero` import (plan-6 Task 10) -----------------------------------------------------

  protected readonly importAccept = HERO_IMPORT_ACCEPT;
  protected readonly importInput = viewChild<ElementRef<HTMLInputElement>>('importInput');

  protected onImportClick(): void {
    this.importInput()?.nativeElement.click();
  }

  protected async onImportFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    // Reset immediately so re-selecting the SAME file path still fires a fresh `change` event —
    // the browser only fires `change` when the input's value actually differs from before.
    input.value = '';
    if (!file) return;

    const result = await this.heroImportFlow.importFile(file);
    if (result) this.charactersResource.reload();
  }

  protected async delete(row: CharacterRow): Promise<void> {
    const handle = this.dialogService.open(CharactersDeleteConfirmComponent, {
      data: { name: row.name },
    });
    const confirmed = await handle.closed;
    if (confirmed !== true) return;

    try {
      await this.syncService.deleteEverywhere(row.id);
      this.charactersResource.reload();
      this.toastService.show('characters.list.toast.deleted', { name: row.name });
    } catch (error) {
      const key =
        error instanceof CharacterStoreNotLeaderError ? error.code : GENERIC_DELETE_FAILURE_KEY;
      this.toastService.show(key);
    }
  }

  // --- Sync-status chip (task-9-brief.md) --------------------------------------------------
  //
  // Placement: a chip on each hero card. This is the one screen where every synced character is
  // visible AT ONCE — a user with several characters can see which ones are still catching up (or
  // offline) without opening each one. Hidden entirely when anon (task brief: "solo mode looks
  // exactly as today") — `SyncService` never opens a session for anyone logged out, so
  // `syncState` would always read 'offline' anyway; gating on `authService.status()` avoids ever
  // rendering a misleading "offline" chip for a user who was never trying to sync.

  private static readonly PENDING_STATE = /^pending-(\d+)$/;

  private syncOf(id: string): { bucket: HeroSyncBucket; count: number } {
    const state = this.syncService.syncState(id)();
    if (state === 'synced' || state === 'connecting' || state === 'offline') {
      return { bucket: state, count: 0 };
    }
    // The remaining `SyncStateValue` shape is the `pending-${number}` template literal.
    const match = CharactersListComponent.PENDING_STATE.exec(state);
    return { bucket: 'pending', count: match ? Number(match[1]) : 0 };
  }
}
