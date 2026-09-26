import { Component, computed, inject, resource } from '@angular/core';
import { Router } from '@angular/router';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { ButtonComponent } from '@shared/components/button/button.component';
import { CardComponent } from '@shared/components/card/card.component';
import { DialogService } from '@shared/components/dialog/dialog.service';
import { SkeletonComponent } from '@shared/components/skeleton/skeleton.component';
import { CampaignsRepository } from '@shared/services/storage/campaigns.repository';
import type { CampaignRow } from '@shared/services/storage/dexie.db';
import { SyncService } from '@shared/services/sync/sync.service';
import { CreateCampaignDialogComponent } from '../create/create-campaign-dialog.component';

const SKELETON_ROW_COUNT = 3;

function toBareId(streamId: string): string {
  return streamId.startsWith('camp:') ? streamId.slice('camp:'.length) : streamId;
}

/**
 * `/campaigns` (plan-10 task-6-brief.md): every locally-cached `CampaignsRepository` row —
 * campaigns this device has created, joined, or that `SyncService.reconcileCampaigns` seeded on
 * login — newest-first (the repository's own `list()` order), same "read the cheap index table,
 * never replay a full event stream just to show a name" posture
 * `characters-list.component.ts`'s own doc comment describes for its sibling view. Role badges
 * (`row.role`) and sync badges (`SyncService.syncState('camp:'+row.id)`) mirror that same
 * component's conventions exactly — the badge markup/CSS below is a near-verbatim adaptation of
 * `characters-list.component.html`'s own sync-badge block.
 */
@Component({
  selector: 'app-campaigns-list',
  imports: [TranslocoDirective, CardComponent, ButtonComponent, SkeletonComponent],
  providers: [provideTranslocoScope('campaigns')],
  templateUrl: './campaigns-list.component.html',
  styleUrl: './campaigns-list.component.scss',
})
export class CampaignsListComponent {
  private readonly campaignsRepository = inject(CampaignsRepository);
  private readonly syncService = inject(SyncService);
  private readonly dialogService = inject(DialogService);
  private readonly router = inject(Router);

  protected readonly skeletonRows: readonly number[] = Array.from(
    { length: SKELETON_ROW_COUNT },
    (_, index) => index,
  );

  private readonly campaignsResource = resource({ loader: () => this.campaignsRepository.list() });

  protected readonly rows = computed(() => this.campaignsResource.value() ?? []);
  protected readonly loading = this.campaignsResource.isLoading;

  protected open(row: CampaignRow): void {
    void this.router.navigate(['/g', row.id]);
  }

  protected async onCreate(): Promise<void> {
    const handle = this.dialogService.open(CreateCampaignDialogComponent);
    const result = await handle.closed;
    if (typeof result === 'string') {
      await this.router.navigate(['/g', toBareId(result), 'lobby']);
    } else {
      // Dialog cancelled — nothing was created, but a leader-tab create/no-op elsewhere could
      // still have changed the list (unlikely here, but cheap to refresh for free).
      this.campaignsResource.reload();
    }
  }

  protected onJoin(): void {
    void this.router.navigate(['/join']);
  }

  // --- Sync-status indicator — same bucketing as `characters-list.component.ts`'s own
  // `syncStateBucket`/`syncPendingCount`/`syncTooltipKey` trio, keyed by this row's `camp:` stream
  // id instead of `char:`.

  private static readonly PENDING_STATE = /^pending-(\d+)$/;

  protected syncStateBucket(id: string): 'synced' | 'pending' | 'connecting' | 'offline' {
    const state = this.syncService.syncState(`camp:${id}`)();
    if (state === 'synced' || state === 'connecting' || state === 'offline') return state;
    return 'pending';
  }

  protected syncPendingCount(id: string): number {
    const state = this.syncService.syncState(`camp:${id}`)();
    const match = CampaignsListComponent.PENDING_STATE.exec(state);
    return match ? Number(match[1]) : 0;
  }

  // Scope-RELATIVE (no `campaigns.` prefix) — the template renders this under
  // `*transloco="let t; read: 'campaigns'"`, which already prepends that prefix; a fully-qualified
  // key here would double-prefix (`campaigns.campaigns.list...`), the same bug class
  // `JoinComponent`'s own `JOIN_ERROR_KEYS` doc comment describes.
  protected syncTooltipKey(id: string): string {
    return `list.sync.tooltip.${this.syncStateBucket(id)}`;
  }
}
