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

  private async sendHello(): Promise<void> {
    if (this.stopped || !this.socket) return;
    const rows = await this.eventsRepository.byStream(this.streamId);
    const committed = rows.filter((e) => e.seq !== undefined);
    const pending = rows.filter((e) => e.seq === undefined);
    const lastSeq = committed.length > 0 ? (committed[committed.length - 1].seq ?? 0) : 0;

    const hello: HelloMsg = {
      t: 'hello',
      rid: uuidv7(),
      proto: PROTO_VERSION,
      app: APP_VERSION,
      streams: [{ id: this.streamId, lastSeq }],
      have: [],
      pending: pending.slice(0, MAX_APPEND_EVENTS),
    };
    this.leftoverPending = pending.slice(MAX_APPEND_EVENTS);
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

    if (this.leftoverPending.length > 0) {
      const leftover = this.leftoverPending;
      this.leftoverPending = [];
      await this.sendAppendChunks(leftover);
    }
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

  private async handleAck(message: Extract<ServerMessage, { t: 'ack' }>): Promise<void> {
    try {
      await this.store.commitPending(this.streamId, message.results);
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

  private async handleReject(message: Extract<ServerMessage, { t: 'reject' }>): Promise<void> {
    const ids = message.results.map((r) => r.id);
    await this.store.dropPending(this.streamId, ids);
    await this.refreshPendingCount();
    for (const result of message.results) {
      this.toast.show(REJECT_TOAST_KEYS[result.code]);
    }
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
