import { Component, computed, inject, signal } from '@angular/core';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { ButtonComponent } from '@shared/components/button/button.component';
import { DIALOG_DATA, DialogRef } from '@shared/components/dialog/dialog.service';
import { AuthService } from '@shared/services/auth/auth.service';
import {
  retryCampaignLinkStepB,
  runCampaignLinkSequence,
  type CampaignLinkParams,
  type CampaignLinkStepResult,
} from '@shared/services/campaigns/campaign-link-sequence';
import {
  CampaignStore,
  CampaignStoreNotAuthenticatedError,
  CampaignStoreNotLeaderError,
} from '@shared/stores/campaign.store';
import { CharacterStore, CharacterStoreNotLeaderError } from '@shared/stores/character.store';

export interface LeaveCampaignDialogData {
  readonly campaignId: string;
  /** Full `char:<uuid>` stream id. */
  readonly characterId: string;
  readonly characterName: string;
}

/**
 * `CampaignChipComponent`'s "Leave" action (plan-10 task-7-brief.md): a confirm step, then ruling
 * 4's LEAVE sequence — "(a) char socket `character.campaign_left` FIRST, then (b) campaign
 * `campaign.character_left`" — with the same per-step status + "link incomplete — retry" UI the
 * join flow's `LinkCharacterComponent` shows, reusing the exact same
 * `runCampaignLinkSequence`/`retryCampaignLinkStepB` helpers with `action: 'leave'`.
 *
 * Unlike `LinkCharacterComponent` (always reached via a `/g/:id/...` route, so `CampaignStore` is
 * already `open()`'d on the right campaign by `campaignGuard`), this dialog is reached from the
 * CHARACTER sheet — a `/c/:id` route that never touches `CampaignStore` at all otherwise. Step (b)
 * needs `CampaignStore.appendTx` to target THIS campaign's stream, so `confirmLeave` explicitly
 * `open()`s it first (local-storage-only I/O, same posture `campaignGuard` itself takes — see that
 * guard's own doc comment) before ever building the sequence params. This is also what starts a
 * live session for the campaign, if the leader tab doesn't already have one (`SyncService`'s own
 * reactive `effect()` on `CampaignStore.streamId()`, task-5-report.md).
 */
@Component({
  selector: 'app-leave-campaign-dialog',
  imports: [TranslocoDirective, ButtonComponent],
  providers: [provideTranslocoScope('campaigns')],
  templateUrl: './leave-campaign-dialog.component.html',
  styleUrl: './leave-campaign-dialog.component.scss',
})
export class LeaveCampaignDialogComponent {
  private readonly data = inject<LeaveCampaignDialogData>(DIALOG_DATA);
  private readonly dialogRef = inject(DialogRef);
  private readonly characterStore = inject(CharacterStore);
  private readonly campaignStore = inject(CampaignStore);
  private readonly authService = inject(AuthService);

  protected readonly characterName = this.data.characterName;

  protected readonly confirming = signal(true);
  protected readonly steps = signal<readonly CampaignLinkStepResult[]>([]);
  protected readonly busy = signal(false);
  protected readonly errorKey = signal<string | undefined>(undefined);

  protected readonly linkedOk = computed(
    () => this.steps().length > 0 && this.steps().every((s) => s.outcome === 'committed'),
  );
  protected readonly canRetry = computed(() => {
    const list = this.steps();
    return !this.busy() && list.length > 0 && list.at(-1)?.outcome !== 'committed';
  });

  protected cancel(): void {
    this.dialogRef.close(false);
  }

  protected async confirmLeave(): Promise<void> {
    this.confirming.set(false);
    this.errorKey.set(undefined);
    this.busy.set(true);
    try {
      const params = await this.buildParams();
      const outcome = await runCampaignLinkSequence(params);
      this.steps.set(outcome.steps);
      if (outcome.ok) this.dialogRef.close(true);
    } catch (err) {
      this.errorKey.set(this.toErrorKey(err));
    } finally {
      this.busy.set(false);
    }
  }

  protected async retry(): Promise<void> {
    this.errorKey.set(undefined);
    this.busy.set(true);
    try {
      const params = await this.buildParams();
      const step = await retryCampaignLinkStepB(params);
      this.steps.update((current) => [...current.slice(0, -1), step]);
      if (this.linkedOk()) this.dialogRef.close(true);
    } catch (err) {
      this.errorKey.set(this.toErrorKey(err));
    } finally {
      this.busy.set(false);
    }
  }

  private async buildParams(): Promise<CampaignLinkParams> {
    await this.campaignStore.open(`camp:${this.data.campaignId}`);
    const user = this.authService.user();
    if (!user) throw new CampaignStoreNotAuthenticatedError();
    return {
      action: 'leave',
      characterPort: this.characterStore,
      campaignPort: this.campaignStore,
      campaignId: this.data.campaignId,
      characterId: this.data.characterId,
      ownerId: user.userId,
      characterName: this.data.characterName,
    };
  }

  // Same scope-relative/foreign-scope split `LinkCharacterComponent.toErrorKey` documents.
  private toErrorKey(err: unknown): string {
    if (
      err instanceof CampaignStoreNotLeaderError ||
      err instanceof CampaignStoreNotAuthenticatedError
    ) {
      return err.code.replace(/^campaigns\./, '');
    }
    if (err instanceof CharacterStoreNotLeaderError) return 'link.errors.characterNotLeader';
    return 'link.errors.generic';
  }
}
