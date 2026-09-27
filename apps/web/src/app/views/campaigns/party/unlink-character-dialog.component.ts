import { Component, computed, inject, signal } from '@angular/core';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { ButtonComponent } from '@shared/components/button/button.component';
import { DIALOG_DATA, DialogRef } from '@shared/components/dialog/dialog.service';
import {
  runDmUnlinkSequence,
  type DmUnlinkStepResult,
} from '@shared/services/campaigns/dm-unlink-sequence';
import {
  CampaignStore,
  CampaignStoreNotAuthenticatedError,
  CampaignStoreNotLeaderError,
} from '@shared/stores/campaign.store';

export interface UnlinkCharacterDialogData {
  /** Bare campaign uuid. */
  readonly campaignId: string;
  /** Bare character uuid. */
  readonly characterId: string;
  /** The ROSTER entry's real owner — never the acting DM. */
  readonly ownerId: string;
  readonly characterName: string;
}

/**
 * `PartyTabComponent`'s "Unlink character" DM action (plan-10 task-11-brief.md, doc-03 §bye
 * obligation) — offered ONLY on a roster entry (`left: false`) whose owning member has been
 * removed/left (`state.members.get(entry.ownerId)?.removed === true`); see
 * `dm-unlink-sequence.ts`'s own class doc for the full server-rule verification and why this is a
 * DM-only completion path. Confirm step, then `runDmUnlinkSequence`'s two-step sequence with the
 * SAME per-step progress/retry UI pattern `LeaveCampaignDialogComponent` established for the
 * owner-authored equivalent — retrying here simply re-runs the WHOLE sequence (never a step-B-only
 * resume): unlike the owner's own leave, step (a) is DM-authored through the gateway and has no
 * local `events()` signal to inspect for "already done," so there is nothing to check before
 * deciding fresh-vs-resume, and resending it is documented-safe either way.
 */
@Component({
  selector: 'app-unlink-character-dialog',
  imports: [TranslocoDirective, ButtonComponent],
  providers: [provideTranslocoScope('campaigns')],
  templateUrl: './unlink-character-dialog.component.html',
  styleUrl: './unlink-character-dialog.component.scss',
})
export class UnlinkCharacterDialogComponent {
  private readonly data = inject<UnlinkCharacterDialogData>(DIALOG_DATA);
  private readonly dialogRef = inject(DialogRef);
  private readonly campaignStore = inject(CampaignStore);

  protected readonly characterName = this.data.characterName;

  protected readonly confirming = signal(true);
  protected readonly steps = signal<readonly DmUnlinkStepResult[]>([]);
  protected readonly busy = signal(false);
  protected readonly errorKey = signal<string | undefined>(undefined);

  protected readonly unlinkedOk = computed(
    () => this.steps().length > 0 && this.steps().every((s) => s.ok),
  );
  protected readonly canRetry = computed(() => {
    if (this.busy()) return false;
    const list = this.steps();
    const lastStepIncomplete = list.length > 0 && list.at(-1)?.ok !== true;
    return lastStepIncomplete || this.errorKey() !== undefined;
  });

  protected cancel(): void {
    this.dialogRef.close(false);
  }

  protected async confirmUnlink(): Promise<void> {
    this.confirming.set(false);
    await this.run();
  }

  protected async retry(): Promise<void> {
    await this.run();
  }

  private async run(): Promise<void> {
    this.errorKey.set(undefined);
    this.busy.set(true);
    // Same rationale as `LeaveCampaignDialogComponent.confirmLeave` (task-7 fix round 1): block
    // ESC/backdrop dismissal for the whole in-flight window so a dismissed mid-unlink (step (a)
    // committed, step (b) not yet settled) can't strand the roster entry with no visible retry
    // path other than reopening this exact dialog from the same still-eligible roster row (which
    // stays eligible — `left: false` — until step (b) actually commits, so it remains reachable).
    this.dialogRef.setDismissible(false);
    try {
      const outcome = await runDmUnlinkSequence({
        campaignPort: this.campaignStore,
        gatewayAppend: (characterId, drafts) =>
          this.campaignStore.gatewayAppend(characterId, drafts),
        campaignId: this.data.campaignId,
        characterId: this.data.characterId,
        ownerId: this.data.ownerId,
        characterName: this.data.characterName,
      });
      this.steps.set(outcome.steps);
      if (outcome.ok) this.dialogRef.close(true);
    } catch (err) {
      this.errorKey.set(this.toErrorKey(err));
    } finally {
      this.busy.set(false);
      this.dialogRef.setDismissible(true);
    }
  }

  // Only step (b) (`campaignStore.appendTx`, via `runDmUnlinkSequence`'s `campaignPort`) can throw
  // here — step (a) (`gatewayAppend`) is already caught INSIDE `dm-unlink-sequence.ts` and folded
  // into an `ok: false` step result, never propagated. Same scope-relative-vs-generic split
  // `LeaveCampaignDialogComponent.toErrorKey` documents: `CampaignStore`'s own errors already carry
  // a `campaigns.*`-scoped code, stripped before rendering through this component's own
  // `read: 'campaigns'` template.
  private toErrorKey(err: unknown): string {
    if (
      err instanceof CampaignStoreNotLeaderError ||
      err instanceof CampaignStoreNotAuthenticatedError
    ) {
      return err.code.replace(/^campaigns\./, '');
    }
    return 'unlink.errors.generic';
  }
}
