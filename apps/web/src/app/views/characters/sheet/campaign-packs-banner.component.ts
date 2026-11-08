import { Component, computed, inject, signal, type Signal } from '@angular/core';
import { planRebase, type Pins } from '@hk/engine';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { ButtonComponent } from '@shared/components/button/button.component';
import { DialogService } from '@app/ui/dialog/dialog.service';
import { RebaseReportDialogComponent } from '@shared/components/rebase-report-dialog/rebase-report-dialog.component';
import { ToastService } from '@shared/components/toast/toast.service';
import { CampaignEditLockService } from '@shared/services/campaigns/campaign-edit-lock';
import {
  CampaignPacksService,
  type CampaignPackInstallStatus,
} from '@shared/services/campaigns/campaign-packs.service';
import { campaignIdOfCharacter } from '@shared/services/campaigns/character-campaign-link';
import { EngineFacade } from '@shared/services/engine/engine.facade';
import { LeaderService } from '@shared/services/storage/leader.service';
import { SyncService } from '@shared/services/sync/sync.service';
import { CampaignStore } from '@shared/stores/campaign.store';
import { CharacterStore, CharacterStoreNotLeaderError } from '@shared/stores/character.store';
import { PackStore } from '@shared/stores/pack.store';

type TranslateFn = (key: string, params?: Record<string, unknown>) => string;

/** Toasted when pinning fails for any reason other than lost leadership. */
const PIN_FAILED_KEY = 'characters.sheet.banner.campaign-packs.pin-failed';

/** One enabled campaign pack the character does not pin. */
export interface CampaignPackOffer {
  readonly packId: string;
  /** The campaign's enabled version — the one a pin uses. */
  readonly version: string;
  /** Pack-authored display name (data, not UI text); the id until the pack is on this device. */
  readonly name: string;
  readonly state: 'installed' | 'installing';
}

const NO_STATUS: Signal<ReadonlyMap<string, CampaignPackInstallStatus>> = signal(new Map());
/** What `installStatus` reports for an enabled pack it has no entry for yet. */
const INSTALLING: CampaignPackInstallStatus = { state: 'installing' };

const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Plan 16 Task 5 (ruling 4: members install automatically, pin by choice) — the sheet banner for a
 * character LINKED to a campaign with a live session on this device (`campaignIdOfCharacter` +
 * `SyncService.liveCampaignIds`) whose enabled packs (`CampaignStore.enabledPacks`) it does not pin.
 *
 * - Each such pack is listed: an installed one by name and the campaign's version, one still
 *   arriving as "Installing…" (`CampaignPacksService.installStatus`). A refused install is not
 *   offered — the campaign settings packs section shows its error.
 * - A pack the character already pins at ANY version is not offered: moving a pin to the campaign's
 *   version is an update, which members make on the Build tab (plan ruling 11).
 * - "Pin campaign packs" pins every installed offer in ONE transaction, planned with `planRebase`
 *   and gated by the same campaign edit lock as the Build tab. When the plan reports nothing (no
 *   recorded decision breaks or moves), its `plan.events` are appended straight away: the
 *   `pack.pinned` events plus any `item.updated` that moves a held item off an entity the new
 *   version deprecates (plan 16 ruling 7). Otherwise the rebase report opens, exactly as for the
 *   Build tab's turn-off/update; only Confirm commits `plan.events`.
 * - The action is disabled on a tab that is not the character-data writer (`LeaderService`), with
 *   the reason shown; a failed pin (leadership lost mid-way, a storage error) commits nothing and
 *   shows a toast.
 *
 * Nothing is forced and nothing is remembered: the banner is there while the condition holds.
 * Renders nothing otherwise (solo character, campaign offline, everything pinned).
 */
@Component({
  selector: 'app-campaign-packs-banner',
  imports: [TranslocoDirective, ButtonComponent],
  providers: [provideTranslocoScope('characters')],
  templateUrl: './campaign-packs-banner.component.html',
  styleUrl: './campaign-packs-banner.component.scss',
})
export class CampaignPacksBannerComponent {
  private readonly characterStore = inject(CharacterStore);
  private readonly campaignStore = inject(CampaignStore);
  private readonly campaignPacks = inject(CampaignPacksService);
  private readonly syncService = inject(SyncService);
  private readonly packStore = inject(PackStore);
  private readonly engineFacade = inject(EngineFacade);
  private readonly dialogService = inject(DialogService);
  private readonly leaderService = inject(LeaderService);
  private readonly toastService = inject(ToastService);

  private readonly editLock = inject(CampaignEditLockService).editLockFor(
    this.characterStore.events,
  );
  /** The Build tab's own gate (`BuildTabComponent.editLocked`): no pin while it is on. */
  protected readonly editLocked = computed(() => this.editLock().locked);

  protected readonly busy = signal(false);

  /** The linked campaign, while it has a live session on this device. */
  private readonly campaignId = computed(() => {
    const campaignId = campaignIdOfCharacter(this.characterStore.events());
    if (campaignId === undefined) return undefined;
    return this.syncService.liveCampaignIds().has(campaignId) ? campaignId : undefined;
  });

  private readonly installStatus = computed(() => {
    const campaignId = this.campaignId();
    return (campaignId === undefined ? NO_STATUS : this.campaignPacks.installStatus(campaignId))();
  });

  protected readonly offers = computed<CampaignPackOffer[]>(() => {
    const campaignId = this.campaignId();
    const pins = this.characterStore.facts()?.pins;
    if (campaignId === undefined || pins === undefined) return [];
    const enabled = this.campaignStore.enabledPacks().get(campaignId);
    if (enabled === undefined) return [];
    const status = this.installStatus();
    const content = this.packStore.installedContent();

    const offers: CampaignPackOffer[] = [];
    for (const packId of [...enabled.keys()].sort(byCodeUnit)) {
      if (Object.hasOwn(pins, packId)) continue;
      const { version } = enabled.get(packId)!;
      const { state } = status.get(packId) ?? INSTALLING;
      if (state === 'error') continue;
      const local = content.find((p) => p.id === packId && p.version === version);
      const name = state === 'installed' && local ? local.name : packId;
      offers.push({ packId, version, name, state });
    }
    return offers;
  });

  private readonly pinnable = computed(() => this.offers().filter((o) => o.state === 'installed'));

  /** Only the writer tab may append character events (`CharacterStore.appendTx`); another tab
   * shows the reason instead, as the campaign settings packs section does. */
  protected readonly isLeader = this.leaderService.isLeader;

  protected readonly canPin = computed(
    () => this.pinnable().length > 0 && !this.busy() && !this.editLocked() && this.isLeader(),
  );

  protected async onPin(t: TranslateFn): Promise<void> {
    if (!this.canPin()) return;
    this.busy.set(true);
    try {
      await this.pin(this.pinnable(), t);
    } catch (error) {
      // Leadership can still move between the check above and the write; a storage failure has
      // no key of its own. Nothing was committed either way (one transaction).
      this.toastService.show(
        error instanceof CharacterStoreNotLeaderError ? error.code : PIN_FAILED_KEY,
      );
    } finally {
      this.busy.set(false);
    }
  }

  private async pin(offers: readonly CampaignPackOffer[], t: TranslateFn): Promise<void> {
    const facts = this.characterStore.facts();
    const current = this.characterStore.index();
    if (!facts || !current) return;

    const nextPins: Pins = { ...facts.pins };
    for (const offer of offers) nextPins[offer.packId] = offer.version;
    const next = this.engineFacade.indexFor(nextPins);
    const plan = planRebase(facts, current, next, nextPins, this.characterStore.systemRules());

    if (plan.invalid.length === 0 && plan.migrations.length === 0) {
      // Nothing to report — but the plan's events, not bare pins: item migrations (ruling 7) are
      // not report rows and must still land.
      if (plan.events.length > 0) await this.characterStore.appendTx(plan.events);
      return;
    }

    const confirmed = await this.dialogService.open(RebaseReportDialogComponent, {
      data: {
        plan,
        title: t('sheet.banner.campaign-packs.report-title'),
        nextIndex: next,
        currentIndex: current,
      },
    }).closed;
    if (confirmed === true && plan.events.length > 0) {
      await this.characterStore.appendTx(plan.events);
    }
  }
}
