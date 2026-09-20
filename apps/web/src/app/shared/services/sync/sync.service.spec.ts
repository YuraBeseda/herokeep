import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { signal, type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { PACK_ID, PACK_VERSION } from '@hk/content/version';
import { parsePack, type Event, type Pack, type ServerMessage } from '@hk/protocol';
import { provideTransloco, type TranslocoLoader } from '@jsverse/transloco';
import { of } from 'rxjs';
import { ToastService } from '@shared/components/toast/toast.service';
import { AuthService, type AuthStatus } from '@shared/services/auth/auth.service';
import { StoragePersistService } from '@shared/services/pwa/storage-persist.service';
import { CharactersRepository } from '@shared/services/storage/characters.repository';
import { EventsRepository } from '@shared/services/storage/events.repository';
import { HkDb } from '@shared/services/storage/dexie.db';
import { LeaderService } from '@shared/services/storage/leader.service';
import { CharacterStore } from '@shared/stores/character.store';
import { PackStore } from '@shared/stores/pack.store';
import type { BroadcastChannelLike } from './broadcast';
import type { WebSocketLike } from './socket';
import {
  SYNC_BROADCAST_FACTORY,
  SYNC_WEBSOCKET_FACTORY,
  SYNC_WS_URL_FN,
  SyncService,
} from './sync.service';

// --- pack/store fixture plumbing — mirrors character.store.spec.ts / stream-sync-session.spec.ts

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

// --- fake WebSocket — same shape as stream-sync-session.spec.ts's own -------------------------

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

  emitServerClose(code = 1006, reason = 'lost'): void {
    this.onclose?.({ code, reason });
  }

  parsedSent(): { t: string; [k: string]: unknown }[] {
    return this.sent.map((s) => JSON.parse(s) as { t: string; [k: string]: unknown });
  }
}

// --- fake BroadcastChannel — mirrors broadcast.spec.ts's own ------------------------------------

class FakeBroadcastChannel implements BroadcastChannelLike {
  static instances: FakeBroadcastChannel[] = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;
  private closed = false;

  constructor(readonly name: string) {
    FakeBroadcastChannel.instances.push(this);
  }

  postMessage(message: unknown): void {
    for (const instance of FakeBroadcastChannel.instances) {
      if (instance === this || instance.name !== this.name || instance.closed) continue;
      instance.onmessage?.({ data: message });
    }
  }

  close(): void {
    this.closed = true;
  }
}

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function flush(times = 10): Promise<void> {
  for (let i = 0; i < times; i++) await tick();
}

// --- routed fetch — mirrors auth.service.spec.ts's own ------------------------------------------

type FetchHandler = (init: RequestInit | undefined) => Response | Promise<Response>;

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function routedFetch(routes: Record<string, FetchHandler>): ReturnType<typeof vi.fn<typeof fetch>> {
  return vi.fn<typeof fetch>(async (input, init) => {
    const url = requestUrl(input);
    const key = Object.keys(routes).find((k) =>
      k.endsWith('*') ? url.startsWith(k.slice(0, -1)) : url === k,
    );
    if (!key) throw new Error(`routedFetch: no handler declared for ${url}`);
    return routes[key](init);
  });
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function noBodyResponse(status: number): Response {
  return new Response(null, { status });
}

// --- suite ---------------------------------------------------------------------------------------

describe('SyncService', () => {
  const originalFetch = globalThis.fetch;
  let statusState: WritableSignal<AuthStatus>;
  let leaderState: WritableSignal<boolean>;
  let toastShow: ReturnType<typeof vi.fn>;
  let authInit: ReturnType<typeof vi.fn>;

  function configure(): void {
    statusState = signal<AuthStatus>('unknown');
    leaderState = signal(false);
    toastShow = vi.fn();
    authInit = vi.fn();
    FakeWebSocket.instances = [];
    FakeBroadcastChannel.instances = [];

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
        {
          provide: LeaderService,
          useValue: {
            isLeader: leaderState.asReadonly(),
            acquire: vi.fn().mockResolvedValue(undefined),
            release: vi.fn(),
          },
        },
        {
          provide: AuthService,
          useValue: { status: statusState.asReadonly(), user: signal(null), init: authInit },
        },
        { provide: ToastService, useValue: { show: toastShow } },
        { provide: SYNC_WEBSOCKET_FACTORY, useValue: FakeWebSocket },
        { provide: SYNC_WS_URL_FN, useValue: (characterId: string) => `ws://test/${characterId}` },
        { provide: SYNC_BROADCAST_FACTORY, useValue: FakeBroadcastChannel },
      ],
    });
  }

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
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    TestBed.inject(HkDb).close();
  });

  it('upload flow: POSTs a local-only character, verifies ack seqs, then starts an ongoing session', async () => {
    leaderState.set(true); // CharacterStore.create/appendTx need leadership
    const store = TestBed.inject(CharacterStore);
    const streamId = await store.create('Aria', 'feminine');
    const bareId = streamId.slice('char:'.length);
    const committedEvent = store.events()[0];

    const postBodies: unknown[] = [];
    globalThis.fetch = routedFetch({
      '/api/characters': (init) => {
        if (init?.method === 'POST') {
          postBodies.push(JSON.parse(init.body as string));
          return jsonResponse(201, { id: bareId, name: 'Aria', system: 'srd-5e-2024' });
        }
        return jsonResponse(200, []); // GET — nothing on the server yet
      },
    });

    const sync = TestBed.inject(SyncService);
    statusState.set('authed');
    TestBed.tick();
    await flush();

    expect(postBodies).toEqual([{ id: bareId, name: 'Aria', system: 'srd-5e-2024' }]);

    // The one-shot upload socket: hello{lastSeq:0} then the committed event via append.
    const uploadSocket = FakeWebSocket.instances[0];
    expect(uploadSocket).toBeDefined();
    uploadSocket.emitOpen();
    await flush();
    const helloFrame = uploadSocket.parsedSent().find((m) => m.t === 'hello');
    expect(helloFrame?.['streams']).toEqual([{ id: streamId, lastSeq: 0 }]);

    uploadSocket.emitMessage({
      t: 'welcome',
      rid: 'r1',
      serverTime: new Date().toISOString(),
      streams: [
        { id: streamId, headSeq: 0, quota: { bytesUsed: 0, bytesMax: 100, eventCount: 0 } },
      ],
    });
    await flush();
    uploadSocket.emitMessage({
      t: 'ack',
      rid: 'r2',
      results: [{ id: committedEvent.id, seq: committedEvent.seq! }],
    });
    await flush();

    // Verified (seqs matched) — an ONGOING session socket is now opened for this stream.
    expect(FakeWebSocket.instances.length).toBeGreaterThanOrEqual(2);
    const sessionSocket = FakeWebSocket.instances[1];
    expect(sessionSocket.url).toBe(`ws://test/${bareId}`);

    expect(sync.syncState(streamId)()).not.toBe('offline');
  });

  it('upload flow: a POST rejected with limit_exceeded skips the stream with a toast and does not retry', async () => {
    leaderState.set(true);
    const store = TestBed.inject(CharacterStore);
    await store.create('Aria', 'feminine');

    globalThis.fetch = routedFetch({
      '/api/characters': (init) => {
        if (init?.method === 'POST') {
          return jsonResponse(403, { error: 'limit_exceeded', message: 'too many characters' });
        }
        return jsonResponse(200, []);
      },
    });

    TestBed.inject(SyncService);
    statusState.set('authed');
    TestBed.tick();
    await flush();

    expect(toastShow).toHaveBeenCalledWith('sync.upload.limit-reached');
    expect(FakeWebSocket.instances).toHaveLength(0); // never attempted an upload socket
  });

  it('restore flow: a server-only character builds a local stream and a CharactersRepository row', async () => {
    const serverId = '00000000-0000-4000-8000-0000000000aa';
    const streamId = `char:${serverId}`;

    globalThis.fetch = routedFetch({
      '/api/characters': () =>
        jsonResponse(200, [{ id: serverId, name: 'Restored', system: 'srd-5e-2024' }]),
    });

    leaderState.set(true);
    TestBed.inject(SyncService);
    statusState.set('authed');
    TestBed.tick();
    await flush();

    const catchupSocket = FakeWebSocket.instances[0];
    catchupSocket.emitOpen();
    await flush();

    const createdEvent: Event = {
      id: '11111111-1111-7111-8111-111111111111',
      stream: streamId,
      seq: 1,
      ts: new Date().toISOString(),
      actor: { userId: 'local', deviceId: 'd1', role: 'owner' },
      type: 'character.created',
      v: 1,
      payload: {
        name: 'Restored',
        system: 'srd-5e-2024',
        corePack: { id: corePack.id, version: corePack.version },
        engineVersion: '1',
        grammaticalGender: 'feminine',
      },
    } as unknown as Event;

    catchupSocket.emitMessage({
      t: 'welcome',
      rid: 'r1',
      serverTime: new Date().toISOString(),
      streams: [
        { id: streamId, headSeq: 1, quota: { bytesUsed: 0, bytesMax: 100, eventCount: 1 } },
      ],
    });
    await flush();
    catchupSocket.emitMessage({ t: 'events', stream: streamId, events: [createdEvent] });
    await flush();

    const charactersRepository = TestBed.inject(CharactersRepository);
    const row = await charactersRepository.get(streamId);
    expect(row?.name).toBe('Restored');

    const eventsRepository = TestBed.inject(EventsRepository);
    const persisted = await eventsRepository.byStream(streamId);
    expect(persisted).toHaveLength(1);
    expect(persisted[0]?.seq).toBe(1);

    // A normal ongoing session now opens too.
    expect(FakeWebSocket.instances.length).toBeGreaterThanOrEqual(2);
  });

  // --- Final fix wave, Minor finding 4 -----------------------------------------------------------

  it('deleting a character while its restore is gated in-flight does not resurrect it — the row stays gone', async () => {
    const serverId = '00000000-0000-4000-8000-0000000000ab';
    const streamId = `char:${serverId}`;

    globalThis.fetch = routedFetch({
      '/api/characters': () =>
        jsonResponse(200, [{ id: serverId, name: 'ToDelete', system: 'srd-5e-2024' }]),
    });

    leaderState.set(true);
    const sync = TestBed.inject(SyncService);
    statusState.set('authed');
    TestBed.tick();
    await flush();

    const catchupSocket = FakeWebSocket.instances[0];
    catchupSocket.emitOpen();
    await flush();

    catchupSocket.emitMessage({
      t: 'welcome',
      rid: 'r1',
      serverTime: new Date().toISOString(),
      streams: [
        { id: streamId, headSeq: 1, quota: { bytesUsed: 0, bytesMax: 100, eventCount: 1 } },
      ],
    });
    await flush();

    // GATED: `welcome` landed (headSeq known: 1) but the `events` catch-up frame `restore()`'s
    // own promise is still waiting on hasn't arrived yet — this character has NEVER existed
    // locally at any point up to here. Delete it now, racing the still in-flight restore.
    await sync.deleteEverywhere(streamId);

    const createdEvent: Event = {
      id: '11111111-1111-7111-8111-111111111112',
      stream: streamId,
      seq: 1,
      ts: new Date().toISOString(),
      actor: { userId: 'local', deviceId: 'd1', role: 'owner' },
      type: 'character.created',
      v: 1,
      payload: {
        name: 'ToDelete',
        system: 'srd-5e-2024',
        corePack: { id: corePack.id, version: corePack.version },
        engineVersion: '1',
        grammaticalGender: 'feminine',
      },
    } as unknown as Event;
    catchupSocket.emitMessage({ t: 'events', stream: streamId, events: [createdEvent] });
    await flush();

    const charactersRepository = TestBed.inject(CharactersRepository);
    expect(await charactersRepository.get(streamId)).toBeUndefined();
    const eventsRepository = TestBed.inject(EventsRepository);
    expect(await eventsRepository.byStream(streamId)).toEqual([]);
    // No session was resurrected for it either.
    expect(sync.syncState(streamId)()).toBe('offline');
  });

  it('logout stops the session and leaveSyncMode, but pending rows are left untouched', async () => {
    leaderState.set(true);
    const store = TestBed.inject(CharacterStore);
    const streamId = await store.create('Aria', 'feminine');

    globalThis.fetch = routedFetch({
      '/api/characters': () =>
        jsonResponse(200, [{ id: streamId.slice(5), name: 'Aria', system: 'srd-5e-2024' }]),
    });

    TestBed.inject(SyncService);
    statusState.set('authed');
    TestBed.tick();
    await flush();

    const ws = FakeWebSocket.instances[0];
    ws.emitOpen();
    await flush();

    store.enterSyncMode(streamId); // startSession already did this — idempotent, asserts the mode
    await store.appendTx([{ type: 'character.renamed', v: 1, payload: { name: 'Pending' } }]);
    const pendingEvent = store.events().at(-1)!;

    statusState.set('anon');
    TestBed.tick();
    await flush();

    expect(ws.closeCalls.length).toBeGreaterThanOrEqual(1);
    const eventsRepository = TestBed.inject(EventsRepository);
    const persisted = await eventsRepository.byStream(streamId);
    expect(persisted.find((e) => e.id === pendingEvent.id)?.seq).toBeUndefined(); // still pending
  });

  it('leader-loss enters follower mode and stops every session', async () => {
    leaderState.set(true);
    const store = TestBed.inject(CharacterStore);
    const streamId = await store.create('Aria', 'feminine');

    globalThis.fetch = routedFetch({
      '/api/characters': () =>
        jsonResponse(200, [{ id: streamId.slice(5), name: 'Aria', system: 'srd-5e-2024' }]),
    });

    TestBed.inject(SyncService);
    statusState.set('authed');
    TestBed.tick();
    await flush();
    const ws = FakeWebSocket.instances[0];
    ws.emitOpen();
    await flush();

    leaderState.set(false);
    TestBed.tick();
    await flush();

    expect(ws.closeCalls.length).toBeGreaterThanOrEqual(1);
    expect(FakeBroadcastChannel.instances.some((c) => c.name === `hk:events:${streamId}`)).toBe(
      true,
    );
  });

  it('follower mode re-reads storage (via reloadIfCurrent) when poked on its stream channel', async () => {
    leaderState.set(true);
    const store = TestBed.inject(CharacterStore);
    const streamId = await store.create('Aria', 'feminine');

    globalThis.fetch = routedFetch({ '/api/characters': () => jsonResponse(200, []) });
    TestBed.inject(SyncService);
    statusState.set('authed');
    TestBed.tick();
    await flush();

    leaderState.set(false); // now a follower tab
    TestBed.tick();
    await flush();

    const reloadSpy = vi.spyOn(store, 'reloadIfCurrent').mockResolvedValue(undefined);
    const leaderPublisher = new FakeBroadcastChannel(`hk:events:${streamId}`);
    leaderPublisher.postMessage('poke');
    await flush();

    expect(reloadSpy).toHaveBeenCalledWith(streamId);
  });

  it('deleteEverywhere: authed calls DELETE /api/characters/:id after the local delete', async () => {
    leaderState.set(true);
    const store = TestBed.inject(CharacterStore);
    const streamId = await store.create('Aria', 'feminine');
    const bareId = streamId.slice('char:'.length);

    statusState.set('authed');
    const deleteCalls: string[] = [];
    globalThis.fetch = routedFetch({
      '/api/characters': () => jsonResponse(200, []),
      [`/api/characters/${bareId}`]: (init) => {
        deleteCalls.push(init?.method ?? 'GET');
        return noBodyResponse(204);
      },
    });

    const sync = TestBed.inject(SyncService);
    TestBed.tick();
    await flush();

    await sync.deleteEverywhere(streamId);

    expect(deleteCalls).toEqual(['DELETE']);
    const charactersRepository = TestBed.inject(CharactersRepository);
    expect(await charactersRepository.get(streamId)).toBeUndefined();
  });

  it('deleteEverywhere: anon does local-only delete, no DELETE call', async () => {
    leaderState.set(true);
    const store = TestBed.inject(CharacterStore);
    const streamId = await store.create('Aria', 'feminine');

    let fetchCalled = false;
    globalThis.fetch = vi.fn<typeof fetch>(() => {
      fetchCalled = true;
      return Promise.resolve(jsonResponse(200, []));
    });

    const sync = TestBed.inject(SyncService);
    await sync.deleteEverywhere(streamId);

    const charactersRepository = TestBed.inject(CharactersRepository);
    expect(await charactersRepository.get(streamId)).toBeUndefined();
    expect(fetchCalled).toBe(false);
  });

  it('fix-round 1, Critical 2: a local edit made mid-upload becomes pending, never a committed-with-unsent-seq row', async () => {
    leaderState.set(true);
    const store = TestBed.inject(CharacterStore);
    const streamId = await store.create('Aria', 'feminine');
    const bareId = streamId.slice('char:'.length);
    const committedEvent = store.events()[0];

    globalThis.fetch = routedFetch({
      '/api/characters': (init) => {
        if (init?.method === 'POST') {
          return jsonResponse(201, { id: bareId, name: 'Aria', system: 'srd-5e-2024' });
        }
        return jsonResponse(200, []); // GET — nothing on the server yet
      },
    });

    TestBed.inject(SyncService);
    statusState.set('authed');
    TestBed.tick();
    await flush();

    // The POST has resolved by now (`upload()`'s `enterSyncMode` already ran, fix-round 1,
    // Critical 2) — an edit made HERE, before `uploadEvents`'s ack round trip even starts, must be
    // written as a PENDING row rather than a committed-with-a-local-seq row this upload will never
    // send.
    await store.appendTx([
      { type: 'character.renamed', v: 1, payload: { name: 'Mid-upload edit' } },
    ]);
    const midEvent = store.events().at(-1)!;
    expect(midEvent.seq).toBeUndefined(); // PENDING, not committed — the crux of the fix

    const uploadSocket = FakeWebSocket.instances[0];
    uploadSocket.emitOpen();
    await flush();
    uploadSocket.emitMessage({
      t: 'welcome',
      rid: 'r1',
      serverTime: new Date().toISOString(),
      streams: [
        { id: streamId, headSeq: 0, quota: { bytesUsed: 0, bytesMax: 100, eventCount: 0 } },
      ],
    });
    await flush();
    uploadSocket.emitMessage({
      t: 'ack',
      rid: 'r2',
      results: [{ id: committedEvent.id, seq: committedEvent.seq! }],
    });
    await flush();

    // Verified (only the ORIGINAL committed event was uploaded — `midEvent` was never part of that
    // batch) — an ongoing session now opens, and its own `hello` carries `midEvent` as pending,
    // proving it flushes normally rather than sitting silently unsent forever.
    const sessionSocket = FakeWebSocket.instances[1];
    sessionSocket.emitOpen();
    await flush();
    const helloFrame = sessionSocket.parsedSent().find((m) => m.t === 'hello') as
      { pending: { id: string }[] } | undefined;
    expect(helloFrame?.pending.map((e) => e.id)).toContain(midEvent.id);

    const eventsRepository = TestBed.inject(EventsRepository);
    const persisted = await eventsRepository.byStream(streamId);
    expect(persisted.find((e) => e.id === midEvent.id)?.seq).toBeUndefined(); // still pending
  });

  it('fix-round 1, Important 3: a logout during an in-flight upload does not resurrect a session afterward', async () => {
    leaderState.set(true);
    const store = TestBed.inject(CharacterStore);
    const streamId = await store.create('Aria', 'feminine');
    const bareId = streamId.slice('char:'.length);
    const committedEvent = store.events()[0];

    globalThis.fetch = routedFetch({
      '/api/characters': (init) => {
        if (init?.method === 'POST') {
          return jsonResponse(201, { id: bareId, name: 'Aria', system: 'srd-5e-2024' });
        }
        return jsonResponse(200, []);
      },
    });

    const sync = TestBed.inject(SyncService);
    statusState.set('authed');
    TestBed.tick();
    await flush();

    const uploadSocket = FakeWebSocket.instances[0];
    uploadSocket.emitOpen();
    await flush();
    uploadSocket.emitMessage({
      t: 'welcome',
      rid: 'r1',
      serverTime: new Date().toISOString(),
      streams: [
        { id: streamId, headSeq: 0, quota: { bytesUsed: 0, bytesMax: 100, eventCount: 0 } },
      ],
    });
    await flush();

    // Logout races the in-flight upload, BEFORE its ack (and therefore its verification) arrives.
    statusState.set('anon');
    TestBed.tick();
    await flush();

    uploadSocket.emitMessage({
      t: 'ack',
      rid: 'r2',
      results: [{ id: committedEvent.id, seq: committedEvent.seq! }],
    });
    await flush();

    // The now-verified upload's trailing `startSession()` must be suppressed — no session may be
    // resurrected under the current ('anon'/idle) mode.
    expect(sync.syncState(streamId)()).toBe('offline');
    expect(FakeWebSocket.instances).toHaveLength(1); // only the one-shot upload socket ever opened
  });

  // --- Final fix wave, Important finding 2 -----------------------------------------------------

  it('a character created while ALREADY authed+leader uploads immediately — no reload/re-auth needed', async () => {
    leaderState.set(true);
    statusState.set('authed');
    globalThis.fetch = routedFetch({ '/api/characters': () => jsonResponse(200, []) });

    const sync = TestBed.inject(SyncService);
    TestBed.tick();
    await flush(); // reconcile() runs against an EMPTY local list — nothing to upload yet

    const store = TestBed.inject(CharacterStore);
    const postBodies: unknown[] = [];
    globalThis.fetch = routedFetch({
      '/api/characters': (init) => {
        if (init?.method === 'POST') {
          postBodies.push(JSON.parse(init.body as string));
          return jsonResponse(201, { id: 'ignored', name: 'Aria', system: 'srd-5e-2024' });
        }
        return jsonResponse(200, []);
      },
    });

    // No further `statusState`/`leaderState` change and no reload/re-injection of anything —
    // this is the ENTIRE trigger this fix adds: `CharacterStore.create` itself.
    const streamId = await store.create('Aria', 'feminine');
    const bareId = streamId.slice('char:'.length);
    const committedEvent = store.events()[0];
    await flush();

    expect(postBodies).toEqual([{ id: bareId, name: 'Aria', system: 'srd-5e-2024' }]);

    const uploadSocket = FakeWebSocket.instances[0];
    expect(uploadSocket).toBeDefined();
    uploadSocket.emitOpen();
    await flush();
    uploadSocket.emitMessage({
      t: 'welcome',
      rid: 'r1',
      serverTime: new Date().toISOString(),
      streams: [
        { id: streamId, headSeq: 0, quota: { bytesUsed: 0, bytesMax: 100, eventCount: 0 } },
      ],
    });
    await flush();
    uploadSocket.emitMessage({
      t: 'ack',
      rid: 'r2',
      results: [{ id: committedEvent.id, seq: committedEvent.seq! }],
    });
    await flush();

    // Verified — an ongoing session socket now opens for the new stream, same as the "already
    // local-only at reconcile time" upload flow's own trailing `startSession`.
    expect(FakeWebSocket.instances.length).toBeGreaterThanOrEqual(2);
    expect(sync.syncState(streamId)()).not.toBe('offline');
  });

  it('a character created while anon/idle does NOT trigger an upload attempt', async () => {
    let fetchCalled = false;
    globalThis.fetch = vi.fn<typeof fetch>(() => {
      fetchCalled = true;
      return Promise.resolve(jsonResponse(200, []));
    });
    leaderState.set(true); // CharacterStore.create needs leadership; SyncService stays idle (anon)
    TestBed.inject(SyncService);
    const store = TestBed.inject(CharacterStore);

    await store.create('Aria', 'feminine');
    await flush();

    expect(fetchCalled).toBe(false);
  });
});
