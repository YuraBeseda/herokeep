import { computed, inject, Injectable, InjectionToken, signal, type Signal } from '@angular/core';
import {
  parseEvent,
  WS_MESSAGE_BYTES_MAX,
  type ClientMessage,
  type Event,
  type MembershipRole,
  type RejectCode,
} from '@hk/protocol';
import { uuidv7 } from '../helpers/uuid';
import { apiJson } from '../services/api/api-fetch';
import { AuthService } from '../services/auth/auth.service';
import { projectCampaign, type CampaignState } from '../services/campaigns/campaign-projection';
import { CampaignsRepository } from '../services/storage/campaigns.repository';
import type { CampaignRow } from '../services/storage/dexie.db';
import { EventsRepository } from '../services/storage/events.repository';
import { LeaderService } from '../services/storage/leader.service';
import { SettingsRepository } from '../services/storage/settings.repository';
import { type DraftEvent, SyncGapError } from './character.store';
import { PackStore } from './pack.store';

/**
 * Thrown by every `CampaignStore` method that appends/mutates (`create`/`join`/`appendTx`/
 * `gatewayAppend`, plus the `StreamSyncSessionStorePort` methods) when this tab is not the elected
 * writer (`LeaderService.isLeader`) — the SAME `LeaderService`/posture `CharacterStore` uses
 * (its own class doc, R-pf1): one app-wide writer election, shared across every stream kind. This
 * is DISTINCT from `StreamSyncSession`'s own per-stream `hk:sync:<streamId>` Web Lock (which only
 * prevents two overlapping live sockets for the SAME stream) — that lock is entirely
 * `StreamSyncSession`'s concern (T1) and this store never touches it directly. `code` is the i18n
 * key a later UI task toasts (mirrors `CharacterStoreNotLeaderError`'s own convention — see that
 * class's doc for why the translation JSON entry itself is added by a later task, not this one).
 */
export class CampaignStoreNotLeaderError extends Error {
  readonly code = 'campaigns.not-leader';

  constructor() {
    super('This tab is not the active campaign-data writer; another tab holds the lock.');
    this.name = 'CampaignStoreNotLeaderError';
  }
}

/**
 * Thrown when a method that must stamp a real authenticated actor (`appendTx`/`gatewayAppend`, or
 * `create`/`join`'s own fast-fail before ever hitting the network) is called with no signed-in
 * user (`AuthService.user()` is `null`). Campaigns are ALWAYS synced (doc-03; no offline-first
 * campaign authoring in v1 — unlike `CharacterStore`, which stamps a `'local'` placeholder actor
 * for solo/offline streams and only ever meets a real userId at upload time), so there is no
 * offline fallback to fall back to here: every campaign event's `actor.userId` must be the real
 * signed-in user from the moment it is built.
 */
export class CampaignStoreNotAuthenticatedError extends Error {
  readonly code = 'campaigns.not-authenticated';

  constructor() {
    super('CampaignStore: no authenticated user — campaign streams require a signed-in session.');
    this.name = 'CampaignStoreNotAuthenticatedError';
  }
}

/**
 * Thrown by `gatewayAppend` when no live campaign session is attached via `setGateway` (never
 * connected yet, or torn down mid-flight — see `setGateway`'s own doc for the latter case, which
 * additionally rejects every ALREADY-in-flight `gatewayAppend` call with this same error). There is
 * no local queue to fall back to (see class doc's "Campaign-targeted gateway forwarding" section) —
 * the caller is expected to retry once `SyncService` (T5) reports the campaign session as open
 * again.
 */
export class CampaignGatewayUnavailableError extends Error {
  readonly code = 'campaigns.gateway-unavailable';

  constructor() {
    super(
      'CampaignStore.gatewayAppend: no live campaign session is attached to forward this append.',
    );
    this.name = 'CampaignGatewayUnavailableError';
  }
}

/** The narrow slice of `StreamSyncSession` (T1) `gatewayAppend` actually calls: writes `msg`
 * straight to the campaign socket's open connection, bypassing `StreamSyncSession`'s own
 * append/pending pipeline entirely — the EXACT public `sendRaw(msg: ClientMessage)` method T1
 * shipped on that class (`stream-sync-session.ts`'s "Campaign-capable plumbing" doc section). A
 * real `StreamSyncSession` instance satisfies this structurally — `SyncService` (T5) passes it to
 * `setGateway` directly, with no adapter code needed. Kept as a narrow interface (not a direct
 * `StreamSyncSession` import) so this store never depends on `services/sync/` — see class doc. */
export interface CampaignGatewayPort {
  sendRaw(msg: ClientMessage): void;
}

/**
 * `gatewayAppend`'s resolved result: which of the forwarded character-stream events the server
 * acked (with their assigned seq) vs rejected, mirroring one `append` batch's possible SPLIT
 * outcome (doc-03: an `ack`/`reject` frame can each cover only part of a batch). `rejected` entries
 * carry real `code`/`message` when `SyncService` (T5) wires `StreamSyncSession`'s `onRejectEntries`
 * hook (fix round 1, F2 — `handleGatewayRejectEntries`) through to this store; `{id}` ONLY
 * (`code`/`message` `undefined`) if that hook is never wired and a reject is only ever seen via the
 * older `dropPending`-routed fallback — see class doc's "Campaign-targeted gateway forwarding"
 * section for exactly why THAT path loses the detail (the generic per-code toast already fires for
 * the user before `StreamSyncSession.handleReject` discards it, ahead of calling `dropPending`).
 */
export interface AckOrReject {
  readonly acked: { id: string; seq: number }[];
  readonly rejected: { id: string; code?: RejectCode; message?: string }[];
}

/** One in-flight `gatewayAppend()` call's bookkeeping — `remaining` starts as every sent event's
 * id and shrinks as `commitPending`/`dropPending` (or the fix-round-1 `handleGatewayAckEntries`/
 * `handleGatewayRejectEntries` fast path — F2) route matching results here (set-equality
 * completion, mirroring `StreamSyncSession`'s own `resumeState.expected`/`acked` pattern — T11b).
 * `settled` (fix round 1, F1a/F4/F1b) guards `resolve`/`reject` against being called twice — once
 * true, any id still pointing at this batch in `gatewayWaiters` is a "swallow harmlessly, do not
 * touch storage" marker rather than a live waiter (see `resolveGatewayAcks`/`resolveGatewayRejects`
 * and `sendGatewayBatch`'s own docs for why some ids deliberately outlive a settled batch). */
interface GatewayBatch {
  readonly remaining: Set<string>;
  readonly acked: { id: string; seq: number }[];
  readonly rejected: { id: string; code?: RejectCode; message?: string }[];
  readonly resolve: (result: AckOrReject) => void;
  readonly reject: (err: Error) => void;
  settled: boolean;
  timeoutHandle: ReturnType<typeof setTimeout> | undefined;
}

/** How long `gatewayAppend` waits for every sent event's ack/reject before giving up (fix round 1,
 * F1b) — `StreamSyncSession`'s reconnect loop (`handleClose`) never re-sends a gateway-forwarded
 * append on this store's behalf (`sendRaw` bypasses that pipeline entirely, per its own doc), so a
 * connection drop mid-flight would otherwise leave a batch's waiters registered forever with no way
 * to ever complete. Set to match `Backoff`'s own reconnect cap (`backoff.ts`: exponential up to a
 * hard 30s ceiling, doc-03's connection-lifecycle numbers) — a reconnect landing within one backoff
 * cycle still has a fair chance to legitimately answer before this fires; a genuinely stuck
 * connection gives up at a bounded, user-noticeable time instead of hanging indefinitely. */
const GATEWAY_ACK_TIMEOUT_MS = 30_000;

/** DI seam over `GATEWAY_ACK_TIMEOUT_MS` (fix round 1, F1b) — production code never overrides this
 * (the factory default IS the real 30s value); `campaign.store.spec.ts` overrides it to a small
 * real duration so the timeout test waits milliseconds, not 30 real seconds, and does so WITHOUT
 * `vi.useFakeTimers()` (which proved unreliable here — real fake-indexeddb completion depends on
 * genuine timer/microtask scheduling that faking broadly starves, hanging the whole test). */
export const CAMPAIGN_GATEWAY_ACK_TIMEOUT_MS = new InjectionToken<number>(
  'CAMPAIGN_GATEWAY_ACK_TIMEOUT_MS',
  { factory: () => GATEWAY_ACK_TIMEOUT_MS },
);

const GATEWAY_MAX_APPEND_EVENTS = 50;
// Same conservative fixed reserve `stream-sync-session.ts`'s own `chunkEventsForAppend` uses for
// the `{"t":"append","rid":"...","events":[...]}` envelope's own bytes.
const GATEWAY_FRAME_OVERHEAD_BYTES = 256;

function byteLength(s: string): number {
  return new TextEncoder().encode(s).length;
}

/**
 * Splits `events` into doc-03-compliant `append` frame batches (≤50 events AND ≤128 KB per frame)
 * for `gatewayAppend`'s raw sends. Deliberately a SEPARATE, duplicated copy of
 * `stream-sync-session.ts`'s own `chunkEventsForAppend` (same algorithm) rather than an import of
 * it — `apps/web`'s `stores/` never depends on `services/sync/` anywhere else in the codebase
 * (the dependency arrow runs the other way: `stream-sync-session.ts` imports `SyncGapError` FROM
 * `character.store.ts`), and this function is small/stable enough that duplicating it here is
 * cheaper than introducing a new cross-layer edge for one 20-line helper. Keep the two in sync if
 * doc-03's per-frame caps ever change.
 */
function chunkForGateway(events: readonly Event[]): Event[][] {
  const chunks: Event[][] = [];
  let current: Event[] = [];
  let currentBytes = GATEWAY_FRAME_OVERHEAD_BYTES;

  for (const event of events) {
    const eventBytes = byteLength(JSON.stringify(event)) + 1; // +1 for the array-join comma
    if (
      current.length > 0 &&
      (current.length >= GATEWAY_MAX_APPEND_EVENTS ||
        currentBytes + eventBytes > WS_MESSAGE_BYTES_MAX)
    ) {
      chunks.push(current);
      current = [];
      currentBytes = GATEWAY_FRAME_OVERHEAD_BYTES;
    }
    current.push(event);
    currentBytes += eventBytes;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

function toStreamId(campaignId: string): string {
  return `camp:${campaignId}`;
}

function toBareId(streamId: string): string {
  return streamId.startsWith('camp:') ? streamId.slice('camp:'.length) : streamId;
}

function toActorRole(role: MembershipRole | undefined): 'dm' | 'member' {
  return role === 'dm' ? 'dm' : 'member';
}

interface CampaignCreateResponse {
  readonly id: string;
  readonly name: string;
  readonly system: string;
  readonly role: MembershipRole;
  readonly joinCode?: string;
}

interface CampaignJoinResponse {
  readonly campaignId: string;
}

/**
 * The campaign-stream replica every campaign UI task (Task 6+) reads and writes through — the
 * campaign-side sibling of `CharacterStore`, modeled on it directly (task-4-brief.md's binding
 * instruction): it implements the SAME `StreamSyncSessionStorePort` shape
 * (`applyServerCommit`/`commitPending`/`dropPending`/`onLocalAppend`) so a `StreamSyncSession` (T1)
 * driving a `camp:<uuid>` stream can drive THIS store exactly the way it already drives
 * `CharacterStore` for a `char:<uuid>` one — same pending/committed seam semantics, same
 * `SyncGapError` class (imported, not redefined — `StreamSyncSession`'s `catch (err) { if (err
 * instanceof SyncGapError) ... }` checks are a CLASS-IDENTITY check, so reusing the exact export is
 * load-bearing, not cosmetic).
 *
 * ## Always-synced, no direct-commit lane
 *
 * Unlike `CharacterStore` (which supports a genuine logged-out/local-only mode, writing straight to
 * the committed lane), campaign streams are ALWAYS synced in v1 (task-4-brief.md, ruling 3: "no
 * offline-first campaign editing") — there is no `enterSyncMode`/`leaveSyncMode` flag here at all.
 * `appendTx` unconditionally writes PENDING rows; they simply queue (never flushed) while no
 * `StreamSyncSession` is driving this stream, exactly the "pending events queue while disconnected"
 * contract the brief states. `create`/`join` never author `campaign.created`/`member.joined`
 * client-side either — the server's REST routes (`apps/api/src/core/routes/campaigns.ts`) build and
 * commit those atomically server-side; this store only round-trips the DTO and then `open`s the
 * (initially still-empty-locally) stream, same as navigating to any other already-known campaign.
 * `state` therefore reads back mostly-blank (`campaign-projection.ts`'s `emptyState()`) immediately
 * after a fresh `create`/`join`, until a live session (T5) catches the stream up.
 *
 * ## No incremental projection
 *
 * `campaign-projection.ts`'s `projectCampaign` has no snapshot/incremental-fold counterpart to
 * `@hk/engine`'s `reduce` (Task 3's own design choice — see its report) — every storage write here
 * is followed by a FULL `EventsRepository.byStream` + `projectCampaign` re-fold (`refreshState`),
 * never an incremental update on top of the previous `state`. Acceptable for a campaign stream's
 * expected scale; a future task could teach the projector to fold incrementally if this ever
 * becomes a real cost.
 *
 * ## Campaign-targeted gateway forwarding (`gatewayAppend`)
 *
 * Doc-03's gateway lets a device with only a CAMPAIGN socket open append events onto a DIFFERENT,
 * `char:<uuid>` stream over that same connection (e.g. a DM editing an unclaimed pregen they don't
 * have a dedicated character session open for). `StreamSyncSession.sendRaw` (T1's public escape
 * hatch) is the transport; `setGateway`/`CampaignGatewayPort` is the seam THIS task defines so nothing
 * here depends on a concrete `StreamSyncSession` — `SyncService` (T5) attaches/detaches the real
 * session (which structurally satisfies `CampaignGatewayPort` already) once it constructs/tears down
 * this campaign's session.
 *
 * The resulting `ack`/`reject` frames arrive two ways, both handled:
 *
 * 1. (Fix round 1, F2 — controller ruling) `StreamSyncSession` now ALSO ships `onAckEntries`/
 *    `onRejectEntries` (optional, additive — see that class's own doc), firing with the frame's
 *    FULL, unstripped `results` before any other handling. `SyncService` (T5) wires these to
 *    `handleGatewayAckEntries`/`handleGatewayRejectEntries` below, which is how a gateway-forwarded
 *    REJECT recovers a real `code`/`message` (see `AckOrReject`'s own doc).
 * 2. Regardless of whether (1) is wired, the SAME results also arrive the way every OTHER ack/
 *    reject for this stream does: `StreamSyncSession` always calls `this.store.commitPending(
 *    streamId, results)` / `this.store.dropPending(streamId, ids)` unconditionally — doc-03's
 *    gateway multiplexes a forwarded append's own ack/reject onto that SAME frame. `commitPending`/
 *    `dropPending` below partition every incoming id FIRST by membership in `gatewayWaiters` (a
 *    table of this store's own outstanding `gatewayAppend` calls) — exactly mirroring
 *    `StreamSyncSession`'s own `resumeState`-based ack/reject partitioning (T11b round 2) — and
 *    route a match to the matching `gatewayAppend` batch instead of the campaign's own pending-row
 *    bookkeeping. Since (1) — when wired — already resolves/settles the batch and deletes its ids
 *    from `gatewayWaiters`, this second arrival typically finds nothing left to do (a harmless
 *    no-op); when (1) is NOT wired, this is the only path, and (for a reject) only ever supplies
 *    bare `{id}` (`StreamSyncSession.handleReject` strips `code`/`message` before calling
 *    `dropPending` — it already fired the generic per-code toast itself, first).
 *
 * A gateway-forwarded event's id NEVER appears among this stream's OWN Dexie rows
 * (`EventsRepository.byStream(streamId)`) — it is a `char:<id>` event, written (if anywhere) to
 * that OTHER stream's own storage by a LATER task, never here — so this partition can never
 * collide with a genuine campaign-own id.
 *
 * Three more robustness properties added in fix round 1 (controller review findings F1a/F1b/F4):
 * `gatewayAppend` registers its batch in `gatewayWaiters` SYNCHRONOUSLY, before its own first
 * `await` (F1a) — a `setGateway` call landing during that await (detach OR swap to a different
 * session) is caught by re-checking `this.gatewayPort === port` once the await resolves, instead of
 * silently sending through a stale port and leaking a waiter nothing will ever settle. A per-batch
 * `GATEWAY_ACK_TIMEOUT_MS` timer (F1b) fails the caller if no reconnect ever answers. A `sendRaw`
 * failure partway through a multi-chunk batch (F4) deregisters only the NEVER-sent ids; already-sent
 * ids stay registered against the now-settled batch so a later ack/reject for them is swallowed
 * harmlessly rather than mis-routed into the campaign's own pending-prefix walk. See
 * `sendGatewayBatch`'s own doc for the exact mechanics.
 */
@Injectable({ providedIn: 'root' })
export class CampaignStore {
  private readonly eventsRepository = inject(EventsRepository);
  private readonly campaignsRepository = inject(CampaignsRepository);
  private readonly settingsRepository = inject(SettingsRepository);
  private readonly leaderService = inject(LeaderService);
  private readonly authService = inject(AuthService);
  private readonly packStore = inject(PackStore);
  private readonly gatewayAckTimeoutMs = inject(CAMPAIGN_GATEWAY_ACK_TIMEOUT_MS);

  private readonly streamIdState = signal<string | undefined>(undefined);
  private readonly loadedState = signal(false);
  private readonly stateState = signal<CampaignState | null>(null);
  private readonly eventsState = signal<Event[]>([]);
  private readonly roleState = signal<MembershipRole | undefined>(undefined);

  private deviceIdPromise: Promise<string> | undefined;
  private gatewayPort: CampaignGatewayPort | undefined;
  // Keyed by the char-stream event id a still-outstanding gatewayAppend() call sent — see class
  // doc's "Campaign-targeted gateway forwarding" section.
  private readonly gatewayWaiters = new Map<string, GatewayBatch>();
  // Fix round 1 (a bug F2's own test caught): `StreamSyncSession` ALWAYS calls `commitPending`/
  // `dropPending` for a frame's full results, even when the fix-round-1 rich hooks
  // (`handleGatewayAckEntries`/`handleGatewayRejectEntries`) already resolved every gateway id in
  // it — that redundant second pass sees the SAME ids `gatewayWaiters` no longer has (the first
  // pass already deleted them once consumed), which would otherwise mis-bucket them as "own" and
  // throw `SyncGapError`. Every id ever routed through `resolveGatewayAcks`/`resolveGatewayRejects`
  // is added here and NEVER removed — `commitPending`/`dropPending`'s own partition checks this
  // SET too (not just `gatewayWaiters`), so a redundant same-frame delivery is always recognized as
  // "mine, already handled" regardless of whether the batch is still tracked. Unbounded growth is
  // an accepted v1 simplification: `gatewayAppend` is a low-frequency operation (doc-03's gateway
  // use case — e.g. a DM editing an unclaimed pregen), so even a whole long-lived browser tab
  // session's worth of ids here is a trivial amount of memory; a future task can add pruning if
  // that assumption ever stops holding.
  private readonly resolvedGatewayIds = new Set<string>();
  private readonly localAppendListeners = new Set<(streamId: string, events: Event[]) => void>();

  // Serializes every mutating call's actual read/write work — same rationale as
  // `CharacterStore.enqueue`'s own doc (two double-fired calls must never interleave their
  // `nextPendingOrder` reads and storage writes).
  private queue: Promise<void> = Promise.resolve();

  readonly streamId: Signal<string | undefined> = this.streamIdState.asReadonly();
  readonly campaignId: Signal<string | undefined> = computed(() => {
    const streamId = this.streamIdState();
    return streamId ? toBareId(streamId) : undefined;
  });
  readonly loaded: Signal<boolean> = this.loadedState.asReadonly();
  readonly state: Signal<CampaignState | null> = this.stateState.asReadonly();
  readonly events: Signal<Event[]> = this.eventsState.asReadonly();
  /** This device's role (`'dm'|'player'`) in the currently loaded campaign, `undefined` before any
   * campaign has been opened. Seeded from `create`/`join`'s own DTO response, or from the cached
   * `CampaignsRepository` row on a plain `open()` of an already-known campaign — see class doc's
   * `upsertCampaignRow` note for the one defensive fallback case. */
  readonly role: Signal<MembershipRole | undefined> = this.roleState.asReadonly();

  constructor() {
    // Fire-and-forget, same posture as `CharacterStore`'s constructor — `LeaderService.acquire()`
    // is documented safe to call more than once (later calls return the same in-flight/settled
    // acquisition), so this is harmless regardless of which store's constructor runs first.
    void this.leaderService.acquire();
  }

  // --- opening a campaign ----------------------------------------------------------------------

  /** Points this store at `streamId` (a full `camp:<uuid>` stream id), loading whatever this device
   * already has locally (`EventsRepository.byStream` — empty for a brand-new campaign until a live
   * session catches it up) and projecting it via `projectCampaign`. Read-only — safe to call on a
   * non-leader tab (mirrors `CharacterStore.load`'s own posture). */
  async open(streamId: string): Promise<void> {
    return this.enqueue(() => this.openNow(streamId));
  }

  private async openNow(streamId: string): Promise<void> {
    const [events, row] = await Promise.all([
      this.eventsRepository.byStream(streamId),
      this.campaignsRepository.get(toBareId(streamId)),
    ]);
    const state = projectCampaign(events);

    this.streamIdState.set(streamId);
    this.eventsState.set(events);
    this.stateState.set(state);
    this.roleState.set(row?.role);
    this.loadedState.set(true);

    await this.upsertCampaignRow(streamId, events, state);
  }

  /** Creates a brand-new campaign: generates a client `uuidv7` id (or uses `opts.id`, for tests/
   * deterministic callers), POSTs it to the server (`campaigns.ts`'s `POST /`, which atomically
   * commits `campaign.created` + this device's own bootstrap `member.joined` server-side — see
   * class doc's "Always-synced" section for why this store never builds those events itself), caches
   * the returned DTO as this campaign's `CampaignsRepository` row, and `open`s the (still locally
   * empty) stream. Returns the full `camp:<uuid>` stream id, mirroring `CharacterStore.create`'s own
   * return shape. */
  async create(
    name: string,
    system: string,
    opts?: { id?: string; displayName?: string },
  ): Promise<string> {
    this.assertLeader();
    if (!this.packStore.ready()) throw new Error('CampaignStore.create: packs are not ready yet');
    const core = this.packStore.corePack();
    if (!core) throw new Error('CampaignStore.create: no core pack loaded');
    if (!this.authService.user()) throw new CampaignStoreNotAuthenticatedError();

    return this.enqueue(async () => {
      const id = opts?.id ?? uuidv7();
      const streamId = toStreamId(id);
      const body = {
        id,
        name,
        system,
        corePack: { id: core.id, version: core.version },
        ...(opts?.displayName !== undefined ? { displayName: opts.displayName } : {}),
      };
      const dto = await apiJson<CampaignCreateResponse>('/api/campaigns', {
        method: 'POST',
        body: JSON.stringify(body),
      });

      await this.campaignsRepository.put({
        id: dto.id,
        name: dto.name,
        system: dto.system,
        role: dto.role,
        joinCode: dto.joinCode,
        lastSeq: 0,
        updatedAt: Date.now(),
      });
      await this.openNow(streamId);
      return streamId;
    });
  }

  /** Joins an existing campaign by its (possibly dash-grouped) join code, POSTing to `campaigns.ts`'s
   * `POST /join` — idempotent server-side for an already-established membership (a rejoin just
   * returns the same `campaignId`, with no name/system/role in the response, since the server
   * already has that on file). Caches whatever this device already knows locally about the campaign
   * (a fresh join seeds a placeholder `role: 'player'` row; a rejoin preserves the existing cached
   * row's `name`/`system`/`role`/`joinCode` verbatim) and `open`s the stream. Returns the full
   * `camp:<uuid>` stream id. */
  async join(code: string, displayName?: string): Promise<string> {
    this.assertLeader();
    if (!this.authService.user()) throw new CampaignStoreNotAuthenticatedError();

    return this.enqueue(async () => {
      const body = { code, ...(displayName !== undefined ? { displayName } : {}) };
      const dto = await apiJson<CampaignJoinResponse>('/api/campaigns/join', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      const streamId = toStreamId(dto.campaignId);

      const existing = await this.campaignsRepository.get(dto.campaignId);
      await this.campaignsRepository.put({
        id: dto.campaignId,
        name: existing?.name ?? '',
        system: existing?.system ?? '',
        role: existing?.role ?? 'player',
        joinCode: existing?.joinCode,
        lastSeq: existing?.lastSeq ?? 0,
        updatedAt: Date.now(),
      });
      await this.openNow(streamId);
      return streamId;
    });
  }

  // --- appending campaign events -----------------------------------------------------------------

  /** Envelopes and appends `drafts` against the currently open campaign stream, sharing one `txId`
   * when there is more than one — ALWAYS as PENDING rows (see class doc's "Always-synced" section;
   * there is no direct-commit lane here). `event.reverted` drafts are refused outright: campaign
   * streams never carry that type (`@hk/protocol`'s `EVENT_STREAM_KIND` marks it `char`-only; Task
   * 3's projector never handles it either) — there is no `revert()` method on this store. */
  async appendTx(drafts: DraftEvent[]): Promise<void> {
    this.assertLeader();
    if (drafts.length === 0) return;
    if (drafts.some((d) => d.type === 'event.reverted')) {
      throw new Error(
        'CampaignStore.appendTx: campaign streams do not support "event.reverted" — there is no revert() for campaigns',
      );
    }

    return this.enqueue(async () => {
      const streamId = this.requireStream('appendTx');
      const txId = drafts.length > 1 ? uuidv7() : undefined;
      const actor = await this.actor();

      const startOrder = await this.eventsRepository.nextPendingOrder(streamId);
      const events: Event[] = drafts.map((draft) =>
        this.validate(
          this.envelope(streamId, actor, draft.type, draft.v, draft.payload, { txId }),
          draft.type,
          draft.v,
        ),
      );

      await this.eventsRepository.appendPending(events, startOrder);
      await this.refreshState(streamId);
      this.notifyLocalAppend(streamId, events);
    });
  }

  /** [plan-10 Task 8] Appends `drafts` onto `streamId` WITHOUT touching whichever campaign (if any)
   * is currently OPEN for viewing (`this.streamId()`/`this.state()`/`this.role()`) — unlike
   * `appendTx`, which always targets `this.streamIdState()` and would silently reroute a DIFFERENT
   * campaign's live "open" signals out from under whatever UI is currently reading them. The
   * party-overview publisher (ruling 8: "after each committed local append on a campaign-linked
   * character... the owning device appends `party.overview_updated`") needs to write onto THAT
   * character's own campaign stream regardless of which campaign page (if any) happens to be open
   * in this tab right now — a background action, not a UI-driven one.
   *
   * Same leader/auth preconditions, PENDING-only write discipline ("Always-synced" class doc
   * section), and `event.reverted` refusal as `appendTx`. Refreshes `streamId`'s
   * `CampaignsRepository` index row and — only if `streamId` happens to already be the currently
   * open one — this store's live `events`/`state` signals (`refreshState`'s own
   * one-stream-at-a-time discipline, reused verbatim). The actor's `role` is read from the cached
   * `CampaignsRepository` row for `streamId` (falling back to `undefined` -> `'member'` via
   * `toActorRole`, the SAME default `upsertCampaignRow` documents for an uncached stream) rather
   * than `roleState()`, which only ever reflects the OPEN stream. */
  async appendToStream(streamId: string, drafts: DraftEvent[]): Promise<void> {
    this.assertLeader();
    if (drafts.length === 0) return;
    if (drafts.some((d) => d.type === 'event.reverted')) {
      throw new Error(
        'CampaignStore.appendToStream: campaign streams do not support "event.reverted" — there is no revert() for campaigns',
      );
    }
    if (!this.authService.user()) throw new CampaignStoreNotAuthenticatedError();

    return this.enqueue(async () => {
      const txId = drafts.length > 1 ? uuidv7() : undefined;
      const row = await this.campaignsRepository.get(toBareId(streamId));
      const actor = await this.actor(row?.role);

      const startOrder = await this.eventsRepository.nextPendingOrder(streamId);
      const events: Event[] = drafts.map((draft) =>
        this.validate(
          this.envelope(streamId, actor, draft.type, draft.v, draft.payload, { txId }),
          draft.type,
          draft.v,
        ),
      );

      await this.eventsRepository.appendPending(events, startOrder);
      await this.refreshState(streamId);
      this.notifyLocalAppend(streamId, events);
    });
  }

  /** Forwards `drafts` as events on `char:<characterId>` over this campaign's live socket (doc-03's
   * gateway) instead of the currently OPEN campaign stream — see class doc's "Campaign-targeted
   * gateway forwarding" section for the full ack/reject routing design. Requires a `setGateway`d
   * live session; throws `CampaignGatewayUnavailableError` immediately (no queueing) when none is
   * attached. Resolves once EVERY sent event has been either acked or rejected (set-equality
   * completion), rejects if the gateway disconnects mid-flight — including a swap to a DIFFERENT
   * session while this call's own `actor()` lookup was still resolving (fix round 1, F1a) — rejects
   * (settling the whole batch, per `sendGatewayBatch`'s own doc for what happens to already-sent
   * ids) if a chunk fails to send partway through a multi-chunk batch (fix round 1, F4), and rejects
   * if no ack/reject for every sent id arrives within `GATEWAY_ACK_TIMEOUT_MS` (fix round 1, F1b). */
  async gatewayAppend(characterId: string, drafts: DraftEvent[]): Promise<AckOrReject> {
    this.assertLeader();
    if (drafts.length === 0) return { acked: [], rejected: [] };
    const port = this.gatewayPort;
    if (!port) throw new CampaignGatewayUnavailableError();

    const targetStream = `char:${characterId}`;
    const txId = drafts.length > 1 ? uuidv7() : undefined;
    // Fix round 1, F1a: every event's id is generated SYNCHRONOUSLY, before this method's first
    // `await` — so the batch below can be registered in `gatewayWaiters` before control is ever
    // yielded back to the event loop. `envelope()`'s `opts.id` (in `sendGatewayBatch`, once
    // `actor()` resolves) reuses these SAME ids.
    const ids = drafts.map(() => uuidv7());

    return new Promise<AckOrReject>((resolve, reject) => {
      const batch: GatewayBatch = {
        remaining: new Set(ids),
        acked: [],
        rejected: [],
        resolve,
        reject,
        settled: false,
        timeoutHandle: undefined,
      };
      for (const id of ids) this.gatewayWaiters.set(id, batch);

      void this.sendGatewayBatch(port, batch, ids, targetStream, txId, drafts);
    });
  }

  /** The post-registration continuation of `gatewayAppend` — factored out so the Promise executor
   * there can register `batch` in `gatewayWaiters` SYNCHRONOUSLY (see that method's own doc)
   * before this method's own first `await this.actor()`.
   *
   * Fix round 1, F1a: re-checks `this.gatewayPort === port` immediately after that await resolves
   * — a `setGateway` call landing DURING the await (a detach, or a swap to a different session) is
   * otherwise invisible here, since `port` was captured by value before the await ever ran, and
   * `failAllGatewayWaiters` (run synchronously by that `setGateway(undefined)` call) could only
   * fail waiters registered BEFORE it ran — this batch's own registration (above, in
   * `gatewayAppend`) already beat that race, so without this re-check the code below would
   * proceed to `sendRaw` through a port that is no longer live, and the promise would never
   * settle.
   *
   * Fix round 1, F4: a `sendRaw` failure partway through a multi-chunk batch deregisters only the
   * ids that were NEVER sent (nothing will ever answer for them — safe to drop outright). Ids from
   * chunks ALREADY sent before the failing one stay registered, still pointing at this batch —
   * which this call settles (rejects) right here — so a LATER ack/reject for one of those
   * already-sent ids is swallowed harmlessly by `resolveGatewayAcks`/`resolveGatewayRejects`'s own
   * `batch.settled` check instead of falling through to the campaign's own pending-prefix walk
   * (where an unrecognized id would mis-fire `SyncGapError`). */
  private async sendGatewayBatch(
    port: CampaignGatewayPort,
    batch: GatewayBatch,
    ids: readonly string[],
    targetStream: string,
    txId: string | undefined,
    drafts: readonly DraftEvent[],
  ): Promise<void> {
    let actor: Event['actor'];
    try {
      actor = await this.actor();
    } catch (err) {
      this.deregisterGatewayIds(ids);
      this.settleGatewayReject(
        batch,
        err instanceof Error
          ? err
          : new Error('CampaignStore.gatewayAppend: actor resolution failed'),
      );
      return;
    }

    if (this.gatewayPort !== port) {
      this.deregisterGatewayIds(ids);
      this.settleGatewayReject(batch, new CampaignGatewayUnavailableError());
      return;
    }

    const events: Event[] = drafts.map((draft, i) =>
      this.validate(
        this.envelope(targetStream, actor, draft.type, draft.v, draft.payload, {
          txId,
          id: ids[i],
        }),
        draft.type,
        draft.v,
      ),
    );

    const sentIds = new Set<string>();
    try {
      for (const chunk of chunkForGateway(events)) {
        port.sendRaw({ t: 'append', rid: uuidv7(), events: chunk });
        for (const e of chunk) sentIds.add(e.id);
      }
    } catch (err) {
      for (const id of ids) {
        if (!sentIds.has(id)) this.gatewayWaiters.delete(id);
      }
      this.settleGatewayReject(
        batch,
        err instanceof Error ? err : new Error('CampaignStore.gatewayAppend: send failed'),
      );
      return;
    }

    // Fix round 1, F1b: armed only once every event has actually gone out.
    this.armGatewayTimeout(batch, ids);
  }

  /** Attaches (or, with `undefined`, detaches) the live campaign session `gatewayAppend` forwards
   * through — `SyncService` (T5) calls this with the real `StreamSyncSession` it constructs for this
   * campaign, and again with `undefined` when tearing it down. Detaching REJECTS every currently
   * in-flight `gatewayAppend` call with `CampaignGatewayUnavailableError` (there is nothing to wait
   * for any more — the socket that would have delivered their ack/reject is gone); a caller that
   * still needs the append retries once a new session attaches. */
  setGateway(port: CampaignGatewayPort | undefined): void {
    this.gatewayPort = port;
    if (port === undefined) this.failAllGatewayWaiters();
  }

  // --- StreamSyncSessionStorePort (mirrors CharacterStore's implementation of the same shape) ----

  /** Mirrors `CharacterStore.applyServerCommit`'s algorithm (new content lands at its given seq, a
   * pending echo of this device's own event TRANSITIONS in place, an already-committed echo is
   * tolerated only if it agrees with the local seq) with ONE deliberate divergence a character
   * stream never needs: FORWARD seq jumps are tolerated, not just an exact `expected` match.
   *
   * ## Why a campaign stream can't use `CharacterStore`'s strict `e.seq === expected` check
   *
   * Doc-08's read-visibility filtering (`campaign-actor.ts`'s `isVisibleTo`/`filterForConnection`)
   * applies to BOTH live fan-out AND `hello`'s catch-up paging — a `'dm'`-visibility roll never
   * reaches a non-DM, non-roller connection's socket at ALL, and a `'private'` one never reaches
   * anyone but its own actor, not even the DM. The server's real seq space still advances for
   * those events (they occupy real seq numbers in `headSeq`), so a viewer this filtering excludes
   * will legitimately see its NEXT visible event arrive several seqs ahead of its own local head —
   * a real, permanent, per-viewer hole, not a transport loss. WebSocket-over-TCP already guarantees
   * ordered, reliable delivery within one open connection, so a genuinely MISSED live frame (the
   * kind `SyncGapError` -> `sendHello()` recovery exists for) can only ever happen across a
   * reconnect — and a reconnect's own `hello` catch-up re-derives the SAME filtered view, which
   * means it can NEVER close a hole created by filtering. Treating every forward jump as a fatal
   * gap needing a `sendHello()` retry — this store's original behavior, copied verbatim from
   * `CharacterStore` — therefore spun forever the first time a 3-connection campaign (this repo's
   * own task-16 e2e caught it) had a mixed-visibility event: the excluded viewer's session
   * `sendHello()`-looped indefinitely, never able to resync (found and fixed here; see
   * `campaign.store.spec.ts`'s own regression test for the exact reproduction).
   *
   * A BACKWARD move (`e.seq` at or before the frontier this device has already advanced past, for
   * an id it has never seen before) is still a genuine `SyncGapError` — seqs are unique and
   * monotonic per stream, so a brand-new id claiming an already-passed seq slot can only mean real
   * corruption/divergence, never legitimate filtering. An already-committed row's seq disagreeing
   * with what the server just sent is, likewise, still always a hard error.
   *
   * `StreamSyncSession.handleEvents` only ever calls this for events addressed to THIS session's
   * own stream (a gateway-forwarded event for a DIFFERENT stream goes through `onForeignEvents`
   * instead, entirely bypassing this store) — so no gateway-partitioning is needed here, only in
   * `commitPending`/`dropPending` below. */
  async applyServerCommit(streamId: string, events: Event[]): Promise<void> {
    this.assertLeader();
    return this.runExclusive(async () => {
      if (events.length === 0) return;

      const rows = await this.eventsRepository.byStream(streamId);
      const byId = new Map(rows.map((e) => [e.id, e]));
      const head = rows.reduce((max, e) => (e.seq !== undefined ? Math.max(max, e.seq) : max), 0);

      const sorted = [...events].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
      const toInsert: Event[] = [];
      const toTransition: Event[] = [];
      let frontier = head;

      for (const e of sorted) {
        const existingRow = byId.get(e.id);

        if (existingRow === undefined) {
          if (e.seq === undefined || e.seq <= frontier) {
            throw new SyncGapError(streamId, frontier + 1, e.seq);
          }
          toInsert.push(e);
          frontier = e.seq;
          continue;
        }

        if (existingRow.seq === undefined) {
          if (e.seq === undefined || e.seq <= frontier) {
            throw new SyncGapError(streamId, frontier + 1, e.seq);
          }
          toTransition.push(e);
          frontier = e.seq;
          continue;
        }

        if (existingRow.seq !== e.seq) throw new SyncGapError(streamId, existingRow.seq, e.seq);
      }

      if (toInsert.length === 0 && toTransition.length === 0) return;

      if (toInsert.length > 0) await this.eventsRepository.appendCommittedAt(toInsert);
      for (const e of toTransition) {
        // `e.seq` is guaranteed defined — every `toTransition` entry passed the `e.seq <= frontier`
        // (a `number`) check above without throwing.
        await this.eventsRepository.assignSeqs(streamId, e.id, e.seq!, 1);
      }

      await this.refreshState(streamId);
    });
  }

  /** Mirrors `CharacterStore.commitPending`'s algorithm (a partial-prefix ack is the normal case,
   * not an edge case; an idempotent replay of an id `applyServerCommit` already transitioned is
   * tolerated iff it agrees with the now-committed seq), PLUS the gateway partition described in
   * class doc: any `ackResults` entry whose id belongs to an outstanding `gatewayAppend()` call is
   * routed there FIRST and never reaches the campaign's own pending-prefix walk (so it can never
   * falsely `SyncGapError` against ids this stream never wrote).
   *
   * Like `applyServerCommit` above, this tolerates FORWARD seq jumps rather than requiring an
   * exact `expectedSeq` match — see that method's own doc for the full "why" (doc-08 per-viewer
   * filtering: between two of THIS device's own pending sends, a DIFFERENT actor's `'private'`-
   * visibility event — invisible to this device even if it's the DM — can legitimately land at an
   * intervening seq). The FIFO ordering check (`nextPending?.id !== ack.id` — this device's own
   * acks must still name its own pending rows in the exact order they were sent) is untouched; only
   * the numeric seq comparison is relaxed, and each row is assigned ITS OWN acked seq individually
   * (`assignSeqs(..., count: 1)`) rather than one batched contiguous-range call — a range can no
   * longer be assumed once gaps are tolerated. */
  async commitPending(streamId: string, ackResults: { id: string; seq: number }[]): Promise<void> {
    this.assertLeader();
    return this.runExclusive(async () => {
      if (ackResults.length === 0) return;

      const gatewayResults = ackResults.filter((r) => this.isGatewayId(r.id));
      const ownResults = ackResults.filter((r) => !this.isGatewayId(r.id));
      if (gatewayResults.length > 0) this.resolveGatewayAcks(gatewayResults);
      if (ownResults.length === 0) return;

      const rows = await this.eventsRepository.byStream(streamId);
      const byId = new Map(rows.map((e) => [e.id, e]));
      const pending = rows.filter((e) => e.seq === undefined);
      const head = rows.reduce((max, e) => (e.seq !== undefined ? Math.max(max, e.seq) : max), 0);

      let pendingIndex = 0;
      let frontier = head;
      const toAssign: { id: string; seq: number }[] = [];

      for (const ack of ownResults) {
        const existingRow = byId.get(ack.id);

        if (existingRow?.seq !== undefined) {
          if (existingRow.seq !== ack.seq)
            throw new SyncGapError(streamId, existingRow.seq, ack.seq);
          continue;
        }

        const nextPending = pending[pendingIndex];
        if (nextPending?.id !== ack.id) throw new SyncGapError(streamId, frontier + 1, ack.seq);
        if (ack.seq <= frontier) throw new SyncGapError(streamId, frontier + 1, ack.seq);

        toAssign.push(ack);
        pendingIndex++;
        frontier = ack.seq;
      }

      if (toAssign.length === 0) return;

      for (const ack of toAssign) {
        await this.eventsRepository.assignSeqs(streamId, ack.id, ack.seq, 1);
      }
      await this.refreshState(streamId);
    });
  }

  /** Same contract as `CharacterStore.dropPending` (deletes exactly the named STILL-pending rows,
   * then fully re-folds), PLUS the same gateway partition `commitPending` uses: an id belonging to
   * an outstanding `gatewayAppend()` call is routed there instead of `EventsRepository.removePending`
   * — see class doc for why that arm's `code`/`message` are unavailable via this bare-`ids`
   * signature (the caller of `handleReject`, `StreamSyncSession`, already discarded them before
   * calling here). */
  async dropPending(streamId: string, ids: string[]): Promise<void> {
    this.assertLeader();
    return this.runExclusive(async () => {
      if (ids.length === 0) return;

      const gatewayIds = ids.filter((id) => this.isGatewayId(id));
      const ownIds = ids.filter((id) => !this.isGatewayId(id));
      if (gatewayIds.length > 0) {
        // Bare ids only (this call's own signature) — `code`/`message`, when available, arrive
        // separately via `handleGatewayRejectEntries` (fix round 1, F2), which always runs FIRST
        // (`StreamSyncSession.onRejectEntries` fires before `dropPending` is ever called for the
        // same frame) and already deletes/settles anything it resolved — so this is a no-op for
        // any id that path already handled, and a degraded `{id}`-only fallback for any id it
        // didn't (e.g. `onRejectEntries` never wired).
        this.resolveGatewayRejects(gatewayIds.map((id) => ({ id })));
      }
      if (ownIds.length === 0) return;

      await this.eventsRepository.removePending(streamId, ownIds);
      await this.refreshState(streamId);
    });
  }

  /** `SyncService` (T5) subscribes here to ship every pending batch `appendTx` produces — same
   * ordering contract as `CharacterStore.onLocalAppend` (fires once, AFTER the write has durably
   * committed and this store's own signals are updated). Returns an unsubscribe function. */
  onLocalAppend(cb: (streamId: string, events: Event[]) => void): () => void {
    this.localAppendListeners.add(cb);
    return () => this.localAppendListeners.delete(cb);
  }

  /** [Fix round 1, F2 — controller ruling] `SyncService` (T5) wires this to the campaign's live
   * `StreamSyncSession`'s `onAckEntries` hook — fires with an `ack` frame's FULL, unstripped
   * `{id,seq}[]`, before `commitPending` is even called for the same frame. Functionally
   * equivalent to what `commitPending`'s own gateway partition already resolves for a gateway id
   * (an ack loses nothing either way going through `dropPending`/`commitPending`) — wired for
   * symmetry with `handleGatewayRejectEntries` so a future session change can't silently stop
   * gateway acks from resolving via this faster path. Ids not belonging to an outstanding
   * `gatewayAppend()` call are ignored. */
  handleGatewayAckEntries(results: readonly { id: string; seq: number }[]): void {
    const mine = results.filter((r) => this.gatewayWaiters.has(r.id));
    if (mine.length > 0) this.resolveGatewayAcks(mine);
  }

  /** [Fix round 1, F2 — controller ruling] `SyncService` (T5) wires this to the campaign's live
   * `StreamSyncSession`'s `onRejectEntries` hook — fires with a `reject` frame's FULL, unstripped
   * `{id,code,message}[]`, BEFORE `StreamSyncSession.handleReject` strips it down to bare `ids` for
   * its own later `dropPending` call. This is what lets `AckOrReject.rejected` carry REAL
   * `code`/`message` for a gateway-forwarded reject — see `AckOrReject`'s own doc. `dropPending`'s
   * own later call for the SAME ids becomes a harmless no-op (the id is already gone from
   * `gatewayWaiters` by the time it runs). Ids not belonging to an outstanding `gatewayAppend()`
   * call are ignored. */
  handleGatewayRejectEntries(
    results: readonly { id: string; code: RejectCode; message: string }[],
  ): void {
    const mine = results.filter((r) => this.gatewayWaiters.has(r.id));
    if (mine.length > 0) this.resolveGatewayRejects(mine);
  }

  // --- internals -----------------------------------------------------------------------------

  /** Serializes every mutating method's actual work through one promise chain — identical rationale
   * to `CharacterStore.enqueue`'s own doc. */
  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const settled = this.queue.then(operation, operation);
    this.queue = settled.then(
      () => undefined,
      () => undefined,
    );
    return settled;
  }

  /** For a caller already running inside `enqueue`d work (`applyServerCommit`/`commitPending`/
   * `dropPending`, each driven by a live session, never by direct UI action) — same shape as
   * `CharacterStore.runExclusive`. */
  private async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    return this.enqueue(fn);
  }

  private assertLeader(): void {
    if (!this.leaderService.isLeader()) throw new CampaignStoreNotLeaderError();
  }

  private requireStream(context: string): string {
    const streamId = this.streamIdState();
    if (!streamId) throw new Error(`CampaignStore.${context}: no campaign loaded`);
    return streamId;
  }

  private async deviceId(): Promise<string> {
    this.deviceIdPromise ??= this.settingsRepository.deviceId();
    return this.deviceIdPromise;
  }

  /** The real signed-in user's id (never a `'local'` placeholder — see
   * `CampaignStoreNotAuthenticatedError`'s own doc for why campaigns have no offline fallback),
   * stamped with this device's stable id and a membership role (`'dm'|'player'` mapped to the
   * envelope's `'dm'|'member'` — `character.ts`'s `ActorRoleSchema` has no `'player'` value).
   * Defaults to the CURRENTLY OPEN campaign's own role (`roleState()`) when `roleOverride` is
   * omitted — every pre-existing caller (`appendTx`, `sendGatewayBatch`) keeps this exact
   * behavior. `appendToStream` (plan-10 Task 8) passes the TARGET stream's own cached role
   * instead, since that stream is not necessarily the one `roleState()` reflects. Client-side role
   * tagging here is advisory only — doc-08: "the client renders, never re-enforces" the
   * authorization matrix; the server's own membership row is the real gate for whether this actor
   * may author a given type. */
  private async actor(roleOverride?: MembershipRole): Promise<Event['actor']> {
    const user = this.authService.user();
    if (!user) throw new CampaignStoreNotAuthenticatedError();
    return {
      userId: user.userId,
      deviceId: await this.deviceId(),
      role: toActorRole(roleOverride ?? this.roleState()),
    };
  }

  private timestamp(): string {
    return new Date().toISOString();
  }

  /** `opts.id`, when given, is used verbatim instead of minting a fresh `uuidv7()` — `gatewayAppend`
   * (fix round 1, F1a) pre-generates its ids BEFORE its own first `await` so the batch can be
   * registered in `gatewayWaiters` synchronously, then passes those SAME ids through here once
   * `actor()` resolves, so the envelope actually sent matches what was registered. */
  private envelope(
    stream: string,
    actor: Event['actor'],
    type: string,
    v: number,
    payload: unknown,
    opts: { txId?: string; id?: string } = {},
  ): unknown {
    return {
      id: opts.id ?? uuidv7(),
      stream,
      ts: this.timestamp(),
      actor,
      type,
      v,
      ...(opts.txId !== undefined ? { txId: opts.txId } : {}),
      payload,
    };
  }

  private validate(raw: unknown, type: string, v: number): Event {
    const parsed = parseEvent(raw);
    if (!parsed.ok) {
      const issues = parsed.issues.map((i) => `${i.path}: ${i.message}`).join('; ');
      throw new Error(`CampaignStore: invalid "${type}@${v}" event — ${issues}`);
    }
    return parsed.event;
  }

  /** Re-reads `streamId`'s full event log, re-projects it (no incremental fold — see class doc), and
   * ALWAYS refreshes its `CampaignsRepository` index row; only touches this store's LIVE signals
   * (`events`/`state`) when `streamId` is the currently loaded one — same one-stream-at-a-time
   * discipline `CharacterStore.refreshFromStorage` keeps. */
  private async refreshState(streamId: string): Promise<void> {
    const events = await this.eventsRepository.byStream(streamId);
    const state = projectCampaign(events);
    await this.upsertCampaignRow(streamId, events, state);

    if (this.streamIdState() !== streamId) return;
    this.eventsState.set(events);
    this.stateState.set(state);
  }

  /** Keeps the `CampaignsRepository` list-index row current. `name`/`system` fall back to whatever
   * is already cached when the freshly projected `state` is still blank (immediately after
   * `create`/`join`, before any events have synced down — `campaign-projection.ts`'s `emptyState()`
   * yields `''` for both) so a fresh create/join's real name never gets clobbered by a momentarily
   * empty projection. `role` is preserved from the existing cached row — it is NEVER re-derived from
   * `state` here (the event catalog has no "role changed" event type once `member.joined`
   * establishes it, so the row that `create`/`join` originally seeded is the only source of truth);
   * `'player'` is used only as a last-resort default for the — should be unreachable via this
   * store's own `create`/`join`/`open` — case where no row exists yet at all (e.g. a future restore
   * flow that seeds `EventsRepository` directly from a server list without ever calling `create`/
   * `join`; flagged for T5 in task-4-report.md). */
  private async upsertCampaignRow(
    streamId: string,
    events: Event[],
    state: CampaignState,
  ): Promise<void> {
    const id = toBareId(streamId);
    const existing = await this.campaignsRepository.get(id);
    const lastSeq = events.reduce(
      (max, e) => (e.seq !== undefined ? Math.max(max, e.seq) : max),
      0,
    );
    // `state.name`/`state.system` are never `undefined` (`projectCampaign`'s `emptyState()`
    // yields `''`), so a plain `??` fallback would never trigger while still blank — this needs an
    // explicit empty-string check, not nullish coalescing.
    const name = state.name !== '' ? state.name : (existing?.name ?? '');
    const system = state.system !== '' ? state.system : (existing?.system ?? '');
    const row: CampaignRow = {
      id,
      name,
      system,
      role: existing?.role ?? 'player',
      joinCode: state.joinCode ?? existing?.joinCode,
      lastSeq,
      updatedAt: Date.now(),
    };
    await this.campaignsRepository.put(row);
  }

  private notifyLocalAppend(streamId: string, events: Event[]): void {
    for (const cb of this.localAppendListeners) cb(streamId, events);
  }

  /** Arms `GATEWAY_ACK_TIMEOUT_MS` (fix round 1, F1b) once every event in `batch` has actually been
   * sent — a no-op if the batch has already settled by the time this runs (defensive; not
   * reachable in production, since nothing between the send loop and this call yields control).
   *
   * [final review wave, fold-in] The timeout handler also adds every `ids` entry to
   * `resolvedGatewayIds` — mirroring `resolveGatewayAcks`/`resolveGatewayRejects`'s own bookkeeping
   * — NOT just removing them from `gatewayWaiters`. Without this, a late ack/reject that still
   * arrives on a live socket AFTER this timeout already gave up (the request wasn't actually lost,
   * just slower than `gatewayAckTimeoutMs`) would find the id in neither set: `isGatewayId` would
   * return `false`, and `commitPending`/`dropPending` would misfile it into the campaign's OWN
   * pending-prefix walk, throwing a spurious `SyncGapError` for an id that was never a campaign-own
   * pending row to begin with. Keeping it in `resolvedGatewayIds` makes that late arrival the same
   * harmless swallow every OTHER post-settlement duplicate already gets. */
  private armGatewayTimeout(batch: GatewayBatch, ids: readonly string[]): void {
    if (batch.settled) return;
    batch.timeoutHandle = setTimeout(() => {
      for (const id of ids) {
        if (this.gatewayWaiters.get(id) === batch) this.gatewayWaiters.delete(id);
        this.resolvedGatewayIds.add(id);
      }
      this.settleGatewayReject(batch, new CampaignGatewayUnavailableError());
    }, this.gatewayAckTimeoutMs);
  }

  private deregisterGatewayIds(ids: readonly string[]): void {
    for (const id of ids) this.gatewayWaiters.delete(id);
  }

  /** Resolves `batch`'s promise exactly once (fix round 1, F1a/F4/F1b all route through this) —
   * clears any armed timeout and flips `settled` so a LATER ack/reject arrival for one of this
   * batch's already-sent-but-still-registered ids (F4) is recognized as "swallow, don't touch
   * storage" by `resolveGatewayAcks`/`resolveGatewayRejects` rather than double-resolving. */
  private settleGatewayResolve(batch: GatewayBatch): void {
    if (batch.settled) return;
    batch.settled = true;
    if (batch.timeoutHandle !== undefined) clearTimeout(batch.timeoutHandle);
    batch.resolve({ acked: batch.acked, rejected: batch.rejected });
  }

  /** Rejects `batch`'s promise exactly once — see `settleGatewayResolve`'s own doc; same
   * idempotency/timeout-clearing guarantee, the failure arm. */
  private settleGatewayReject(batch: GatewayBatch, err: Error): void {
    if (batch.settled) return;
    batch.settled = true;
    if (batch.timeoutHandle !== undefined) clearTimeout(batch.timeoutHandle);
    batch.reject(err);
  }

  /** `true` for an id that IS or EVER WAS a `gatewayAppend`-sent id — the union of "still actively
   * tracked" (`gatewayWaiters`) and "already resolved once, kept around so a redundant same-frame
   * second delivery is recognized" (`resolvedGatewayIds`, see its own doc). `commitPending`/
   * `dropPending` use this (not a bare `gatewayWaiters.has`) to decide whether an incoming id
   * belongs to the campaign's own pending-prefix walk at all. */
  private isGatewayId(id: string): boolean {
    return this.gatewayWaiters.has(id) || this.resolvedGatewayIds.has(id);
  }

  private resolveGatewayAcks(results: readonly { id: string; seq: number }[]): void {
    for (const r of results) {
      this.resolvedGatewayIds.add(r.id);
      const batch = this.gatewayWaiters.get(r.id);
      if (!batch) continue; // already fully consumed by an earlier pass — nothing left to do
      this.gatewayWaiters.delete(r.id);
      // fix round 1, F4: batch already settled (partial-send failure, timeout, or completed by an
      // earlier id in this same call) — swallow harmlessly, no re-push.
      if (batch.settled || !batch.remaining.has(r.id)) continue;
      batch.remaining.delete(r.id);
      batch.acked.push(r);
      if (batch.remaining.size === 0) this.settleGatewayResolve(batch);
    }
  }

  private resolveGatewayRejects(
    results: readonly { id: string; code?: RejectCode; message?: string }[],
  ): void {
    for (const r of results) {
      this.resolvedGatewayIds.add(r.id);
      const batch = this.gatewayWaiters.get(r.id);
      if (!batch) continue;
      this.gatewayWaiters.delete(r.id);
      if (batch.settled || !batch.remaining.has(r.id)) continue;
      batch.remaining.delete(r.id);
      batch.rejected.push(
        r.code !== undefined ? { id: r.id, code: r.code, message: r.message } : { id: r.id },
      );
      if (batch.remaining.size === 0) this.settleGatewayResolve(batch);
    }
  }

  private failAllGatewayWaiters(): void {
    const batches = new Set(this.gatewayWaiters.values());
    this.gatewayWaiters.clear();
    for (const batch of batches) {
      this.settleGatewayReject(batch, new CampaignGatewayUnavailableError());
    }
  }
}
