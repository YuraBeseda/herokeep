import { Component, computed, inject, signal, type Signal } from '@angular/core';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import type { Pack } from '@hk/protocol';
import semver from 'semver';
import { ButtonComponent } from '@shared/components/button/button.component';
import { ToastService } from '@shared/components/toast/toast.service';
import { ApiError } from '@shared/services/api/api-fetch';
import {
  CAMPAIGN_NON_CORE_PACK_MAX,
  CampaignPacksService,
  CampaignPackUploadMismatchError,
  type CampaignPackInstallStatus,
} from '@shared/services/campaigns/campaign-packs.service';
import type { EnabledPack } from '@shared/services/campaigns/campaign-projection';
import { isHomebrewPackId } from '@shared/services/packs/homebrew-id';
import { updatesFor } from '@shared/services/packs/pack-updates';
import { LeaderService } from '@shared/services/storage/leader.service';
import {
  CampaignStore,
  CampaignStoreNotAuthenticatedError,
  CampaignStoreNotLeaderError,
} from '@shared/stores/campaign.store';
import { PackStore } from '@shared/stores/pack.store';

/** One DM row: a content pack this device holds, or one the campaign has enabled (possibly from
 * another device — listed so it can still be disabled). */
interface DmPackRow {
  readonly packId: string;
  /** The local copy's name; the pack id when this device holds no copy. */
  readonly name: string;
  /** The campaign's enabled entry, if any. */
  readonly enabled: EnabledPack | undefined;
  /** The highest installed version of this pack — what Enable uploads. */
  readonly local: Pack | undefined;
  /** An installed version newer than the enabled one — what "Update campaign version" uploads. */
  readonly update: Pack | undefined;
}

/** One member row: an enabled pack and where it stands on this device. */
interface MemberPackRow {
  readonly packId: string;
  readonly name: string;
  readonly version: string;
  readonly state: CampaignPackInstallStatus['state'];
  /** The refusal's i18n key (`packs.import-failed-*`, `packs.install-failed`,
   * `campaigns.packs.*`) when `state` is `'error'`. */
  readonly errorCode: string | undefined;
}

const NO_PACKS: ReadonlyMap<string, EnabledPack> = new Map();
/** What `installStatus` reports for an enabled pack it has no entry for yet. */
const INSTALLING: CampaignPackInstallStatus = { state: 'installing' };
const NO_STATUS: Signal<ReadonlyMap<string, CampaignPackInstallStatus>> = signal(new Map());

/**
 * [plan-16 Task 3] The campaign settings screen's "Content packs" section (ADR-008: a campaign
 * stores the JSON of every non-core pack it enables; `CampaignPacksService` does the work).
 *
 * - **DM**: one row per content pack installed on this device (never a homebrew line — not
 *   campaign-enableable — and never the core or a translation: `PackStore.installedContent` holds
 *   only content packs) plus every enabled pack this device lacks. Enable uploads the highest
 *   installed version; an enabled pack offers Disable, and "Update campaign version" when this
 *   device holds a newer version than the enabled one (`updatesFor`, the packs screen's own
 *   semver comparison — one version per pack id, ruling 2). The quota reads `n / 6`
 *   (`CAMPAIGN_NON_CORE_PACK_MAX`); Enable stops at the limit. While a request runs, every action
 *   is disabled and the row shows a busy line. Gating is the settings screen's own edit lock —
 *   `canEdit = isDm && isLeader` — and a DM on another tab sees the not-leader reason.
 * - **Member**: the enabled packs, read-only, each with its install status on this device and, for
 *   a refused install, the reason and Retry (ruling 4: pinning happens on the character, never here).
 *
 * Install refusal codes live in the `packs` scope as well as `campaigns`, so both are provided.
 */
@Component({
  selector: 'app-campaign-packs-section',
  imports: [TranslocoDirective, ButtonComponent],
  providers: [provideTranslocoScope('campaigns'), provideTranslocoScope('packs')],
  templateUrl: './campaign-packs-section.component.html',
  styleUrl: './campaign-packs-section.component.scss',
})
export class CampaignPacksSectionComponent {
  private readonly campaignStore = inject(CampaignStore);
  private readonly leaderService = inject(LeaderService);
  private readonly packStore = inject(PackStore);
  private readonly campaignPacks = inject(CampaignPacksService);
  private readonly toastService = inject(ToastService);

  protected readonly isDm = computed(() => this.campaignStore.role() === 'dm');
  protected readonly isLeader = this.leaderService.isLeader;
  protected readonly canEdit = computed(() => this.isDm() && this.isLeader());

  protected readonly maxPacks = CAMPAIGN_NON_CORE_PACK_MAX;
  /** The pack whose enable / version change / disable is running — one at a time. */
  protected readonly busyPackId = signal<string | null>(null);
  /** The pack whose install Retry is running. */
  protected readonly retryingPackId = signal<string | null>(null);

  /** The open campaign's enabled packs: pack id → `{version, sha256}`. */
  private readonly enabled = computed<ReadonlyMap<string, EnabledPack>>(() => {
    const campaignId = this.campaignStore.campaignId();
    if (campaignId === undefined) return NO_PACKS;
    return this.campaignStore.enabledPacks().get(campaignId) ?? NO_PACKS;
  });

  protected readonly enabledCount = computed(() => this.enabled().size);
  protected readonly quotaFull = computed(() => this.enabledCount() >= CAMPAIGN_NON_CORE_PACK_MAX);

  private readonly installStatus = computed(() => {
    const campaignId = this.campaignStore.campaignId();
    return (campaignId === undefined ? NO_STATUS : this.campaignPacks.installStatus(campaignId))();
  });

  protected readonly dmRows = computed<DmPackRow[]>(() => {
    const enabled = this.enabled();
    const offered = this.packStore.installedContent().filter((pack) => !isHomebrewPackId(pack.id));

    const latest = new Map<string, Pack>();
    for (const pack of offered) {
      const current = latest.get(pack.id);
      if (current === undefined || semver.gt(pack.version, current.version)) {
        latest.set(pack.id, pack);
      }
    }
    const core = this.packStore.corePack();
    const pins = Object.fromEntries([...enabled].map(([packId, entry]) => [packId, entry.version]));
    const updateTo = new Map(
      (core ? updatesFor(pins, offered, core) : []).map((update) => [update.packId, update.to]),
    );

    return sortedIds([...enabled.keys(), ...latest.keys()]).map((packId) => {
      const local = latest.get(packId);
      const to = updateTo.get(packId);
      return {
        packId,
        name: local?.name ?? packId,
        enabled: enabled.get(packId),
        local,
        update:
          to === undefined
            ? undefined
            : offered.find((pack) => pack.id === packId && pack.version === to),
      };
    });
  });

  protected readonly memberRows = computed<MemberPackRow[]>(() => {
    const enabled = this.enabled();
    const status = this.installStatus();
    const installed = this.packStore.installedContent();
    return [...enabled]
      .sort(([a], [b]) => byId(a, b))
      .map(([packId, entry]) => {
        const packStatus = status.get(packId) ?? INSTALLING;
        return {
          packId,
          name: installed.find((pack) => pack.id === packId)?.name ?? packId,
          version: entry.version,
          state: packStatus.state,
          errorCode: packStatus.state === 'error' ? packStatus.code : undefined,
        };
      });
  });

  /** The id of a row's name, which describes that row's buttons ("Enable" alone says not which). */
  protected nameId(packId: string): string {
    return `campaign-pack-${packId}-name`;
  }

  protected enable(pack: Pack): Promise<void> {
    return this.run(
      pack.id,
      (campaignId) => this.campaignPacks.enable(campaignId, pack),
      enableFailureKey,
    );
  }

  protected updateVersion(pack: Pack): Promise<void> {
    return this.run(
      pack.id,
      (campaignId) => this.campaignPacks.changeVersion(campaignId, pack),
      enableFailureKey,
    );
  }

  protected disable(packId: string): Promise<void> {
    return this.run(
      packId,
      (campaignId) => this.campaignPacks.disable(campaignId, packId),
      (error) => codedFailureKey(error) ?? 'campaigns.settings.packs.toast.disableFailed',
    );
  }

  protected async retry(packId: string): Promise<void> {
    const campaignId = this.campaignStore.campaignId();
    if (campaignId === undefined || this.retryingPackId() !== null) return;
    this.retryingPackId.set(packId);
    try {
      await this.campaignPacks.retryInstall(campaignId, packId);
    } catch (error) {
      this.toastService.show(codedFailureKey(error) ?? 'packs.install-failed');
    } finally {
      this.retryingPackId.set(null);
    }
  }

  private async run(
    packId: string,
    action: (campaignId: string) => Promise<void>,
    failureKey: (error: unknown) => string,
  ): Promise<void> {
    const campaignId = this.campaignStore.campaignId();
    if (!this.canEdit() || this.busyPackId() !== null || campaignId === undefined) return;
    this.busyPackId.set(packId);
    try {
      await action(campaignId);
    } catch (error) {
      this.toastService.show(failureKey(error));
    } finally {
      this.busyPackId.set(null);
    }
  }
}

/** Code-unit order of pack ids (stable and locale-independent). */
function byId(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Pack ids, deduplicated, in `byId` order. */
function sortedIds(ids: Iterable<string>): string[] {
  return [...new Set(ids)].sort(byId);
}

/** The i18n key an error carries itself — toasted verbatim, as the settings save already does. */
function codedFailureKey(error: unknown): string | undefined {
  if (
    error instanceof CampaignStoreNotLeaderError ||
    error instanceof CampaignStoreNotAuthenticatedError ||
    error instanceof CampaignPackUploadMismatchError
  ) {
    return error.code;
  }
  return undefined;
}

/** Enable / version change: the server's `409 quota_exceeded` and `413` get their own text. */
function enableFailureKey(error: unknown): string {
  const coded = codedFailureKey(error);
  if (coded !== undefined) return coded;
  if (error instanceof ApiError && error.status === 409) {
    return 'campaigns.settings.packs.toast.quota';
  }
  if (error instanceof ApiError && error.status === 413) {
    return 'campaigns.settings.packs.toast.tooLarge';
  }
  return 'campaigns.settings.packs.toast.enableFailed';
}
