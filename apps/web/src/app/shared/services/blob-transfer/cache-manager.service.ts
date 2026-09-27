import { inject, Injectable, signal, type Signal } from '@angular/core';
import { projectCampaign } from '@shared/services/campaigns/campaign-projection';
import {
  StoragePersistService,
  type StorageUsageEstimate,
} from '@shared/services/pwa/storage-persist.service';
import { BlobsRepository } from '@shared/services/storage/blobs.repository';
import { CampaignsRepository } from '@shared/services/storage/campaigns.repository';
import { CharactersRepository } from '@shared/services/storage/characters.repository';
import { EventsRepository } from '@shared/services/storage/events.repository';
import { SettingsRepository } from '@shared/services/storage/settings.repository';
import { SnapshotsRepository } from '@shared/services/storage/snapshots.repository';
import {
  isOrphanSweepDue,
  selectLruEvictions,
  selectOrphans,
  type CacheableBlob,
} from './blob-cache-policy';

/** doc-07 §Cache management: "Settings slider 100 MB–2 GB". */
export const CACHE_CAP_MIN_BYTES = 100 * 1024 * 1024;
export const CACHE_CAP_MAX_BYTES = 2 * 1024 * 1024 * 1024;
/** doc-07: "LRU cap default 500 MB". */
export const CACHE_CAP_DEFAULT_BYTES = 500 * 1024 * 1024;

const CACHE_CAP_SETTINGS_KEY = 'blobCacheCapBytes';
const ORPHAN_SWEEP_LAST_RUN_KEY = 'blobOrphanSweepLastRunAt';
/** doc-07: "Orphans ... are cleaned weekly." */
const ORPHAN_SWEEP_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

function clampCapBytes(bytes: number): number {
  return Math.min(CACHE_CAP_MAX_BYTES, Math.max(CACHE_CAP_MIN_BYTES, Math.round(bytes)));
}

function toCacheable(
  rows: readonly { hash: string; size: number; pinned: boolean; lastUsedAt: number }[],
): CacheableBlob[] {
  return rows.map((r) => ({
    hash: r.hash,
    size: r.size,
    pinned: r.pinned,
    lastUsedAt: r.lastUsedAt,
  }));
}

/**
 * `CacheManagerService` — the Dexie-facing orchestrator for doc-07 §Cache management. Owns:
 * (1) the cache cap (`Settings` row, Settings UI slider 100 MB–2 GB, default 500 MB), (2) pin
 * recomputation (own characters + every LOCALLY KNOWN campaign's party-overview thumbs — a
 * `CampaignsRepository` row only exists locally WHILE this device is a member, per
 * `sync.service.ts`'s `handleCampaignBye` removing it on member-removal, so "every locally known
 * campaign" already IS doc-07's "current campaign(s), while a member"), (3) the LRU sweep down to
 * the cap, and (4) the weekly orphan sweep. The actual eviction/orphan DECISIONS are pure functions
 * in `blob-cache-policy.ts`; this class only supplies the real data and performs the writes.
 *
 * HONESTY NOTE on the reference scan: doc-07 says orphans are "not referenced by any local stream
 * OR PACK". This class's `computeReferencedHashes` covers "local stream" (own characters' portrait
 * thumb + full portrait when a `Snapshot` happens to be cached, and every locally-known campaign's
 * projected `party.overview_updated` thumbs) but NOT "pack" — no content pack in this codebase
 * currently references a hash in the `blobs` table via any implemented pipeline (ADR-008: the
 * server never stores pack ASSETS at all, and no client-side pack-asset-into-`blobs`-table pipeline
 * exists yet), so this is a real but currently-inert gap, flagged rather than silently assumed
 * complete.
 *
 * `BlobTransferService` (the other Task 13 half) calls `refreshPins()` whenever a live campaign
 * session's roster/overview data changes or a campaign session starts/stops — see that service's
 * own doc for exactly where.
 */
@Injectable({ providedIn: 'root' })
export class CacheManagerService {
  private readonly blobsRepository = inject(BlobsRepository);
  private readonly charactersRepository = inject(CharactersRepository);
  private readonly campaignsRepository = inject(CampaignsRepository);
  private readonly eventsRepository = inject(EventsRepository);
  private readonly snapshotsRepository = inject(SnapshotsRepository);
  private readonly settingsRepository = inject(SettingsRepository);
  private readonly storagePersistService = inject(StoragePersistService);

  private readonly capBytesState = signal(CACHE_CAP_DEFAULT_BYTES);
  /** The current LRU cap, in bytes — the Settings slider's own bound value. */
  readonly capBytes: Signal<number> = this.capBytesState.asReadonly();
  /** `navigator.storage.estimate()`, re-exported for the Settings UI (doc-07: the slider "shows
   * `navigator.storage.estimate()`") — this service adds no polling of its own, it just forwards
   * `StoragePersistService`'s existing signal. */
  readonly estimate: Signal<StorageUsageEstimate | undefined> = this.storagePersistService.estimate;

  /** Resolves once construction-time work (loading the persisted cap, and the boot-time weekly
   * orphan-sweep check) has settled — tests await this for deterministic assertions; production
   * code never needs to (every public method is independently safe to call before or after). */
  readonly ready: Promise<void>;

  constructor() {
    this.ready = this.init();
  }

  private async init(): Promise<void> {
    await this.loadCap();
    await this.maybeRunWeeklyOrphanSweep();
  }

  private async loadCap(): Promise<void> {
    const stored = await this.settingsRepository.get<number>(CACHE_CAP_SETTINGS_KEY);
    if (stored !== undefined) this.capBytesState.set(clampCapBytes(stored));
  }

  /** Settings UI entry point — clamps to `[CACHE_CAP_MIN_BYTES, CACHE_CAP_MAX_BYTES]`, persists,
   * and immediately re-runs the LRU sweep against the new (possibly smaller) cap. */
  async setCapBytes(bytes: number): Promise<void> {
    const clamped = clampCapBytes(bytes);
    this.capBytesState.set(clamped);
    await this.settingsRepository.set(CACHE_CAP_SETTINGS_KEY, clamped);
    await this.runLruSweep();
  }

  /** Every hash this device currently has a legitimate reason to pin OR keep during an orphan
   * sweep — own characters' portrait thumb (+ full portrait, when a `Snapshot` is cached) and
   * every locally-known campaign's projected party-overview thumbs. See class doc's honesty note
   * for what this deliberately does NOT cover (pack assets). */
  private async computeReferencedHashes(): Promise<Set<string>> {
    const hashes = new Set<string>();

    const characters = await this.charactersRepository.list();
    for (const character of characters) {
      if (character.portraitThumbHash) hashes.add(character.portraitThumbHash);
      const snapshot = await this.snapshotsRepository.get(character.id);
      if (snapshot?.facts.portrait?.hash) hashes.add(snapshot.facts.portrait.hash);
      if (snapshot?.facts.portrait?.thumbHash) hashes.add(snapshot.facts.portrait.thumbHash);
    }

    const campaigns = await this.campaignsRepository.list();
    for (const campaign of campaigns) {
      const events = await this.eventsRepository.byStream(`camp:${campaign.id}`);
      const state = projectCampaign(events);
      for (const overview of state.overviews.values()) {
        if (overview.portraitThumb) hashes.add(overview.portraitThumb);
      }
    }

    return hashes;
  }

  /** Recomputes `pinned` for EVERY locally-cached blob from scratch (a full recompute, not an
   * incremental patch — simpler and self-correcting: a blob no longer referenced anywhere gets
   * un-pinned exactly as readily as a newly-referenced one gets pinned). Called by
   * `BlobTransferService` whenever campaign roster/overview data changes — see that service's own
   * doc for where. */
  async refreshPins(): Promise<void> {
    const referenced = await this.computeReferencedHashes();
    const rows = await this.blobsRepository.list();
    for (const row of rows) {
      const shouldPin = referenced.has(row.hash);
      if (row.pinned !== shouldPin) await this.blobsRepository.setPinned(row.hash, shouldPin);
    }
  }

  /** LRU-evicts unpinned rows down to the current cap (`selectLruEvictions`) — never removes a
   * pinned row. Safe to call any time (Settings slider change, a periodic background tick, or
   * right after a fresh blob arrives). */
  async runLruSweep(): Promise<void> {
    const rows = await this.blobsRepository.list();
    const evictions = selectLruEvictions(toCacheable(rows), this.capBytesState());
    for (const hash of evictions) await this.blobsRepository.remove(hash);
  }

  /** Refreshes pins first (so the `pinned` column is current before deciding what counts as
   * "referenced" for THIS pass — see `selectOrphans`'s own "pinned rows are never orphan-swept"
   * rule), then removes every unpinned, unreferenced row, then stamps the sweep timestamp. */
  async runOrphanSweep(): Promise<void> {
    await this.refreshPins();
    const referenced = await this.computeReferencedHashes();
    const rows = await this.blobsRepository.list();
    const orphans = selectOrphans(toCacheable(rows), referenced);
    for (const hash of orphans) await this.blobsRepository.remove(hash);
    await this.settingsRepository.set(ORPHAN_SWEEP_LAST_RUN_KEY, Date.now());
  }

  private async maybeRunWeeklyOrphanSweep(): Promise<void> {
    const lastRun = await this.settingsRepository.get<number>(ORPHAN_SWEEP_LAST_RUN_KEY);
    if (!isOrphanSweepDue(lastRun, Date.now(), ORPHAN_SWEEP_INTERVAL_MS)) return;
    await this.runOrphanSweep();
  }
}
