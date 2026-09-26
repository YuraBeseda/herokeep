import { Component, computed, inject, signal } from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';
import { ButtonComponent } from '@shared/components/button/button.component';
import { DialogRef } from '@shared/components/dialog/dialog.service';
import { PackStore } from '@shared/stores/pack.store';
import {
  CampaignStore,
  CampaignStoreNotAuthenticatedError,
  CampaignStoreNotLeaderError,
} from '@shared/stores/campaign.store';

const NAME_MAX_LENGTH = 200;

/**
 * `CampaignsListComponent`'s "New campaign" dialog (plan-10 task-6-brief.md): collects ONLY the
 * name — "system fixed to SRD pack like character creation" — `CampaignStore.create` internally
 * reads `PackStore.corePack()` for the `corePack: {id, version}` the server's `POST /api/campaigns`
 * needs; this dialog passes `core.id` as the `system` argument, mirroring
 * `create-wizard.state.ts`'s own `system: core.id` precedent exactly (the core pack's own id IS
 * the campaign's system slug — there is no separate "choose a system" step in this plan).
 * Closes with the new campaign's full `camp:<uuid>` stream id on success, `undefined` on
 * cancel/ESC/backdrop — the caller (`CampaignsListComponent`) is what navigates to `/g/<id>/lobby`.
 *
 * `DialogService.open()` attaches this under a NEW injector rooted at the app's root, not
 * `CampaignsListComponent`'s own — same "no `provideTranslocoScope('campaigns')` of its own,
 * fully-qualified global keys" pattern as `characters-list.component.ts`'s own
 * `CharactersDeleteConfirmComponent` (see that file's doc comment): safe because the `campaigns`
 * scope is always already loaded by the time this dialog can open (its only caller loads it).
 */
@Component({
  selector: 'app-create-campaign-dialog',
  imports: [TranslocoDirective, ButtonComponent],
  templateUrl: './create-campaign-dialog.component.html',
})
export class CreateCampaignDialogComponent {
  private readonly campaignStore = inject(CampaignStore);
  private readonly packStore = inject(PackStore);
  private readonly dialogRef = inject(DialogRef);

  protected readonly name = signal('');
  protected readonly submitting = signal(false);
  protected readonly errorKey = signal<string | undefined>(undefined);

  protected readonly nameTooLong = computed(() => this.name().trim().length > NAME_MAX_LENGTH);
  protected readonly canSubmit = computed(
    () => this.name().trim().length > 0 && !this.nameTooLong() && !this.submitting(),
  );

  protected onNameChange(value: string): void {
    this.name.set(value);
  }

  protected cancel(): void {
    this.dialogRef.close(undefined);
  }

  protected async confirm(): Promise<void> {
    if (!this.canSubmit()) return;
    const core = this.packStore.corePack();
    if (!core) return; // defensive — the core pack always loads before any route reachable from the shell renders

    this.errorKey.set(undefined);
    this.submitting.set(true);
    try {
      const streamId = await this.campaignStore.create(this.name().trim(), core.id);
      this.dialogRef.close(streamId);
    } catch (err) {
      this.errorKey.set(this.toErrorKey(err));
    } finally {
      this.submitting.set(false);
    }
  }

  private toErrorKey(err: unknown): string {
    if (
      err instanceof CampaignStoreNotLeaderError ||
      err instanceof CampaignStoreNotAuthenticatedError
    ) {
      return err.code;
    }
    // Any other failure (an `ApiError` from the server, or anything else) falls back to one
    // generic message — the server's actual reasons for rejecting a fresh `POST /api/campaigns`
    // are all either unreachable in practice (a fresh `uuidv7()` id colliding) or transient
    // (join-code generation exhaustion), not worth a per-code message table.
    return 'campaigns.create.errors.generic';
  }
}
