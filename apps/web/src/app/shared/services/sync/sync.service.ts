import {
  computed,
  effect,
  inject,
  Injectable,
  InjectionToken,
  signal,
  type Signal,
} from '@angular/core';
import { PROTO_VERSION, type Event, type ServerMessage } from '@hk/protocol';
import { APP_VERSION } from '@app/version';
import { uuidv7 } from '@shared/helpers/uuid';
import { ToastService } from '@shared/components/toast/toast.service';
import { ApiError, apiJson } from '@shared/services/api/api-fetch';
import { AuthService, type AuthStatus } from '@shared/services/auth/auth.service';
import type { CharacterRow } from '@shared/services/storage/dexie.db';
import { CharactersRepository } from '@shared/services/storage/characters.repository';
import { EventsRepository } from '@shared/services/storage/events.repository';
import { LeaderService } from '@shared/services/storage/leader.service';
import { CharacterStore } from '@shared/stores/character.store';
import { broadcastChannelName, SyncBroadcast, type BroadcastChannelFactory } from './broadcast';
import { SyncSocket, SyncSocketOversizeError, wsUrl, type WebSocketFactory } from './socket';
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
 */

export type SyncStateValue = 'offline' | 'connecting' | 'synced' | `pending-${number}`;

interface RemoteCharacterDto {
  readonly id: string;
  readonly name: string;
  readonly system: string;
}

/** Constructor-injectable `WebSocket` factory for every socket `SyncService` opens (both the
 * long-lived `StreamSyncSession`s it starts and its own one-shot upload/restore sockets) —
 * defaults to the real global `WebSocket` (via `SyncSocket`'s own default) when not overridden.
 * Specs override this via a `TestBed` provider. */
export const SYNC_WEBSOCKET_FACTORY = new InjectionToken<WebSocketFactory | undefined>(
  'SYNC_WEBSOCKET_FACTORY',
  { factory: () => undefined },
);

/** Constructor-injectable url builder, overriding `wsUrl` (which reads `window.location`) —
 * defaults to `undefined` (use the real `wsUrl`). Specs override this via a `TestBed` provider. */
export const SYNC_WS_URL_FN = new InjectionToken<((characterId: string) => string) | undefined>(
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

type SyncMode = 'idle' | 'leader' | 'follower';

@Injectable({ providedIn: 'root' })
export class SyncService {
  private readonly authService = inject(AuthService);
  private readonly leaderService = inject(LeaderService);
  private readonly characterStore = inject(CharacterStore);
  private readonly charactersRepository = inject(CharactersRepository);
  private readonly eventsRepository = inject(EventsRepository);
  private readonly toastService = inject(ToastService);
  private readonly webSocketFactory = inject(SYNC_WEBSOCKET_FACTORY);
  private readonly wsUrlFnOverride = inject(SYNC_WS_URL_FN);
  private readonly broadcastFactory = inject(SYNC_BROADCAST_FACTORY);

  private readonly storePort: StreamSyncSessionStorePort = this.characterStore;
  private readonly eventsPort: StreamSyncSessionEventsPort = this.eventsRepository;
  private readonly toastPort: StreamSyncSessionToastPort = this.toastService;

  private readonly sessionsState = signal<ReadonlyMap<string, StreamSyncSession>>(new Map());
  private readonly publishers = new Map<string, SyncBroadcast>();
  private readonly followerSubs = new Map<string, () => void>();
  private readonly quotaSignalCache = new Map<string, Signal<QuotaInfo | null>>();
  private readonly syncStateSignalCache = new Map<string, Signal<SyncStateValue>>();

  private mode: SyncMode = 'idle';
  private reconcileGeneration = 0;

  constructor() {
    effect(() => {
      const status = this.authService.status();
      const leader = this.leaderService.isLeader();
      this.onAuthLeaderChange(status, leader);
    });
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

  /** `characters-list.component.ts`'s delete flow — see class doc's "Deletion" section. */
  async deleteEverywhere(characterId: string): Promise<void> {
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
      await this.upload(row);
    }

    for (const serverRow of serverRows) {
      if (!this.stillReconciling(generation)) return;
      const streamId = `char:${serverRow.id}`;
      if (localIds.has(streamId)) continue;
      await this.restore(streamId);
    }
  }

  private stillReconciling(generation: number): boolean {
    return generation === this.reconcileGeneration && this.mode === 'leader';
  }

  private async upload(row: CharacterRow): Promise<void> {
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

    const localEvents = await this.eventsRepository.byStream(row.id);
    const committed = localEvents.filter((e) => e.seq !== undefined);
    if (committed.length > 0) {
      const verified = await this.uploadEvents(row.id, committed);
      if (!verified) {
        // Server wins — a full re-pull, task-8-brief.md's explicit resolution for the mismatch
        // case. `restore` is the exact same catch-up-then-`resetStreamFromServer` routine a
        // server-only stream uses.
        await this.restore(row.id);
        return;
      }
    }
    this.startSession(row.id);
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
   * device AND the upload-mismatch fallback (see class doc). */
  private async restore(streamId: string): Promise<void> {
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

    collected.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
    await this.characterStore.resetStreamFromServer(streamId, collected);
    this.startSession(streamId);
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
    });

    this.sessionsState.update((current) => {
      const next = new Map(current);
      next.set(streamId, session);
      return next;
    });
    void session.start();
  }

  private removeSession(streamId: string): void {
    const session = this.sessionsState().get(streamId);
    if (!session) return;
    session.stop();
    this.characterStore.leaveSyncMode(streamId);
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
    if (/session/i.test(reason)) {
      this.authService.init();
    }
  }

  private wsUrlFor(streamId: string): string {
    const characterId = stripStreamPrefix(streamId);
    return this.wsUrlFnOverride ? this.wsUrlFnOverride(characterId) : wsUrl(characterId);
  }
}

function stripStreamPrefix(streamId: string): string {
  return streamId.startsWith('char:') ? streamId.slice('char:'.length) : streamId;
}

// Re-exported so a consumer never needs to import `./broadcast` just to spell a channel name in a
// test/assertion.
export { broadcastChannelName };
