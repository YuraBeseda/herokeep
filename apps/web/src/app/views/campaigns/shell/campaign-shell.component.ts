import { Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterOutlet, ActivatedRoute } from '@angular/router';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { TabsComponent, type HkTab } from '@shared/components/tabs/tabs.component';
import { LeaderService } from '@shared/services/storage/leader.service';
import { CampaignStore } from '@shared/stores/campaign.store';
import { filter, map } from 'rxjs';

const TAB_IDS = ['party', 'log', 'settings', 'lobby'] as const;
type TabId = (typeof TAB_IDS)[number];

/**
 * `/g/:id`'s shell (plan-10 task-6-brief.md): `campaignGuard` (`app.routes.ts`) has already
 * `CampaignStore.open()`'d the stream by the time this component is ever created (mirrors
 * `SheetShellComponent`'s own relationship to `characterResolver`) — this just renders the
 * campaign's name/role plus `hk-tabs` routing between the `party`/`log`/`settings`/`lobby` child
 * routes, near-verbatim adapted from `sheet-shell.component.ts`'s own tab-shell pattern
 * (`activeTabId`/`tabsFor`/`onTabSelected`).
 *
 * ## Follower-mode "stale" notice (task-5-report.md's carried concern; task-6-brief.md ruling)
 *
 * `SyncService` only runs a campaign's live `StreamSyncSession` on the LEADER tab
 * (`onAuthLeaderChange`'s `mode === 'leader'` gate) — task-5-report.md's own words: "No
 * SyncBroadcast/follower-tab reload story exists for campaigns yet." A non-leader tab's
 * `CampaignStore.state()` is therefore whatever this device last had locally when THIS tab
 * happened to load it — it will not pick up events a sibling (leader) tab's live socket receives
 * until a full reload or this tab itself becomes leader. No reuse pattern exists for this on the
 * character side (`play-tab.component.ts`'s own not-leader handling is about the WRITE lock —
 * `CharacterStoreNotLeaderError` toasted on a failed append — not about read-side staleness), so
 * this is a new, lightweight, i18n-keyed banner rather than an adapted existing one: a
 * `role="status"` paragraph shown whenever `LeaderService.isLeader()` is `false`. It does not
 * disable navigation or reading — only `LobbyComponent`/`CampaignSettingsComponent` disable their
 * own MUTATING actions (rotate/remove-member/save) on the same signal, since those two bypass or
 * wrap `CampaignStore`'s own leader-gated write path and would otherwise appear to silently do
 * nothing from a stale, non-reactive view.
 */
@Component({
  selector: 'app-campaign-shell',
  imports: [TranslocoDirective, RouterOutlet, TabsComponent],
  providers: [provideTranslocoScope('campaigns')],
  templateUrl: './campaign-shell.component.html',
  styleUrl: './campaign-shell.component.scss',
})
export class CampaignShellComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  protected readonly campaignStore = inject(CampaignStore);
  protected readonly leaderService = inject(LeaderService);

  protected readonly state = this.campaignStore.state;
  protected readonly role = this.campaignStore.role;

  private readonly currentUrl = toSignal(
    this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      map(() => this.router.url),
    ),
    { initialValue: this.router.url },
  );

  protected readonly activeTabId = computed<TabId>(() => {
    const url = this.currentUrl();
    return TAB_IDS.find((id) => url.endsWith(`/${id}`)) ?? 'party';
  });

  protected tabsFor(t: (key: string) => string): HkTab[] {
    return TAB_IDS.map((id) => ({ id, label: t(`shell.tabs.${id}`) }));
  }

  protected onTabSelected(id: string | undefined): void {
    if (!id || id === this.activeTabId()) return;
    void this.router.navigate([id], { relativeTo: this.route });
  }
}
