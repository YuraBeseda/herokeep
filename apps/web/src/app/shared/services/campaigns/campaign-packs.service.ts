import {
  computed,
  effect,
  inject,
  Injectable,
  signal,
  untracked,
  type Signal,
} from '@angular/core';
import type { Pack } from '@hk/protocol';
import { ToastService } from '@shared/components/toast/toast.service';
import { ApiError, apiBytes, apiJson } from '@shared/services/api/api-fetch';
import { sha256Hex } from '@shared/services/images/image-pipeline.service';
import { canonicalJson } from '@shared/services/packs/canonical-json';
import { PackImportError } from '@shared/services/packs/pack-import.errors';
import { checkPackConflict, validateExternalPack } from '@shared/services/packs/pack-validate';
import { LeaderService } from '@shared/services/storage/leader.service';
import { SyncService } from '@shared/services/sync/sync.service';
import { CampaignStore, CampaignStoreNotLeaderError } from '@shared/stores/campaign.store';
import { PackStore } from '@shared/stores/pack.store';
import type { EnabledPack } from './campaign-projection';

/** Where one campaign pack stands on THIS device: present (`installed`), not yet present
 * (`installing` — fetching, or waiting for the campaign's live session), or refused (`error`, with
 * the i18n key of the reason). */
export type CampaignPackInstallStatus =
  | { readonly state: 'installed' }
  | { readonly state: 'installing' }
  | { readonly state: 'error'; readonly code: string };

/** The key `installErrors` uses for one campaign's pack. */
export function campaignPackKey(campaignId: string, packId: string): string {
  return `${campaignId}/${packId}`;
}

/** `enable` refused to append `pack.enabled`: the digest the server reports for the body it stored
 * is not the digest of the body this device sent. `code` is the i18n key a UI toasts. */
export class CampaignPackUploadMismatchError extends Error {
  readonly code = 'campaigns.packs.enable-failed';

  constructor(readonly packKey: string) {
    super(`The server stored a different body for ${packKey}`);
    this.name = 'CampaignPackUploadMismatchError';
  }
}

/** The outcome of the last install attempt for one campaign's pack, for the exact enabled entry
 * (`version` + `sha256`) it was made for. */
interface InstallRecord {
  readonly campaignId: string;
  readonly packId: string;
  readonly version: string;
  readonly sha256: string;
  readonly status: CampaignPackInstallStatus;
  /** `PackStore.installedContent()` when the attempt started: a refused pack is retried once this
   * changes (its dependency may have been installed since). */
  readonly content: readonly Pack[];
}

const INSTALLED: CampaignPackInstallStatus = { state: 'installed' };
const INSTALLING: CampaignPackInstallStatus = { state: 'installing' };

/**
 * [plan 16 Task 2] The campaign side of content packs (ADR-008: a campaign's stream stores the JSON
 * of every non-core pack it has enabled, so a member can install it without the DM online).
 *
 * ## DM: `enable` / `changeVersion` / `disable`
 * `enable` uploads the pack's canonical JSON (`PUT /api/campaigns/:id/packs/:packId/:version`),
 * checks the server's `{sha256}` (bare hex over the exact bytes it stored) against the local
 * digest of the same bytes, and only then appends `pack.enabled@1 {packId, version, sha256}` — the
 * server refuses that event unless the digest names the stored body. `changeVersion` is `enable`
 * with the new version (one version per pack id; the upload replaces the old body). `disable`
 * appends `pack.disabled@1` naming the currently enabled version and digest.
 *
 * ## Member: automatic install
 * An effect watches every campaign with a live session (`SyncService.liveCampaignIds`) and its
 * enabled packs (`CampaignStore.enabledPacks`: `welcome.packs` seed + folded pack events). For
 * each enabled pack this device does not hold identically, it fetches the body
 * (`GET` on the same path), runs the SAME checks a `.hkpack`/`.hero` import runs
 * (`validateExternalPack`: size, sha256 against the event's digest, strict schema, id/version,
 * conflict, `validatePack`), and only then installs it (`PackStore.installContent`, no assets —
 * those travel over the blob relay) and toasts `campaigns.packs.installed`. A refusal stores
 * nothing and is recorded (`installErrors`, `installStatus`); it is retried when the enabled entry
 * changes, when this device's installed packs change (a dependency arrived), when the campaign's
 * session comes back, or on `retryInstall`. A missing body (`404` — e.g. the window where the
 * server already holds a newer version than the event this device has folded) is such a
 * retriable error: the matching `pack.enabled` arriving changes the entry. Writes happen on the
 * leader tab only (the only tab with live sessions).
 */
@Injectable({ providedIn: 'root' })
export class CampaignPacksService {
  private readonly syncService = inject(SyncService);
  private readonly campaignStore = inject(CampaignStore);
  private readonly packStore = inject(PackStore);
  private readonly toast = inject(ToastService);
  private readonly leaderService = inject(LeaderService);

  private readonly records = signal<ReadonlyMap<string, InstallRecord>>(new Map());
  private readonly inflight = new Map<string, Promise<void>>();
  private readonly statusSignals = new Map<
    string,
    Signal<ReadonlyMap<string, CampaignPackInstallStatus>>
  >();

  /** Every enabled campaign pack whose install was refused, keyed by `campaignPackKey`, → the i18n
   * key of the reason (`packs.import-failed-*`, `campaigns.packs.install-failed-unavailable`,
   * `packs.install-failed`). Only refusals of the CURRENT enabled entry are listed. */
  readonly installErrors: Signal<ReadonlyMap<string, string>> = computed(() => {
    const enabled = this.campaignStore.enabledPacks();
    const errors = new Map<string, string>();
    for (const [key, record] of this.records()) {
      if (record.status.state !== 'error') continue;
      if (!matches(record, enabled.get(record.campaignId)?.get(record.packId))) continue;
      errors.set(key, record.status.code);
    }
    return errors;
  });

  constructor() {
    effect(() => {
      // The inputs that can make an enabled pack need (another) install attempt.
      this.syncService.liveCampaignIds();
      this.campaignStore.enabledPacks();
      this.packStore.installedContent();
      this.packStore.ready();
      untracked(() => this.reconcile());
    });
  }

  // --- DM ----------------------------------------------------------------------------------------

  /** Uploads `pack` to `campaignId` and enables it (see class doc). Throws
   * `CampaignStoreNotLeaderError` on a non-leader tab (before any upload), the server's `ApiError`
   * (`409 quota_exceeded`, `413`, `403`, ...), or `CampaignPackUploadMismatchError` — in every case
   * no event is appended. */
  async enable(campaignId: string, pack: Pack): Promise<void> {
    if (!this.leaderService.isLeader()) throw new CampaignStoreNotLeaderError();
    const json = canonicalJson(pack);
    const sha256 = await bareSha256(new TextEncoder().encode(json));
    const stored = await apiJson<{ sha256: string }>(
      packBodyPath(campaignId, pack.id, pack.version),
      { method: 'PUT', body: json },
    );
    if (stored.sha256 !== sha256) {
      throw new CampaignPackUploadMismatchError(`${pack.id}@${pack.version}`);
    }
    await this.campaignStore.appendToStream(toStreamId(campaignId), [
      { type: 'pack.enabled', v: 1, payload: { packId: pack.id, version: pack.version, sha256 } },
    ]);
  }

  /** Switches `campaignId` to another version of an enabled pack: `enable` with that version. */
  changeVersion(campaignId: string, pack: Pack): Promise<void> {
    return this.enable(campaignId, pack);
  }

  /** Disables `packId` in `campaignId`; a no-op when the campaign has not enabled it. */
  async disable(campaignId: string, packId: string): Promise<void> {
    const entry = this.campaignStore.enabledPacks().get(campaignId)?.get(packId);
    if (entry === undefined) return;
    await this.campaignStore.appendToStream(toStreamId(campaignId), [
      {
        type: 'pack.disabled',
        v: 1,
        payload: { packId, version: entry.version, sha256: entry.sha256 },
      },
    ]);
  }

  // --- member ------------------------------------------------------------------------------------

  /** `campaignId`'s enabled packs (by pack id) → their install status on this device. */
  installStatus(campaignId: string): Signal<ReadonlyMap<string, CampaignPackInstallStatus>> {
    let status = this.statusSignals.get(campaignId);
    if (status === undefined) {
      status = computed(() => this.computeStatus(campaignId));
      this.statusSignals.set(campaignId, status);
    }
    return status;
  }

  /** Runs the install of `campaignId`'s enabled `packId` again now (a refused one, typically);
   * resolves once that attempt has settled. A no-op for a pack the campaign has not enabled. */
  async retryInstall(campaignId: string, packId: string): Promise<void> {
    if (!this.leaderService.isLeader()) throw new CampaignStoreNotLeaderError();
    const running = this.inflight.get(campaignPackKey(campaignId, packId));
    if (running !== undefined) return running;
    const entry = this.campaignStore.enabledPacks().get(campaignId)?.get(packId);
    if (entry === undefined) return;
    await this.runInstall(campaignId, packId, entry);
  }

  private computeStatus(campaignId: string): ReadonlyMap<string, CampaignPackInstallStatus> {
    const entries = this.campaignStore.enabledPacks().get(campaignId);
    const records = this.records();
    const installed = this.packStore.installedContent();
    const status = new Map<string, CampaignPackInstallStatus>();
    for (const [packId, entry] of entries ?? []) {
      const record = records.get(campaignPackKey(campaignId, packId));
      if (record !== undefined && matches(record, entry) && record.status.state !== 'installed') {
        status.set(packId, record.status);
      } else if (installed.some((p) => p.id === packId && p.version === entry.version)) {
        status.set(packId, INSTALLED);
      } else {
        status.set(packId, INSTALLING);
      }
    }
    return status;
  }

  /** Starts an install for every enabled pack of every live campaign that is neither running nor
   * settled; forgets the refusals of campaigns that went offline (retried when they come back). */
  private reconcile(): void {
    if (!this.packStore.ready() || !this.leaderService.isLeader()) return;
    const live = this.syncService.liveCampaignIds();
    const enabled = this.campaignStore.enabledPacks();
    const content = this.packStore.installedContent();

    const records = this.records();
    const offline = [...records].filter(
      ([, r]) => r.status.state === 'error' && !live.has(r.campaignId),
    );
    if (offline.length > 0) {
      const next = new Map(records);
      for (const [key] of offline) next.delete(key);
      this.records.set(next);
    }

    for (const campaignId of live) {
      for (const [packId, entry] of enabled.get(campaignId) ?? []) {
        const key = campaignPackKey(campaignId, packId);
        if (this.inflight.has(key)) continue;
        if (settled(this.records().get(key), entry, content)) continue;
        void this.runInstall(campaignId, packId, entry);
      }
    }
  }

  private async runInstall(campaignId: string, packId: string, entry: EnabledPack): Promise<void> {
    const key = campaignPackKey(campaignId, packId);
    const content = this.packStore.installedContent();
    const record = (status: CampaignPackInstallStatus): InstallRecord => ({
      campaignId,
      packId,
      version: entry.version,
      sha256: entry.sha256,
      status,
      content,
    });
    this.setRecord(key, record(INSTALLING));

    const run = (async () => {
      try {
        await this.install(campaignId, packId, entry);
        this.setRecord(key, record(INSTALLED));
      } catch (error) {
        this.setRecord(key, record({ state: 'error', code: installErrorCode(error) }));
      }
    })();
    this.inflight.set(key, run);
    try {
      await run;
    } finally {
      this.inflight.delete(key);
    }
    // Anything that changed while this attempt ran (a newer entry, a dependency installed).
    this.reconcile();
  }

  /** Fetches, validates and installs one enabled pack — nothing is written unless every check
   * passes; nothing is fetched when this device already holds the identical pack. */
  private async install(campaignId: string, packId: string, entry: EnabledPack): Promise<void> {
    const local = this.packStore
      .installedContent()
      .find((p) => p.id === packId && p.version === entry.version);
    if (local !== undefined) {
      const localSha = await bareSha256(new TextEncoder().encode(canonicalJson(local)));
      if (localSha === entry.sha256) return;
    }

    const bytes = await apiBytes(packBodyPath(campaignId, packId, entry.version));
    const { pack } = await validateExternalPack(
      bytes,
      { id: packId, version: entry.version, sha256: entry.sha256 },
      this.packStore.packs(),
    );
    // Another campaign may have installed the same pack while this body was in flight.
    if (checkPackConflict(pack, this.packStore.packs())) return;
    await this.packStore.installContent(pack, new Map());
    this.toast.show('campaigns.packs.installed', { name: pack.name });
  }

  private setRecord(key: string, record: InstallRecord): void {
    this.records.update((current) => new Map(current).set(key, record));
  }
}

function matches(record: InstallRecord, entry: EnabledPack | undefined): boolean {
  return entry?.version === record.version && entry.sha256 === record.sha256;
}

/** No new attempt is due: one is recorded for this exact entry, and it either is still running,
 * installed a pack that is still present, or was refused with nothing installed since. */
function settled(
  record: InstallRecord | undefined,
  entry: EnabledPack,
  content: readonly Pack[],
): boolean {
  if (record === undefined || !matches(record, entry)) return false;
  switch (record.status.state) {
    case 'installing':
      return true;
    case 'installed':
      return content.some((p) => p.id === record.packId && p.version === record.version);
    case 'error':
      return record.content === content;
  }
}

function installErrorCode(error: unknown): string {
  if (error instanceof PackImportError) return error.code;
  if (error instanceof ApiError) return 'campaigns.packs.install-failed-unavailable';
  return 'packs.install-failed';
}

function packBodyPath(campaignId: string, packId: string, version: string): string {
  return `/api/campaigns/${encodeURIComponent(campaignId)}/packs/${encodeURIComponent(packId)}/${encodeURIComponent(version)}`;
}

function toStreamId(campaignId: string): string {
  return `camp:${campaignId}`;
}

/** The bare 64-hex digest `pack.enabled@1` and the server's `{sha256}` carry. */
async function bareSha256(bytes: Uint8Array): Promise<string> {
  return (await sha256Hex(bytes)).slice('sha256:'.length);
}
