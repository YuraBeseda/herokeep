import { Component, computed, inject, resource, signal } from '@angular/core';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import type { MembershipRole } from '@hk/protocol';
import { ButtonComponent } from '@shared/components/button/button.component';
import { DIALOG_DATA, DialogRef, DialogService } from '@shared/components/dialog/dialog.service';
import { ToastService } from '@shared/components/toast/toast.service';
import { apiJson } from '@shared/services/api/api-fetch';
import { LeaderService } from '@shared/services/storage/leader.service';
import { CampaignsRepository } from '@shared/services/storage/campaigns.repository';
import { SyncService } from '@shared/services/sync/sync.service';
import { CampaignStore } from '@shared/stores/campaign.store';

/** One row this component's member list template renders — `state.members` (Task 3's projector,
 * the canonical roster including DM-removed-but-not-unlinked rows) merged with the LIVE
 * `SyncService.membersFor()` presence frame, per task-6-brief.md's binding carry: "Members list =
 * state.members merged with the LIVE membersFor() presence (online dots from the members frame's
 * online flag; displayName preference: live frame > state)." */
interface MemberVm {
  readonly userId: string;
  readonly displayName: string;
  readonly role: MembershipRole;
  readonly removed: boolean;
  readonly online: boolean;
}

/** `LobbyComponent.removeMember`'s confirm dialog — same "one-off content component, own
 * injector, global unscoped keys" pattern as `characters-list.component.ts`'s
 * `CharactersDeleteConfirmComponent`. */
@Component({
  selector: 'app-lobby-remove-member-confirm',
  imports: [TranslocoDirective, ButtonComponent],
  template: `
    <ng-container *transloco="let t">
      <h2 class="lobby-remove-member-confirm__title" data-dialog-title>
        {{ t('campaigns.lobby.removeConfirm.title', { name: data.displayName }) }}
      </h2>
      <p class="lobby-remove-member-confirm__body">
        {{ t('campaigns.lobby.removeConfirm.body', { name: data.displayName }) }}
      </p>
      <div class="lobby-remove-member-confirm__actions">
        <button hk-button [variant]="'ghost'" type="button" (click)="cancel()">
          {{ t('campaigns.lobby.removeConfirm.cancel') }}
        </button>
        <button hk-button [variant]="'danger'" type="button" (click)="confirm()">
          {{ t('campaigns.lobby.removeConfirm.confirm') }}
        </button>
      </div>
    </ng-container>
  `,
})
export class LobbyRemoveMemberConfirmComponent {
  protected readonly data = inject<{ displayName: string }>(DIALOG_DATA);
  private readonly dialogRef = inject(DialogRef);

  protected confirm(): void {
    this.dialogRef.close(true);
  }

  protected cancel(): void {
    this.dialogRef.close(false);
  }
}

function groupJoinCode(code: string): string {
  return code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
}

/**
 * `/g/:id/lobby` (plan-10 task-6-brief.md, ruling 10): the join-code/QR/member-management screen.
 * `campaignGuard` has already `CampaignStore.open()`'d the stream, so `campaignStore.state()`/
 * `.role()`/`.campaignId()` already point here.
 *
 * ## Join code source (a judgment call — see class doc's own reasoning)
 *
 * `CampaignState.joinCode` (Task 3) is only ever populated by a `campaign.join_code_rotated`
 * EVENT — the code a fresh `campaign.created` establishes lives only in D1/the DTO, never as an
 * event payload (doc-02's `campaign.created` row has no `joinCode` field). `CampaignStore.
 * upsertCampaignRow` already falls back to the cached `CampaignsRepository` row's `joinCode` for
 * exactly this reason (task-4's own report). This component mirrors that same fallback chain —
 * `rotatedCode() ?? state()?.joinCode ?? cachedRow()?.joinCode` — rather than re-deriving it from
 * scratch, so the code shown here always agrees with what `CampaignStore` itself considers
 * authoritative.
 *
 * ## QR (ruling 10): `qrcode-generator`, lazy-imported
 *
 * Verified MIT-licensed, zero-runtime-dependency, pinned exact `2.0.4` (task-6-report.md has the
 * npm-registry verification evidence) — `await import('qrcode-generator')` inside a `resource()`
 * loader, same "dynamically imported and cached, keeps the library out of the app's initial
 * bundle" pattern `markdown.service.ts` already established for `marked`/`dompurify`. Renders via
 * `createSvgTag({cellSize: 4, margin: 2})` — a plain, self-generated (never user-authored) SVG
 * string — bypassed through `DomSanitizer.bypassSecurityTrustHtml` exactly like that same service
 * does for its own (DOMPurify-sanitized) HTML.
 *
 * ## Follower-mode write gating (task-6-brief.md ruling; see `CampaignShellComponent`'s own doc)
 *
 * Rotate and remove-member are plain `apiJson` REST calls — NEITHER goes through
 * `CampaignStore.assertLeader()` (unlike `appendTx`/`create`/`join`), so a non-leader tab could
 * technically still fire them successfully server-side while never seeing the result (no live
 * session updates a follower tab's `campaignStore.state()`). Both actions are gated on
 * `leaderService.isLeader()` here (in addition to `isDm()`) purely as a UX consistency measure —
 * there is no OTHER enforcement backing this restriction, so it is trivially bypassable by a
 * determined caller; that is an accepted, documented posture, not a security boundary.
 */
@Component({
  selector: 'app-lobby',
  imports: [TranslocoDirective, ButtonComponent],
  providers: [provideTranslocoScope('campaigns')],
  templateUrl: './lobby.component.html',
  styleUrl: './lobby.component.scss',
})
export class LobbyComponent {
  private readonly campaignStore = inject(CampaignStore);
  private readonly campaignsRepository = inject(CampaignsRepository);
  private readonly syncService = inject(SyncService);
  private readonly leaderService = inject(LeaderService);
  private readonly dialogService = inject(DialogService);
  private readonly toastService = inject(ToastService);
  private readonly domSanitizer = inject(DomSanitizer);

  protected readonly state = this.campaignStore.state;
  protected readonly role = this.campaignStore.role;
  protected readonly isDm = computed(() => this.role() === 'dm');
  protected readonly canManage = computed(() => this.isDm() && this.leaderService.isLeader());

  private readonly campaignId = computed(() => this.campaignStore.campaignId());

  private readonly cachedRowResource = resource({
    params: () => this.campaignId(),
    loader: ({ params: id }) =>
      id ? this.campaignsRepository.get(id) : Promise.resolve(undefined),
  });

  private readonly rotatedCode = signal<string | undefined>(undefined);

  protected readonly joinCode = computed(
    () => this.rotatedCode() ?? this.state()?.joinCode ?? this.cachedRowResource.value()?.joinCode,
  );
  protected readonly groupedJoinCode = computed(() => {
    const code = this.joinCode();
    return code ? groupJoinCode(code) : undefined;
  });
  protected readonly joinUrl = computed(() => {
    const code = this.joinCode();
    return code ? `${location.origin}/join/${code}` : undefined;
  });

  private readonly qrResource = resource({
    params: () => this.joinUrl(),
    loader: async ({ params: url }): Promise<SafeHtml | undefined> => {
      if (!url) return undefined;
      const { default: qrcode } = await import('qrcode-generator');
      const qr = qrcode(0, 'M');
      qr.addData(url);
      qr.make();
      // Fixed `cellSize`/`margin` (rather than `scalable: true`) so the generated `<svg>` carries
      // its own `width`/`height` attributes — Angular's emulated view encapsulation never applies
      // this component's scoped CSS to raw `[innerHTML]` content (it isn't compiled by Angular's
      // template compiler, so it never gets the `_ngcontent-*` attribute a scoped selector would
      // need to match), so sizing this any other way would need an unscoped/global style rule.
      return this.domSanitizer.bypassSecurityTrustHtml(qr.createSvgTag({ cellSize: 4, margin: 2 }));
    },
  });
  protected readonly qrSvg = computed(() => this.qrResource.value());

  protected readonly rotating = signal(false);
  protected readonly removingUserId = signal<string | undefined>(undefined);

  // --- Members --------------------------------------------------------------------------------

  protected readonly members = computed<MemberVm[]>(() => {
    const state = this.state();
    if (!state) return [];
    const id = this.campaignId();
    const live = id ? this.syncService.membersFor(id)() : null;
    const liveByUserId = new Map((live ?? []).map((m) => [m.userId, m]));

    const rows: MemberVm[] = [];
    for (const [userId, entry] of state.members) {
      const liveEntry = liveByUserId.get(userId);
      rows.push({
        userId,
        displayName: liveEntry?.displayName ?? entry.displayName,
        role: entry.role,
        removed: entry.removed,
        online: liveEntry?.online ?? false,
      });
    }
    return rows;
  });

  protected canRemove(member: MemberVm): boolean {
    return this.canManage() && member.role !== 'dm' && !member.removed;
  }

  // --- Actions ---------------------------------------------------------------------------------

  protected async copyLink(): Promise<void> {
    const url = this.joinUrl();
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      this.toastService.show('campaigns.lobby.toast.linkCopied');
    } catch {
      this.toastService.show('campaigns.lobby.toast.linkCopyFailed');
    }
  }

  protected async rotate(): Promise<void> {
    if (!this.canManage() || this.rotating()) return;
    const id = this.campaignId();
    if (!id) return;

    this.rotating.set(true);
    try {
      const { joinCode } = await apiJson<{ joinCode: string }>(`/api/campaigns/${id}/rotate-code`, {
        method: 'POST',
      });
      const existing = await this.campaignsRepository.get(id);
      if (existing) {
        await this.campaignsRepository.put({ ...existing, joinCode, updatedAt: Date.now() });
      }
      this.rotatedCode.set(joinCode);
      this.toastService.show('campaigns.lobby.toast.rotated');
    } catch {
      this.toastService.show('campaigns.lobby.toast.rotateFailed');
    } finally {
      this.rotating.set(false);
    }
  }

  protected async removeMember(member: MemberVm): Promise<void> {
    if (!this.canRemove(member)) return;
    const id = this.campaignId();
    if (!id) return;

    const handle = this.dialogService.open(LobbyRemoveMemberConfirmComponent, {
      data: { displayName: member.displayName },
    });
    const confirmed = await handle.closed;
    if (confirmed !== true) return;

    this.removingUserId.set(member.userId);
    try {
      await apiJson<void>(`/api/campaigns/${id}/members/${member.userId}`, { method: 'DELETE' });
      // The server appends `member.removed` and byes the removed member's own sockets
      // (task-6-brief.md's binding carry) — this tab's own roster updates via the live stream on
      // the LEADER tab; nothing is appended client-side here.
      this.toastService.show('campaigns.lobby.toast.memberRemoved', { name: member.displayName });
    } catch {
      this.toastService.show('campaigns.lobby.toast.removeFailed');
    } finally {
      this.removingUserId.set(undefined);
    }
  }
}
