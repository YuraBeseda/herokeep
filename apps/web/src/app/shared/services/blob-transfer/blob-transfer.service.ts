import {
  effect,
  inject,
  Injectable,
  InjectionToken,
  Injector,
  type EffectRef,
} from '@angular/core';
import { uuidv7 } from '@shared/helpers/uuid';
import { projectCampaign } from '@shared/services/campaigns/campaign-projection';
import { sha256Hex } from '@shared/services/images/image-pipeline.service';
import { Backoff } from '@shared/services/sync/backoff';
import { SyncService } from '@shared/services/sync/sync.service';
import { BlobsRepository } from '@shared/services/storage/blobs.repository';
import { CampaignsRepository } from '@shared/services/storage/campaigns.repository';
import { CharactersRepository } from '@shared/services/storage/characters.repository';
import type { BlobRow } from '@shared/services/storage/dexie.db';
import { EventsRepository } from '@shared/services/storage/events.repository';
import { SnapshotsRepository } from '@shared/services/storage/snapshots.repository';
import { CacheManagerService } from './cache-manager.service';
import {
  decodeBlobChunkHeader,
  encodeBlobChunkFrame,
  hashPrefixBytes,
  splitIntoChunks,
} from './blob-chunk-codec';
import { sniffImageMime } from './image-mime-sniff';

/** doc-07's client-side design gives no explicit number for how long a requester waits for
 * SOMETHING (a `blob.pull`-triggered chunk, or `blob.unavailable`) before giving up — a judgment
 * call, generous enough that a holder streaming a full-size portrait over a slow connection isn't
 * mistaken for a stall, bounded enough that a genuinely stuck request recovers in a
 * user-noticeable time. Constructor-injectable so specs use a small real duration. */
export const BLOB_REQUEST_TIMEOUT_MS = new InjectionToken<number>('BLOB_REQUEST_TIMEOUT_MS', {
  factory: () => 15_000,
});

/** Schedules `fn` for idle, best-effort, work — `requestIdleCallback` where available, a 2s
 * `setTimeout` fallback otherwise (doc-07's own prefetch-policy table: "`requestIdleCallback` or
 * 2s after 2" for P3; "idle, continuous" for P4). Constructor-injectable so specs drive idle work
 * deterministically instead of depending on real idle callbacks or timers. */
export type BlobIdleScheduler = (fn: () => void) => void;

function defaultIdleScheduler(fn: () => void): void {
  const ric = (globalThis as { requestIdleCallback?: (cb: () => void) => number })
    .requestIdleCallback;
  if (typeof ric === 'function') ric(() => fn());
  else setTimeout(fn, 2000);
}

export const BLOB_IDLE_SCHEDULER = new InjectionToken<BlobIdleScheduler>('BLOB_IDLE_SCHEDULER', {
  factory: () => defaultIdleScheduler,
});

type WantedTier = 1 | 2 | 3;

interface WantedHash {
  readonly hash: string;
  readonly tier: WantedTier;
  readonly kind: BlobRow['kind'];
}

interface InFlightRequest {
  readonly hash: string;
  readonly tier: WantedTier;
  readonly kind: BlobRow['kind'];
  readonly chunks: Map<number, Uint8Array>;
  total: number | undefined;
  readonly timeoutHandle: ReturnType<typeof setTimeout>;
}

interface ServeJob {
  readonly hash: string;
  readonly to: number;
}

interface CampaignWatcher {
  queue: WantedHash[];
  current: InFlightRequest | undefined;
  serveQueue: ServeJob[];
  currentServe: ServeJob | undefined;
  readonly backoff: Backoff;
  retryTimeoutHandle: ReturnType<typeof setTimeout> | undefined;
  pendingRetry: WantedHash | undefined;
  dmLoopActive: boolean;
  wasConnected: boolean;
  unsubscribeBinary: (() => void) | undefined;
  unsubscribeBlobPull: (() => void) | undefined;
  unsubscribeBlobUnavailable: (() => void) | undefined;
  membersEffect: EffectRef | undefined;
  connectEffect: EffectRef | undefined;
}

interface WantedTiers {
  readonly p1: WantedHash[];
  readonly p2: WantedHash[];
  readonly p3: WantedHash[];
  readonly isDm: boolean;
}

function bareCharacterId(streamId: string): string {
  return streamId.startsWith('char:') ? streamId.slice('char:'.length) : streamId;
}

function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * `BlobTransferService` — docs/02-architecture/07-images-and-blobs.md §Blob transfer protocol +
 * §Prefetch policy, plan-10 Task 13. One `CampaignWatcher` per campaign with a currently live
 * session (`SyncService.liveCampaignIds`, reactive) — NOT gated on `CampaignStore`'s single
 * "currently open for viewing" state, since prefetch/serve must keep running for every
 * concurrently-synced campaign (mirrors `CacheManagerService`'s own reasoning for reading
 * `CampaignsRepository`/`EventsRepository` directly rather than through `CampaignStore.state()`).
 *
 * ## Prefetch tiers — HONESTY NOTE (doc-07's table vs. what this codebase's state actually exposes)
 *
 * doc-07: "P1 own portrait thumb + token + equipped/prepared icons; P2 party tokens + campaign
 * banner; P3 full portrait + remaining own icons; P4 (DM) every announced blob, continuous." What
 * this task's data sources ACTUALLY expose:
 * - "Token" is not a separately-stored hash anywhere in this codebase — `ImagePipelineService`'s
 *   own doc: a token is byte-identical to its thumb (same box, same cap), so `tokenHash ===
 *   thumbHash` always. P1's "thumb + token" therefore collapses to ONE hash per own character.
 * - Equipped-item/prepared-spell icons have NO hash surface in `Facts`/`CharacterRow` at all — that
 *   would require resolving enabled content packs' own asset manifests against a character's
 *   equipped/prepared entity ids, which is FULL-mode roster/pack-asset territory outside what a
 *   campaign's `CampaignState` (this task's actual scope) exposes. NOT implemented — a real,
 *   documented v1 gap, not a silent omission.
 * - The campaign settings document (`CampaignSettingsSchema`, `@hk/protocol`) has NO banner field
 *   at all. P2's "campaign banner" has nothing to prefetch in v1 — also not implemented.
 * - "Full portrait" (P3) is available ONLY for a device's OWN characters, and only when that
 *   character's `Snapshot` happens to be cached locally (`SnapshotsRepository`) — `CharacterRow`
 *   itself indexes just `portraitThumbHash` (task-2-report.md).
 *
 * So in this implementation: **P1** = own characters' portrait thumb (immediate, on connect).
 * **P2** = OTHER roster members' `party.overview_updated` thumb (`CampaignState.overviews`,
 * doc-07's own "Announced" hashes source), right after P1. **P3** = own characters' FULL portrait
 * hash (from a cached `Snapshot`, when one exists), idle. **P4** (DM only) = the SAME sources as
 * P1–P3, re-scanned CONTINUOUSLY on every idle tick — "every announced blob" reduces to "every
 * `portraitThumb`/own-portrait hash this state can see", scanned repeatedly rather than once, since
 * no broader "announced" hash source (full-mode roster subscriptions, pack assets) exists at this
 * task's boundary.
 *
 * ## Codec pinning
 *
 * `blob-chunk-codec.ts`'s constants are copied from (not imported from — `apps/web` cannot import
 * `apps/api`) `apps/api/src/core/streams/blob-relay.ts`, with a byte-equality fixture test pinning
 * them.
 *
 * ## State machines
 *
 * - **Requester**: one `WantedHash` queue per campaign, priority-ordered by tier; `pump()` starts
 *   the next request only when nothing is currently in flight (doc-07: "one blob in flight per
 *   requester"). `blob.request` → EITHER `blob.chunk` frames accumulate until `index === total-1`,
 *   (SHA-256 verified BEFORE storing; mismatch discards and retries) OR `blob.unavailable` arrives,
 *   OR nothing arrives within `BLOB_REQUEST_TIMEOUT_MS` (→ `blob.cancel`, then retry). Every retry
 *   path goes through `scheduleRetry`: a `Backoff`-timed re-queue, ALSO cancelable early by
 *   `SyncService.membersFor(campaignId)` changing (doc-07: "retries when a `members` update shows
 *   a new peer" — HONEST caveat: `selectHolder` (server-side) has no exclusion list, so the server
 *   may re-pick the SAME holder again; this client's only lever is cancel+retry TIMING, not a
 *   guaranteed different holder).
 * - **Holder (serving)**: `blob.pull {hash, to}` frames queue per campaign; `pumpServe()` sends
 *   ONE transfer's `blob.chunk` frames to completion before starting the next (deliberately
 *   serialized on THIS client's own outbound socket use, even though the SERVER independently
 *   allows up to 2 concurrent serves per holder — doc-07's "serve one-at-a-time per holder queue"
 *   binds this task's client behavior, not the server's own, separate cap).
 *
 * ## Pin refresh
 *
 * `CacheManagerService.refreshPins()` is called at every point this service already recomputes
 * campaign state anyway: after a watcher starts/stops (`reconcileCampaignWatchers`), on each
 * connect sequence, and after every successfully stored blob. No dedicated
 * "membership/roster changed" event hook exists on `CampaignStore`/`SyncService` for campaigns
 * other than the currently-open one, so piggybacking on this service's own recompute points is the
 * pragmatic, honestly-documented choice — see `CacheManagerService`'s own class doc for what its
 * reference scan can see.
 */
@Injectable({ providedIn: 'root' })
export class BlobTransferService {
  private readonly syncService = inject(SyncService);
  private readonly cacheManagerService = inject(CacheManagerService);
  private readonly blobsRepository = inject(BlobsRepository);
  private readonly charactersRepository = inject(CharactersRepository);
  private readonly campaignsRepository = inject(CampaignsRepository);
  private readonly eventsRepository = inject(EventsRepository);
  private readonly snapshotsRepository = inject(SnapshotsRepository);
  private readonly requestTimeoutMs = inject(BLOB_REQUEST_TIMEOUT_MS);
  private readonly idleScheduler = inject(BLOB_IDLE_SCHEDULER);
  private readonly injector = inject(Injector);

  private readonly watchers = new Map<string, CampaignWatcher>();

  constructor() {
    effect(() => {
      const liveIds = this.syncService.liveCampaignIds();
      // Deferred to a microtask: `reconcileCampaignWatchers` → `startWatcher` creates NESTED
      // `effect()`s (the members/connect watchers below) — Angular forbids calling `effect()`
      // synchronously from within another effect's own reactive execution (NG0602), regardless of
      // the `injector` option passed to the nested call. Escaping to a microtask here is enough;
      // production code has no reason to react synchronously to this signal.
      queueMicrotask(() => this.reconcileCampaignWatchers(liveIds));
    });
  }

  // --- watcher lifecycle -----------------------------------------------------------------------

  private reconcileCampaignWatchers(liveIds: ReadonlySet<string>): void {
    for (const id of liveIds) {
      if (!this.watchers.has(id)) this.startWatcher(id);
    }
    for (const id of [...this.watchers.keys()]) {
      if (!liveIds.has(id)) this.stopWatcher(id);
    }
  }

  private startWatcher(campaignId: string): void {
    const watcher: CampaignWatcher = {
      queue: [],
      current: undefined,
      serveQueue: [],
      currentServe: undefined,
      backoff: new Backoff(),
      retryTimeoutHandle: undefined,
      pendingRetry: undefined,
      dmLoopActive: false,
      wasConnected: false,
      unsubscribeBinary: undefined,
      unsubscribeBlobPull: undefined,
      unsubscribeBlobUnavailable: undefined,
      membersEffect: undefined,
      connectEffect: undefined,
    };
    this.watchers.set(campaignId, watcher);

    watcher.unsubscribeBinary = this.syncService.registerBinaryFrameConsumer(campaignId, (bytes) =>
      this.onBinaryFrame(campaignId, bytes),
    );
    watcher.unsubscribeBlobPull = this.syncService.registerBlobPullConsumer(
      campaignId,
      (hash, to) => this.onBlobPull(campaignId, hash, to),
    );
    watcher.unsubscribeBlobUnavailable = this.syncService.registerBlobUnavailableConsumer(
      campaignId,
      (hash) => this.onBlobUnavailable(campaignId, hash),
    );

    // Retry-on-members-change (doc-07) — see class doc's "State machines" section.
    watcher.membersEffect = effect(
      () => {
        this.syncService.membersFor(campaignId)();
        this.onMembersChanged(campaignId);
      },
      { injector: this.injector },
    );

    // "On connect" (doc-07) — `syncState` transitions to 'synced'/'pending-N' on EVERY genuine
    // (re)connect, not just the first, since `StreamSyncSession.connectionState` flips to
    // 'connecting' on every reconnect attempt first (see `stream-sync-session.ts`'s own
    // `handleClose`/`connect`).
    watcher.connectEffect = effect(
      () => {
        const state = this.syncService.syncState(`camp:${campaignId}`)();
        const isOpen = state === 'synced' || state.startsWith('pending-');
        if (isOpen && !watcher.wasConnected) {
          watcher.wasConnected = true;
          void this.runConnectSequence(campaignId);
        } else if (!isOpen) {
          watcher.wasConnected = false;
        }
      },
      { injector: this.injector },
    );

    void this.cacheManagerService.refreshPins();
  }

  private stopWatcher(campaignId: string): void {
    const watcher = this.watchers.get(campaignId);
    if (!watcher) return;
    watcher.unsubscribeBinary?.();
    watcher.unsubscribeBlobPull?.();
    watcher.unsubscribeBlobUnavailable?.();
    watcher.membersEffect?.destroy();
    watcher.connectEffect?.destroy();
    if (watcher.current) clearTimeout(watcher.current.timeoutHandle);
    if (watcher.retryTimeoutHandle !== undefined) clearTimeout(watcher.retryTimeoutHandle);
    watcher.dmLoopActive = false;
    this.watchers.delete(campaignId);
    void this.cacheManagerService.refreshPins();
  }

  // --- wanted-hash computation (see class doc's honesty note) -----------------------------------

  private async computeWantedForCampaign(campaignId: string): Promise<WantedTiers> {
    const campaignRow = await this.campaignsRepository.get(campaignId);
    const isDm = campaignRow?.role === 'dm';

    const events = await this.eventsRepository.byStream(`camp:${campaignId}`);
    const state = projectCampaign(events);

    const characters = await this.charactersRepository.list();
    const localCharacterIds = new Set(characters.map((c) => bareCharacterId(c.id)));
    const ownRosterIds = new Set(
      [...state.roster.entries()]
        .filter(([id, entry]) => !entry.left && localCharacterIds.has(id))
        .map(([id]) => id),
    );

    const p1: WantedHash[] = [];
    const p3: WantedHash[] = [];
    for (const character of characters) {
      const bareId = bareCharacterId(character.id);
      if (!ownRosterIds.has(bareId)) continue;
      if (character.portraitThumbHash) {
        p1.push({ hash: character.portraitThumbHash, tier: 1, kind: 'thumb' });
      }
      const snapshot = await this.snapshotsRepository.get(character.id);
      if (snapshot?.facts.portrait?.hash) {
        p3.push({ hash: snapshot.facts.portrait.hash, tier: 3, kind: 'portrait' });
      }
    }

    const p2: WantedHash[] = [];
    for (const [characterId, overview] of state.overviews) {
      if (!overview.portraitThumb || ownRosterIds.has(characterId)) continue;
      p2.push({ hash: overview.portraitThumb, tier: 2, kind: 'thumb' });
    }

    return { p1, p2, p3, isDm };
  }

  // --- connect sequence (P1 → P2 immediately, P3 idle, P4 DM-only continuous) -------------------

  private async runConnectSequence(campaignId: string): Promise<void> {
    const watcher = this.watchers.get(campaignId);
    if (!watcher) return;

    const wanted = await this.computeWantedForCampaign(campaignId);
    await this.cacheManagerService.refreshPins();

    const relevant = [...wanted.p1, ...wanted.p2, ...wanted.p3];
    const held: string[] = [];
    for (const w of relevant) {
      if (await this.blobsRepository.get(w.hash)) held.push(w.hash);
    }
    this.announceHave(campaignId, held);

    await this.enqueueMissing(watcher, wanted.p1);
    this.pump(campaignId);
    await this.enqueueMissing(watcher, wanted.p2);
    this.pump(campaignId);

    this.idleScheduler(() => {
      void (async () => {
        const stillWatching = this.watchers.get(campaignId);
        if (!stillWatching) return;
        await this.enqueueMissing(stillWatching, wanted.p3);
        this.pump(campaignId);
        if (wanted.isDm) this.startDmSuperPeerLoop(campaignId);
      })();
    });
  }

  private startDmSuperPeerLoop(campaignId: string): void {
    const watcher = this.watchers.get(campaignId);
    if (!watcher || watcher.dmLoopActive) return;
    watcher.dmLoopActive = true;

    const tick = (): void => {
      const current = this.watchers.get(campaignId);
      if (!current?.dmLoopActive) return;
      void this.dmSuperPeerTick(campaignId).finally(() => {
        const stillActive = this.watchers.get(campaignId);
        if (stillActive?.dmLoopActive) this.idleScheduler(tick);
      });
    };
    this.idleScheduler(tick);
  }

  private async dmSuperPeerTick(campaignId: string): Promise<void> {
    const watcher = this.watchers.get(campaignId);
    if (!watcher) return;
    const wanted = await this.computeWantedForCampaign(campaignId);
    await this.enqueueMissing(watcher, [...wanted.p1, ...wanted.p2, ...wanted.p3]);
    this.pump(campaignId);
  }

  private async enqueueMissing(
    watcher: CampaignWatcher,
    wanted: readonly WantedHash[],
  ): Promise<void> {
    for (const w of wanted) {
      if (watcher.queue.some((q) => q.hash === w.hash)) continue;
      if (watcher.current?.hash === w.hash) continue;
      const existing = await this.blobsRepository.get(w.hash);
      if (existing) continue;
      watcher.queue.push(w);
    }
    watcher.queue.sort((a, b) => a.tier - b.tier);
  }

  private announceHave(campaignId: string, hashes: readonly string[]): void {
    if (hashes.length === 0) return;
    this.syncService.sendBlobHave(campaignId, hashes);
  }

  // --- requester state machine (single in-flight per campaign) -----------------------------------

  private pump(campaignId: string): void {
    const watcher = this.watchers.get(campaignId);
    if (!watcher || watcher.current || watcher.queue.length === 0) return;
    const next = watcher.queue.shift();
    if (!next) return;
    void this.startRequest(campaignId, next);
  }

  private async startRequest(campaignId: string, wanted: WantedHash): Promise<void> {
    const watcher = this.watchers.get(campaignId);
    if (!watcher || watcher.current) return;
    const existing = await this.blobsRepository.get(wanted.hash);
    if (existing) {
      this.pump(campaignId);
      return;
    }

    const rid = uuidv7();
    const timeoutHandle = setTimeout(
      () => this.onRequestTimeout(campaignId),
      this.requestTimeoutMs,
    );
    watcher.current = {
      hash: wanted.hash,
      tier: wanted.tier,
      kind: wanted.kind,
      chunks: new Map(),
      total: undefined,
      timeoutHandle,
    };
    this.syncService.sendBlobRequest(campaignId, rid, wanted.hash);
  }

  private onRequestTimeout(campaignId: string): void {
    const watcher = this.watchers.get(campaignId);
    if (!watcher?.current) return;
    const { hash, tier, kind } = watcher.current;
    this.syncService.sendBlobCancel(campaignId, hash);
    watcher.current = undefined;
    this.scheduleRetry(campaignId, { hash, tier, kind });
    this.pump(campaignId);
  }

  private onBlobUnavailable(campaignId: string, hash: string): void {
    const watcher = this.watchers.get(campaignId);
    if (watcher?.current?.hash !== hash) return;
    clearTimeout(watcher.current.timeoutHandle);
    const { tier, kind } = watcher.current;
    watcher.current = undefined;
    this.scheduleRetry(campaignId, { hash, tier, kind });
    this.pump(campaignId);
  }

  private scheduleRetry(campaignId: string, wanted: WantedHash): void {
    const watcher = this.watchers.get(campaignId);
    if (!watcher) return;
    const delay = watcher.backoff.next();
    watcher.pendingRetry = wanted;
    watcher.retryTimeoutHandle = setTimeout(() => {
      const current = this.watchers.get(campaignId);
      if (!current) return;
      current.retryTimeoutHandle = undefined;
      current.pendingRetry = undefined;
      current.queue.unshift(wanted);
      this.pump(campaignId);
    }, delay);
  }

  private onMembersChanged(campaignId: string): void {
    const watcher = this.watchers.get(campaignId);
    if (!watcher?.pendingRetry) return;
    if (watcher.retryTimeoutHandle !== undefined) {
      clearTimeout(watcher.retryTimeoutHandle);
      watcher.retryTimeoutHandle = undefined;
    }
    const wanted = watcher.pendingRetry;
    watcher.pendingRetry = undefined;
    watcher.queue.unshift(wanted);
    this.pump(campaignId);
  }

  private onBinaryFrame(campaignId: string, bytes: Uint8Array): void {
    const watcher = this.watchers.get(campaignId);
    if (!watcher?.current) return;
    const decoded = decodeBlobChunkHeader(bytes);
    if (!decoded) return;
    if (!bytesEqual(decoded.hashPrefix, hashPrefixBytes(watcher.current.hash))) return;

    watcher.current.chunks.set(decoded.index, decoded.payload);
    watcher.current.total = decoded.total;
    if (watcher.current.chunks.size < decoded.total) return;

    void this.finishAssembly(campaignId);
  }

  private async finishAssembly(campaignId: string): Promise<void> {
    const watcher = this.watchers.get(campaignId);
    const inflight = watcher?.current;
    if (!watcher || !inflight) return;
    clearTimeout(inflight.timeoutHandle);

    const total = inflight.total ?? inflight.chunks.size;
    const parts: Uint8Array[] = [];
    let incomplete = false;
    for (let i = 0; i < total; i++) {
      const part = inflight.chunks.get(i);
      if (!part) {
        incomplete = true;
        break;
      }
      parts.push(part);
    }

    watcher.current = undefined;

    if (incomplete) {
      this.scheduleRetry(campaignId, {
        hash: inflight.hash,
        tier: inflight.tier,
        kind: inflight.kind,
      });
      this.pump(campaignId);
      return;
    }

    const assembled = concatBytes(parts);
    const digestHex = await sha256Hex(assembled);

    // doc-07: "verifies the SHA-256 of the assembled bytes before storing; mismatch -> discard and
    // retry from another holder".
    if (digestHex !== inflight.hash) {
      this.scheduleRetry(campaignId, {
        hash: inflight.hash,
        tier: inflight.tier,
        kind: inflight.kind,
      });
      this.pump(campaignId);
      return;
    }

    const mime = sniffImageMime(assembled) ?? 'application/octet-stream';
    await this.blobsRepository.put(digestHex, mime, assembled, { kind: inflight.kind });
    watcher.backoff.reset();
    this.announceHave(campaignId, [digestHex]);
    await this.cacheManagerService.refreshPins();
    this.pump(campaignId);
  }

  // --- holder state machine (serve queue one-at-a-time) ------------------------------------------

  private onBlobPull(campaignId: string, hash: string, toStr: string): void {
    const watcher = this.watchers.get(campaignId);
    if (!watcher) return;
    const to = Number(toStr);
    if (!Number.isFinite(to)) return;
    watcher.serveQueue.push({ hash, to });
    this.pumpServe(campaignId);
  }

  private pumpServe(campaignId: string): void {
    const watcher = this.watchers.get(campaignId);
    if (!watcher || watcher.currentServe || watcher.serveQueue.length === 0) return;
    const job = watcher.serveQueue.shift();
    if (!job) return;
    watcher.currentServe = job;
    void this.serve(campaignId, job);
  }

  private async serve(campaignId: string, job: ServeJob): Promise<void> {
    const row = await this.blobsRepository.get(job.hash);
    if (row) {
      const chunks = splitIntoChunks(row.bytes);
      const total = chunks.length;
      for (let index = 0; index < total; index++) {
        const frame = encodeBlobChunkFrame(job.hash, index, total, job.to, chunks[index]);
        this.syncService.sendBlobChunk(campaignId, frame);
      }
      await this.blobsRepository.touchLastUsed(job.hash);
    }
    // doc-03/doc-07 give no "I can't serve after all" reply for a hash this device no longer holds
    // (evicted since it announced — same "nothing to answer with" stance the server's own
    // `handleRequest` takes for an unhonorable request) — just move on to the next queued job.
    const watcher = this.watchers.get(campaignId);
    if (watcher) watcher.currentServe = undefined;
    this.pumpServe(campaignId);
  }
}
