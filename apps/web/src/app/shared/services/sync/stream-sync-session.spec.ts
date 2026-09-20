import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { signal, type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { PACK_ID, PACK_VERSION } from '@hk/content/version';
import { parsePack, type Event, type Pack, type ServerMessage } from '@hk/protocol';
import { provideTransloco, type TranslocoLoader } from '@jsverse/transloco';
import { of } from 'rxjs';
import { uuidv7 } from '@shared/helpers/uuid';
import { StoragePersistService } from '@shared/services/pwa/storage-persist.service';
import { EventsRepository } from '@shared/services/storage/events.repository';
import { HkDb } from '@shared/services/storage/dexie.db';
import { PackStore } from '@shared/stores/pack.store';
import { CharacterStore } from '@shared/stores/character.store';
import type { WebSocketLike } from './socket';
import {
  chunkEventsForAppend,
  StreamSyncSession,
  type StreamSyncSessionEventsPort,
  type StreamSyncSessionOptions,
  type StreamSyncSessionStorePort,
  type StreamSyncSessionToastPort,
} from './stream-sync-session';

// --- pack/store fixture plumbing — mirrors character.store.spec.ts exactly -------------------

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

class StubLoader implements TranslocoLoader {
  getTranslation() {
    return of({});
  }
}

function configure(): { readyState: WritableSignal<boolean> } {
  const readyState = signal(true);
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
        useValue: { packs: signal([corePack]), ready: readyState, corePack: signal(corePack) },
      },
      {
        provide: StoragePersistService,
        useValue: { requestPersist: vi.fn().mockResolvedValue(true) },
      },
    ],
  });
  return { readyState };
}

// --- fake WebSocket (mirrors socket.spec.ts's own fake) ----------------------------------------

type Handler = ((event: unknown) => void) | null;

class FakeWebSocket implements WebSocketLike {
  static instances: FakeWebSocket[] = [];

  readonly url: string;
  readonly sent: string[] = [];
  closeCalls: { code?: number; reason?: string }[] = [];

  onopen: (() => void) | null = null;
  onclose: Handler = null;
  onerror: Handler = null;
  onmessage: Handler = null;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(code?: number, reason?: string): void {
    this.closeCalls.push({ code, reason });
  }

  emitOpen(): void {
    this.onopen?.();
  }

  emitMessage(message: ServerMessage): void {
    this.onmessage?.({ data: JSON.stringify(message) });
  }

  /** Simulates a server/network-initiated close (as opposed to OUR side calling `close()`) —
   * fires the same `onclose` a real socket would. */
  emitServerClose(code = 1006, reason = 'lost'): void {
    this.onclose?.({ code, reason });
  }

  parsedSent(): unknown[] {
    return this.sent.map((s) => JSON.parse(s) as unknown);
  }
}

function factory(): typeof FakeWebSocket {
  FakeWebSocket.instances = [];
  return FakeWebSocket;
}

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function flush(times = 8): Promise<void> {
  for (let i = 0; i < times; i++) await tick();
}

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

  dispatch(type: string): void {
    for (const listener of this.listeners.get(type) ?? []) listener();
  }
}

// --- suite ---------------------------------------------------------------------------------------

describe('StreamSyncSession', () => {
  let store: CharacterStore;
  let eventsRepository: EventsRepository;
  let toastShow: ReturnType<typeof vi.fn<StreamSyncSessionToastPort['show']>>;
  let toast: StreamSyncSessionToastPort;
  let win: FakeTarget;
  let doc: FakeTarget;

  beforeEach(async () => {
    configure();
    const db = TestBed.inject(HkDb);
    await Promise.all([
      db.packs.clear(),
      db.settings.clear(),
      db.events.clear(),
      db.snapshots.clear(),
      db.characters.clear(),
      db.blobs.clear(),
    ]);
    store = TestBed.inject(CharacterStore);
    eventsRepository = TestBed.inject(EventsRepository);
    toastShow = vi.fn<StreamSyncSessionToastPort['show']>();
    toast = { show: toastShow };
    win = new FakeTarget();
    doc = new FakeTarget();
    delete (navigator as unknown as { locks?: unknown }).locks;
  });

  afterEach(() => {
    TestBed.inject(HkDb).close();
  });

  function newSession(
    streamId: string,
    overrides: Partial<StreamSyncSessionOptions> = {},
  ): { session: StreamSyncSession; Factory: ReturnType<typeof factory> } {
    const Factory = factory();
    const session = new StreamSyncSession({
      streamId,
      store,
      eventsRepository,
      toast,
      webSocketFactory: Factory,
      wsUrlFn: () => 'ws://test/socket',
      window: win,
      document: doc,
      rng: () => 0.5, // deterministic backoff: 500ms, 1000ms, ...
      ...overrides,
    });
    return { session, Factory };
  }

  it('sends a hello with the local committed head and pending events on open', async () => {
    const streamId = await store.create('Aria', 'feminine');
    store.enterSyncMode(streamId);
    await store.appendTx([{ type: 'character.renamed', v: 1, payload: { name: 'Pending Name' } }]);
    const pendingEvent = store.events().at(-1)!;

    const { session, Factory } = newSession(streamId);
    await session.start();
    await flush();
    Factory.instances[0].emitOpen();
    await flush();

    const sent = Factory.instances[0].parsedSent() as {
      t: string;
      streams: unknown;
      pending: unknown[];
    }[];
    expect(sent).toHaveLength(1);
    expect(sent[0].t).toBe('hello');
    expect(sent[0].streams).toEqual([{ id: streamId, lastSeq: 1 }]);
    expect((sent[0].pending[0] as { id: string }).id).toBe(pendingEvent.id);
    session.stop();
  });

  it('welcome sets quota + open state; a catch-up events frame then an ack commits pending and fires onApplied', async () => {
    const streamId = await store.create('Aria', 'feminine');
    store.enterSyncMode(streamId);
    await store.appendTx([{ type: 'character.renamed', v: 1, payload: { name: 'Pending Name' } }]);
    const pendingEvent = store.events().at(-1)!;
    const onApplied = vi.fn();

    const { session, Factory } = newSession(streamId, { onApplied });
    await session.start();
    await flush();
    const ws = Factory.instances[0];
    ws.emitOpen();
    await flush();

    ws.emitMessage({
      t: 'welcome',
      rid: 'r1',
      serverTime: new Date().toISOString(),
      streams: [
        { id: streamId, headSeq: 1, quota: { bytesUsed: 10, bytesMax: 100, eventCount: 1 } },
      ],
    });
    await flush();
    expect(session.connectionState()).toBe('open');
    expect(session.quota()).toEqual({ bytesUsed: 10, bytesMax: 100, eventCount: 1 });

    ws.emitMessage({ t: 'events', stream: streamId, events: [] });
    await flush();

    ws.emitMessage({ t: 'ack', rid: 'r2', results: [{ id: pendingEvent.id, seq: 2 }] });
    await flush();

    const persisted = await eventsRepository.byStream(streamId);
    expect(persisted.find((e) => e.id === pendingEvent.id)?.seq).toBe(2);
    expect(session.pendingCount()).toBe(0);
    expect(onApplied).toHaveBeenCalled();
    session.stop();
  });

  it('a reject drops the named pending rows and toasts a reject-code-keyed message', async () => {
    const streamId = await store.create('Aria', 'feminine');
    store.enterSyncMode(streamId);
    await store.appendTx([{ type: 'character.renamed', v: 1, payload: { name: 'Doomed' } }]);
    const rejected = store.events().at(-1)!;

    const { session, Factory } = newSession(streamId);
    await session.start();
    await flush();
    const ws = Factory.instances[0];
    ws.emitOpen();
    await flush();
    ws.emitMessage({
      t: 'welcome',
      rid: 'r1',
      serverTime: new Date().toISOString(),
      streams: [
        { id: streamId, headSeq: 1, quota: { bytesUsed: 0, bytesMax: 100, eventCount: 1 } },
      ],
    });
    await flush();

    ws.emitMessage({
      t: 'reject',
      rid: 'r2',
      results: [{ id: rejected.id, code: 'forbidden', message: 'nope' }],
    });
    await flush();

    const persisted = await eventsRepository.byStream(streamId);
    expect(persisted.find((e) => e.id === rejected.id)).toBeUndefined();
    expect(toastShow).toHaveBeenCalledWith('sync.reject.forbidden');
    session.stop();
  });

  it('a seq gap in a catch-up events frame re-sends hello instead of guessing', async () => {
    const streamId = await store.create('Aria', 'feminine');
    store.enterSyncMode(streamId);

    const { session, Factory } = newSession(streamId);
    await session.start();
    await flush();
    const ws = Factory.instances[0];
    ws.emitOpen();
    await flush();
    expect(ws.sent).toHaveLength(1); // the initial hello

    // Local head is 1; a frame claiming seq 5 for a brand-new id is a gap.
    ws.emitMessage({
      t: 'events',
      stream: streamId,
      events: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          stream: streamId,
          seq: 5,
          ts: new Date().toISOString(),
          actor: { userId: 'local', deviceId: 'd1', role: 'owner' },
          type: 'character.renamed',
          v: 1,
          payload: { name: 'Ghost' },
        } as unknown as Event,
      ],
    });
    await flush();

    expect(ws.sent).toHaveLength(2); // resync hello sent in response to the gap
    const second = JSON.parse(ws.sent[1]) as { t: string };
    expect(second.t).toBe('hello');
    session.stop();
  });

  it('shows the quota-warning toast once per connection, not on every notice', async () => {
    const streamId = await store.create('Aria', 'feminine');
    store.enterSyncMode(streamId);

    const { session, Factory } = newSession(streamId);
    await session.start();
    await flush();
    const ws = Factory.instances[0];
    ws.emitOpen();
    await flush();
    ws.emitMessage({
      t: 'welcome',
      rid: 'r1',
      serverTime: new Date().toISOString(),
      streams: [
        { id: streamId, headSeq: 1, quota: { bytesUsed: 80, bytesMax: 100, eventCount: 1 } },
      ],
    });
    await flush();

    ws.emitMessage({ t: 'notice', level: 'warning', key: 'quota.warning' });
    ws.emitMessage({ t: 'notice', level: 'warning', key: 'quota.warning' });
    await flush();

    expect(toastShow).toHaveBeenCalledTimes(1);
    expect(toastShow).toHaveBeenCalledWith('sync.quota.warning', undefined);
    session.stop();
  });

  it('chunks more than 50 locally-appended events into multiple append frames while connected', async () => {
    const streamId = await store.create('Aria', 'feminine');
    store.enterSyncMode(streamId);

    const { session, Factory } = newSession(streamId);
    await session.start();
    await flush();
    const ws = Factory.instances[0];
    ws.emitOpen();
    await flush();
    ws.emitMessage({
      t: 'welcome',
      rid: 'r1',
      serverTime: new Date().toISOString(),
      streams: [
        { id: streamId, headSeq: 1, quota: { bytesUsed: 0, bytesMax: 100, eventCount: 1 } },
      ],
    });
    await flush();
    const sentBefore = ws.sent.length;

    const drafts = Array.from({ length: 60 }, (_, i) => ({
      type: 'character.renamed' as const,
      v: 1,
      payload: { name: `Name ${i}` },
    }));
    await store.appendTx(drafts);
    await flush();

    const appendFrames = ws
      .parsedSent()
      .slice(sentBefore)
      .filter(
        (m: unknown): m is { t: 'append'; events: unknown[] } =>
          (m as { t: string }).t === 'append',
      );
    expect(appendFrames).toHaveLength(2);
    expect(appendFrames[0].events).toHaveLength(50);
    expect(appendFrames[1].events).toHaveLength(10);
    session.stop();
  });

  // --- Final fix wave, Minor finding 3 ----------------------------------------------------------

  it(
    'hello.pending is byte-split, not just count-capped: an oversized-but-under-50 pending ' +
      'backlog sends a byte-safe subset in hello, and the remainder follows as append frames ' +
      'after welcome, without ever throwing (the pre-fix bug: a count-only cap let this throw ' +
      "inside onOpen and the session never sent a hello at all, stuck 'connecting' forever)",
    async () => {
      const streamId = await store.create('Aria', 'feminine');
      store.enterSyncMode(streamId);

      // 30 events, well under `MAX_APPEND_EVENTS` (50), but each carries a ~6KB `description`
      // (`LongTextSchema`, up to 20KB) — 30 * ~6KB is comfortably over the 128KB WS frame cap, so
      // a count-only `hello.pending` slice (the pre-fix bug) would still overflow it.
      const bigDescription = 'x'.repeat(6000);
      const drafts = Array.from({ length: 30 }, () => ({
        type: 'character.appearance_set' as const,
        v: 1,
        payload: { description: bigDescription },
      }));
      await store.appendTx(drafts);
      const pendingIds = store
        .events()
        .slice(-30)
        .map((e) => e.id);
      expect(pendingIds).toHaveLength(30);

      const { session, Factory } = newSession(streamId);
      await session.start();
      await flush();
      const ws = Factory.instances[0];
      ws.emitOpen();
      await flush();

      // No throw, no hang: exactly the hello itself was sent.
      const sentAfterOpen = ws.parsedSent() as { t: string; pending?: { id: string }[] }[];
      expect(sentAfterOpen).toHaveLength(1);
      const hello = sentAfterOpen[0];
      expect(hello.t).toBe('hello');
      expect(hello.pending).toBeDefined();
      expect(hello.pending!.length).toBeGreaterThan(0); // some progress was made
      expect(hello.pending!.length).toBeLessThan(30); // but byte-capped, not the full backlog

      // Local committed head is 1 (just `character.created`) — matches `headSeq`, so no resume;
      // this exercises the ordinary leftoverPending-flush-after-welcome path.
      ws.emitMessage({
        t: 'welcome',
        rid: 'r1',
        serverTime: new Date().toISOString(),
        streams: [
          { id: streamId, headSeq: 1, quota: { bytesUsed: 0, bytesMax: 100, eventCount: 1 } },
        ],
      });
      await flush();

      const appendFrames = ws
        .parsedSent()
        .slice(1)
        .filter(
          (m: unknown): m is { t: 'append'; events: { id: string }[] } =>
            (m as { t: string }).t === 'append',
        );
      expect(appendFrames.length).toBeGreaterThan(0); // the leftover DID get flushed
      const leftoverIds = appendFrames.flatMap((f) => f.events.map((e) => e.id));

      // Nothing lost, nothing duplicated across hello.pending + the leftover flush.
      const allSentIds = [...hello.pending!.map((e) => e.id), ...leftoverIds];
      expect(new Set(allSentIds)).toEqual(new Set(pendingIds));
      expect(allSentIds).toHaveLength(pendingIds.length);
      session.stop();
    },
  );

  it('an unexpected close schedules a backoff-delayed reconnect, and firing it opens a new socket', async () => {
    const streamId = await store.create('Aria', 'feminine');
    store.enterSyncMode(streamId);
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');

    const { session, Factory } = newSession(streamId);
    await session.start();
    await flush();
    const ws = Factory.instances[0];
    ws.emitOpen();
    await flush();

    ws.emitServerClose();
    expect(session.connectionState()).toBe('closed');

    const reconnectCall = setTimeoutSpy.mock.calls.find(([, delay]) => delay === 500);
    expect(reconnectCall).toBeDefined();
    const callback = reconnectCall![0];
    callback();
    await flush();

    expect(Factory.instances).toHaveLength(2); // a fresh socket was opened
    session.stop();
    setTimeoutSpy.mockRestore();
  });

  it('stop() prevents any further reconnect after a subsequent close', async () => {
    const streamId = await store.create('Aria', 'feminine');
    store.enterSyncMode(streamId);

    const { session, Factory } = newSession(streamId);
    await session.start();
    await flush();
    const ws = Factory.instances[0];
    ws.emitOpen();
    await flush();

    session.stop();
    expect(ws.closeCalls).toHaveLength(1);
    ws.emitServerClose(); // a late/racing close event after stop()

    expect(Factory.instances).toHaveLength(1); // no reconnect attempted
  });

  it('a ReconnectSignals trigger resets backoff and reconnects immediately while disconnected', async () => {
    const streamId = await store.create('Aria', 'feminine');
    store.enterSyncMode(streamId);

    const { session, Factory } = newSession(streamId);
    await session.start();
    await flush();
    Factory.instances[0].emitOpen();
    await flush();
    Factory.instances[0].emitServerClose();
    expect(session.connectionState()).toBe('closed');

    win.dispatch('online');
    await flush();

    expect(Factory.instances).toHaveLength(2); // reconnected immediately, not after waiting 500ms
    session.stop();
  });

  it('acquires and releases the per-stream Web Lock across start()/stop()', async () => {
    const streamId = await store.create('Aria', 'feminine');
    store.enterSyncMode(streamId);

    const held: string[] = [];
    let released = false;
    const stubLocks = {
      request: (name: string, _opts: unknown, cb: () => Promise<void>) => {
        held.push(name);
        return cb().then(() => {
          released = true;
        });
      },
    } as unknown as LockManager;

    const { session } = newSession(streamId, { locks: stubLocks });
    await session.start();

    expect(held).toEqual([`hk:sync:${streamId}`]);
    expect(released).toBe(false); // still held while running

    session.stop();
    await flush();
    expect(released).toBe(true);
  });

  it('fix-round 1, Critical 1: releases a lock granted AFTER stop() already ran, instead of holding it forever', async () => {
    const streamId = await store.create('Aria', 'feminine');
    store.enterSyncMode(streamId);

    // A lock manager whose FIRST grant is held back until the test calls `grantFirst()` — models
    // `stop()` racing a still-pending Web Lock grant. Any request queued BEHIND the first (a
    // second waiter, e.g. another session for the same stream) only gets granted once the first
    // request's callback-returned promise resolves — exactly the real Web Locks API's single-
    // holder-per-name contract, which is what "a second session can acquire it" actually proves.
    let held = false;
    let firstRequested = false;
    let pendingGrant: (() => void) | undefined;
    const queue: (() => void)[] = [];
    const grant = (
      callback: () => Promise<void>,
      resolve: () => void,
      reject: (err: Error) => void,
    ): void => {
      callback().then(
        () => {
          held = false;
          resolve();
          queue.shift()?.();
        },
        (err: unknown) => {
          held = false;
          reject(err instanceof Error ? err : new Error(String(err)));
          queue.shift()?.();
        },
      );
    };
    const locks = {
      request: (
        _name: string,
        _opts: { mode?: string },
        callback: () => Promise<void>,
      ): Promise<void> =>
        new Promise<void>((resolve, reject) => {
          const attempt = (): void => {
            if (held) {
              queue.push(attempt);
              return;
            }
            held = true;
            if (!firstRequested) {
              firstRequested = true;
              pendingGrant = () => grant(callback, resolve, reject);
              return; // gated — the test decides when this first grant actually fires
            }
            grant(callback, resolve, reject);
          };
          attempt();
        }),
    } as unknown as LockManager;

    const { session } = newSession(streamId, { locks });
    const startPromise = session.start(); // blocked on the gated first grant

    session.stop(); // races the still-pending grant — the bug: this used to leak the lock forever

    let secondGranted = false;
    void locks.request(`hk:sync:${streamId}`, { mode: 'exclusive' }, () => {
      secondGranted = true;
      return new Promise<void>(() => undefined); // holds — nothing more to assert past "granted"
    });
    expect(secondGranted).toBe(false); // still queued behind the (as yet ungranted) first request

    pendingGrant!(); // the lock manager now actually grants the first request
    await startPromise;
    await flush();

    expect(secondGranted).toBe(true); // released, not held forever — the second waiter got in
  });

  it('T11b: a local-ahead welcome (interrupted upload) resumes by resending just the missing committed tail', async () => {
    const streamId = await store.create('Aria', 'feminine');
    await store.appendTx([{ type: 'character.renamed', v: 1, payload: { name: 'Two' } }]);
    await store.appendTx([{ type: 'character.renamed', v: 1, payload: { name: 'Three' } }]);
    const allCommitted = store.events(); // seq 1..3: create + two renames

    const { session, Factory } = newSession(streamId);
    await session.start();
    await flush();
    const ws = Factory.instances[0];
    ws.emitOpen();
    await flush();

    // Server reports headSeq=1 — only the FIRST event ever landed (an interrupted prior upload:
    // the POST that registers the character durably succeeded, but the append round trip for
    // events 2/3 never completed before this device's page tore down).
    ws.emitMessage({
      t: 'welcome',
      rid: 'r1',
      serverTime: new Date().toISOString(),
      streams: [
        { id: streamId, headSeq: 1, quota: { bytesUsed: 0, bytesMax: 100, eventCount: 1 } },
      ],
    });
    await flush();

    const appendFrames = ws
      .parsedSent()
      .filter(
        (m: unknown): m is { t: 'append'; events: { id: string; seq?: number }[] } =>
          (m as { t: string }).t === 'append',
      );
    expect(appendFrames).toHaveLength(1);
    // Only the MISSING tail (events 2/3, seq > headSeq) was resent — not the whole local history.
    expect(appendFrames[0].events.map((e) => e.id)).toEqual([
      allCommitted[1].id,
      allCommitted[2].id,
    ]);

    // The server assigns the SAME seqs this device already has on disk (the honest, idempotent
    // outcome for a genuine resume) — verification must succeed without rewriting anything.
    ws.emitMessage({
      t: 'ack',
      rid: 'r2',
      results: [
        { id: allCommitted[1].id, seq: allCommitted[1].seq! },
        { id: allCommitted[2].id, seq: allCommitted[2].seq! },
      ],
    });
    await flush();

    const persisted = await eventsRepository.byStream(streamId);
    expect(persisted.map((e) => e.seq)).toEqual([1, 2, 3]); // untouched — already correct
    session.stop();
  });

  it('T11b: a resume ack seq mismatch is a genuine divergence — tears the session down and fires onDivergence', async () => {
    const streamId = await store.create('Aria', 'feminine');
    await store.appendTx([{ type: 'character.renamed', v: 1, payload: { name: 'Two' } }]);
    const secondEvent = store.events().at(-1)!;

    const onDivergence = vi.fn();
    const { session, Factory } = newSession(streamId, { onDivergence });
    await session.start();
    await flush();
    const ws = Factory.instances[0];
    ws.emitOpen();
    await flush();
    ws.emitMessage({
      t: 'welcome',
      rid: 'r1',
      serverTime: new Date().toISOString(),
      streams: [
        { id: streamId, headSeq: 1, quota: { bytesUsed: 0, bytesMax: 100, eventCount: 1 } },
      ],
    });
    await flush();

    // The server assigns a DIFFERENT seq than what this device already has — a genuine
    // divergence (e.g. another writer raced it), not idempotent dedupe.
    ws.emitMessage({ t: 'ack', rid: 'r2', results: [{ id: secondEvent.id, seq: 99 }] });
    await flush();

    expect(onDivergence).toHaveBeenCalledTimes(1);
    expect(session.connectionState()).toBe('closed'); // the session tore itself down
  });

  it('T11b: a reject during resume also fires onDivergence, never a silent no-op via dropPending', async () => {
    const streamId = await store.create('Aria', 'feminine');
    await store.appendTx([{ type: 'character.renamed', v: 1, payload: { name: 'Two' } }]);
    const secondEvent = store.events().at(-1)!;

    const onDivergence = vi.fn();
    const { session, Factory } = newSession(streamId, { onDivergence });
    await session.start();
    await flush();
    const ws = Factory.instances[0];
    ws.emitOpen();
    await flush();
    ws.emitMessage({
      t: 'welcome',
      rid: 'r1',
      serverTime: new Date().toISOString(),
      streams: [
        { id: streamId, headSeq: 1, quota: { bytesUsed: 0, bytesMax: 100, eventCount: 1 } },
      ],
    });
    await flush();

    ws.emitMessage({
      t: 'reject',
      rid: 'r2',
      results: [{ id: secondEvent.id, code: 'invalid', message: 'nope' }],
    });
    await flush();

    expect(onDivergence).toHaveBeenCalledTimes(1);
    const persisted = await eventsRepository.byStream(streamId);
    // The committed row must still be on disk — a resume-time reject must NEVER silently drop
    // committed history the way `dropPending` would for a genuinely pending row.
    expect(persisted.find((e) => e.id === secondEvent.id)?.seq).toBe(2);
  });

  it('T11b round 2: a hello.pending ack arriving BEFORE the resume completes routes correctly — no false-positive divergence', async () => {
    const streamId = await store.create('Aria', 'feminine');
    await store.appendTx([{ type: 'character.renamed', v: 1, payload: { name: 'Two' } }]);
    const missingTailEvent = store.events().at(-1)!; // committed seq 2 — never uploaded (interrupted)

    // An OLD unsynced backlog row, already pending before this connect even starts.
    store.enterSyncMode(streamId);
    await store.appendTx([{ type: 'character.renamed', v: 1, payload: { name: 'Backlog' } }]);
    const pendingEvent = store.events().at(-1)!;
    expect(pendingEvent.seq).toBeUndefined();

    const onDivergence = vi.fn();
    const { session, Factory } = newSession(streamId, { onDivergence });
    await session.start();
    await flush();
    const ws = Factory.instances[0];
    ws.emitOpen();
    await flush();
    ws.emitMessage({
      t: 'welcome',
      rid: 'r1',
      serverTime: new Date().toISOString(),
      streams: [
        { id: streamId, headSeq: 1, quota: { bytesUsed: 0, bytesMax: 100, eventCount: 1 } },
      ],
    });
    await flush();

    // The hello.pending ack lands FIRST, in its OWN frame — before the resume's own ack.
    ws.emitMessage({ t: 'ack', rid: 'r2', results: [{ id: pendingEvent.id, seq: 3 }] });
    await flush();

    expect(onDivergence).not.toHaveBeenCalled(); // must NOT have been swallowed into resume verification
    const midway = await eventsRepository.byStream(streamId);
    expect(midway.find((e) => e.id === pendingEvent.id)?.seq).toBe(3); // committed via the normal path
    expect(midway.find((e) => e.id === missingTailEvent.id)?.seq).toBe(2); // resume still unresolved, untouched

    // Now the resume's own ack arrives.
    ws.emitMessage({
      t: 'ack',
      rid: 'r3',
      results: [{ id: missingTailEvent.id, seq: missingTailEvent.seq! }],
    });
    await flush();

    expect(onDivergence).not.toHaveBeenCalled();
    const final = await eventsRepository.byStream(streamId);
    expect(final.map((e) => e.seq).sort()).toEqual([1, 2, 3]);
    session.stop();
  });

  it('T11b round 2: a local append made mid-resume is held and flushed (in order) once the resume completes', async () => {
    const streamId = await store.create('Aria', 'feminine');
    await store.appendTx([{ type: 'character.renamed', v: 1, payload: { name: 'Two' } }]);
    const missingTailEvent = store.events().at(-1)!; // committed seq 2 — never uploaded

    store.enterSyncMode(streamId);
    const { session, Factory } = newSession(streamId);
    await session.start();
    await flush();
    const ws = Factory.instances[0];
    ws.emitOpen();
    await flush();
    ws.emitMessage({
      t: 'welcome',
      rid: 'r1',
      serverTime: new Date().toISOString(),
      streams: [
        { id: streamId, headSeq: 1, quota: { bytesUsed: 0, bytesMax: 100, eventCount: 1 } },
      ],
    });
    await flush();

    const sentBeforeMidEdit = ws.sent.length;

    // A real user edit lands WHILE the resume is still in flight (no ack yet).
    await store.appendTx([
      { type: 'character.renamed', v: 1, payload: { name: 'Mid-resume edit' } },
    ]);
    const midEvent = store.events().at(-1)!;
    await flush();

    // Held — nothing new was sent for it yet.
    expect(ws.sent.length).toBe(sentBeforeMidEdit);

    // The resume completes.
    ws.emitMessage({
      t: 'ack',
      rid: 'r2',
      results: [{ id: missingTailEvent.id, seq: missingTailEvent.seq! }],
    });
    await flush();

    // NOW the held append gets sent.
    const appendFrames = ws
      .parsedSent()
      .slice(sentBeforeMidEdit)
      .filter(
        (m: unknown): m is { t: 'append'; events: { id: string }[] } =>
          (m as { t: string }).t === 'append',
      );
    expect(appendFrames.some((f) => f.events.some((e) => e.id === midEvent.id))).toBe(true);

    // The server acks it through the normal (non-resume) path.
    ws.emitMessage({ t: 'ack', rid: 'r3', results: [{ id: midEvent.id, seq: 3 }] });
    await flush();

    const persisted = await eventsRepository.byStream(streamId);
    expect(persisted.map((e) => e.seq).sort()).toEqual([1, 2, 3]);
    expect(store.facts()?.name).toBe('Mid-resume edit'); // final facts converge on the held edit
    session.stop();
  });

  it('T11b round 2: one ack frame mixing a resume id and a pending id partitions both correctly', async () => {
    const streamId = await store.create('Aria', 'feminine');
    await store.appendTx([{ type: 'character.renamed', v: 1, payload: { name: 'Two' } }]);
    const missingTailEvent = store.events().at(-1)!; // committed seq 2 — never uploaded

    store.enterSyncMode(streamId);
    await store.appendTx([{ type: 'character.renamed', v: 1, payload: { name: 'Backlog' } }]);
    const pendingEvent = store.events().at(-1)!;

    const onDivergence = vi.fn();
    const { session, Factory } = newSession(streamId, { onDivergence });
    await session.start();
    await flush();
    const ws = Factory.instances[0];
    ws.emitOpen();
    await flush();
    ws.emitMessage({
      t: 'welcome',
      rid: 'r1',
      serverTime: new Date().toISOString(),
      streams: [
        { id: streamId, headSeq: 1, quota: { bytesUsed: 0, bytesMax: 100, eventCount: 1 } },
      ],
    });
    await flush();

    // ONE frame, both ids together — the server has no reason to split them.
    ws.emitMessage({
      t: 'ack',
      rid: 'r2',
      results: [
        { id: pendingEvent.id, seq: 3 },
        { id: missingTailEvent.id, seq: missingTailEvent.seq! },
      ],
    });
    await flush();

    expect(onDivergence).not.toHaveBeenCalled();
    const persisted = await eventsRepository.byStream(streamId);
    expect(persisted.find((e) => e.id === pendingEvent.id)?.seq).toBe(3);
    expect(persisted.find((e) => e.id === missingTailEvent.id)?.seq).toBe(2);
    session.stop();
  });

  // --- Final fix wave, Minor finding 6 (T11b reject-side partition, parked) ----------------------

  it('T11b round 2 (parked): a reject frame naming only a pending id during an in-flight resume drops it normally, no divergence', async () => {
    const streamId = await store.create('Aria', 'feminine');
    await store.appendTx([{ type: 'character.renamed', v: 1, payload: { name: 'Two' } }]);
    const missingTailEvent = store.events().at(-1)!; // committed seq 2 — never uploaded (resume target)

    store.enterSyncMode(streamId);
    await store.appendTx([{ type: 'character.renamed', v: 1, payload: { name: 'Backlog' } }]);
    const pendingEvent = store.events().at(-1)!;

    const onDivergence = vi.fn();
    const { session, Factory } = newSession(streamId, { onDivergence });
    await session.start();
    await flush();
    const ws = Factory.instances[0];
    ws.emitOpen();
    await flush();
    ws.emitMessage({
      t: 'welcome',
      rid: 'r1',
      serverTime: new Date().toISOString(),
      streams: [
        { id: streamId, headSeq: 1, quota: { bytesUsed: 0, bytesMax: 100, eventCount: 1 } },
      ],
    });
    await flush();

    // A resume is now in flight (missingTailEvent's own ack hasn't arrived yet). This reject
    // names ONLY the ordinary pending row.
    ws.emitMessage({
      t: 'reject',
      rid: 'r2',
      results: [{ id: pendingEvent.id, code: 'invalid', message: 'nope' }],
    });
    await flush();

    expect(onDivergence).not.toHaveBeenCalled();
    const persisted = await eventsRepository.byStream(streamId);
    expect(persisted.find((e) => e.id === pendingEvent.id)).toBeUndefined(); // dropped normally
    // The resume itself is untouched — still unresolved, still committed at its original seq.
    expect(persisted.find((e) => e.id === missingTailEvent.id)?.seq).toBe(2);

    // Completing the resume afterward still works normally.
    ws.emitMessage({
      t: 'ack',
      rid: 'r3',
      results: [{ id: missingTailEvent.id, seq: missingTailEvent.seq! }],
    });
    await flush();
    expect(onDivergence).not.toHaveBeenCalled();
    session.stop();
  });

  it('T11b round 2 (parked): a mixed reject frame (a resume id + a pending id together) diverges the resume AND still drops the pending id', async () => {
    const streamId = await store.create('Aria', 'feminine');
    await store.appendTx([{ type: 'character.renamed', v: 1, payload: { name: 'Two' } }]);
    const missingTailEvent = store.events().at(-1)!; // committed seq 2 — never uploaded (resume target)

    store.enterSyncMode(streamId);
    await store.appendTx([{ type: 'character.renamed', v: 1, payload: { name: 'Backlog' } }]);
    const pendingEvent = store.events().at(-1)!;

    const onDivergence = vi.fn();
    const { session, Factory } = newSession(streamId, { onDivergence });
    await session.start();
    await flush();
    const ws = Factory.instances[0];
    ws.emitOpen();
    await flush();
    ws.emitMessage({
      t: 'welcome',
      rid: 'r1',
      serverTime: new Date().toISOString(),
      streams: [
        { id: streamId, headSeq: 1, quota: { bytesUsed: 0, bytesMax: 100, eventCount: 1 } },
      ],
    });
    await flush();

    // ONE frame, both ids together — same "the server has no reason to split them" shape the
    // mixed-ack spec above uses.
    ws.emitMessage({
      t: 'reject',
      rid: 'r2',
      results: [
        { id: missingTailEvent.id, code: 'invalid', message: 'nope' },
        { id: pendingEvent.id, code: 'invalid', message: 'nope' },
      ],
    });
    await flush();

    expect(onDivergence).toHaveBeenCalledTimes(1);
    const persisted = await eventsRepository.byStream(streamId);
    // The resume-tail id is COMMITTED history — never silently dropped, even though its own
    // resume diverges (mirrors the non-mixed "reject during resume" spec above).
    expect(persisted.find((e) => e.id === missingTailEvent.id)?.seq).toBe(2);
    // The unrelated pending id still drops through the ordinary path regardless.
    expect(persisted.find((e) => e.id === pendingEvent.id)).toBeUndefined();
  });
});

describe('chunkEventsForAppend', () => {
  function mkEvent(overrides: Partial<Event> = {}): Event {
    return {
      id: uuidv7(),
      stream: 'char:00000000-0000-4000-8000-000000000001',
      ts: new Date().toISOString(),
      actor: { userId: 'local', deviceId: 'd1', role: 'owner' },
      type: 'character.renamed',
      v: 1,
      payload: { name: 'x' },
      ...overrides,
    };
  }

  it('keeps events under both caps in a single chunk', () => {
    const events = Array.from({ length: 10 }, () => mkEvent());
    expect(chunkEventsForAppend(events)).toHaveLength(1);
  });

  it('splits at 50 events even when well under the byte cap', () => {
    const events = Array.from({ length: 120 }, () => mkEvent());
    const chunks = chunkEventsForAppend(events);
    expect(chunks.map((c) => c.length)).toEqual([50, 50, 20]);
  });

  it('emits a single event alone when its own JSON already exceeds the byte cap', () => {
    const huge = mkEvent({ payload: { name: 'x'.repeat(140_000) } });
    const small = mkEvent();
    const chunks = chunkEventsForAppend([huge, small]);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toEqual([huge]);
    expect(chunks[1]).toEqual([small]);
  });
});

describe('StreamSyncSession poisoned outbound events', () => {
  it('drops a single event that still overflows the WS frame and toasts, without blocking the rest', async () => {
    const streamId = 'char:00000000-0000-4000-8000-000000000001';
    let capturedCb!: (streamId: string, events: Event[]) => void;
    const dropPending = vi
      .fn<StreamSyncSessionStorePort['dropPending']>()
      .mockResolvedValue(undefined);
    const onLocalAppend = vi.fn<StreamSyncSessionStorePort['onLocalAppend']>((cb) => {
      capturedCb = cb;
      return () => undefined;
    });
    const storePort: StreamSyncSessionStorePort = {
      applyServerCommit: vi
        .fn<StreamSyncSessionStorePort['applyServerCommit']>()
        .mockResolvedValue(undefined),
      commitPending: vi
        .fn<StreamSyncSessionStorePort['commitPending']>()
        .mockResolvedValue(undefined),
      dropPending,
      onLocalAppend,
    };
    const eventsPort: StreamSyncSessionEventsPort = {
      byStream: vi.fn<StreamSyncSessionEventsPort['byStream']>().mockResolvedValue([]),
    };
    const toastShow = vi.fn<StreamSyncSessionToastPort['show']>();

    const Factory = factory();
    const session = new StreamSyncSession({
      streamId,
      store: storePort,
      eventsRepository: eventsPort,
      toast: { show: toastShow },
      webSocketFactory: Factory,
      wsUrlFn: () => 'ws://test',
    });
    await session.start();
    await flush();
    const ws = Factory.instances[0];
    ws.emitOpen();
    await flush();
    ws.emitMessage({
      t: 'welcome',
      rid: 'r1',
      serverTime: new Date().toISOString(),
      streams: [
        { id: streamId, headSeq: 0, quota: { bytesUsed: 0, bytesMax: 100, eventCount: 0 } },
      ],
    });
    await flush();

    const huge: Event = {
      id: uuidv7(),
      stream: streamId,
      ts: new Date().toISOString(),
      actor: { userId: 'local', deviceId: 'd1', role: 'owner' },
      type: 'character.renamed',
      v: 1,
      payload: { name: 'x'.repeat(140_000) },
    } as unknown as Event;

    capturedCb(streamId, [huge]);
    await flush();

    expect(dropPending).toHaveBeenCalledWith(streamId, [huge.id]);
    expect(toastShow).toHaveBeenCalledWith('sync.append.poisoned-event');
    session.stop();
  });
});
