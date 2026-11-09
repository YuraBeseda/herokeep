import { Component, DestroyRef, computed, effect, inject, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterOutlet, ActivatedRoute } from '@angular/router';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { ToastService } from '@shared/components/toast/toast.service';
import { AuthService } from '@shared/services/auth/auth.service';
import { LeaderService } from '@shared/services/storage/leader.service';
import {
  CampaignStore,
  CampaignStoreNotAuthenticatedError,
  CampaignStoreNotLeaderError,
} from '@shared/stores/campaign.store';
import { filter, map } from 'rxjs';
import { IconComponent } from '../../../shared/icons/icon.component';
import { ActionStrapService } from '../../../ui/action-strap/action-strap.service';
import { DialogService } from '../../../ui/dialog/dialog.service';
import { TopBarService } from '../../../ui/shell/top-bar.service';
import { phoneLayout } from '../../../ui/shell/viewport';
import { TabBarService, type TabItem } from '../../../ui/tab-bar/tab-bar.service';
import { CampaignExportDialogComponent } from '../settings/campaign-export-dialog.component';
import { CampaignSelectionService, type DmEffectKind } from './campaign-selection.service';
import { buildCampaignStrap } from './campaign-strap';

const TAB_IDS = ['party', 'log', 'lobby', 'settings'] as const;
type TabId = (typeof TAB_IDS)[number];

/** Icons and (campaigns-scope) label keys of the tabs; the Table tab keeps the `log` route. */
const TAB_ITEMS: Record<TabId, Pick<TabItem, 'icon' | 'label'>> = {
  party: { icon: 'campaigns', label: 'shell.tabs.campaign-party' },
  log: { icon: 'notes', label: 'shell.tabs.campaign-table' },
  lobby: { icon: 'join', label: 'shell.tabs.campaign-lobby' },
  settings: { icon: 'settings', label: 'shell.tabs.campaign-settings' },
};

/**
 * `/g/:id`'s shell (plan-10 task-6-brief.md): `campaignGuard` (`app.routes.ts`) has already
 * `CampaignStore.open()`'d the stream by the time this component is ever created (mirrors
 * `SheetShellComponent`'s own relationship to `characterResolver`). It renders the campaign's
 * name and role, the Party · Table · Lobby · Settings tabs, and sets the chrome the way the sheet
 * does (plan 17 B11a): the phone's bottom tab bar, the phone top bar's title, and the campaign
 * action strap, each set from an effect and cleared when the campaign closes.
 *
 * The strap (`buildCampaignStrap`): the DM's Damage · Heal · Condition · XP · Item act on the
 * member picked on the Party tab (`CampaignSelectionService` — the strap posts a request and that
 * member's quick-effects leaf runs its own action), Session starts or ends the session, Export opens
 * the export dialog; a player gets Open my sheet when they have a hero here.
 *
 * ## Follower-mode "stale" notice (task-5-report.md's carried concern; task-6-brief.md ruling)
 *
 * `SyncService` only runs a campaign's live `StreamSyncSession` on the LEADER tab, so a non-leader
 * tab's `CampaignStore.state()` does not pick up events a sibling tab's socket receives. This
 * shows a `role="status"` paragraph whenever `LeaderService.isLeader()` is `false`; it does not
 * disable navigation or reading — only `LobbyComponent`/`CampaignSettingsComponent` disable their
 * own MUTATING actions on the same signal.
 */
@Component({
  selector: 'app-campaign-shell',
  imports: [TranslocoDirective, RouterOutlet, IconComponent],
  providers: [provideTranslocoScope('campaigns')],
  templateUrl: './campaign-shell.component.html',
  styleUrl: './campaign-shell.component.scss',
})
export class CampaignShellComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly strap = inject(ActionStrapService);
  private readonly tabBar = inject(TabBarService);
  private readonly topBar = inject(TopBarService);
  private readonly selection = inject(CampaignSelectionService);
  private readonly dialogs = inject(DialogService);
  private readonly toasts = inject(ToastService);
  private readonly auth = inject(AuthService);
  protected readonly campaignStore = inject(CampaignStore);
  protected readonly leaderService = inject(LeaderService);

  protected readonly state = this.campaignStore.state;
  protected readonly role = this.campaignStore.role;
  protected readonly tabIds = TAB_IDS;
  protected readonly tabIcon = (id: TabId): string => `ui:${TAB_ITEMS[id].icon}`;

  /** The one breakpoint signal (`ui/shell/viewport`): phone below 768 px. */
  protected readonly phone = phoneLayout();
  /** Reactive: Angular reuses this shell for `/g/a` to `/g/b`, so a snapshot would go stale. */
  private readonly routeId = toSignal(
    this.route.paramMap.pipe(map((params) => params.get('id') ?? '')),
    { initialValue: this.route.snapshot.paramMap.get('id') ?? '' },
  );
  private lastRouteId = this.routeId();

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

  /** The player's first active hero in this campaign (what Open my sheet opens). */
  private readonly ownCharacterId = computed<string | undefined>(() => {
    const userId = this.auth.user()?.userId;
    const roster = this.state()?.roster;
    if (!userId || !roster) return undefined;
    for (const [characterId, entry] of roster) {
      if (entry.ownerId === userId && !entry.left) return characterId;
    }
    return undefined;
  });

  constructor() {
    // Set from effects, not eagerly: a predecessor screen's destroy-time clear can run after this
    // constructor and would wipe a config set eagerly (the sheet shell's own note).
    effect(() => this.setStrap());
    effect(() => this.setTabBar());
    effect(() => this.setTopBar());
    // A selection belongs to one campaign: a reused shell for another campaign starts clean.
    effect(() => {
      const id = this.routeId();
      untracked(() => {
        if (id === this.lastRouteId) return;
        this.lastRouteId = id;
        this.selection.clear();
      });
    });

    inject(DestroyRef).onDestroy(() => {
      this.strap.clear();
      this.tabBar.set(null);
      this.topBar.clear();
      this.selection.clear();
    });
  }

  protected onTabSelected(id: TabId): void {
    if (id === this.activeTabId()) return;
    void this.router.navigate([id], { relativeTo: this.route });
  }

  /** Roving arrows between the tabs, Home and End to the ends. */
  protected onTabsKey(event: KeyboardEvent): void {
    const index = TAB_IDS.indexOf(this.activeTabId());
    const next =
      event.key === 'ArrowRight'
        ? (index + 1) % TAB_IDS.length
        : event.key === 'ArrowLeft'
          ? (index + TAB_IDS.length - 1) % TAB_IDS.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? TAB_IDS.length - 1
              : -1;
    if (next < 0) return;
    event.preventDefault();
    this.onTabSelected(TAB_IDS[next]);
    queueMicrotask(() => document.getElementById(`campaign-tab-${TAB_IDS[next]}`)?.focus());
  }

  /** The quick-effects leaf lives on the Party tab: from another tab, go there and run it once. */
  private runEffect(kind: DmEffectKind): void {
    if (this.activeTabId() === 'party') {
      this.selection.requestEffect(kind);
      return;
    }
    void this.router.navigate(['party'], { relativeTo: this.route }).then((ok) => {
      if (ok) this.selection.requestEffect(kind);
    });
  }

  private setStrap(): void {
    const role = this.role();
    const selected = this.selection.selected() !== null;
    const sessionActive = this.state()?.session?.active ?? false;
    const canOpenSheet = this.ownCharacterId() !== undefined;
    const scope = ['/g', this.routeId()];
    untracked(() =>
      this.strap.set(
        buildCampaignStrap(
          { role, selected, sessionActive, canOpenSheet, scope },
          {
            effect: (kind) => this.runEffect(kind),
            toggleSession: () => void this.toggleSession(),
            exportCampaign: () => this.openExport(),
            openSheet: () => {
              const id = this.ownCharacterId();
              if (id) void this.router.navigate(['/c', id]);
            },
          },
        ),
      ),
    );
  }

  private setTabBar(): void {
    this.tabBar.set(
      this.phone()
        ? TAB_IDS.map((id) => ({
            id,
            ...TAB_ITEMS[id],
            route: ['/g', this.routeId(), id],
          }))
        : null,
    );
  }

  private setTopBar(): void {
    const name = this.state()?.name;
    const scope = ['/g', this.routeId()];
    if (!this.phone() || !name) {
      untracked(() => this.topBar.clear());
      return;
    }
    untracked(() => this.topBar.set({ title: name, scope }));
  }

  /** Start with no title (the Table tab's own form names a session), or end the running one. */
  private async toggleSession(): Promise<void> {
    const active = this.state()?.session?.active ?? false;
    try {
      await this.campaignStore.appendTx([
        active
          ? { type: 'session.ended', v: 1, payload: {} }
          : { type: 'session.started', v: 1, payload: {} },
      ]);
    } catch (err) {
      this.toasts.show(
        err instanceof CampaignStoreNotLeaderError ||
          err instanceof CampaignStoreNotAuthenticatedError
          ? err.code
          : 'campaigns.log.session.errors.generic',
      );
    }
  }

  private openExport(): void {
    const campaignId = this.campaignStore.campaignId();
    if (this.role() !== 'dm' || !campaignId) return;
    this.dialogs.open(CampaignExportDialogComponent, {
      data: { campaignId, name: this.state()?.name ?? '' },
    });
  }
}
