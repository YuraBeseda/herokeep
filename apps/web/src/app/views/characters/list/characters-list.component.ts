import {
  Component,
  computed,
  inject,
  resource,
  signal,
  viewChild,
  type ElementRef,
} from '@angular/core';
import { Router } from '@angular/router';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { ButtonComponent } from '@shared/components/button/button.component';
import { CardComponent } from '@shared/components/card/card.component';
import { DIALOG_DATA, DialogRef, DialogService } from '@shared/components/dialog/dialog.service';
import { SkeletonComponent } from '@shared/components/skeleton/skeleton.component';
import { ToastService } from '@shared/components/toast/toast.service';
import { BlobUrlPipe } from '@shared/pipes/blob-url.pipe';
import {
  HeroImportBadEventError,
  HeroImportBadManifestError,
  HeroImportBadZipError,
  HeroImportHashMismatchError,
  HeroReaderService,
} from '@shared/services/export/hero-reader.service';
import { AuthService } from '@shared/services/auth/auth.service';
import { PlaceholderService } from '@shared/services/images/placeholder.service';
import { CharactersRepository } from '@shared/services/storage/characters.repository';
import type { CharacterRow } from '@shared/services/storage/dexie.db';
import { SyncService } from '@shared/services/sync/sync.service';
import { CharacterStoreNotLeaderError } from '@shared/stores/character.store';
import { InstallBannerComponent } from './install-banner.component';

const SKELETON_ROW_COUNT = 4;
const GENERIC_DELETE_FAILURE_KEY = 'characters.list.toast.delete-failed';
const GENERIC_IMPORT_FAILURE_KEY = 'characters.list.toast.import-failed-generic';
/** `.hero` files only — the extension `HeroWriterService.export` names its downloads with. */
const IMPORT_ACCEPT = '.hero';

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
 * `SyncService.deleteEverywhere`, task-8-brief.md — stops any live sync session for the row,
 * removes it locally via `CharacterStore.deleteCharacter` (its snapshot and whole event stream),
 * then a best-effort `DELETE /api/characters/:id` when authed; a no-op past the local delete when
 * anon/offline). Reads straight from `CharactersRepository` rather than `CharacterStore` — the index
 * rows (`{id, name, system, archived, updatedAt, portraitThumbHash?}`) are all a list needs; no
 * reason to load/reduce any character's full event stream just to show its name.
 */
@Component({
  selector: 'app-characters-list',
  imports: [
    TranslocoDirective,
    CardComponent,
    ButtonComponent,
    SkeletonComponent,
    BlobUrlPipe,
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
  private readonly placeholderService = inject(PlaceholderService);
  private readonly heroReaderService = inject(HeroReaderService);
  protected readonly authService = inject(AuthService);

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

  /** `PlaceholderService.monogram` for a row that has no `portraitThumbHash` (or whose thumb blob
   * hasn't resolved yet) — deterministic per character id, matching `sheet-shell.component.ts`'s
   * own header placeholder for the SAME character. */
  protected monogramInitials(row: CharacterRow): string {
    return this.placeholderService.monogram(row.name, row.id).initials;
  }

  // Fix-round 1, finding 4: `PlaceholderService.monogram` now computes the `hsl(...)` string
  // itself (`Monogram.background`) — this just re-exposes it under the name the template binds,
  // rather than re-deriving the formula here (previously duplicated, verbatim, across THREE
  // components, and already once out of sync with this service's own doc comment).
  protected monogramBackground(row: CharacterRow): string {
    return this.placeholderService.monogram(row.name, row.id).background;
  }

  // Methods
  protected create(): void {
    void this.router.navigate(['/characters/new']);
  }

  protected open(id: string): void {
    void this.router.navigate(['/c', id]);
  }

  // --- `.hero` import (plan-6 Task 10) -----------------------------------------------------

  protected readonly importAccept = IMPORT_ACCEPT;
  protected readonly importInput = viewChild<ElementRef<HTMLInputElement>>('importInput');

  /** Guards against a second file pick racing an already-in-flight import — same re-entrancy
   * reasoning as `BuildTabComponent`'s `portraitUploading` (task-8-brief.md's own pattern): the
   * control is disabled in the template (`[disabled]="importing()"`) AND the handler
   * short-circuits a synthetic/queued event that slips through anyway. */
  protected readonly importing = signal(false);

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
    if (this.importing()) return;

    this.importing.set(true);
    try {
      const result = await this.heroReaderService.import(file);
      this.charactersResource.reload();
      const key =
        result.mode === 'created'
          ? 'characters.list.toast.import-created'
          : 'characters.list.toast.import-merged';
      this.toastService.show(key, {
        name: result.name,
        imported: result.imported,
        skippedDuplicates: result.skippedDuplicates,
      });
    } catch (error) {
      this.toastService.show(...this.importFailureToastArgs(error));
    } finally {
      this.importing.set(false);
    }
  }

  /** Maps every `HeroReaderService.import` failure mode to its toast `show(key, params?)` args —
   * each typed error already carries its own full, global i18n key as `code` (same pattern as
   * `CharacterStoreNotLeaderError`, checked here too: a non-leader tab can't import either).
   * `HeroImportBadEventError`'s 0-based `index` is shown 1-based — friendlier for a user who has
   * no reason to think in array positions. */
  private importFailureToastArgs(error: unknown): [string, Record<string, unknown>?] {
    if (error instanceof HeroImportBadEventError) {
      return [error.code, { index: error.index + 1 }];
    }
    if (
      error instanceof HeroImportBadZipError ||
      error instanceof HeroImportBadManifestError ||
      error instanceof HeroImportHashMismatchError ||
      error instanceof CharacterStoreNotLeaderError
    ) {
      return [error.code];
    }
    return [GENERIC_IMPORT_FAILURE_KEY];
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

  // --- Sync-status indicator (task-9-brief.md) --------------------------------------------
  //
  // Placement: a small per-row badge here on the Library list rather than the sheet shell
  // header. This is the one screen where every synced character is visible AT ONCE — a user
  // with several characters can see which ones are still catching up (or offline) without
  // opening each one individually, which the sheet header (one character at a time) can't offer.
  // It also keeps the footprint to ONE component: `row.id` is already this exact streamId
  // `SyncService.syncState` expects, no extra plumbing needed. Hidden entirely when anon (task
  // brief: "solo mode looks exactly as today") — `SyncService` never opens a session for anyone
  // logged out, so `syncState` would always read 'offline' anyway; gating on `authService.status()`
  // avoids ever rendering a misleading "offline" dot for a user who was never trying to sync.

  private static readonly PENDING_STATE = /^pending-(\d+)$/;

  protected syncStateBucket(id: string): 'synced' | 'pending' | 'connecting' | 'offline' {
    const state = this.syncService.syncState(id)();
    if (state === 'synced' || state === 'connecting' || state === 'offline') return state;
    return 'pending'; // the remaining `SyncStateValue` shape is the `pending-${number}` template literal
  }

  protected syncPendingCount(id: string): number {
    const state = this.syncService.syncState(id)();
    const match = CharactersListComponent.PENDING_STATE.exec(state);
    return match ? Number(match[1]) : 0;
  }

  // Scope-relative key for the badge's tooltip/aria-label — same `t(key, params)` shape every
  // other translated string in this template already uses.
  protected syncTooltipKey(id: string): string {
    return `list.sync.tooltip.${this.syncStateBucket(id)}`;
  }
}
