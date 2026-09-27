import {
  computed,
  effect,
  inject,
  Injectable,
  InjectionToken,
  signal,
  type Signal,
} from '@angular/core';
import { Router } from '@angular/router';
import {
  PROTO_VERSION,
  type Event,
  type MembershipRole,
  type MembersMsg,
  type PresenceMsg,
  type ServerMessage,
} from '@hk/protocol';
import { APP_VERSION } from '@app/version';
import { uuidv7 } from '@shared/helpers/uuid';
import { ToastService } from '@shared/components/toast/toast.service';
import { ApiError, apiJson } from '@shared/services/api/api-fetch';
import { AuthService, type AuthStatus } from '@shared/services/auth/auth.service';
import type { CharacterRow } from '@shared/services/storage/dexie.db';
import { CampaignsRepository } from '@shared/services/storage/campaigns.repository';
import { CharactersRepository } from '@shared/services/storage/characters.repository';
import { EventsRepository } from '@shared/services/storage/events.repository';
import { LeaderService } from '@shared/services/storage/leader.service';
import { CampaignStore } from '@shared/stores/campaign.store';
import { CharacterStore } from '@shared/stores/character.store';
import { broadcastChannelName, SyncBroadcast, type BroadcastChannelFactory } from './broadcast';
import type { VisibilityDocument } from './reconnect-signals';
import {
  SyncSocket,
  SyncSocketOversizeError,
  wsUrlForStream,
  type WebSocketFactory,
} from './socket';
import {
  chunkEventsForAppend,
  StreamSyncSession,
  type QuotaInfo,
  type StreamSyncSessionEventsPort,
  type StreamSyncSessionStorePort,
  type StreamSyncSessionToastPort,
} from './stream-sync-session';

/**
 * `SyncService` — the orchestrator (task-8-brief.md). Root-provided, self-driving: its
 * constructor sets up an `effect()` reacting to `AuthService.status` + `LeaderService.isLeader`
 * (design ruling 4 — only the elected `hk-writer` leader tab ever runs a live socket), and does
 * everything else — startup reconciliation, per-stream `StreamSyncSession` lifecycles, the
 * leader→follower `BroadcastChannel` poke, deletion fan-out — from there. It must be instantiated
 * once, early (`app.config.ts`'s `provideAppInitializer`, alongside `AuthService.init()`) so its
 * constructor's `effect()` actually starts observing — `providedIn: 'root'` alone does not
 * instantiate a service nobody has injected yet.
 *
 * ## Startup reconciliation (`reconcile`)
 *
 * `GET /api/characters` (server rows, keyed by the BARE uuid) vs `CharactersRepository.list()`
 * (local rows, keyed by the full `char:<uuid>` stream id):
 *  - **both** — the common case. `startSession` opens a `StreamSyncSession`, which builds its own
 *    `hello` from local storage (`lastSeq` = local committed head, `pending` = local pending rows)
 *    — doc-03's merge-by-catch-up is protocol-native, nothing special needed here.
 *  - **local-only** — `upload()`. `POST /api/characters {id: bareUuid, name, system}` registers
 *    ownership, THEN the full local **committed** event array is sent as `append` frames over a
 *    dedicated one-shot socket (`uploadEvents`) — deliberately NOT through the ordinary
 *    `StreamSyncSession`/pending-row path, because these events are already locally COMMITTED
 *    (they have real local seqs); `CharacterStore` has no "commit these existing IDs as if they
 *    were freshly acked" operation, and inventing one would mean two different code paths for
 *    "assign a seq to an id" ( `assignSeqs` already is that path, reached via `commitPending`,
 *    which only ever looks at rows that are STILL pending). Sending them as ordinary `append`
 *    content lets the server assign seqs 1..n exactly as it would for anyone else's fresh
 *    content; `uploadEvents` then verifies every ack's `{id, seq}` matches what's already on disk.
 *    They will, for a truly fresh stream (empty server-side, same order, same count) — the happy
 *    path never rewrites local storage at all. A mismatch (a race: something else claimed seq 1
 *    on the server between the `POST` and the `append`, vanishingly rare for a solo-owned stream)
 *    falls back to `restore()` — the exact same full-catch-up-then-`resetStreamFromServer` routine
 *    server-only streams use — because at that point "server wins" is simplest and correct (ruling
 *    in task-8-brief.md's Produces section: "mismatch → resetStreamFromServer from a full
 *    re-pull"). A `POST` that fails with a limit/quota code skips the stream with a toast and does
 *    NOT retry in a loop (task-8-brief.md's explicit guard).
 *  - **server-only** — `restore()`. Creates the local stream from scratch: a one-shot socket sends
 *    `hello {lastSeq: 0}`, collects `events` catch-up frames until `welcome.headSeq` is reached,
 *    then `CharacterStore.resetStreamFromServer(streamId, events)`. That method's own
 *    `refreshFromStorage` ALWAYS upserts the `CharactersRepository` Library-index row regardless
 *    of whether the stream happens to be loaded (see its class doc) — so restore needs no separate
 *    "create the index row" step; Task 6 already built that half.
 *
 * `restore()` is ALSO `handleDivergence`'s repair path (T11b): if an ordinary `both`-branch
 * session (or an interrupted upload's own later session) discovers on connect that the LOCAL
 * committed head is ahead of the server's `headSeq` — an upload/append round that got interrupted
 * mid-flight (a page teardown, crash, or tab close after the events were already committed locally
 * but before the server received/acked some suffix of them) — `StreamSyncSession` itself first
 * tries a targeted RESUME (resend just the missing tail over its own open socket, verify the acks);
 * `restore()` only runs as the fallback when that resume's own verification fails. See
 * `StreamSyncSession`'s class doc ("Local-ahead resume") for the full mechanics — this makes
 * upload-interruption recovery generic (every connect, not just this service's own reconcile pass).
 *
 * ## `syncState` (T9's indicator surface)
 *
 * `'offline'` (no session — not currently syncing this stream at all), `'connecting'` (session
 * exists, socket not yet open), `'synced'` (open, nothing pending), or the template-literal
 * `` `pending-${n}` `` (open, `n` local events not yet acked — or, transiently, momentarily
 * disconnected with something still queued, since `pendingCount` only clears on ack/reject, not
 * on connection state). One `computed` per streamId, cached so repeated calls (e.g. a list view
 * reading it once per row, every render) don't allocate a fresh `Signal` each time.
 *
 * ## Deletion (`deleteEverywhere`)
 *
 * `characters-list.component.ts`'s delete flow (the only caller of `CharacterStore.deleteCharacter`
 * for a USER-initiated delete — plan-5 Task 3) now calls `SyncService.deleteEverywhere` instead:
 * stop this stream's session (if any) and `leaveSyncMode` first (so no in-flight frame can touch
 * the stream mid-delete), then the same local `CharacterStore.deleteCharacter` as before (still
 * leader-guarded, still throws `CharacterStoreNotLeaderError` unchanged — callers keep their
 * existing catch), then — only when `AuthService.status() === 'authed'` — a best-effort
 * `DELETE /api/characters/:id`. "Best-effort" mirrors `AuthService.logout`'s own tolerance
 * contract: the user-visible action (the character is gone locally) has already succeeded, so a
 * network failure here is swallowed rather than surfaced — a stray server-side row is harmless
 * (`reconcile`'s local-only branch only ever uploads rows this device still has; it can never
 * re-create one that was just deleted). Logged-out (`anon`)/offline callers get local-only delete,
 * unchanged from before this task.
 *
 * ## Logout / leader-loss
 *
 * The `effect()` reacts to EITHER `status` leaving `'authed'` OR leadership being lost: every open
 * session is stopped and its stream's `leaveSyncMode` called, but — task-8-brief.md's explicit
 * instruction — pending ROWS themselves are left exactly as `CharacterStore.leaveSyncMode`'s own
 * contract already promises (untouched): they simply resume flushing on the next login/leadership
 * from the same `pendingOrder` rows, no special "flush before logout" attempt. A losing-leadership
 * (but still authed) tab instead enters FOLLOWER mode: it subscribes a `SyncBroadcast` per local
 * character and re-reads Dexie (`CharacterStore.reloadIfCurrent`) whenever poked, per design
 * ruling 4.
 *
 * ## Campaign sessions (plan-10 Task 5)
 *
 * `camp:<uuid>` streams reuse EVERY piece of the generic machinery above — the SAME
 * `sessionsState` map (so `quotaFor`/`syncState` already work for a campaign streamId for free),
 * the SAME leader-mode/idle-mode sweep (`stopLeaderMode`'s `[...sessionsState().keys()]` loop
 * already stops a campaign session on logout/leader-loss, no separate code needed), the SAME
 * `EventsRepository`/`ToastService` ports. `CampaignStore` (Task 4) is the store port — its
 * `applyServerCommit`/`commitPending`/`dropPending` are per-streamId-parameterized (not scoped to
 * whichever campaign is currently "open" for viewing), so ONE `CampaignStore` instance safely
 * backs MANY simultaneous campaign sessions.
 *
 * `reconcileCampaigns` (mirrors `reconcile`, invoked alongside it from `enterLeaderMode`) has no
 * local-only/server-only branch to resolve — unlike a character, a campaign row is NEVER cached
 * locally without first round-tripping the server (`CampaignStore.create`/`join`), so there is no
 * "upload" case. It only: (1) seeds/refreshes `CampaignsRepository` from `GET /api/campaigns`
 * (task-4-report.md's judgment call 1 — real rows with correct roles land BEFORE any stream ever
 * opens, so `CampaignStore.open`'s defensive `'player'` fallback should never fire via this path),
 * then (2) starts a session for every locally known row.
 *
 * `CampaignStore` has no `onCreate` emitter (Task 4 didn't ship one, and adding one there is
 * outside this task's file boundary) — the equivalent "don't wait for the next reconcile" shortcut
 * instead reacts to its `streamId` SIGNAL (set by `open`/`create`/`join` alike): whenever it points
 * at a stream this tab doesn't have a session for yet AND this tab is the live leader,
 * `startCampaignSession` runs immediately. `reconcileCampaigns` remains the general safety net for
 * anything this misses (e.g. leadership arriving AFTER `streamId` last changed — a plain field
 * read inside `effect()` doesn't re-trigger it).
 *
 * `CampaignStore.gatewayAppend`'s single `setGateway` target (task-4-report.md: not per-stream)
 * is attached/detached by a THIRD reactive `effect()`: whichever session matches the store's
 * currently OPEN `streamId`, recomputed whenever either changes. `setGateway` only ever writes a
 * plain instance field on `CampaignStore`, never an Angular signal, so doing this from inside an
 * `effect()` that also reads `sessionsState()` is safe — no write-during-read self-trigger.
 * `onAckEntries`/`onRejectEntries` (Task 4 fix round 1, controller ruling F2) are wired to
 * `campaignStore.handleGatewayAckEntries`/`handleGatewayRejectEntries` on EVERY campaign session
 * (not just the gateway-attached one) — harmless no-ops for ids that aren't the store's own
 * outstanding `gatewayAppend` batch, and required so a gateway-forwarded reject recovers its real
 * `code`/`message` instead of degrading to `{id}`-only. Character sessions never get these two
 * hooks wired, unchanged from Task 4's fix round.
 *
 * `onMembers` (`welcome.members` or a standalone `members` frame) updates a per-BARE-campaignId
 * signal read via `membersFor(campaignId)`. `onForeignEvents`/`onBinaryFrame` fan out to
 * `registerForeignEventsConsumer`/`registerBinaryFrameConsumer`'s registries (Tasks 9/13's own
 * seams) — a frame with nothing registered is simply dropped (never written to storage, never
 * queued). `onNotice` maps EVERY notice to `ToastService.show(notice.key, notice.params)` —
 * `NoticeMsg.level` has no effect (`ToastService.show` has no styling/level parameter to feed it;
 * see `toast.service.ts`).
 *
 * `onBye`: any OTHER reason just closes the session (`removeSession`, matching the character
 * path's own fallback stance for an unrecognized reason). `campaign.member_removed`
 * (`CAMPAIGN_BYE_REASON_MEMBER_REMOVED` — doc-03's own exported `BYE_REASON_MEMBER_REMOVED`
 * string, duplicated here rather than imported: `apps/web` never imports from `apps/api`, the
 * same boundary Task 1's `WS_MESSAGE_BYTES_MAX` hoist into `@hk/protocol` exists to avoid
 * re-litigating for every such shared literal) ADDITIONALLY drops this device's
 * `CampaignsRepository` row (events stay — server is authoritative; a re-added member's row is
 * simply re-seeded by a later `reconcileCampaigns` pass), toasts, and navigates away from any
 * `/g/<id>`-prefixed route this tab is currently on.
 *
 * `onDivergence` is wired defensively only (`removeSession`, no restart) — `CampaignStore` has no
 * `resetStreamFromServer` equivalent to actually repair one (task-4-report.md's judgment call 5),
 * and a genuine local-ahead divergence is believed practically unreachable for a campaign stream
 * in practice (`appendTx` never writes a locally-committed-with-unsent-seq row — see that store's
 * own "Always-synced, no direct-commit lane" doc section — so local can never get ahead of what
 * the server already told this device). This at least avoids a phantom "still open" bookkeeping
 * entry if it ever somehow fires.
 *
 * Presence (`{t:'presence', state:'active'|'idle'}`, doc-03 verbatim: throttle ≥60 s, sent on
 * state CHANGE only) is driven by a SINGLE `visibilitychange` listener (constructor-injectable via
 * `SYNC_VISIBILITY_DOCUMENT` for specs), fanned out to every LIVE campaign session on each firing
 * — independent per-session throttle bookkeeping (`presenceThrottle`, keyed by streamId) means one
 * campaign's send never consumes another's window. No initial presence is sent merely because a
 * session just opened (only a real `visibilitychange` firing triggers a send) — a documented, v1
 * judgment call, not a doc-03 requirement.
 *
 * No `SyncBroadcast`/follower-tab reload story exists for campaigns yet (`onApplied` is left
 * unwired) — `CampaignStore` has no `reloadIfCurrent`-shaped method for a follower tab to call, and
 * `enterFollowerMode` above only iterates `CharactersRepository`. Flagged for a future task.
 */

export type SyncStateValue = 'offline' | 'connecting' | 'synced' | `pending-${number}`;

interface RemoteCharacterDto {
  readonly id: string;
  readonly name: string;
  readonly system: string;
}

interface RemoteCampaignDto {
  readonly id: string;
  readonly name: string;
  readonly system: string;
  readonly role: MembershipRole;
  readonly joinCode?: string;
}

/** [plan-10 Task 5] doc-03's exported reason string for a DM-initiated removal
 * (`apps/api/src/core/routes/campaigns.ts`'s `BYE_REASON_MEMBER_REMOVED`) — duplicated here as a
 * plain string constant rather than imported: `apps/web` never imports from `apps/api` (a
 * separate deployable target, reached only over the wire), the same boundary `@hk/protocol`'s own
 * `WS_MESSAGE_BYTES_MAX` hoist (Task 1) exists to avoid re-litigating for every such shared
 * literal. Keep the two in sync if that route ever changes it. */
const CAMPAIGN_BYE_REASON_MEMBER_REMOVED = 'campaign.member_removed';

/** [plan-10 Task 5] doc-03 verbatim: "presence {state} (throttle ≥60 s)". */
const PRESENCE_THROTTLE_MS = 60_000;

/** Constructor-injectable `WebSocket` factory for every socket `SyncService` opens (both the
 * long-lived `StreamSyncSession`s it starts and its own one-shot upload/restore sockets) —
 * defaults to the real global `WebSocket` (via `SyncSocket`'s own default) when not overridden.
 * Specs override this via a `TestBed` provider. */
export const SYNC_WEBSOCKET_FACTORY = new InjectionToken<WebSocketFactory | undefined>(
  'SYNC_WEBSOCKET_FACTORY',
  { factory: () => undefined },
);

/** Constructor-injectable url builder, overriding `wsUrlForStream` (which reads
 * `window.location`) — defaults to `undefined` (use the real `wsUrlForStream`). Takes the FULL
 * stream id (`char:<uuid>` / `camp:<uuid>` — plan-10 Task 1 widened this from a bare-character-
 * uuid fn, migrating every caller below to match). Specs override this via a `TestBed`
 * provider. */
export const SYNC_WS_URL_FN = new InjectionToken<((streamId: string) => string) | undefined>(
  'SYNC_WS_URL_FN',
  { factory: () => undefined },
);

/** Constructor-injectable `BroadcastChannel` factory, threaded through to every `SyncBroadcast`
 * this service constructs — defaults to `undefined` (use the real global). Specs override this via
 * a `TestBed` provider. */
export const SYNC_BROADCAST_FACTORY = new InjectionToken<BroadcastChannelFactory | undefined>(
  'SYNC_BROADCAST_FACTORY',
  { factory: () => undefined },
);

/** [plan-10 Task 5] Constructor-injectable `document`-shaped presence source for campaign
 * sessions' `visibilitychange` listener — defaults to `undefined` (use the real global
 * `document`). Specs override this via a `TestBed` provider so a firing doesn't depend on jsdom's
 * own (unavailable-to-control-per-test) `visibilityState`. Reuses `VisibilityDocument`
 * (`reconnect-signals.ts`) — the same narrow shape `StreamSyncSession`'s own reconnect-trigger
 * wiring already uses for the identical DOM event; consumed independently here since presence has
 * nothing to do with reconnect triggers. */
export const SYNC_VISIBILITY_DOCUMENT = new InjectionToken<VisibilityDocument | undefined>(
  'SYNC_VISIBILITY_DOCUMENT',
  { factory: () => undefined },
);

type SyncMode = 'idle' | 'leader' | 'follower';

@Injectable({ providedIn: 'root' })
export class SyncService {
  private readonly authService = inject(AuthService);
  private readonly leaderService = inject(LeaderService);
  private readonly characterStore = inject(CharacterStore);
  private readonly campaignStore = inject(CampaignStore);
  private readonly charactersRepository = inject(CharactersRepository);
  private readonly campaignsRepository = inject(CampaignsRepository);
  private readonly eventsRepository = inject(EventsRepository);
  private readonly toastService = inject(ToastService);
  private readonly router = inject(Router);
  private readonly webSocketFactory = inject(SYNC_WEBSOCKET_FACTORY);
  private readonly wsUrlFnOverride = inject(SYNC_WS_URL_FN);
  private readonly broadcastFactory = inject(SYNC_BROADCAST_FACTORY);
  private readonly visibilityDocument: VisibilityDocument =
    inject(SYNC_VISIBILITY_DOCUMENT) ?? document;

  private readonly storePort: StreamSyncSessionStorePort = this.characterStore;
  private readonly campaignStorePort: StreamSyncSessionStorePort = this.campaignStore;
  private readonly eventsPort: StreamSyncSessionEventsPort = this.eventsRepository;
  private readonly toastPort: StreamSyncSessionToastPort = this.toastService;

  private readonly sessionsState = signal<ReadonlyMap<string, StreamSyncSession>>(new Map());
  private readonly publishers = new Map<string, SyncBroadcast>();
  private readonly followerSubs = new Map<string, () => void>();
  private readonly quotaSignalCache = new Map<string, Signal<QuotaInfo | null>>();
  private readonly syncStateSignalCache = new Map<string, Signal<SyncStateValue>>();

  // --- campaign-session-only bookkeeping (plan-10 Task 5) --------------------------------------
  private readonly campaignMembersState = signal<ReadonlyMap<string, MembersMsg['members']>>(
    new Map(),
  );
  private readonly membersSignalCache = new Map<string, Signal<MembersMsg['members'] | null>>();
  private readonly presenceThrottle = new Map<
    string,
    { state: PresenceMsg['state']; sentAt: number }
  >();
  private readonly foreignEventsConsumers = new Map<
    string,
    Set<(stream: string, events: Event[]) => void>
  >();
  private readonly binaryFrameConsumers = new Map<string, Set<(bytes: Uint8Array) => void>>();

  private mode: SyncMode = 'idle';
  private reconcileGeneration = 0;

  constructor() {
    effect(() => {
      const status = this.authService.status();
      const leader = this.leaderService.isLeader();
      this.onAuthLeaderChange(status, leader);
    });
    // Fix-wave review, Important finding 2: the effect above only re-fires on a `status`/
    // `isLeader` CHANGE — a character `create()`d while ALREADY authed+leader wouldn't otherwise
    // upload until some LATER transition re-ran `reconcile()` (a login, a reload). `onCreate`
    // (`CharacterStore`'s own class doc) is the narrow hook that catches exactly this case.
    this.characterStore.onCreate((streamId) => this.onCharacterCreated(streamId));

    // [plan-10 Task 5] `CampaignStore` has no `onCreate` emitter of its own — see class doc's
    // "Campaign sessions" section for why this reacts to its `streamId` SIGNAL instead.
    effect(() => {
      const streamId = this.campaignStore.streamId();
      if (streamId && this.mode === 'leader') this.startCampaignSession(streamId);
    });

    // [plan-10 Task 5] Gateway attach/detach — see class doc's "Campaign sessions" section for why
    // this is safe to write from inside an `effect()` alongside a `sessionsState()` read.
    effect(() => {
      const openStreamId = this.campaignStore.streamId();
      const session = openStreamId ? this.sessionsState().get(openStreamId) : undefined;
      this.campaignStore.setGateway(session);
    });

    this.visibilityDocument.addEventListener('visibilitychange', () =>
      this.onPresenceVisibilityChange(),
    );
  }

  /** Per-streamId, cached `Signal` of the stream's current welcome-reported quota (R-pf1); `null`
   * whenever the stream has no live session or the session hasn't yet received a `welcome`. */
  quotaFor(streamId: string): Signal<QuotaInfo | null> {
    let cached = this.quotaSignalCache.get(streamId);
    if (!cached) {
      cached = computed(() => this.sessionsState().get(streamId)?.quota() ?? null);
      this.quotaSignalCache.set(streamId, cached);
    }
    return cached;
  }

  /** Per-streamId, cached `Signal` of T9's indicator surface — see class doc. */
  syncState(streamId: string): Signal<SyncStateValue> {
    let cached = this.syncStateSignalCache.get(streamId);
    if (!cached) {
      cached = computed<SyncStateValue>(() => {
        const session = this.sessionsState().get(streamId);
        if (!session) return 'offline';
        const conn = session.connectionState();
        if (conn === 'connecting') return 'connecting';
        if (conn === 'closed') return 'offline';
        const pending = session.pendingCount();
        return pending > 0 ? (`pending-${pending}` as const) : 'synced';
      });
      this.syncStateSignalCache.set(streamId, cached);
    }
    return cached;
  }

  /** [plan-10 Task 5] Per-campaign, cached `Signal` of the LAST roster this device has received —
   * `welcome.members` (an initial snapshot, when the server includes one) or a later standalone
   * `members` frame, whichever arrived most recently; `null` before either has arrived (including
   * for a `campaignId` with no live session at all right now). `campaignId` is the BARE id (no
   * `camp:` prefix) — the same convention `CampaignStore.campaignId`/route params use. */
  membersFor(campaignId: string): Signal<MembersMsg['members'] | null> {
    let cached = this.membersSignalCache.get(campaignId);
    if (!cached) {
      cached = computed(() => this.campaignMembersState().get(campaignId) ?? null);
      this.membersSignalCache.set(campaignId, cached);
    }
    return cached;
  }

  /** [plan-10 Task 5] Registration seam for Task 9's subscription consumer: `cb` fires with EVERY
   * `events` frame this campaign's live session receives that is addressed to a DIFFERENT stream
   * than the campaign's own (doc-03's gateway — a subscribed character stream's catch-up/live
   * events, forwarded over the campaign socket). Default (nothing registered) is to IGNORE such a
   * frame outright — it is never written to storage by this service. Returns an unsubscribe
   * function. */
  registerForeignEventsConsumer(
    campaignId: string,
    cb: (stream: string, events: Event[]) => void,
  ): () => void {
    return registerConsumer(this.foreignEventsConsumers, campaignId, cb);
  }

  /** [plan-10 Task 5] Registration seam for Task 13's blob-transfer service: `cb` fires with EVERY
   * binary `blob.chunk` frame this campaign's live session receives. Default (nothing registered)
   * is a no-op — see class doc. Returns an unsubscribe function. */
  registerBinaryFrameConsumer(campaignId: string, cb: (bytes: Uint8Array) => void): () => void {
    return registerConsumer(this.binaryFrameConsumers, campaignId, cb);
  }

  /** [plan-10 Task 9] Sends `subscribe {t:'subscribe', stream, lastSeq?}` (`@hk/protocol`'s
   * `SubscribeMsgSchema`) over `campaignId`'s LIVE campaign socket, via that session's own public
   * `sendRaw` escape hatch (`StreamSyncSession`'s "Campaign-capable plumbing" doc section) — the
   * transport path `task-5-report.md` flagged as still-needed for this task. `lastSeq` omitted (or
   * `undefined`) asks the server for a full catch-up from the beginning (doc-03: "catch-up pages
   * arrive... from `(lastSeq ?? 0)+1`"); the DM party-sheet drill-in's own gap-rule re-subscribe
   * passes its last known-good seq instead. A silent no-op — same "no live session = nothing to
   * send" contract every other `sendRaw`-based outbound path in this service already has (see
   * `onPresenceVisibilityChange`) — when this campaign has no live session right now (not this
   * tab's leader, or momentarily disconnected): the caller is expected to treat "never got a
   * reply" the same way it treats a genuinely unauthorized subscribe (a bounded timeout, per
   * task-9-brief.md), since from the caller's side the two are indistinguishable. */
  subscribeForeignStream(campaignId: string, stream: string, lastSeq?: number): void {
    this.sessionsState()
      .get(`camp:${campaignId}`)
      ?.sendRaw(
        lastSeq !== undefined ? { t: 'subscribe', stream, lastSeq } : { t: 'subscribe', stream },
      );
  }

  /** [plan-10 Task 9] Sends `unsubscribe {t:'unsubscribe', stream}` — the drill-in's own cleanup
   * (dialog close, or navigating away from the campaign) calls this so the server stops forwarding
   * that character stream's events over this campaign socket. Same silent-no-op contract as
   * `subscribeForeignStream` above when there is no live session to send it over — nothing to clean
   * up server-side in that case either, since a session that isn't live never had the subscription
   * in the first place. */
  unsubscribeForeignStream(campaignId: string, stream: string): void {
    this.sessionsState().get(`camp:${campaignId}`)?.sendRaw({ t: 'unsubscribe', stream });
  }

  /** `characters-list.component.ts`'s delete flow — see class doc's "Deletion" section.
   *
   * Fix-wave review, Minor finding 4: bumps `reconcileGeneration` FIRST, same as
   * `enterIdleMode`/`enterLeaderMode` already do — an in-flight one-shot `restore()`/`upload()`
   * for THIS (or any other) stream, started before this delete, re-checks `stillReconciling`
   * before every trailing write (its own `startSession`, and `upload`'s `restore` fallback); this
   * makes that check fail, so a gated restore that resolves AFTER the delete can no longer
   * resurrect the just-deleted row. Coarser than strictly necessary (it also retires every OTHER
   * in-flight reconcile op, not just this stream's), but matches the existing generation-based
   * guard's own granularity — a delete is rare enough that superseding a same-tick unrelated
   * upload/restore, which simply resumes on the next login/leader change, is an acceptable cost
   * for a guarantee the alternative (a per-stream generation) doesn't buy anything more for here. */
  async deleteEverywhere(characterId: string): Promise<void> {
    this.reconcileGeneration++;
    this.removeSession(characterId);
    await this.characterStore.deleteCharacter(characterId);

    if (this.authService.status() !== 'authed') return;
    const bareId = stripStreamPrefix(characterId);
    try {
      await apiJson<void>(`/api/characters/${bareId}`, { method: 'DELETE' });
    } catch {
      // Best-effort — see class doc's "Deletion" section.
    }
  }

  // --- mode switching (the constructor's effect) ----------------------------------------------

  private onAuthLeaderChange(status: AuthStatus, leader: boolean): void {
    if (status === 'authed' && leader) {
      if (this.mode !== 'leader') this.enterLeaderMode();
    } else if (status === 'authed' && !leader) {
      if (this.mode !== 'follower') void this.enterFollowerMode();
    } else if (this.mode !== 'idle') {
      this.enterIdleMode();
    }
  }

  private enterLeaderMode(): void {
    this.stopFollowerMode();
    this.mode = 'leader';
    const generation = ++this.reconcileGeneration;
    void this.reconcile(generation);
    void this.reconcileCampaigns(generation);
  }

  private async enterFollowerMode(): Promise<void> {
    this.stopLeaderMode();
    this.mode = 'follower';
    const rows = await this.charactersRepository.list();
    if (this.mode !== 'follower') return; // superseded while this await was in flight
    for (const row of rows) {
      if (this.followerSubs.has(row.id)) continue;
      const broadcast = new SyncBroadcast(row.id, this.broadcastFactory);
      const unsubscribe = broadcast.subscribe(() => {
        void this.characterStore.reloadIfCurrent(row.id);
      });
      this.followerSubs.set(row.id, unsubscribe);
    }
  }

  private enterIdleMode(): void {
    this.reconcileGeneration++; // supersede any in-flight reconcile
    this.stopLeaderMode();
    this.stopFollowerMode();
    this.mode = 'idle';
  }

  private stopLeaderMode(): void {
    for (const streamId of [...this.sessionsState().keys()]) {
      this.removeSession(streamId);
    }
  }

  private stopFollowerMode(): void {
    for (const unsubscribe of this.followerSubs.values()) unsubscribe();
    this.followerSubs.clear();
  }

  // --- reconciliation ---------------------------------------------------------------------------

  private async reconcile(generation: number): Promise<void> {
    let serverRows: RemoteCharacterDto[];
    try {
      serverRows = await apiJson<RemoteCharacterDto[]>('/api/characters');
    } catch {
      // Offline / server unreachable at reconcile time — no sessions start; the next `online`/
      // `visibilitychange` reconnect signal happens PER-SESSION (there are none yet), so recovery
      // here relies on a future leader/auth re-fire of the effect (a logout+login, a tab
      // becoming leader again, ...) or T9's own manual retry affordance, not an internal retry
      // loop — task-8-brief.md's upload guard ("don't retry loop") generalizes to reconcile
      // itself.
      return;
    }
    if (!this.stillReconciling(generation)) return;

    const localRows = await this.charactersRepository.list();
    if (!this.stillReconciling(generation)) return;
    const serverIds = new Set(serverRows.map((r) => `char:${r.id}`));
    const localIds = new Set(localRows.map((r) => r.id));

    for (const row of localRows) {
      if (!this.stillReconciling(generation)) return;
      if (serverIds.has(row.id)) {
        this.startSession(row.id);
        continue;
      }
      await this.upload(row, generation);
    }

    for (const serverRow of serverRows) {
      if (!this.stillReconciling(generation)) return;
      const streamId = `char:${serverRow.id}`;
      if (localIds.has(streamId)) continue;
      await this.restore(streamId, generation);
    }
  }

  private stillReconciling(generation: number): boolean {
    return generation === this.reconcileGeneration && this.mode === 'leader';
  }

  /** Fix-wave review, Important finding 2 — `CharacterStore.onCreate`'s subscriber. Only acts
   * when this tab is ALREADY the leader mode's own live generation (an idle/follower tab has no
   * business uploading anything; a genuinely fresh `authed`+leader transition instead goes through
   * the ordinary `reconcile()` path, which will pick this same brand-new row up as "local-only"
   * regardless — this hook is purely for the "already leader when created" case `reconcile()`'s
   * own change-triggered effect can't see). Reuses `upload()` verbatim — a fresh local-only row is
   * exactly what that method already handles, generation-guards included. */
  private onCharacterCreated(streamId: string): void {
    if (this.mode !== 'leader') return;
    const generation = this.reconcileGeneration;
    void (async () => {
      const row = await this.charactersRepository.get(streamId);
      if (!row) return; // deleted again before this async hop landed
      if (!this.stillReconciling(generation)) return;
      await this.upload(row, generation);
    })();
  }

  private async upload(row: CharacterRow, generation: number): Promise<void> {
    const bareId = stripStreamPrefix(row.id);
    try {
      await apiJson('/api/characters', {
        method: 'POST',
        body: JSON.stringify({ id: bareId, name: row.name, system: row.system }),
      });
    } catch (err) {
      if (
        err instanceof ApiError &&
        (err.code === 'limit_exceeded' || err.code === 'quota_exceeded')
      ) {
        this.toastService.show('sync.upload.limit-reached');
        return; // skip this stream, don't retry in a loop
      }
      this.toastService.show('sync.upload.failed', { name: row.name });
      return;
    }

    // Fix-round 1, Critical 2: turn on the pending-write fork BEFORE snapshotting which events are
    // "committed" for upload — `uploadEvents` below `await`s a full round trip to the server, and
    // without this, a local edit landing during that window (`CharacterStore.appendTx`, still in
    // local-committed mode) would be written as a COMMITTED row with a LOCAL seq that this upload
    // never sends — permanent silent divergence (the server never learns of it, and nothing ever
    // retransmits it, since `commitPending`/`applyServerCommit` only ever touch pending rows).
    // Calling this now means any such concurrent edit instead becomes a PENDING row, which flushes
    // normally once `startSession` below opens a real session (or, if reconciliation gets
    // superseded before that happens, on the next `hello.pending` a future session sends).
    this.characterStore.enterSyncMode(row.id);

    const localEvents = await this.eventsRepository.byStream(row.id);
    const committed = localEvents.filter((e) => e.seq !== undefined);
    if (committed.length > 0) {
      const verified = await this.uploadEvents(row.id, committed);
      if (!verified) {
        // Server wins — a full re-pull, task-8-brief.md's explicit resolution for the mismatch
        // case. `restore` is the exact same catch-up-then-`resetStreamFromServer` routine a
        // server-only stream uses.
        await this.restore(row.id, generation);
        return;
      }
    }
    // Fix-round 1, Important 3: re-check — a logout/leader-loss during the `await`s above must not
    // let this stale continuation resurrect a session under idle/follower mode.
    if (this.stillReconciling(generation)) this.startSession(row.id);
  }

  /** One-shot socket: `hello {lastSeq: 0}` (this stream is brand new server-side — the `POST`
   * just registered it), then the full `committed` array as chunked `append` frames, then verifies
   * every ack's `{id, seq}` matches what's already on disk locally. Resolves `true` only when
   * every (non-poisoned) event's ack seq matches — see class doc's upload section. */
  private async uploadEvents(streamId: string, committed: readonly Event[]): Promise<boolean> {
    const expected = new Map(committed.map((e) => [e.id, e.seq]));
    const acked = new Map<string, number>();

    return new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (result: boolean): void => {
        if (settled) return;
        settled = true;
        socket.close();
        resolve(result);
      };

      const socket = new SyncSocket({
        url: this.wsUrlFor(streamId),
        webSocketFactory: this.webSocketFactory,
        onOpen: () => {
          socket.send({
            t: 'hello',
            rid: uuidv7(),
            proto: PROTO_VERSION,
            app: APP_VERSION,
            streams: [{ id: streamId, lastSeq: 0 }],
            have: [],
            pending: [],
          });
        },
        onMessage: (message: ServerMessage) => {
          if (message.t === 'welcome') {
            for (const chunk of chunkEventsForAppend(committed)) {
              try {
                socket.send({ t: 'append', rid: uuidv7(), events: chunk });
              } catch (chunkErr) {
                if (chunkErr instanceof SyncSocketOversizeError && chunk.length === 1) {
                  expected.delete(chunk[0].id);
                  this.toastService.show('sync.upload.poisoned-event');
                  continue;
                }
                finish(false);
                return;
              }
            }
            if (expected.size === 0) finish(true);
            return;
          }
          if (message.t === 'ack') {
            for (const result of message.results) acked.set(result.id, result.seq);
            if (acked.size >= expected.size) {
              const matches = [...expected].every(([id, seq]) => acked.get(id) === seq);
              finish(matches);
            }
            return;
          }
          if (message.t === 'reject' || message.t === 'bye') {
            finish(false);
          }
        },
        onClose: () => finish(false),
        onError: () => finish(false),
        onProtocolError: () => finish(false),
      });
    });
  }

  /** One-shot socket: `hello {lastSeq: 0}`, collect `events` catch-up frames until
   * `welcome.headSeq` is reached, then `CharacterStore.resetStreamFromServer` — restore-on-new-
   * device AND the upload-mismatch fallback (see class doc). `generation` is re-checked before the
   * trailing `startSession` (fix-round 1, Important 3) — same reasoning as `upload`'s own check. */
  private async restore(streamId: string, generation: number): Promise<void> {
    const collected: Event[] = [];
    const ok = await new Promise<boolean>((resolve) => {
      let headSeq = 0;
      let settled = false;
      const finish = (result: boolean): void => {
        if (settled) return;
        settled = true;
        socket.close();
        resolve(result);
      };

      const socket = new SyncSocket({
        url: this.wsUrlFor(streamId),
        webSocketFactory: this.webSocketFactory,
        onOpen: () => {
          socket.send({
            t: 'hello',
            rid: uuidv7(),
            proto: PROTO_VERSION,
            app: APP_VERSION,
            streams: [{ id: streamId, lastSeq: 0 }],
            have: [],
            pending: [],
          });
        },
        onMessage: (message: ServerMessage) => {
          if (message.t === 'welcome') {
            headSeq = message.streams.find((s) => s.id === streamId)?.headSeq ?? 0;
            if (headSeq === 0) finish(true); // a genuinely empty stream is still a valid restore
            return;
          }
          if (message.t === 'events' && message.stream === streamId) {
            collected.push(...message.events);
            const maxSeq = collected.reduce((m, e) => Math.max(m, e.seq ?? 0), 0);
            if (maxSeq >= headSeq) finish(true);
            return;
          }
          if (message.t === 'bye') finish(false);
        },
        onClose: () => finish(false),
        onError: () => finish(false),
        onProtocolError: () => finish(false),
      });
    });

    if (!ok) {
      this.toastService.show('sync.restore.failed');
      return;
    }

    // Fix-wave review, Minor finding 4: re-checked HERE too, not just before the trailing
    // `startSession` below — `deleteEverywhere` bumps `reconcileGeneration` precisely so THIS
    // check can catch a delete (of this stream, or any other — same coarse generation-wide
    // supersession `enterIdleMode`/`enterLeaderMode` already use) that raced this restore's own
    // socket round trip: without it, `resetStreamFromServer` would unconditionally resurrect a
    // just-deleted character's row/events from the server's copy, superseded generation or not.
    if (!this.stillReconciling(generation)) return;

    collected.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
    await this.characterStore.resetStreamFromServer(streamId, collected);
    if (this.stillReconciling(generation)) this.startSession(streamId);
  }

  // --- session bookkeeping -----------------------------------------------------------------------

  private startSession(streamId: string): void {
    if (this.sessionsState().has(streamId)) return;
    this.characterStore.enterSyncMode(streamId);

    const publisher = new SyncBroadcast(streamId, this.broadcastFactory);
    this.publishers.set(streamId, publisher);

    const session = new StreamSyncSession({
      streamId,
      store: this.storePort,
      eventsRepository: this.eventsPort,
      toast: this.toastPort,
      webSocketFactory: this.webSocketFactory,
      wsUrlFn: this.wsUrlFnOverride,
      onApplied: () => publisher.publish(),
      onBye: (reason) => this.handleBye(streamId, reason),
      onDivergence: () => this.handleDivergence(streamId),
    });

    this.sessionsState.update((current) => {
      const next = new Map(current);
      next.set(streamId, session);
      return next;
    });
    void session.start();
  }

  /** Generic teardown for BOTH stream kinds (plan-10 Task 5 widened this from character-only) —
   * prefix-dispatches the kind-specific half: `leaveSyncMode` only means something for a `char:`
   * stream (`CampaignStore` has no such mode — campaigns are always-synced); a `camp:` stream
   * additionally drops its cached roster/presence-throttle bookkeeping. The gateway `setGateway`
   * detach for a `camp:` stream is NOT done here — the constructor's own reactive `effect()`
   * (class doc's "Campaign sessions" section) picks it up automatically once `sessionsState`
   * changes below. */
  private removeSession(streamId: string): void {
    const session = this.sessionsState().get(streamId);
    if (!session) return;
    session.stop();
    if (streamId.startsWith('char:')) {
      this.characterStore.leaveSyncMode(streamId);
    } else if (streamId.startsWith('camp:')) {
      const campaignId = campaignIdOf(streamId);
      this.campaignMembersState.update((current) => {
        if (!current.has(campaignId)) return current;
        const next = new Map(current);
        next.delete(campaignId);
        return next;
      });
      this.presenceThrottle.delete(streamId);
    }
    this.sessionsState.update((current) => {
      const next = new Map(current);
      next.delete(streamId);
      return next;
    });
    this.publishers.get(streamId)?.close();
    this.publishers.delete(streamId);
  }

  private handleBye(streamId: string, reason: string): void {
    this.removeSession(streamId);
    // doc-03: "bye { reason }" — "session expired" is the one reason worth an eager re-check;
    // anything else (e.g. a future "removed from campaign") has no bearing on this device's own
    // session state.
    // FOLLOW-UP (fix-round 1, reviewer finding 4 — flagged, no behavior change here): the shipped
    // server currently emits NO `bye` frames at all, and doc-03/@hk/protocol only constrain
    // `reason` to a non-empty string — there is no enum of known reason codes to match against.
    // This `/session/i` heuristic is a best-effort placeholder that will need re-verifying (exact
    // wording, or a real code) once the server actually starts sending `bye` with a
    // session-expiry reason.
    if (/session/i.test(reason)) {
      this.authService.init();
    }
  }

  /** `StreamSyncSession`'s local-ahead resume attempt (T11b, see that class's own doc) failed
   * verification — a genuine divergence the session couldn't self-repair. The session has already
   * torn itself down by the time this fires; sweep this device's own bookkeeping for it, then run
   * the exact same server-wins `restore()` a server-only stream uses. `restore`'s own trailing
   * `startSession` re-checks `stillReconciling` against the CURRENT generation (nothing newer has
   * started since this is a live-session callback, not part of `reconcile()`'s own loop), so a
   * logout/leader-loss racing this repair still can't resurrect a session under idle/follower mode. */
  private handleDivergence(streamId: string): void {
    this.removeSession(streamId);
    void this.restore(streamId, this.reconcileGeneration);
  }

  private wsUrlFor(streamId: string): string {
    return this.wsUrlFnOverride ? this.wsUrlFnOverride(streamId) : wsUrlForStream(streamId);
  }

  // --- campaign sessions (plan-10 Task 5) -------------------------------------------------------

  /** Mirrors `reconcile()` — see class doc's "Campaign sessions" section for why this has no
   * local-only/server-only branch to resolve. */
  private async reconcileCampaigns(generation: number): Promise<void> {
    let serverRows: RemoteCampaignDto[];
    try {
      serverRows = await apiJson<RemoteCampaignDto[]>('/api/campaigns');
    } catch {
      // Offline / server unreachable — same posture as `reconcile()`'s own guard: no retry loop,
      // the next auth/leader transition tries again.
      return;
    }
    if (!this.stillReconciling(generation)) return;

    // Task 4's report, judgment call 1: seed real rows (correct role) from the server's own DTO
    // BEFORE any session ever opens for them — `CampaignStore.open`'s defensive `'player'`
    // fallback should never be exercised via this path.
    for (const row of serverRows) {
      if (!this.stillReconciling(generation)) return;
      const existing = await this.campaignsRepository.get(row.id);
      await this.campaignsRepository.put({
        id: row.id,
        name: row.name,
        system: row.system,
        role: row.role,
        joinCode: row.joinCode ?? existing?.joinCode,
        lastSeq: existing?.lastSeq ?? 0,
        updatedAt: existing?.updatedAt ?? Date.now(),
      });
    }
    if (!this.stillReconciling(generation)) return;

    const localRows = await this.campaignsRepository.list();
    for (const row of localRows) {
      if (!this.stillReconciling(generation)) return;
      this.startCampaignSession(`camp:${row.id}`);
    }
  }

  private startCampaignSession(streamId: string): void {
    if (this.sessionsState().has(streamId)) return;
    const campaignId = campaignIdOf(streamId);

    const session = new StreamSyncSession({
      streamId,
      store: this.campaignStorePort,
      eventsRepository: this.eventsPort,
      toast: this.toastPort,
      webSocketFactory: this.webSocketFactory,
      wsUrlFn: this.wsUrlFnOverride,
      onBye: (reason) => this.handleCampaignBye(streamId, reason),
      onDivergence: () => this.handleCampaignDivergence(streamId),
      onMembers: (members) => {
        this.campaignMembersState.update((current) => {
          const next = new Map(current);
          next.set(campaignId, members);
          return next;
        });
      },
      onForeignEvents: (stream, events) => {
        for (const cb of this.foreignEventsConsumers.get(campaignId) ?? []) cb(stream, events);
      },
      onBinaryFrame: (bytes) => {
        for (const cb of this.binaryFrameConsumers.get(campaignId) ?? []) cb(bytes);
      },
      onNotice: (notice) => this.toastService.show(notice.key, notice.params),
      // Task 4 fix round 1, controller ruling F2 — see class doc's "Campaign sessions" section.
      onAckEntries: (results) => this.campaignStore.handleGatewayAckEntries(results),
      onRejectEntries: (results) => this.campaignStore.handleGatewayRejectEntries(results),
    });

    this.sessionsState.update((current) => {
      const next = new Map(current);
      next.set(streamId, session);
      return next;
    });
    void session.start();
  }

  private handleCampaignBye(streamId: string, reason: string): void {
    this.removeSession(streamId);
    if (reason !== CAMPAIGN_BYE_REASON_MEMBER_REMOVED) return;

    const campaignId = campaignIdOf(streamId);
    // Events stay — server is authoritative; a re-added member's row is simply re-seeded by a
    // later `reconcileCampaigns` pass.
    void this.campaignsRepository.remove(campaignId);
    this.toastService.show('campaigns.removed.toast');

    const path = `/g/${campaignId}`;
    if (this.router.url === path || this.router.url.startsWith(`${path}/`)) {
      // Plan-10 Task 6 carry (task-5-report.md): `/campaigns` now exists — swapped from the
      // placeholder `/characters` destination task-5 shipped before this route existed.
      void this.router.navigateByUrl('/campaigns');
    }
  }

  /** See class doc's "Campaign sessions" section for why this is bookkeeping-only (no restart —
   * `CampaignStore` has no repair primitive to hand off to). */
  private handleCampaignDivergence(streamId: string): void {
    this.removeSession(streamId);
  }

  private onPresenceVisibilityChange(): void {
    const newState: PresenceMsg['state'] =
      this.visibilityDocument.visibilityState === 'visible' ? 'active' : 'idle';
    const now = Date.now();

    for (const [streamId, session] of this.sessionsState()) {
      if (!streamId.startsWith('camp:')) continue;
      const last = this.presenceThrottle.get(streamId);
      if (last?.state === newState) continue; // doc-03: sent on state CHANGE only
      if (last && now - last.sentAt < PRESENCE_THROTTLE_MS) continue; // throttled — dropped, no queue

      this.presenceThrottle.set(streamId, { state: newState, sentAt: now });
      session.sendRaw({ t: 'presence', state: newState });
    }
  }
}

function stripStreamPrefix(streamId: string): string {
  return streamId.startsWith('char:') ? streamId.slice('char:'.length) : streamId;
}

function campaignIdOf(streamId: string): string {
  return streamId.startsWith('camp:') ? streamId.slice('camp:'.length) : streamId;
}

/** Shared `Map<key, Set<callback>>` registration helper for
 * `registerForeignEventsConsumer`/`registerBinaryFrameConsumer` — adds `cb` under `key`, pruning
 * the key entirely once its callback set empties out, and returns an unsubscribe function. */
function registerConsumer<T>(registry: Map<string, Set<T>>, key: string, cb: T): () => void {
  let set = registry.get(key);
  if (!set) {
    set = new Set();
    registry.set(key, set);
  }
  set.add(cb);
  return () => {
    const current = registry.get(key);
    if (!current) return;
    current.delete(cb);
    if (current.size === 0) registry.delete(key);
  };
}

// Re-exported so a consumer never needs to import `./broadcast` just to spell a channel name in a
// test/assertion.
export { broadcastChannelName };
