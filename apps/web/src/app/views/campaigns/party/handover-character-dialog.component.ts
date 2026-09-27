import { Component, computed, inject, signal } from '@angular/core';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { ButtonComponent } from '@shared/components/button/button.component';
import { DIALOG_DATA, DialogRef } from '@shared/components/dialog/dialog.service';
import { bareCharacterId } from '@shared/services/campaigns/campaign-link-sequence';
import {
  runPregenHandoverSequence,
  type HandoverStepResult,
} from '@shared/services/campaigns/pregen-handover-sequence';
import {
  CampaignStore,
  CampaignStoreNotAuthenticatedError,
  CampaignStoreNotLeaderError,
} from '@shared/stores/campaign.store';
import { CharacterStore, CharacterStoreNotLeaderError } from '@shared/stores/character.store';

export interface HandoverCharacterDialogData {
  /** Bare campaign uuid. */
  readonly campaignId: string;
  /** `char:<uuid>` or bare — either form (`runPregenHandoverSequence` normalizes). */
  readonly characterId: string;
  readonly characterName: string;
  /** The DM's own userId — the pregen's CURRENT recorded owner. */
  readonly fromOwnerId: string;
}

interface MemberOption {
  readonly userId: string;
  readonly displayName: string;
}

/**
 * `PartyTabComponent`'s "Hand over to…" DM action on a pregen card (plan-10 task-12-brief.md,
 * ruling 6) — member picker, then the validated 5-step handover
 * (`pregen-handover-sequence.ts`'s own class doc has the full server-rule citations for why this
 * EXACT order is the only one that works). Offered ONLY on a roster entry the DM themselves owns
 * (`PartyTabComponent`'s own `isPregen` gate) — never a general "reassign any character" tool.
 *
 * Unlike `UnlinkCharacterDialogComponent`/`LeaveCampaignDialogComponent`, retrying here is genuinely
 * simple: `runPregenHandoverSequence` ALWAYS re-derives every step's "already done?" state fresh
 * (from `characterStore.events()`/`campaignStore.state()?.roster`) before deciding whether to
 * append anything — so "Retry" is just "call it again," picking up exactly where the previous
 * attempt stopped, with no separate resume-vs-fresh branch needed in this component at all.
 */
@Component({
  selector: 'app-handover-character-dialog',
  imports: [TranslocoDirective, ButtonComponent],
  providers: [provideTranslocoScope('campaigns')],
  templateUrl: './handover-character-dialog.component.html',
  styleUrl: './handover-character-dialog.component.scss',
})
export class HandoverCharacterDialogComponent {
  private readonly data = inject<HandoverCharacterDialogData>(DIALOG_DATA);
  private readonly dialogRef = inject(DialogRef);
  private readonly campaignStore = inject(CampaignStore);
  private readonly characterStore = inject(CharacterStore);

  protected readonly characterName = this.data.characterName;

  /** Active, non-DM members — a pregen is never handed to the DM themselves (self-owned already)
   * nor to a removed member (they have no live campaign socket to receive anything through). */
  protected readonly members = computed<readonly MemberOption[]>(() => {
    const state = this.campaignStore.state();
    if (!state) return [];
    const rows: MemberOption[] = [];
    for (const [userId, entry] of state.members) {
      if (entry.role === 'dm' || entry.removed) continue;
      rows.push({ userId, displayName: entry.displayName });
    }
    return rows;
  });

  protected readonly selectedUserId = signal<string | undefined>(undefined);
  /** The selected member's display name — for the success message only (`handover.success`'s
   * `{member}` interpolation). Falls back to the userId itself in the (unreachable in practice)
   * case a selection was made from a members list that has since changed shape. */
  protected readonly selectedMemberName = computed(
    () =>
      this.members().find((m) => m.userId === this.selectedUserId())?.displayName ??
      this.selectedUserId() ??
      '',
  );
  protected readonly confirming = signal(true);
  protected readonly steps = signal<readonly HandoverStepResult[]>([]);
  protected readonly busy = signal(false);
  protected readonly errorKey = signal<string | undefined>(undefined);

  protected readonly handedOverOk = computed(
    () =>
      this.steps().length > 0 &&
      this.steps().every((s) => s.outcome === 'committed' || s.outcome === 'skipped'),
  );
  protected readonly canRetry = computed(() => {
    if (this.busy()) return false;
    const list = this.steps();
    const lastStepIncomplete =
      list.length > 0 &&
      !(list.at(-1)?.outcome === 'committed' || list.at(-1)?.outcome === 'skipped');
    return lastStepIncomplete || this.errorKey() !== undefined;
  });

  protected cancel(): void {
    this.dialogRef.close(false);
  }

  protected selectMember(userId: string): void {
    this.selectedUserId.set(userId);
  }

  protected async confirmHandover(): Promise<void> {
    if (!this.selectedUserId()) return;
    this.confirming.set(false);
    await this.run();
  }

  protected async retry(): Promise<void> {
    await this.run();
  }

  private async run(): Promise<void> {
    const toUserId = this.selectedUserId();
    if (!toUserId) return;
    this.errorKey.set(undefined);
    this.busy.set(true);
    // Same rationale as `UnlinkCharacterDialogComponent`/`LeaveCampaignDialogComponent`: block
    // ESC/backdrop dismissal for the whole in-flight window so a dismissed mid-handover can't
    // strand the character between steps with no visible retry path other than reopening this
    // exact dialog from the same still-owned-by-the-DM roster row.
    this.dialogRef.setDismissible(false);
    try {
      // Loads the pregen into the DM's OWN `CharacterStore` — a genuine DIRECT connection (the DM
      // D1-owns every pregen they create, exactly like any of their own characters; see
      // `pregen-handover-sequence.ts`'s class doc) — needed either way: a fresh attempt appends
      // through it directly, a retry needs its `events()` signal live to re-derive what already
      // committed.
      await this.characterStore.load(this.data.characterId);
      const outcome = await runPregenHandoverSequence({
        characterPort: this.characterStore,
        campaignPort: this.campaignStore,
        rosterEntry: () =>
          this.campaignStore.state()?.roster.get(bareCharacterId(this.data.characterId)),
        campaignId: this.data.campaignId,
        characterId: this.data.characterId,
        characterName: this.data.characterName,
        fromOwnerId: this.data.fromOwnerId,
        toUserId,
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

  // Same scope-relative-vs-generic split `UnlinkCharacterDialogComponent.toErrorKey` documents:
  // `CampaignStore`'s own errors already carry a `campaigns.*`-scoped code, stripped before
  // rendering through this component's own `read: 'campaigns'` template; `CharacterStore`'s own
  // `characters.*`-scoped code is a DIFFERENT scope, not reused — this dialog has its own local key
  // describing the same condition in the `campaigns` scope.
  private toErrorKey(err: unknown): string {
    if (
      err instanceof CampaignStoreNotLeaderError ||
      err instanceof CampaignStoreNotAuthenticatedError
    ) {
      return err.code.replace(/^campaigns\./, '');
    }
    if (err instanceof CharacterStoreNotLeaderError) return 'handover.errors.characterNotLeader';
    return 'handover.errors.generic';
  }
}
