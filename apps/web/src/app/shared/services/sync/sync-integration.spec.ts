import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { createContentIndex, reduce, type Facts, type SystemRules } from '@hk/engine';
import { PACK_ID, PACK_VERSION } from '@hk/content/version';
import {
  PROTO_VERSION,
  parseClientMessage,
  parsePack,
  type AppendMsg,
  type Event,
  type HelloMsg,
  type Pack,
  type RejectCode,
  type ServerMessage,
} from '@hk/protocol';
import { provideTransloco, type TranslocoLoader } from '@jsverse/transloco';
import { of } from 'rxjs';
import { APP_VERSION } from '@app/version';
import { uuidv7 } from '@shared/helpers/uuid';
import { StoragePersistService } from '@shared/services/pwa/storage-persist.service';
import { EventsRepository } from '@shared/services/storage/events.repository';
import { HK_DB_NAME, HkDb } from '@shared/services/storage/dexie.db';
import { PackStore } from '@shared/stores/pack.store';
import { CharacterStore } from '@shared/stores/character.store';
import { SyncSocket, type WebSocketFactory, type WebSocketLike } from './socket';
import {
  chunkEventsForAppend,
  StreamSyncSession,
  type StreamSyncSessionToastPort,
} from './stream-sync-session';

/**
 * Task 10 — a scripted, end-to-end unit test proving the whole client sync stack (T6's
 * `CharacterStore` sync seam, T7/T8's `StreamSyncSession`/`SyncSocket`, and the upload/restore
 * flows `SyncService` — T9 — drives) actually interoperates with doc-03's protocol, not just with
 * itself.
 *
 * ## Layer chosen, and why
 *
 * TWO independent `CharacterStore` + `EventsRepository` stacks ("devices"), each its own
 * `TestBed`-configured environment injector pointed at its own `HkDb` (a distinct fake-indexeddb
 * database name per device — `dexie.db.ts`'s `HK_DB_NAME` injection token, defaulting to the real
 * app's `'hk-db'`, purely so this harness can provide a second, genuinely separate database name
 * without duplicating `HkDb`'s schema). `TestBed` itself is a process-wide singleton that can only hold
 * ONE active configuration at a time, so `configureDevice()` below calls
 * `TestBed.resetTestingModule()` between devices — but the object graph `TestBed.inject()` hands
 * back (the `CharacterStore`/`EventsRepository` instances themselves) is ordinary, already-
 * constructed JS objects from then on: resetting `TestBed`'s CURRENT configuration doesn't
 * retroactively invalidate an instance obtained earlier, so device A's store keeps working
 * unmodified once device B's environment is configured. This is exactly `stream-sync-session.spec.
 * ts`/`character.store.spec.ts`'s own "fake socket + REAL store + fake-indexeddb" seam, just
 * instantiated twice.
 *
 * `SyncService` itself is NOT instantiated (twice or otherwise) — its constructor wires an
 * `effect()` against `AuthService`/`LeaderService` and reaches `apiJson`/`fetch` for
 * reconciliation, none of which this harness needs or wants to fake out twice over. Per
 * task-10-brief.md's own allowance, this test drives the upload/restore ONE-SHOT-SOCKET layer
 * directly (`uploadCommitted`/`restoreStream` below, each a trimmed, faithful copy of
 * `SyncService.uploadEvents`/`restore`'s own body — same `SyncSocket`, same `chunkEventsForAppend`,
 * same hello/welcome/ack/events handshake) and constructs `StreamSyncSession` directly for the
 * live phase — proving the REAL integration seam (`CharacterStore` <-> `StreamSyncSession` <->
 * `SyncSocket` <-> the wire) without `SyncService`'s own DI-entangled orchestration on top.
 *
 * ## The fake server's rule coverage (doc-03, read in full for this task)
 *
 * `FakeSyncServer` below (~100 lines) implements: `welcome` before any catch-up `events` frame
 * before any `ack`/`reject` for `hello.pending` (the exact binding order `stream-actor.ts`'s
 * `hello` uses); strictly increasing per-stream `seq` assignment; dedupe-by-id (an already-
 * committed id is acked with its EXISTING seq, nothing re-stored); `txId` group atomicity (any
 * rejected member drags every other member of the same group down to `invalid`, mirroring
 * `stream-actor.ts`'s `resolveTxGroups`); fan-out of newly committed events to every OTHER
 * connection subscribed to the stream (never an echo back to the sender, which gets `ack`/`reject`
 * instead); and catch-up paging at 200 events/frame. It does NOT implement quota/permission
 * rejection, `members`/`presence`/blob frames, or multi-connection-per-device fan-out — all out of
 * this task's scope (doc-03 constrains character streams to owner-only direct sockets; Phase 2 has
 * no quota-exhaustion scenario in this brief).
 *
 * Every inbound frame is parsed with the REAL `parseClientMessage` (`FakeSyncServer.receive`
 * below) — a frame that fails that check THROWS, failing the test outright rather than being
 * silently dropped. That is this harness's client-conformance assertion: if `StreamSyncSession`/
 * `SyncService`'s upload/restore code ever sent a frame the real `@hk/protocol` schema rejects,
 * this test would fail here, not downstream. No such mismatch surfaced while building this test —
 * every frame the client code sent this harness validated cleanly against `ClientMessageSchema`.
 *
 * ## Scenario
 *
 * One flowing `it()` (not a `describe` with shared state) — the whole point is one continuous,
 * causally-ordered story across two devices and one server, so splitting it into independent
 * `it()`s would either duplicate the entire setup per step or reintroduce exactly the
 * shared-mutable-state hazard `it()` isolation exists to avoid. Steps are labelled (a)-(h) inline,
 * matching task-10-brief.md's own list.
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..', '..', '..', '..', '..');

function readPack(path: string): Pack {
  const raw: unknown = JSON.parse(readFileSync(path, 'utf8'));
  const result = parsePack(raw);
  if (!result.ok) {
    throw new Error(
      `fixture pack at ${path} failed validation: ${result.issues.map((i) => i.message).join('; ')}`,
    );
  }
  return result.pack;
}

const corePack = readPack(
  join(repoRoot, 'packages/content/dist/packs', PACK_ID, PACK_VERSION, 'pack.json'),
);

// The exact `SystemRules` projection `CharacterStore.systemRules()` computes from the loaded core
// pack — used only by this spec's OWN final `reduce()` call (scenario (h)), so its independently
// reduced facts are computed under the identical rules every store instance already uses, not by
// coincidence of both leaving rules `undefined`.
const systemRules: SystemRules = (() => {
  const system = createContentIndex([corePack]).system();
  return { restRules: system.restRules, hpRules: system.hpRules };
})();

class StubLoader implements TranslocoLoader {
  getTranslation() {
    return of({});
  }
}

/** A payload value the fake server treats as "reject this — code invalid" (see `FakeSyncServer.
 * append`'s `isPoisoned` check). Deliberately NOT something the client's own `parseEvent` would
 * ever refuse (`character.renamed`'s payload is a plain short string) — a real client can only
 * ever be schema-poisoned server-side by a SERVER-side rule it has no way to pre-check, which is
 * exactly what this simulates (the real `invalid` code doc-03 defines covers this family of "the
 * server refused it" outcomes, not literally identical trigger conditions to the production
 * `validateEvent` checks — this harness invents its own trigger deliberately, documented here). */
const POISON_NAME = '__sync_poison__';

function isPoisoned(event: Event): boolean {
  return (
    event.type === 'character.renamed' && (event.payload as { name?: unknown }).name === POISON_NAME
  );
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// --- fake WebSocket + scripted fake server -----------------------------------------------------

type Handler = ((event: unknown) => void) | null;

/** One simulated client connection. Auto-"connects" on a microtask (mirrors a real `WebSocket`'s
 * async handshake) rather than requiring the test to manually fire `emitOpen()` for every socket
 * this harness opens (there are many: two long-lived sessions plus one-shot upload/restore
 * sockets, each reconnect) — `waitFor` below is what the test actually synchronizes on. */
class FakeClientSocket implements WebSocketLike {
  onopen: (() => void) | null = null;
  onclose: Handler = null;
  onerror: Handler = null;
  onmessage: Handler = null;
  closed = false;

  constructor(
    readonly url: string,
    private readonly server: FakeSyncServer,
    readonly label: string,
  ) {
    this.server.connect(this);
    queueMicrotask(() => {
      if (this.closed) return;
      this.onopen?.();
    });
  }

  send(data: string): void {
    if (this.closed) return;
    const parsed: unknown = JSON.parse(data);
    this.server.receive(this, parsed);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.server.disconnect(this);
  }

  /** server -> this client. */
  deliver(message: ServerMessage): void {
    if (this.closed) return;
    this.onmessage?.({ data: JSON.stringify(message) });
  }
}

/** Minimal `window`/`document`-shaped stand-in for `StreamSyncSession`'s `ReconnectSignals` —
 * mirrors `stream-sync-session.spec.ts`'s own fake exactly, so neither device's session attaches
 * real listeners to jsdom's shared global `window`/`document` (this scenario never dispatches
 * `online`/`visibilitychange`, so this is purely isolation, not behavior this test exercises). */
class FakeTarget {
  private readonly listeners = new Map<string, Set<(e?: unknown) => void>>();
  visibilityState: 'visible' | 'hidden' = 'visible';

  addEventListener(type: string, listener: (e?: unknown) => void): void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(listener);
  }

  removeEventListener(type: string, listener: (e?: unknown) => void): void {
    this.listeners.get(type)?.delete(listener);
  }
}

function socketFactory(server: FakeSyncServer, label: string): WebSocketFactory {
  return class extends FakeClientSocket {
    constructor(url: string) {
      super(url, server, label);
    }
  };
}

interface ConnInfo {
  readonly label: string;
  readonly subscribedStreams: Set<string>;
}

interface StreamState {
  readonly events: Event[]; // committed, ascending seq — this IS the server's ground truth.
}

const CATCH_UP_PAGE_SIZE = 200;

/** The scripted doc-03 double — see this file's header comment for its rule coverage. */
class FakeSyncServer {
  private readonly streams = new Map<string, StreamState>();
  private readonly conns = new Map<FakeClientSocket, ConnInfo>();
  private readonly dropNextFanoutFor = new Set<string>();

  connect(ws: FakeClientSocket): void {
    this.conns.set(ws, { label: ws.label, subscribedStreams: new Set() });
  }

  disconnect(ws: FakeClientSocket): void {
    this.conns.delete(ws);
  }

  eventsFor(streamId: string): Event[] {
    return [...this.streamState(streamId).events];
  }

  /** Test hook (scenario (g)): the NEXT fan-out `events` frame this server would otherwise
   * deliver to `label`'s live connection is silently dropped once — simulating a frame lost on
   * the wire, which is exactly what doc-03's own gap-detection contract (`seq != lastSeq + 1` ->
   * re-`hello`) exists to recover from. */
  dropNextFanoutTo(label: string): void {
    this.dropNextFanoutFor.add(label);
  }

  /** Client -> server. Validates with the REAL `parseClientMessage` — see this file's header
   * comment: a frame that fails this IS the client-conformance assertion, so it throws rather
   * than silently dropping. */
  receive(ws: FakeClientSocket, raw: unknown): void {
    const parsed = parseClientMessage(raw);
    if (!parsed.ok) {
      throw new Error(
        `sync-integration harness: client sent a frame that failed parseClientMessage — ` +
          `${parsed.issues.map((i) => `${i.path}: ${i.message}`).join('; ')}`,
      );
    }
    const msg = parsed.message;
    if (msg.t === 'hello') this.handleHello(ws, msg);
    else if (msg.t === 'append') this.handleAppend(ws, msg);
    // subscribe/unsubscribe/blob.*/presence: Phase-3 scope, no-op here too (mirrors
    // `StreamActor.handleMessage`'s own no-op branch).
  }

  private streamState(streamId: string): StreamState {
    let state = this.streams.get(streamId);
    if (!state) {
      state = { events: [] };
      this.streams.set(streamId, state);
    }
    return state;
  }

  private handleHello(ws: FakeClientSocket, msg: HelloMsg): void {
    const info = this.conns.get(ws);
    if (!info) return;

    const welcomeStreams = msg.streams.map((ref) => {
      info.subscribedStreams.add(ref.id);
      const head = this.streamState(ref.id).events.length;
      return {
        id: ref.id,
        headSeq: head,
        quota: { bytesUsed: 0, bytesMax: 10_000_000, eventCount: head },
      };
    });
    ws.deliver({
      t: 'welcome',
      rid: msg.rid,
      serverTime: new Date().toISOString(),
      streams: welcomeStreams,
    });

    for (const ref of msg.streams) {
      const missing = this.streamState(ref.id).events.filter((e) => (e.seq ?? 0) > ref.lastSeq);
      for (const page of chunk(missing, CATCH_UP_PAGE_SIZE)) {
        ws.deliver({ t: 'events', stream: ref.id, events: page });
      }
    }

    if (msg.pending.length > 0) {
      const byStream = new Map<string, Event[]>();
      for (const event of msg.pending) {
        const list = byStream.get(event.stream) ?? [];
        list.push(event);
        byStream.set(event.stream, list);
      }
      for (const [streamId, events] of byStream) this.append(ws, streamId, msg.rid, events);
    }
  }

  private handleAppend(ws: FakeClientSocket, msg: AppendMsg): void {
    const streamId = msg.events[0]?.stream;
    if (!streamId) return;
    this.append(ws, streamId, msg.rid, msg.events);
  }

  /** doc-03's actual append pipeline, trimmed to what this harness exercises: dedupe-by-id (ack
   * existing seq), `txId` group atomicity, strictly-increasing seq assignment, fan-out to every
   * OTHER connection subscribed to the stream. */
  private append(
    ws: FakeClientSocket,
    streamId: string,
    rid: string,
    events: readonly Event[],
  ): void {
    type Outcome =
      | { kind: 'existing'; id: string; seq: number }
      | { kind: 'new'; event: Event }
      | { kind: 'rejected'; id: string; code: RejectCode; message: string };

    const state = this.streamState(streamId);
    const byId = new Map(state.events.map((e) => [e.id, e]));

    const outcomes: Outcome[] = events.map((event) => {
      const existing = byId.get(event.id);
      if (existing?.seq !== undefined) return { kind: 'existing', id: event.id, seq: existing.seq };
      if (isPoisoned(event)) {
        return {
          kind: 'rejected',
          id: event.id,
          code: 'invalid',
          message: 'fake-server: poisoned payload',
        };
      }
      return { kind: 'new', event };
    });

    // txId atomicity (doc-03 §Ordering: "commits them contiguously or rejects all") — any
    // rejected member drags every OTHER member of the same group down to `invalid` too.
    const byTx = new Map<string, number[]>();
    events.forEach((event, i) => {
      if (!event.txId) return;
      const list = byTx.get(event.txId) ?? [];
      list.push(i);
      byTx.set(event.txId, list);
    });
    for (const [txId, indexes] of byTx) {
      if (!indexes.some((i) => outcomes[i]?.kind === 'rejected')) continue;
      for (const i of indexes) {
        const outcome = outcomes[i];
        if (!outcome || outcome.kind === 'rejected') continue;
        const id = outcome.kind === 'existing' ? outcome.id : outcome.event.id;
        outcomes[i] = {
          kind: 'rejected',
          id,
          code: 'invalid',
          message: `fake-server: txId ${txId} group rejected`,
        };
      }
    }

    const acked: { id: string; seq: number }[] = [];
    const rejected: { id: string; code: RejectCode; message: string }[] = [];
    const toCommit: Event[] = [];
    for (const outcome of outcomes) {
      if (outcome.kind === 'existing') acked.push({ id: outcome.id, seq: outcome.seq });
      // `RejectResultSchema`/`AckResultSchema` are `z.strictObject` — the discriminant `kind` tag
      // must NOT leak into the wire frame (an extra key fails the client's own `parseServerMessage`
      // and protocol-error-closes the socket), so every field is picked explicitly here rather
      // than spreading `outcome` itself.
      else if (outcome.kind === 'rejected')
        rejected.push({ id: outcome.id, code: outcome.code, message: outcome.message });
      else toCommit.push(outcome.event);
    }

    let seq = state.events.length;
    const committed: Event[] = [];
    for (const event of toCommit) {
      seq += 1;
      const withSeq: Event = { ...event, seq };
      state.events.push(withSeq);
      committed.push(withSeq);
      acked.push({ id: withSeq.id, seq });
    }

    if (acked.length > 0) ws.deliver({ t: 'ack', rid, results: acked });
    if (rejected.length > 0) ws.deliver({ t: 'reject', rid, results: rejected });
    if (committed.length > 0) this.fanOut(streamId, committed, ws);
  }

  private fanOut(streamId: string, events: Event[], sourceWs: FakeClientSocket): void {
    for (const [ws, info] of this.conns) {
      if (ws === sourceWs) continue;
      if (!info.subscribedStreams.has(streamId)) continue;
      if (this.dropNextFanoutFor.has(info.label)) {
        this.dropNextFanoutFor.delete(info.label);
        continue;
      }
      ws.deliver({ t: 'events', stream: streamId, events });
    }
  }
}

// --- upload / restore one-shot flows (trimmed copies of SyncService's own — see header comment) -

async function uploadCommitted(
  factory: WebSocketFactory,
  streamId: string,
  committed: readonly Event[],
): Promise<boolean> {
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
      url: 'ws://fake-sync-server/upload',
      webSocketFactory: factory,
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
      onMessage: (message) => {
        if (message.t === 'welcome') {
          if (expected.size === 0) {
            finish(true);
            return;
          }
          for (const eventChunk of chunkEventsForAppend(committed)) {
            socket.send({ t: 'append', rid: uuidv7(), events: eventChunk });
          }
          return;
        }
        if (message.t === 'ack') {
          for (const result of message.results) acked.set(result.id, result.seq);
          if (acked.size >= expected.size) {
            finish([...expected].every(([id, seq]) => acked.get(id) === seq));
          }
          return;
        }
        if (message.t === 'reject' || message.t === 'bye') finish(false);
      },
      onClose: () => finish(false),
      onError: () => finish(false),
      onProtocolError: () => finish(false),
    });
  });
}

async function restoreStream(factory: WebSocketFactory, streamId: string): Promise<Event[]> {
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
      url: 'ws://fake-sync-server/restore',
      webSocketFactory: factory,
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
      onMessage: (message) => {
        if (message.t === 'welcome') {
          headSeq = message.streams.find((s) => s.id === streamId)?.headSeq ?? 0;
          if (headSeq === 0) finish(true);
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

  if (!ok) throw new Error('sync-integration harness: restoreStream did not reach headSeq');
  collected.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
  return collected;
}

// --- device rig ----------------------------------------------------------------------------------

interface DeviceRig {
  readonly store: CharacterStore;
  readonly eventsRepository: EventsRepository;
  readonly db: HkDb;
  readonly toastShow: ReturnType<typeof vi.fn<StreamSyncSessionToastPort['show']>>;
  readonly toast: StreamSyncSessionToastPort;
}

/** Configures a fresh `TestBed` environment (see this file's header comment for why resetting
 * `TestBed` between devices is safe) pointed at its own named `HkDb`, and hands back the live
 * `CharacterStore`/`EventsRepository` instances — ordinary JS objects from this point on,
 * independent of whatever `TestBed` goes on to be configured with next. */
function configureDevice(dbName: string): DeviceRig {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideTransloco({
        config: {
          availableLangs: ['en', 'ru', 'uk'],
          defaultLang: 'en',
          fallbackLang: 'en',
          reRenderOnLangChange: true,
          prodMode: true,
        },
        loader: StubLoader,
      }),
      {
        provide: PackStore,
        useValue: { packs: signal([corePack]), ready: signal(true), corePack: signal(corePack) },
      },
      {
        provide: StoragePersistService,
        useValue: { requestPersist: vi.fn().mockResolvedValue(true) },
      },
      { provide: HK_DB_NAME, useValue: dbName },
    ],
  });

  const db = TestBed.inject(HkDb);
  const store = TestBed.inject(CharacterStore);
  const eventsRepository = TestBed.inject(EventsRepository);
  const toastShow = vi.fn<StreamSyncSessionToastPort['show']>();
  return { store, eventsRepository, db, toastShow, toast: { show: toastShow } };
}

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Polls `predicate` (a plain, synchronous read of a signal — no fake timers/zone needed, per
 * this file's header comment: the sessions never hit a reconnect/backoff path in this scenario)
 * until it's true, yielding one real macrotask tick between attempts so every microtask chain
 * `StreamSyncSession`'s `enqueue`d frame handling and every `fake-indexeddb` operation schedules
 * gets a chance to drain. Throws with `description` on timeout instead of leaving a silent
 * `expect` failure with no context about WHAT never converged. */
async function waitFor(
  predicate: () => boolean,
  description: string,
  maxTicks = 200,
): Promise<void> {
  for (let i = 0; i < maxTicks; i++) {
    if (predicate()) return;
    await tick();
  }
  throw new Error(`sync-integration harness: waitFor timed out — ${description}`);
}

function nameOf(facts: Facts | undefined): string | undefined {
  return facts?.name;
}

function factsEqual(a: Facts | undefined, b: Facts | undefined): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Convergence means more than "the name changed" — the SENDER's own pending row must also have
 * been acked (transitioning its local `facts.lastSeq`, which a still-pending/not-yet-committed
 * event never advances — `CharacterStore`'s own R-pf2 finding) before both devices' `facts` are
 * truly byte-identical, not just agreeing on one field. */
function bothConverged(a: DeviceRig, b: DeviceRig, expectedName: string): boolean {
  const factsA = a.store.facts();
  const factsB = b.store.facts();
  return (
    nameOf(factsA) === expectedName && nameOf(factsB) === expectedName && factsEqual(factsA, factsB)
  );
}

// --- the scenario ----------------------------------------------------------------------------

describe('two-device sync integration (doc-03, task-10-brief.md)', () => {
  it('converges two devices through one scripted fake server', async () => {
    // `navigator.locks` is absent in jsdom by default; deleting it explicitly (mirrors character.
    // store.spec.ts/stream-sync-session.spec.ts) makes BOTH devices' `LeaderService` fall back to
    // "assume sole leadership" — correct here, since two REAL devices each have their own Web
    // Locks scope; sharing jsdom's single `navigator` with a real lock manager would instead
    // wrongly serialize device A and device B against each other.
    delete (navigator as unknown as { locks?: unknown }).locks;

    const server = new FakeSyncServer();

    // (a) Device A creates a character and plays offline — plain committed-local rows, sync mode
    // off, exactly like every pre-Phase-2 `CharacterStore` caller.
    const deviceA = configureDevice('hk-db-device-a');
    const characterId = await deviceA.store.create('Aria', 'feminine');
    await deviceA.store.appendTx([
      { type: 'character.renamed', v: 1, payload: { name: 'Aria the Bold' } },
    ]);
    await deviceA.store.appendTx([
      { type: 'character.renamed', v: 1, payload: { name: 'Aria the Brave' } },
    ]);

    const offlineEvents = await deviceA.eventsRepository.byStream(characterId);
    expect(offlineEvents.every((e) => e.seq !== undefined)).toBe(true); // still offline: nothing pending

    // (b) A "logs in" -> upload. Mirrors SyncService.upload: enter sync mode BEFORE the round
    // trip, send every local-committed event as one-shot `append` frames, verify every ack.
    deviceA.store.enterSyncMode(characterId);
    const uploaded = await uploadCommitted(socketFactory(server, 'A'), characterId, offlineEvents);
    expect(uploaded).toBe(true);
    expect(server.eventsFor(characterId).map((e) => e.id)).toEqual(offlineEvents.map((e) => e.id));
    expect(server.eventsFor(characterId).map((e) => e.seq)).toEqual(
      offlineEvents.map((e) => e.seq),
    );

    const sessionA = new StreamSyncSession({
      streamId: characterId,
      store: deviceA.store,
      eventsRepository: deviceA.eventsRepository,
      toast: deviceA.toast,
      webSocketFactory: socketFactory(server, 'A'),
      wsUrlFn: () => 'ws://fake-sync-server/live',
      rng: () => 0.5,
      window: new FakeTarget(),
      document: new FakeTarget(),
    });
    await sessionA.start();
    await waitFor(
      () => sessionA.connectionState() === 'open',
      'device A live session never opened',
    );

    // (c) Device B "logs in" fresh -> restore. A brand-new local stream built purely from the
    // server's own event array, then loaded so its `facts` signal is live.
    const deviceB = configureDevice('hk-db-device-b');
    const restored = await restoreStream(socketFactory(server, 'B'), characterId);
    await deviceB.store.resetStreamFromServer(characterId, restored);
    await deviceB.store.load(characterId);
    deviceB.store.enterSyncMode(characterId);

    expect(deviceB.store.facts()).toEqual(deviceA.store.facts());

    const sessionB = new StreamSyncSession({
      streamId: characterId,
      store: deviceB.store,
      eventsRepository: deviceB.eventsRepository,
      toast: deviceB.toast,
      webSocketFactory: socketFactory(server, 'B'),
      wsUrlFn: () => 'ws://fake-sync-server/live',
      rng: () => 0.5,
      window: new FakeTarget(),
      document: new FakeTarget(),
    });
    await sessionB.start();
    await waitFor(
      () => sessionB.connectionState() === 'open',
      'device B live session never opened',
    );

    // (d) A appends while B is connected -> B receives the events frame -> B's facts update.
    await deviceA.store.appendTx([
      { type: 'character.renamed', v: 1, payload: { name: 'Aria Level 2' } },
    ]);
    await waitFor(
      () => bothConverged(deviceA, deviceB, 'Aria Level 2'),
      "device B never converged on device A's append (or A's own ack never landed)",
    );
    expect(deviceB.store.facts()).toEqual(deviceA.store.facts());

    // (e) B appends -> A receives.
    await deviceB.store.appendTx([
      { type: 'character.renamed', v: 1, payload: { name: 'Aria Level 3' } },
    ]);
    await waitFor(
      () => bothConverged(deviceA, deviceB, 'Aria Level 3'),
      "device A never converged on device B's append (or B's own ack never landed)",
    );
    expect(deviceA.store.facts()).toEqual(deviceB.store.facts());

    // (f) A poisoned event, inside a 2-event tx with an otherwise-valid sibling, is rejected
    // `invalid` — the fake server's txId-atomicity rule drags the WHOLE group down (doc-03
    // "commits contiguously or rejects all"), and the client drops both + re-derives. Facts must
    // land back EXACTLY where they were before this call — the reject must not corrupt anything.
    const beforePoisonFacts = deviceA.store.facts();
    await deviceA.store.appendTx([
      { type: 'character.renamed', v: 1, payload: { name: POISON_NAME } },
      { type: 'character.renamed', v: 1, payload: { name: 'Should Never Land' } },
    ]);
    await waitFor(
      () => deviceA.toastShow.mock.calls.some(([key]) => key === 'sync.reject.invalid'),
      'device A never saw a sync.reject.invalid toast for the poisoned tx group',
    );
    await waitFor(
      () => JSON.stringify(deviceA.store.facts()) === JSON.stringify(beforePoisonFacts),
      'device A facts never settled back to their pre-poison state',
    );
    expect(nameOf(deviceA.store.facts())).not.toBe(POISON_NAME);
    expect(nameOf(deviceA.store.facts())).not.toBe('Should Never Land');
    expect(deviceA.store.facts()).toEqual(beforePoisonFacts);
    expect(server.eventsFor(characterId).some((e) => isPoisoned(e))).toBe(false); // never stored

    // (g) Reconnect with a gap: the server withholds ONE fan-out frame from A, then A's session
    // detects the gap on the NEXT frame (seq != lastSeq + 1) and re-`hello`s (doc-03's own
    // contract — no socket close/backoff involved, exactly matching `StreamSyncSession.
    // handleEvents`'s `SyncGapError` -> `sendHello()` path) to catch up and heal.
    server.dropNextFanoutTo('A');
    await deviceB.store.appendTx([
      { type: 'character.renamed', v: 1, payload: { name: 'Gap Hidden From A' } },
    ]);
    await deviceB.store.appendTx([
      { type: 'character.renamed', v: 1, payload: { name: 'After Gap' } },
    ]);

    await waitFor(
      () => bothConverged(deviceA, deviceB, 'After Gap'),
      'device A never healed past the withheld frame via re-hello catch-up',
    );
    expect(deviceA.store.facts()).toEqual(deviceB.store.facts());

    // (h) Final convergence: both devices' live facts equal an INDEPENDENT reduce of the server's
    // own event array — the ultimate ground truth neither device's own bookkeeping can fudge.
    const serverEvents = server.eventsFor(characterId);
    const reduced = reduce(serverEvents, undefined, systemRules);
    expect(deviceA.store.facts()).toEqual(reduced);
    expect(deviceB.store.facts()).toEqual(reduced);
    expect(deviceA.store.facts()).toEqual(deviceB.store.facts());

    sessionA.stop();
    sessionB.stop();
    deviceA.db.close();
    deviceB.db.close();
  });

  it('T11b: an interrupted upload (partial or zero appends landed) self-heals via local-ahead resume on the next connect', async () => {
    delete (navigator as unknown as { locks?: unknown }).locks;
    const server = new FakeSyncServer();

    // --- character 1: ZERO appends landed — the POST that durably registers a character
    // succeeded, but the page tore down (crash/tab-close/navigation) before `uploadEvents`'s
    // append round trip even started. The server genuinely has nothing for this stream.
    const deviceZero = configureDevice('hk-db-t11b-zero');
    const zeroId = await deviceZero.store.create('Zero', 'feminine');
    await deviceZero.store.appendTx([
      { type: 'character.renamed', v: 1, payload: { name: 'Zero Renamed' } },
    ]);
    const zeroCommitted = await deviceZero.eventsRepository.byStream(zeroId);
    expect(zeroCommitted.every((e) => e.seq !== undefined)).toBe(true);
    expect(server.eventsFor(zeroId)).toHaveLength(0); // nothing ever uploaded

    deviceZero.store.enterSyncMode(zeroId);
    const sessionZero = new StreamSyncSession({
      streamId: zeroId,
      store: deviceZero.store,
      eventsRepository: deviceZero.eventsRepository,
      toast: deviceZero.toast,
      webSocketFactory: socketFactory(server, 'Zero'),
      wsUrlFn: () => 'ws://fake-sync-server/live',
      rng: () => 0.5,
      window: new FakeTarget(),
      document: new FakeTarget(),
    });
    await sessionZero.start();
    await waitFor(
      () => server.eventsFor(zeroId).length === zeroCommitted.length,
      'zero-appends case: the interrupted upload never self-healed via resume',
    );
    expect(server.eventsFor(zeroId).map((e) => e.id)).toEqual(zeroCommitted.map((e) => e.id));
    expect(server.eventsFor(zeroId).map((e) => e.seq)).toEqual(zeroCommitted.map((e) => e.seq));
    // Local storage was never rewritten — the resume converged with the ORIGINAL local seqs.
    const zeroPersisted = await deviceZero.eventsRepository.byStream(zeroId);
    expect(zeroPersisted.map((e) => e.seq)).toEqual(zeroCommitted.map((e) => e.seq));
    expect(deviceZero.store.facts()).toEqual(
      reduce(server.eventsFor(zeroId), undefined, systemRules),
    );

    // --- character 2: PARTIAL appends landed — a real (trimmed) `uploadCommitted` call sends only
    // the FIRST TWO events before the simulated interruption; the rest of the local history (3
    // more events) was committed locally but never reached the server at all.
    const devicePartial = configureDevice('hk-db-t11b-partial');
    const partialId = await devicePartial.store.create('Partial', 'feminine');
    for (const name of ['Partial 2', 'Partial 3', 'Partial 4', 'Partial 5']) {
      await devicePartial.store.appendTx([{ type: 'character.renamed', v: 1, payload: { name } }]);
    }
    const partialCommitted = await devicePartial.eventsRepository.byStream(partialId);
    expect(partialCommitted).toHaveLength(5);

    const landedBeforeInterruption = partialCommitted.slice(0, 2);
    const uploaded = await uploadCommitted(
      socketFactory(server, 'Partial'),
      partialId,
      landedBeforeInterruption,
    );
    expect(uploaded).toBe(true);
    expect(server.eventsFor(partialId)).toHaveLength(2); // exactly the interrupted prefix

    devicePartial.store.enterSyncMode(partialId);
    const sessionPartial = new StreamSyncSession({
      streamId: partialId,
      store: devicePartial.store,
      eventsRepository: devicePartial.eventsRepository,
      toast: devicePartial.toast,
      webSocketFactory: socketFactory(server, 'Partial'),
      wsUrlFn: () => 'ws://fake-sync-server/live',
      rng: () => 0.5,
      window: new FakeTarget(),
      document: new FakeTarget(),
    });
    await sessionPartial.start();
    await waitFor(
      () => server.eventsFor(partialId).length === partialCommitted.length,
      'partial-appends case: the interrupted upload never self-healed via resume',
    );
    expect(server.eventsFor(partialId).map((e) => e.id)).toEqual(partialCommitted.map((e) => e.id));
    expect(server.eventsFor(partialId).map((e) => e.seq)).toEqual(
      partialCommitted.map((e) => e.seq),
    );
    const partialPersisted = await devicePartial.eventsRepository.byStream(partialId);
    expect(partialPersisted.map((e) => e.seq)).toEqual(partialCommitted.map((e) => e.seq));
    expect(devicePartial.store.facts()).toEqual(
      reduce(server.eventsFor(partialId), undefined, systemRules),
    );

    sessionZero.stop();
    sessionPartial.stop();
    deviceZero.db.close();
    devicePartial.db.close();
  });
});
