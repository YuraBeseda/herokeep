import { Component, DestroyRef, computed, effect, inject, resource } from '@angular/core';
import { Router } from '@angular/router';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { SkeletonComponent } from '@shared/components/skeleton/skeleton.component';
import { CampaignsRepository } from '@shared/services/storage/campaigns.repository';
import type { CampaignRow } from '@shared/services/storage/dexie.db';
import { SyncService } from '@shared/services/sync/sync.service';
import { DialogService } from '@app/ui/dialog/dialog.service';
import { IconComponent } from '../../../shared/icons/icon.component';
import { ActionStrapService } from '../../../ui/action-strap/action-strap.service';
import { HkButtonComponent } from '../../../ui/button/button.component';
import { HkLeafComponent } from '../../../ui/leaf/leaf.component';
import { campaignsScopeReady } from '../shell/scope-ready';
import { CreateCampaignDialogComponent } from '../create/create-campaign-dialog.component';

const SKELETON_ROW_COUNT = 3;

/** The campaign tabs a card links to; `log` is the Table tab (the route keeps its path). */
const QUICK_TABS = ['party', 'log', 'lobby', 'settings'] as const;
const QUICK_TAB_ICONS: Record<(typeof QUICK_TABS)[number], string> = {
  party: 'ui:campaigns',
  log: 'ui:notes',
  lobby: 'ui:join',
  settings: 'ui:settings',
};

function toBareId(streamId: string): string {
  return streamId.startsWith('camp:') ? streamId.slice('camp:'.length) : streamId;
}

/**
 * `/campaigns` (plan-10 task-6-brief.md, board C01): every locally-cached `CampaignsRepository`
 * row — campaigns this device has created, joined, or that `SyncService.reconcileCampaigns` seeded
 * on login — newest-first (the repository's own `list()` order), same "read the cheap index table,
 * never replay a full event stream just to show a name" posture
 * `characters-list.component.ts`'s own doc comment describes for its sibling view. Each card
 * carries the role, the sync badge, an Open button and quick links to the four campaign tabs.
 * New campaign and Join are the strap's zone 2 (set from an effect, scoped to `/campaigns`), and
 * also sit inside the empty state so a first-time visitor finds them where they look.
 *
 * The board also shows member counts, a live-session chip and "last played" per card; those need
 * the campaign's event stream (not a `CampaignRow` field), which the list deliberately never
 * loads, so they are not drawn.
 */
@Component({
  selector: 'app-campaigns-list',
  imports: [
    TranslocoDirective,
    HkButtonComponent,
    HkLeafComponent,
    IconComponent,
    SkeletonComponent,
  ],
  providers: [provideTranslocoScope('campaigns')],
  templateUrl: './campaigns-list.component.html',
  styleUrl: './campaigns-list.component.scss',
})
export class CampaignsListComponent {
  private readonly campaignsRepository = inject(CampaignsRepository);
  private readonly syncService = inject(SyncService);
  private readonly dialogService = inject(DialogService);
  private readonly router = inject(Router);
  private readonly strap = inject(ActionStrapService);

  protected readonly skeletonRows: readonly number[] = Array.from(
    { length: SKELETON_ROW_COUNT },
    (_, index) => index,
  );
  protected readonly quickTabs = QUICK_TABS;
  protected readonly quickTabIcon = (tab: (typeof QUICK_TABS)[number]): string =>
    QUICK_TAB_ICONS[tab];

  private readonly campaignsResource = resource({ loader: () => this.campaignsRepository.list() });

  protected readonly rows = computed(() => this.campaignsResource.value() ?? []);
  protected readonly loading = this.campaignsResource.isLoading;

  private readonly labelsReady = campaignsScopeReady(['list.create', 'list.join']);

  constructor() {
    // Zone 2 of the strap: New campaign, Join; released when the list closes. Set again once the
    // `campaigns` labels are loaded (the strap translates outside this scope's provider).
    effect(() => {
      this.labelsReady();
      this.strap.set({
        primary: [
          {
            id: 'new-campaign',
            label: 'campaigns.list.create',
            icon: 'add',
            kind: 'primary',
            run: () => void this.onCreate(),
          },
          {
            id: 'join',
            label: 'campaigns.list.join',
            icon: 'join',
            kind: 'parchment',
            run: () => this.onJoin(),
          },
        ],
        scope: ['/campaigns'],
      });
    });
    inject(DestroyRef).onDestroy(() => this.strap.clear());
  }

  protected open(row: CampaignRow): void {
    void this.router.navigate(['/g', row.id]);
  }

  protected openTab(row: CampaignRow, tab: (typeof QUICK_TABS)[number]): void {
    void this.router.navigate(['/g', row.id, tab]);
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
