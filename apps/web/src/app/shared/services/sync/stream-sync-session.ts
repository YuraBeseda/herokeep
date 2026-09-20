import { signal, type Signal } from '@angular/core';
import {
  PROTO_VERSION,
  type ClientMessage,
  type Event,
  type HelloMsg,
  type RejectCode,
  type ServerMessage,
} from '@hk/protocol';
import { APP_VERSION } from '@app/version';
import { uuidv7 } from '@shared/helpers/uuid';
import { SyncGapError } from '@shared/stores/character.store';
import { Backoff } from './backoff';
import {
  ReconnectSignals,
  type EventListenable,
  type VisibilityDocument,
} from './reconnect-signals';
import {
  SyncSocket,
  SyncSocketOversizeError,
  WS_MESSAGE_BYTES_MAX,
  wsUrl,
  type WebSocketFactory,
} from './socket';

/**
 * `StreamSyncSession` — one per synced character stream, driving exactly ONE `SyncSocket`
 * lifecycle end to end (docs/02-architecture/03-sync-protocol.md, task-8-brief.md). Not an
 * Angular service — `SyncService` (the orchestrator) constructs one per stream it decides to sync
 * and owns their lifetimes; a session never reaches into DI itself so specs can `new` it directly
 * against a REAL `CharacterStore`/`EventsRepository` (fake-indexeddb-backed) and a fake
 * `SyncSocket` factory, per task-8-brief.md's TDD instruction.
 *
 * Frame handling is STRICTLY sequential in arrival order (`enqueue`/`handleFrame`'s own doc) even
 * though every handler is `async` — a naive `onMessage` callback calling straight into an `async`
 * handler would let a slow `welcome` handler's await be overtaken by a same-tick `events` frame's
 * handler finishing first, which doc-03's catch-up-before-ack-flush ordering guarantee depends on
 * never happening.
 *
 * ## Local-ahead resume (T11b)
 *
 * `handleWelcome` compares `welcome.streams[].headSeq` against this stream's LOCAL committed head
 * on every single `welcome` — not just a first connect. When the local head is ahead (a prior
 * upload/append round was interrupted — a page teardown, a crash, a tab close — after the events
 * were already committed locally but before the server ever received/acked some suffix of them),
 * the missing committed tail (local committed events whose `seq > headSeq`, in original order) is
 * resent as chunked `append` frames over THIS session's own already-open socket, and every
 * resulting `ack` is verified to name exactly the same `{id, seq}` pairs already on disk (identical
 * semantics to `SyncService.uploadEvents()`'s fresh-upload verification — a genuinely fresh upload
 * is just the degenerate case `headSeq === 0`). A full match lets the session proceed into normal
 * steady state (any `hello.pending` overflow flushes right after); any mismatch — or a poisoned
 * event this device can no longer resend — is treated as a genuine divergence: `onDivergence` fires
 * (after this session tears itself down), and `SyncService` runs its existing server-wins
 * `restore()` for the stream. Because this check runs on EVERY `welcome`, an interruption during
 * the resume attempt ITSELF (another crash mid-resume) just gets retried, and correctly resends a
 * SMALLER tail next time (the server's `headSeq` will have advanced by whatever landed before the
 * interruption — doc-03's duplicate-id idempotency means even re-sending an already-landed event
 * acks with its existing seq, which still matches, so nothing double-counts).
 *
 * ### ID-scoped ack/reject routing during resume (T11b round 2)
 *
 * Doc-03's fixed emission order means a genuinely PENDING backlog's `hello.pending` ack (or a
 * reject) can arrive in the SAME connect sequence as a resume's own acks — even in the SAME `ack`
 * frame, mixed together (the server has no reason to separate them). `handleAck`/`handleReject`
 * therefore partition `results` by membership in `resumeState.expected` whenever a resume is in
 * flight: ids that belong to the resume go to verification; every other id goes through the
 * ordinary `commitPending`/`dropPending` path, completely independent of how the resume itself
 * resolves. Resume completion is judged by SET EQUALITY against `expected`'s keys (every expected
 * id has a recorded ack), never a raw count — a `size`-based check is corruptible by exactly the
 * foreign ids this partitioning now filters out before they'd ever reach it. `onLocalAppend` also
 * checks `resumeState` and HOLDS (buffers) any new local edit made while a resume is in flight,
 * flushing the buffer (in order) once the resume completes — sending it immediately instead would
 * mix that append's own ack into the very frame resume verification is trying to interpret.
 */

export interface QuotaInfo {
  readonly bytesUsed: number;
  readonly bytesMax: number;
  readonly eventCount: number;
}

export type SessionConnectionState = 'connecting' | 'open' | 'closed';

/** The narrow slice of `CharacterStore` this session actually calls — see that class's own "sync
 * seam" doc for what each method does. A real `CharacterStore` satisfies this structurally; specs
 * pass the real thing (task-8-brief.md: "fake socket + REAL store + fake-indexeddb"). */
export interface StreamSyncSessionStorePort {
  applyServerCommit(streamId: string, events: Event[]): Promise<void>;
  commitPending(streamId: string, ackResults: { id: string; seq: number }[]): Promise<void>;
  dropPending(streamId: string, ids: string[]): Promise<void>;
  onLocalAppend(cb: (streamId: string, events: Event[]) => void): () => void;
}

/** The narrow slice of `EventsRepository` this session reads directly — `byStream`'s own ordering
 * contract (committed by seq asc, then pending by pendingOrder asc) is exactly what a `hello`
 * frame's `streams[].lastSeq`/`pending` need. Read-only: this session never writes storage itself
 * — every write goes through `StreamSyncSessionStorePort` so `CharacterStore` stays the single
 * writer (its own class doc). */
export interface StreamSyncSessionEventsPort {
  byStream(stream: string): Promise<Event[]>;
}

export interface StreamSyncSessionToastPort {
  show(key: string, params?: Record<string, unknown>): void;
}

export interface StreamSyncSessionOptions {
  /** The full `char:<uuid>` stream id. */
  streamId: string;
  store: StreamSyncSessionStorePort;
  eventsRepository: StreamSyncSessionEventsPort;
  toast: StreamSyncSessionToastPort;
  /** Constructor-injectable so specs use a fake `WebSocket`; defaults to the global one (via
   * `SyncSocket`'s own default). */
  webSocketFactory?: WebSocketFactory;
  /** Constructor-injectable RNG for `Backoff`'s jitter; defaults to `Math.random`. */
  rng?: () => number;
  /** Constructor-injectable `navigator.locks`-shaped API; defaults to the real one, falling back
   * to "assume granted" when absent (mirrors `LeaderService`'s own contract). */
  locks?: LockManager;
  window?: EventListenable;
  document?: VisibilityDocument;
  /** Builds the absolute `ws://`/`wss://` url from the bare character uuid; defaults to `wsUrl`.
   * Overridable so specs don't depend on `window.location`. */
  wsUrlFn?: (characterId: string) => string;
  /** Fires after this session successfully applies server-committed content for this stream (a
   * caught-up `events` frame, or an `ack`) — `SyncService` wires this to
   * `SyncBroadcast.publish()` so follower tabs know to re-read Dexie. NOT fired for this device's
   * own outbound appends (a follower tab already sees those the instant `CharacterStore.appendTx`
   * wrote them — Dexie is shared). */
  onApplied?: () => void;
  /** Fires once, after this session has fully torn itself down, when the server sends `bye` —
   * `reason` passed through verbatim. `SyncService` decides whether it implies a session-expiry
   * re-check of `AuthService`. */
  onBye?: (reason: string) => void;
  /** Fires once, after this session has fully torn itself down, when a local-ahead resume attempt
   * (see class doc) fails verification — a genuine divergence between local and server history that
   * this session cannot repair by itself. `SyncService` responds with its existing server-wins
   * `restore()` for the stream. */
  onDivergence?: () => void;
}

const LOCK_PREFIX = 'hk:sync:';
const MAX_APPEND_EVENTS = 50;

// Stand-in for the `{"t":"append","rid":"...","events":[...]}` frame envelope's own bytes — a
// fixed, conservative reserve rather than re-stringifying the whole candidate frame on every
// event (which would be O(n^2) for a large backlog). `rid` is a uuid (36 bytes); the rest of the
// envelope is well under 100 bytes; 256 leaves comfortable headroom.
const FRAME_OVERHEAD_BYTES = 256;

function byteLength(s: string): number {
  return new TextEncoder().encode(s).length;
}

/**
 * Splits `events` into frames respecting doc-03's `append`/`hello.pending` caps (≤50 events AND
 * ≤128 KB per frame). A single event whose own JSON already exceeds the per-frame byte budget is
 * still emitted alone (a chunk of length 1) — `SyncSocket.send`'s own `WS_MESSAGE_BYTES_MAX` guard
 * is the actual source of truth on size, so a lone chunk that STILL throws
 * `SyncSocketOversizeError` is a genuinely poisoned single event, not a chunking bug (see
 * `sendAppendChunks`'s handling of that case).
 */
export function chunkEventsForAppend(events: readonly Event[]): Event[][] {
  const chunks: Event[][] = [];
  let current: Event[] = [];
  let currentBytes = FRAME_OVERHEAD_BYTES;

  for (const event of events) {
    const eventBytes = byteLength(JSON.stringify(event)) + 1; // +1 for the array-join comma
    if (
      current.length > 0 &&
      (current.length >= MAX_APPEND_EVENTS || currentBytes + eventBytes > WS_MESSAGE_BYTES_MAX)
    ) {
      chunks.push(current);
      current = [];
      currentBytes = FRAME_OVERHEAD_BYTES;
    }
    current.push(event);
    currentBytes += eventBytes;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

const REJECT_TOAST_KEYS: Readonly<Record<RejectCode, string>> = {
  forbidden: 'sync.reject.forbidden',
  quota: 'sync.reject.quota',
  invalid: 'sync.reject.invalid',
  duplicate: 'sync.reject.duplicate',
  stream_closed: 'sync.reject.stream_closed',
};

export class StreamSyncSession {
  private readonly streamId: string;
  private readonly characterId: string;
  private readonly store: StreamSyncSessionStorePort;
  private readonly eventsRepository: StreamSyncSessionEventsPort;
  private readonly toast: StreamSyncSessionToastPort;
  private readonly webSocketFactory: WebSocketFactory | undefined;
  private readonly backoff: Backoff;
  private readonly reconnectSignals: ReconnectSignals;
  private readonly wsUrlFn: (characterId: string) => string;
  private readonly onApplied: (() => void) | undefined;
  private readonly onBye: ((reason: string) => void) | undefined;
  private readonly onDivergence: (() => void) | undefined;
  private readonly locksApi: LockManager | undefined;

  private socket: SyncSocket | undefined;
  private msgQueue: Promise<void> = Promise.resolve();
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private lockRelease: (() => void) | undefined;
  private stopped = false;
  // doc-03: `notice quota.warning` is deduped client-side "once per crossing" — approximated here
  // as once per connection (reset on every fresh `welcome`), since the server doesn't send an
  // explicit "back under the threshold" signal to key a real crossing off of.
  private quotaWarningShown = false;
  // Overflow from a `hello.pending` capped at 50 (HelloMsgSchema's own max) — flushed as ordinary
  // `append` chunks once `welcome` confirms the connection.
  private leftoverPending: Event[] = [];
  // Set while a local-ahead resume (class doc) is in flight — `expected` names the missing
  // committed tail's `{id -> seq}`; `acked` accumulates matching `ack` results (possibly across
  // more than one `ack` frame, symmetric with `SyncService.uploadEvents()`'s own accumulation).
  // `undefined` the rest of the time, including the entire non-diverged common case.
  private resumeState: { expected: Map<string, number>; acked: Map<string, number> } | undefined;
  // Local edits made WHILE a resume is in flight (T11b round 2) — held here instead of sent
  // immediately (an immediate send's own ack could land mixed into the same frame resume
  // verification is reading) and flushed, in order, once the resume completes.
  private heldLocalAppends: Event[] = [];
  private unsubscribeLocalAppend: (() => void) | undefined;
  private unsubscribeReconnect: (() => void) | undefined;

  private readonly connectionStateState = signal<SessionConnectionState>('connecting');
  private readonly quotaState = signal<QuotaInfo | null>(null);
  private readonly pendingCountState = signal(0);

  readonly connectionState: Signal<SessionConnectionState> = this.connectionStateState.asReadonly();
  readonly quota: Signal<QuotaInfo | null> = this.quotaState.asReadonly();
  readonly pendingCount: Signal<number> = this.pendingCountState.asReadonly();

  constructor(options: StreamSyncSessionOptions) {
    this.streamId = options.streamId;
    this.characterId = options.streamId.startsWith('char:')
      ? options.streamId.slice('char:'.length)
      : options.streamId;
    this.store = options.store;
    this.eventsRepository = options.eventsRepository;
    this.toast = options.toast;
    this.webSocketFactory = options.webSocketFactory;
    this.backoff = new Backoff(options.rng);
    this.wsUrlFn = options.wsUrlFn ?? ((id) => wsUrl(id));
    this.onApplied = options.onApplied;
    this.onBye = options.onBye;
    this.onDivergence = options.onDivergence;
    this.locksApi = options.locks ?? navigator.locks;
    this.reconnectSignals = new ReconnectSignals({
      window: options.window,
      document: options.document,
    });
    this.unsubscribeReconnect = this.reconnectSignals.onTrigger(() => this.onReconnectTrigger());
    this.unsubscribeLocalAppend = this.store.onLocalAppend((streamId, events) => {
      if (streamId === this.streamId) void this.onLocalAppend(events);
    });
  }

  /** Acquires this stream's Web Lock `hk:sync:<streamId>` (falling back to "assume granted" when
   * the Web Locks API is absent, mirroring `LeaderService`), seeds `pendingCount` from storage,
   * then opens the socket. Resolves once the lock is held — NOT once connected; connection itself
   * is driven from here on by the socket's own callbacks and the reconnect loop. */
  async start(): Promise<void> {
    await this.acquireLock();
    if (this.stopped) {
      // `stop()` ran while the lock grant was still pending — its own `releaseLock()` call was a
      // no-op back then (`this.lockRelease` wasn't set yet, since the lock manager's callback
      // above is what sets it), so the lock JUST granted to us here would otherwise be held
      // forever (`hk:sync:<streamId>` never released, permanently blocking every future session
      // for this stream). Release it now instead.
      this.releaseLock();
      return;
    }
    await this.refreshPendingCount();
    this.connect();
  }

  /** Tears this session down completely: cancels any pending reconnect timer, closes the socket,
   * unsubscribes from `onLocalAppend`/`ReconnectSignals`, and releases the Web Lock. Idempotent —
   * a `bye` frame's own handling calls this internally, and `SyncService` may also call it
   * directly during a leader-loss/logout sweep. */
  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    if (this.reconnectTimer !== undefined) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    this.unsubscribeLocalAppend?.();
    this.unsubscribeLocalAppend = undefined;
    this.unsubscribeReconnect?.();
    this.unsubscribeReconnect = undefined;
    this.reconnectSignals.destroy();
    this.socket?.close();
    this.socket = undefined;
    this.connectionStateState.set('closed');
    this.releaseLock();
  }

  // --- connection lifecycle ------------------------------------------------------------------

  private connect(): void {
    if (this.stopped) return;
    this.connectionStateState.set('connecting');
    const url = this.wsUrlFn(this.characterId);
    this.socket = new SyncSocket({
      url,
      webSocketFactory: this.webSocketFactory,
      onOpen: () => void this.sendHello(),
      onMessage: (message) => this.enqueue(message),
      onClose: () => this.handleClose(),
      onError: () => undefined,
      // `SyncSocket` already closed the socket on a protocol error — the resulting `onClose`
      // drives the same reconnect-with-backoff path a network-level close would.
      onProtocolError: () => undefined,
    });
  }

  /** No ack-timeout policy in v1 (task-8-brief.md): the server acks pending events reliably, or
   * the socket dies and `handleClose`'s backoff reconnect re-sends a fresh `hello` (with every
   * still-pending event re-included — doc-03's dedupe-by-id rule makes that idempotent). */
  private handleClose(): void {
    this.socket = undefined;
    if (this.stopped) return;
    this.connectionStateState.set('closed');
    const delay = this.backoff.next();
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.connect();
    }, delay);
  }

  private onReconnectTrigger(): void {
    if (this.stopped) return;
    this.backoff.reset();
    if (this.connectionStateState() !== 'closed') return; // already open/connecting — nothing to do
    if (this.reconnectTimer !== undefined) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    this.connect();
  }

  /** Fix-wave review, Minor finding 3: `hello.pending` must respect the SAME ≤50-events-AND-
   * ≤128KB-per-frame cap doc-03 puts on every `append` frame — capping by COUNT alone (the
   * pre-fix `pending.slice(0, MAX_APPEND_EVENTS)`) let 50 sufficiently large pending events push a
   * single `hello` past `WS_MESSAGE_BYTES_MAX`, which `SyncSocket.send` then throws for
   * synchronously, INSIDE `onOpen` — with nothing catching it there, the session never sends a
   * `hello` at all and sits stuck 'connecting' forever. `chunkEventsForAppend` already computes
   * exactly the byte-safe-AND-count-safe prefix this needs (its own doc): reusing it here means
   * `hello.pending` carries that first chunk verbatim, and everything after it becomes
   * `leftoverPending` — the SAME overflow field/flush-after-`welcome` mechanism the count-only cap
   * already used, just now fed a byte-safe (not just count-safe) prefix. */
  private async sendHello(): Promise<void> {
    if (this.stopped || !this.socket) return;
    const rows = await this.eventsRepository.byStream(this.streamId);
    const committed = rows.filter((e) => e.seq !== undefined);
    const pending = rows.filter((e) => e.seq === undefined);
    const lastSeq = committed.length > 0 ? (committed[committed.length - 1].seq ?? 0) : 0;

    const helloPending = chunkEventsForAppend(pending)[0] ?? [];

    const hello: HelloMsg = {
      t: 'hello',
      rid: uuidv7(),
      proto: PROTO_VERSION,
      app: APP_VERSION,
      streams: [{ id: this.streamId, lastSeq }],
      have: [],
      pending: helloPending,
    };
    this.leftoverPending = pending.slice(helloPending.length);
    this.send(hello);
  }

  // --- inbound frame handling — STRICTLY in arrival order -------------------------------------

  /** Chains `message`'s handling onto the tail of every prior frame's — never runs two frames'
   * handlers concurrently, and one frame's thrown/rejected handling never blocks the next frame
   * from still being processed (only logged). */
  private enqueue(message: ServerMessage): void {
    this.msgQueue = this.msgQueue
      .catch(() => undefined)
      .then(() => this.handleFrame(message))
      .catch((err: unknown) => {
        console.error('[sync] frame handling failed', this.streamId, message.t, err);
      });
  }

  private async handleFrame(message: ServerMessage): Promise<void> {
    if (this.stopped) return;
    switch (message.t) {
      case 'welcome':
        await this.handleWelcome(message);
        return;
      case 'events':
        await this.handleEvents(message);
        return;
      case 'ack':
        await this.handleAck(message);
        return;
      case 'reject':
        await this.handleReject(message);
        return;
      case 'notice':
        this.handleNotice(message);
        return;
      case 'bye':
        this.handleBye(message);
        return;
      default:
        // members/blob.* frames — out of this task's scope (task-8-brief.md).
        return;
    }
  }

  private async handleWelcome(message: Extract<ServerMessage, { t: 'welcome' }>): Promise<void> {
    this.connectionStateState.set('open');
    this.backoff.reset();
    this.quotaWarningShown = false;
    const streamWelcome = message.streams.find((s) => s.id === this.streamId);
    this.quotaState.set(streamWelcome?.quota ?? null);

    const headSeq = streamWelcome?.headSeq ?? 0;
    const rows = await this.eventsRepository.byStream(this.streamId);
    const committed = rows.filter((e) => e.seq !== undefined);
    const localHead = committed.length > 0 ? (committed[committed.length - 1].seq ?? 0) : 0;

    if (localHead > headSeq) {
      // Local-ahead divergence — see class doc's "Local-ahead resume" section. Deliberately does
      // NOT flush `leftoverPending` here: that only happens once resume verification succeeds
      // (`handleResumeAck`) — mixing the two would route a plain pending-flush ack into resume
      // verification (or vice versa) and misclassify it either way.
      const missingTail = committed.filter((e) => (e.seq ?? 0) > headSeq);
      this.beginResume(missingTail);
      return;
    }

    if (this.leftoverPending.length > 0) {
      const leftover = this.leftoverPending;
      this.leftoverPending = [];
      await this.sendAppendChunks(leftover);
    }
  }

  /** Sends `missingTail` (local committed events the server doesn't have yet, in order) as chunked
   * `append` frames over this session's own open socket, and arms `resumeState` so the resulting
   * `ack`(s) are routed to `handleResumeAck` instead of the normal `commitPending` path — these
   * ids are already locally COMMITTED, not pending rows, so `CharacterStore.commitPending` would
   * reject them outright (no matching pending row). A send failure (including a poisoned single
   * event this device can no longer resend — unlike a genuinely PENDING row, a committed one can't
   * simply be dropped) is treated as an immediate divergence, same as a verification mismatch. */
  private beginResume(missingTail: readonly Event[]): void {
    this.resumeState = {
      expected: new Map(missingTail.map((e) => [e.id, e.seq!])),
      acked: new Map(),
    };
    for (const chunk of chunkEventsForAppend(missingTail)) {
      try {
        this.send({ t: 'append', rid: uuidv7(), events: chunk });
      } catch {
        // `SyncSocketOversizeError` (or anything else `send` can throw) — can't resend this
        // chunk's committed history; let the divergence path (server wins) sort it out.
        this.failDivergence();
        return;
      }
    }
  }

  /** Accumulates `ack` results BELONGING TO THE RESUME (already partitioned by `handleAck` — see
   * its own doc) while it's in flight, possibly across more than one `ack` frame, symmetric with
   * `SyncService.uploadEvents()`. Completion is SET EQUALITY: every id in `expected` must have a
   * recorded ack — never a raw count (`acked.size`), which a caller passing anything other than an
   * already-id-scoped subset could corrupt (T11b round 2 finding: a mixed `hello.pending` ack in
   * the same frame previously inflated a plain `size` check into firing early on incomplete data).
   * A full match proceeds into normal steady state (flushing anything held while resuming — the
   * local-append buffer first, then any `hello.pending` overflow); any mismatch is a genuine
   * divergence. */
  private async handleResumeAck(results: { id: string; seq: number }[]): Promise<void> {
    const state = this.resumeState;
    if (!state) return;
    for (const result of results) {
      if (state.expected.has(result.id)) state.acked.set(result.id, result.seq);
    }
    const complete = [...state.expected.keys()].every((id) => state.acked.has(id));
    if (!complete) return; // still waiting on more of the expected ids

    const matches = [...state.expected].every(([id, seq]) => state.acked.get(id) === seq);
    this.resumeState = undefined;
    if (!matches) {
      this.failDivergence();
      return;
    }

    this.onApplied?.(); // the server's view of this stream just changed — wake follower tabs
    if (this.heldLocalAppends.length > 0) {
      const held = this.heldLocalAppends;
      this.heldLocalAppends = [];
      await this.sendAppendChunks(held);
    }
    if (this.leftoverPending.length > 0) {
      const leftover = this.leftoverPending;
      this.leftoverPending = [];
      await this.sendAppendChunks(leftover);
    }
  }

  /** A local-ahead resume attempt failed verification (or couldn't even send) — tears this session
   * down completely and hands off to `onDivergence` (`SyncService`'s server-wins `restore()`, which
   * overwrites local storage — including anything still sitting in `heldLocalAppends` — with the
   * server's own truth, so that buffer is simply dropped here rather than flushed). */
  private failDivergence(): void {
    this.resumeState = undefined;
    this.heldLocalAppends = [];
    this.stop();
    this.onDivergence?.();
  }

  private async handleEvents(message: Extract<ServerMessage, { t: 'events' }>): Promise<void> {
    if (message.stream !== this.streamId) return;
    try {
      await this.store.applyServerCommit(this.streamId, message.events);
      await this.refreshPendingCount();
      this.onApplied?.();
    } catch (err) {
      if (err instanceof SyncGapError) {
        await this.sendHello();
        return;
      }
      throw err;
    }
  }

  /** T11b round 2: when a resume is in flight, `results` is partitioned by membership in
   * `resumeState.expected` FIRST — an id can only ever mean one thing (a resume-tail id, or an
   * ordinary pending row), never both, but a single `ack` frame can legitimately carry BOTH kinds
   * mixed together (doc-03's fixed emission order puts a `hello.pending` ack in the same window a
   * resume's own acks can arrive in). Matching ids go to resume verification; every other id goes
   * through the ordinary `commitPending` path, unconditionally — that path never depended on the
   * resume's own outcome (resume never writes storage on success; on failure the whole stream gets
   * overwritten by `restore()` regardless of what else this frame committed). */
  private async handleAck(message: Extract<ServerMessage, { t: 'ack' }>): Promise<void> {
    if (this.resumeState) {
      const state = this.resumeState;
      const resumeResults = message.results.filter((r) => state.expected.has(r.id));
      const otherResults = message.results.filter((r) => !state.expected.has(r.id));
      if (resumeResults.length > 0) await this.handleResumeAck(resumeResults);
      if (otherResults.length > 0) await this.commitPendingAck(otherResults);
      return;
    }
    await this.commitPendingAck(message.results);
  }

  private async commitPendingAck(results: { id: string; seq: number }[]): Promise<void> {
    try {
      await this.store.commitPending(this.streamId, results);
      await this.refreshPendingCount();
      this.onApplied?.();
    } catch (err) {
      if (err instanceof SyncGapError) {
        await this.sendHello();
        return;
      }
      throw err;
    }
  }

  /** T11b round 2: symmetric partitioning to `handleAck`'s own — a reject frame can equally mix a
   * resume-tail id with an ordinary pending id. A reject touching ANY resume id is a definitive
   * "this can't succeed" signal for the whole resume (not something `dropPending` could act on
   * anyway — these ids are COMMITTED rows, not pending ones; it would silently no-op), so that
   * triggers `failDivergence` outright; any OTHER (non-resume) rejected id still goes through the
   * ordinary `dropPending` path regardless. */
  private async handleReject(message: Extract<ServerMessage, { t: 'reject' }>): Promise<void> {
    for (const result of message.results) {
      this.toast.show(REJECT_TOAST_KEYS[result.code]);
    }

    if (this.resumeState) {
      const state = this.resumeState;
      const resumeRejected = message.results.some((r) => state.expected.has(r.id));
      const otherIds = message.results.filter((r) => !state.expected.has(r.id)).map((r) => r.id);
      if (resumeRejected) this.failDivergence();
      if (otherIds.length > 0) {
        await this.store.dropPending(this.streamId, otherIds);
        await this.refreshPendingCount();
      }
      return;
    }

    const ids = message.results.map((r) => r.id);
    await this.store.dropPending(this.streamId, ids);
    await this.refreshPendingCount();
  }

  private handleNotice(message: Extract<ServerMessage, { t: 'notice' }>): void {
    if (message.key !== 'quota.warning') return;
    if (this.quotaWarningShown) return;
    this.quotaWarningShown = true;
    this.toast.show('sync.quota.warning', message.params);
  }

  private handleBye(message: Extract<ServerMessage, { t: 'bye' }>): void {
    const reason = message.reason;
    this.stop();
    this.onBye?.(reason);
  }

  // --- outbound: local appends -----------------------------------------------------------------

  private async onLocalAppend(events: Event[]): Promise<void> {
    await this.refreshPendingCount();
    if (this.resumeState) {
      // T11b round 2: hold — sending now would land this append's own ack mixed into the same
      // frame resume verification is trying to interpret (see class doc's "ID-scoped ack/reject
      // routing" section). Flushed, in order, from `handleResumeAck`'s success path once the
      // resume completes.
      this.heldLocalAppends.push(...events);
      return;
    }
    if (this.connectionStateState() !== 'open' || !this.socket) return; // flushed via next hello
    await this.sendAppendChunks(events);
  }

  private async sendAppendChunks(events: readonly Event[]): Promise<void> {
    const chunks = chunkEventsForAppend(events);
    for (const chunk of chunks) {
      try {
        this.send({ t: 'append', rid: uuidv7(), events: chunk });
      } catch (err) {
        if (err instanceof SyncSocketOversizeError && chunk.length === 1) {
          // A single event whose own JSON exceeds the frame budget — a poisoned event, not a
          // chunking bug (see `chunkEventsForAppend`'s doc). Drop it and keep going with the rest.
          await this.store.dropPending(this.streamId, [chunk[0].id]);
          await this.refreshPendingCount();
          this.toast.show('sync.append.poisoned-event');
          continue;
        }
        throw err;
      }
    }
  }

  private send(message: ClientMessage): void {
    this.socket?.send(message);
  }

  private async refreshPendingCount(): Promise<void> {
    const rows = await this.eventsRepository.byStream(this.streamId);
    this.pendingCountState.set(rows.filter((e) => e.seq === undefined).length);
  }

  // --- Web Lock --------------------------------------------------------------------------------

  private async acquireLock(): Promise<void> {
    const locks = this.locksApi;
    if (!locks) return; // absent-API fallback — assume granted, mirrors LeaderService.
    await new Promise<void>((resolveAcquire) => {
      void locks.request(
        `${LOCK_PREFIX}${this.streamId}`,
        { mode: 'exclusive' },
        () =>
          new Promise<void>((resolveHold) => {
            this.lockRelease = resolveHold;
            resolveAcquire();
          }),
      );
    });
  }

  private releaseLock(): void {
    this.lockRelease?.();
    this.lockRelease = undefined;
  }
}
