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
import { lastCampaignLinkEvent } from '@shared/services/campaigns/character-campaign-link';
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
  /** Fix round 1 (finding 3): also true when an exception was THROWN before any step was ever
   * recorded (`buildParams`'s own `CampaignStoreNotAuthenticatedError`, or `appendTx`'s
   * `*NotLeaderError`s firing synchronously) — without this, that path left `steps` empty,
   * `canRetry()` false, and the user stuck behind a generic error banner with no retry button (the
   * SAME gap `LinkCharacterComponent.canRetry` fixes for the join side). */
  protected readonly canRetry = computed(() => {
    if (this.busy()) return false;
    const list = this.steps();
    const lastStepIncomplete = list.length > 0 && list.at(-1)?.outcome !== 'committed';
    return lastStepIncomplete || this.errorKey() !== undefined;
  });

  protected cancel(): void {
    this.dialogRef.close(false);
  }

  protected async confirmLeave(): Promise<void> {
    this.confirming.set(false);
    this.errorKey.set(undefined);
    this.busy.set(true);
    // Fix round 1 (finding 1): block ESC/backdrop dismissal for the whole in-flight window — a
    // dismissed mid-leave (step (a) committed, step (b) not yet attempted/settled) would strand
    // this character half-left with no surviving recovery UI (the chip itself disappears the
    // instant step (a) commits — see `CampaignChipComponent`'s own doc). Re-allowed in `finally`
    // regardless of outcome: once settled (success, a clean reject, OR a thrown exception), the
    // user can always close and, if incomplete, come back via `/g/:id/link-character`'s own
    // `resumeLeave` bucket.
    this.dialogRef.setDismissible(false);
    try {
      await this.runOrResume();
      if (this.linkedOk()) this.dialogRef.close(true);
    } catch (err) {
      this.errorKey.set(this.toErrorKey(err));
    } finally {
      this.busy.set(false);
      this.dialogRef.setDismissible(true);
    }
  }

  protected async retry(): Promise<void> {
    this.errorKey.set(undefined);
    this.busy.set(true);
    this.dialogRef.setDismissible(false);
    try {
      await this.runOrResume();
      if (this.linkedOk()) this.dialogRef.close(true);
    } catch (err) {
      this.errorKey.set(this.toErrorKey(err));
    } finally {
      this.busy.set(false);
      this.dialogRef.setDismissible(true);
    }
  }

  /**
   * Shared by `confirmLeave` (the first attempt) AND `retry` (every later one, including a retry
   * after an exception THROWN so early that step (a) never even got sent) — re-derives WHETHER
   * step (a) (`character.campaign_left` for THIS campaign) already exists fresh off
   * `characterStore.events()` rather than trusting which method called it. Fix round 1: an
   * earlier version had `retry()` always call `retryCampaignLinkStepB` directly, which is WRONG
   * when the very first attempt failed INSIDE step (a) itself (e.g. `CharacterStoreNotLeaderError`
   * thrown before anything was written) — that would have sent step (b) alone with NO step (a)
   * ever having happened, violating ruling 4's ordering outright. Mirrors
   * `LinkCharacterComponent.runAttempt`'s identical reasoning (that component's own doc has the
   * fuller rationale).
   */
  private async runOrResume(): Promise<void> {
    const params = await this.buildParams();
    const linkInfo = lastCampaignLinkEvent(this.characterStore.events());
    const alreadyHasStepA =
      linkInfo?.type === 'character.campaign_left' && linkInfo.campaignId === params.campaignId;

    if (alreadyHasStepA) {
      const step = await retryCampaignLinkStepB(params);
      this.steps.update((current) =>
        current.length > 0 ? [...current.slice(0, -1), step] : [step],
      );
    } else {
      const outcome = await runCampaignLinkSequence(params);
      this.steps.set(outcome.steps);
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
