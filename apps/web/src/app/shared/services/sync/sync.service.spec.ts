import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { signal, type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { PACK_ID, PACK_VERSION } from '@hk/content/version';
import {
  parsePack,
  type Event,
  type MembersMsg,
  type Pack,
  type ServerMessage,
} from '@hk/protocol';
import { provideTransloco, type TranslocoLoader } from '@jsverse/transloco';
import { of } from 'rxjs';
import { ToastService } from '@shared/components/toast/toast.service';
import { AuthService, type AuthStatus } from '@shared/services/auth/auth.service';
import { StoragePersistService } from '@shared/services/pwa/storage-persist.service';
import { CampaignsRepository } from '@shared/services/storage/campaigns.repository';
import { CharactersRepository } from '@shared/services/storage/characters.repository';
import { EventsRepository } from '@shared/services/storage/events.repository';
import { HkDb } from '@shared/services/storage/dexie.db';
import { LeaderService } from '@shared/services/storage/leader.service';
import { CampaignStore } from '@shared/stores/campaign.store';
import { CharacterStore } from '@shared/stores/character.store';
import { PackStore } from '@shared/stores/pack.store';
import type { BroadcastChannelLike } from './broadcast';
import type { VisibilityDocument } from './reconnect-signals';
import type { WebSocketLike } from './socket';
import {
  SYNC_BROADCAST_FACTORY,
  SYNC_VISIBILITY_DOCUMENT,
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
  readonly sent: (string | Uint8Array)[] = [];
  closeCalls: { code?: number; reason?: string }[] = [];
  binaryType: 'blob' | 'arraybuffer' | undefined;

  onopen: (() => void) | null = null;
  onclose: Handler = null;
  onerror: Handler = null;
  onmessage: Handler = null;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  send(data: string | Uint8Array): void {
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

  /** Drives a BINARY frame (see `socket.ts`'s `onBinaryFrame` doc, `stream-sync-session.spec.ts`'s
   * own identical helper) — `data` is whatever a real socket would hand `onmessage` once
   * `binaryType` is `'arraybuffer'`. */
  emitBinary(bytes: ArrayBuffer | Uint8Array): void {
    this.onmessage?.({ data: bytes });
  }

  emitServerClose(code = 1006, reason = 'lost'): void {
    this.onclose?.({ code, reason });
  }

  parsedSent(): { t: string; [k: string]: unknown }[] {
    return this.sent
      .filter((s): s is string => typeof s === 'string')
      .map((s) => JSON.parse(s) as { t: string; [k: string]: unknown });
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

// --- fake visibility document — plan-10 Task 5's presence throttle -----------------------------

class FakeVisibilityDocument implements VisibilityDocument {
  visibilityState: DocumentVisibilityState = 'visible';
  private listener: (() => void) | null = null;

  addEventListener(type: string, listener: () => void): void {
    if (type === 'visibilitychange') this.listener = listener;
  }

  removeEventListener(type: string, listener: () => void): void {
    if (type === 'visibilitychange' && this.listener === listener) this.listener = null;
  }

  /** Invokes the registered `visibilitychange` listener, same as a real firing would — the
   * listener itself reads `this.visibilityState` at call time, matching real DOM semantics. */
  fire(): void {
    this.listener?.();
  }
}

/** A minimal `welcome` frame for a campaign stream, optionally carrying an initial roster. */
function campaignWelcome(
  streamId: string,
  headSeq = 0,
  members?: MembersMsg['members'],
): ServerMessage {
  return {
    t: 'welcome',
    rid: 'r1',
    serverTime: new Date().toISOString(),
    streams: [{ id: streamId, headSeq, quota: { bytesUsed: 0, bytesMax: 100, eventCount: 0 } }],
    ...(members ? { members } : {}),
  };
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
  let routerMock: { url: string; navigateByUrl: ReturnType<typeof vi.fn> };
  let visibilityDoc: FakeVisibilityDocument;

  function configure(): void {
    statusState = signal<AuthStatus>('unknown');
    leaderState = signal(false);
    toastShow = vi.fn();
    authInit = vi.fn();
    routerMock = { url: '/', navigateByUrl: vi.fn() };
    visibilityDoc = new FakeVisibilityDocument();
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
        // Plan-10 Task 1: SYNC_WS_URL_FN now takes the FULL stream id (`char:<uuid>`), not a bare
        // characterId — see sessionSocket.url's assertion below, migrated to match.
        { provide: SYNC_WS_URL_FN, useValue: (streamId: string) => `ws://test/${streamId}` },
        { provide: SYNC_BROADCAST_FACTORY, useValue: FakeBroadcastChannel },
        // Plan-10 Task 5: `Router` has no real config in this TestBed (no `provideRouter`) — every
        // test needs SOME provider, since `SyncService`'s constructor unconditionally `inject()`s
        // it for the `campaign.member_removed` bye handler's navigate-away check.
        { provide: Router, useValue: routerMock },
        { provide: SYNC_VISIBILITY_DOCUMENT, useValue: visibilityDoc },
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
      db.campaigns.clear(),
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
    expect(sessionSocket.url).toBe(`ws://test/${streamId}`);

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

  // --- Plan-10 Task 5: campaign session integration ----------------------------------------------

  describe('campaign sessions', () => {
    it('auto-start on auth: seeds CampaignsRepository from GET /api/campaigns (with correct role) and opens a live session', async () => {
      const campaignId = '00000000-0000-4000-8000-0000000000c1';
      const streamId = `camp:${campaignId}`;

      globalThis.fetch = routedFetch({
        '/api/characters': () => jsonResponse(200, []),
        '/api/campaigns': () =>
          jsonResponse(200, [
            {
              id: campaignId,
              name: 'Curse of Strahd',
              system: 'srd-5e-2024',
              role: 'dm',
              joinCode: 'ABCD-1234',
            },
          ]),
      });

      leaderState.set(true);
      TestBed.inject(SyncService);
      statusState.set('authed');
      TestBed.tick();
      await flush();

      const campaignsRepository = TestBed.inject(CampaignsRepository);
      const row = await campaignsRepository.get(campaignId);
      expect(row?.role).toBe('dm');
      expect(row?.name).toBe('Curse of Strahd');
      expect(row?.joinCode).toBe('ABCD-1234');

      const campaignSocket = FakeWebSocket.instances.find((s) => s.url === `ws://test/${streamId}`);
      expect(campaignSocket).toBeDefined();
    });

    it("auto-start on auth: refreshes an existing local row's role/name from the server DTO", async () => {
      const campaignId = '00000000-0000-4000-8000-0000000000c2';
      const campaignsRepository = TestBed.inject(CampaignsRepository);
      await campaignsRepository.put({
        id: campaignId,
        name: 'Stale Name',
        system: 'srd-5e-2024',
        role: 'player',
        lastSeq: 0,
        updatedAt: 1,
      });

      globalThis.fetch = routedFetch({
        '/api/characters': () => jsonResponse(200, []),
        '/api/campaigns': () =>
          jsonResponse(200, [
            { id: campaignId, name: 'Fresh Name', system: 'srd-5e-2024', role: 'dm' },
          ]),
      });

      leaderState.set(true);
      TestBed.inject(SyncService);
      statusState.set('authed');
      TestBed.tick();
      await flush();

      const row = await campaignsRepository.get(campaignId);
      expect(row?.role).toBe('dm');
      expect(row?.name).toBe('Fresh Name');
    });

    it('welcome.members and a later standalone members frame both populate membersFor(campaignId)', async () => {
      const campaignId = '00000000-0000-4000-8000-0000000000c3';
      const streamId = `camp:${campaignId}`;
      await TestBed.inject(CampaignsRepository).put({
        id: campaignId,
        name: 'X',
        system: 'srd-5e-2024',
        role: 'dm',
        lastSeq: 0,
        updatedAt: 1,
      });

      globalThis.fetch = routedFetch({
        '/api/characters': () => jsonResponse(200, []),
        '/api/campaigns': () => jsonResponse(200, []),
      });

      leaderState.set(true);
      const sync = TestBed.inject(SyncService);
      statusState.set('authed');
      TestBed.tick();
      await flush();

      expect(sync.membersFor(campaignId)()).toBeNull();

      const socket = FakeWebSocket.instances.find((s) => s.url === `ws://test/${streamId}`)!;
      socket.emitOpen();
      await flush();
      const initialMembers: MembersMsg['members'] = [
        { userId: 'u1', displayName: 'Ann', role: 'dm', online: true },
      ];
      socket.emitMessage(campaignWelcome(streamId, 0, initialMembers));
      await flush();
      expect(sync.membersFor(campaignId)()).toEqual(initialMembers);

      const updatedMembers: MembersMsg['members'] = [
        ...initialMembers,
        { userId: 'u2', displayName: 'Bo', role: 'member', online: false },
      ];
      socket.emitMessage({ t: 'members', members: updatedMembers });
      await flush();
      expect(sync.membersFor(campaignId)()).toEqual(updatedMembers);
    });

    it("bye 'campaign.member_removed': closes the session, drops the CampaignsRepository row (events stay), toasts, and navigates away from a /g/<id> route", async () => {
      const campaignId = '00000000-0000-4000-8000-0000000000c4';
      const streamId = `camp:${campaignId}`;
      await TestBed.inject(CampaignsRepository).put({
        id: campaignId,
        name: 'X',
        system: 'srd-5e-2024',
        role: 'player',
        lastSeq: 0,
        updatedAt: 1,
      });

      globalThis.fetch = routedFetch({
        '/api/characters': () => jsonResponse(200, []),
        '/api/campaigns': () => jsonResponse(200, []),
      });

      leaderState.set(true);
      const sync = TestBed.inject(SyncService);
      statusState.set('authed');
      TestBed.tick();
      await flush();

      const socket = FakeWebSocket.instances.find((s) => s.url === `ws://test/${streamId}`)!;
      socket.emitOpen();
      await flush();
      socket.emitMessage(campaignWelcome(streamId, 1));
      await flush();
      const committedEvent: Event = {
        id: '11111111-1111-7111-8111-111111111121',
        stream: streamId,
        seq: 1,
        ts: new Date().toISOString(),
        actor: { userId: 'u1', deviceId: 'd1', role: 'dm' },
        type: 'test.marker',
        v: 1,
        payload: {},
      } as unknown as Event;
      socket.emitMessage({ t: 'events', stream: streamId, events: [committedEvent] });
      await flush();

      routerMock.url = `/g/${campaignId}/party`;
      socket.emitMessage({ t: 'bye', reason: 'campaign.member_removed' });
      await flush();

      expect(socket.closeCalls.length).toBeGreaterThanOrEqual(1);
      expect(toastShow).toHaveBeenCalledWith('campaigns.removed.toast');
      expect(await TestBed.inject(CampaignsRepository).get(campaignId)).toBeUndefined();
      const eventsRepository = TestBed.inject(EventsRepository);
      expect(await eventsRepository.byStream(streamId)).toHaveLength(1); // events stay
      expect(routerMock.navigateByUrl).toHaveBeenCalledWith('/campaigns');
      expect(sync.syncState(streamId)()).toBe('offline');
    });

    it('bye with an unrecognized reason just closes the session — no drop, no toast, no navigate', async () => {
      const campaignId = '00000000-0000-4000-8000-0000000000c4a';
      const streamId = `camp:${campaignId}`;
      await TestBed.inject(CampaignsRepository).put({
        id: campaignId,
        name: 'X',
        system: 'srd-5e-2024',
        role: 'player',
        lastSeq: 0,
        updatedAt: 1,
      });

      globalThis.fetch = routedFetch({
        '/api/characters': () => jsonResponse(200, []),
        '/api/campaigns': () => jsonResponse(200, []),
      });

      leaderState.set(true);
      TestBed.inject(SyncService);
      statusState.set('authed');
      TestBed.tick();
      await flush();

      const socket = FakeWebSocket.instances.find((s) => s.url === `ws://test/${streamId}`)!;
      socket.emitOpen();
      await flush();

      routerMock.url = `/g/${campaignId}`;
      socket.emitMessage({ t: 'bye', reason: 'some.other.reason' });
      await flush();

      expect(socket.closeCalls.length).toBeGreaterThanOrEqual(1);
      expect(toastShow).not.toHaveBeenCalledWith('campaigns.removed.toast');
      expect(await TestBed.inject(CampaignsRepository).get(campaignId)).toBeDefined();
      expect(routerMock.navigateByUrl).not.toHaveBeenCalled();
    });

    it('notice frames (any key) forward to ToastService.show', async () => {
      const campaignId = '00000000-0000-4000-8000-0000000000c5';
      const streamId = `camp:${campaignId}`;
      await TestBed.inject(CampaignsRepository).put({
        id: campaignId,
        name: 'X',
        system: 'srd-5e-2024',
        role: 'player',
        lastSeq: 0,
        updatedAt: 1,
      });

      globalThis.fetch = routedFetch({
        '/api/characters': () => jsonResponse(200, []),
        '/api/campaigns': () => jsonResponse(200, []),
      });

      leaderState.set(true);
      TestBed.inject(SyncService);
      statusState.set('authed');
      TestBed.tick();
      await flush();

      const socket = FakeWebSocket.instances.find((s) => s.url === `ws://test/${streamId}`)!;
      socket.emitOpen();
      await flush();
      socket.emitMessage(campaignWelcome(streamId));
      await flush();
      toastShow.mockClear();

      socket.emitMessage({
        t: 'notice',
        level: 'info',
        key: 'campaigns.dm.pausedSession',
        params: { name: 'X' },
      });
      await flush();

      expect(toastShow).toHaveBeenCalledWith('campaigns.dm.pausedSession', { name: 'X' });
    });

    it('foreign events route to a registered consumer; unregistered campaigns ignore them; unsubscribe stops delivery', async () => {
      const campaignId = '00000000-0000-4000-8000-0000000000c6';
      const streamId = `camp:${campaignId}`;
      const foreignStreamId = 'char:00000000-0000-4000-8000-0000000000f1';
      await TestBed.inject(CampaignsRepository).put({
        id: campaignId,
        name: 'X',
        system: 'srd-5e-2024',
        role: 'dm',
        lastSeq: 0,
        updatedAt: 1,
      });

      globalThis.fetch = routedFetch({
        '/api/characters': () => jsonResponse(200, []),
        '/api/campaigns': () => jsonResponse(200, []),
      });

      leaderState.set(true);
      const sync = TestBed.inject(SyncService);
      statusState.set('authed');
      TestBed.tick();
      await flush();

      const socket = FakeWebSocket.instances.find((s) => s.url === `ws://test/${streamId}`)!;
      socket.emitOpen();
      await flush();
      socket.emitMessage(campaignWelcome(streamId));
      await flush();

      const foreignEvent: Event = {
        id: '11111111-1111-7111-8111-111111111131',
        stream: foreignStreamId,
        seq: 1,
        ts: new Date().toISOString(),
        actor: { userId: 'u1', deviceId: 'd1', role: 'owner' },
        type: 'test.marker',
        v: 1,
        payload: {},
      } as unknown as Event;

      // No consumer registered yet — must be a silent no-op, never written to storage.
      socket.emitMessage({ t: 'events', stream: foreignStreamId, events: [foreignEvent] });
      await flush();
      const eventsRepository = TestBed.inject(EventsRepository);
      expect(await eventsRepository.byStream(foreignStreamId)).toEqual([]);
      expect(await eventsRepository.byStream(streamId)).toEqual([]);

      const received: [string, Event[]][] = [];
      const unsubscribe = sync.registerForeignEventsConsumer(campaignId, (stream, events) => {
        received.push([stream, events]);
      });

      socket.emitMessage({ t: 'events', stream: foreignStreamId, events: [foreignEvent] });
      await flush();
      expect(received).toEqual([[foreignStreamId, [foreignEvent]]]);

      unsubscribe();
      socket.emitMessage({ t: 'events', stream: foreignStreamId, events: [foreignEvent] });
      await flush();
      expect(received).toHaveLength(1); // no further delivery after unsubscribe
    });

    it('binary frames route to a registered consumer; unregistered campaigns are a no-op', async () => {
      const campaignId = '00000000-0000-4000-8000-0000000000c7';
      const streamId = `camp:${campaignId}`;
      await TestBed.inject(CampaignsRepository).put({
        id: campaignId,
        name: 'X',
        system: 'srd-5e-2024',
        role: 'dm',
        lastSeq: 0,
        updatedAt: 1,
      });

      globalThis.fetch = routedFetch({
        '/api/characters': () => jsonResponse(200, []),
        '/api/campaigns': () => jsonResponse(200, []),
      });

      leaderState.set(true);
      const sync = TestBed.inject(SyncService);
      statusState.set('authed');
      TestBed.tick();
      await flush();

      const socket = FakeWebSocket.instances.find((s) => s.url === `ws://test/${streamId}`)!;
      socket.emitOpen();
      await flush();

      // No consumer registered — must not throw.
      expect(() => socket.emitBinary(new Uint8Array([9, 9]).buffer)).not.toThrow();

      const received: Uint8Array[] = [];
      sync.registerBinaryFrameConsumer(campaignId, (bytes) => received.push(bytes));
      socket.emitBinary(new Uint8Array([1, 2, 3]).buffer);
      await flush();
      expect(received).toHaveLength(1);
      expect(Array.from(received[0])).toEqual([1, 2, 3]);
    });

    it('wires StreamSyncSession onAckEntries/onRejectEntries to CampaignStore.handleGatewayAckEntries/handleGatewayRejectEntries', async () => {
      const campaignId = '00000000-0000-4000-8000-0000000000c8';
      const streamId = `camp:${campaignId}`;
      await TestBed.inject(CampaignsRepository).put({
        id: campaignId,
        name: 'X',
        system: 'srd-5e-2024',
        role: 'dm',
        lastSeq: 0,
        updatedAt: 1,
      });

      globalThis.fetch = routedFetch({
        '/api/characters': () => jsonResponse(200, []),
        '/api/campaigns': () => jsonResponse(200, []),
      });

      leaderState.set(true);
      TestBed.inject(SyncService);
      statusState.set('authed');
      TestBed.tick();
      await flush();

      const campaignStore = TestBed.inject(CampaignStore);
      const ackSpy = vi.spyOn(campaignStore, 'handleGatewayAckEntries');
      const rejectSpy = vi.spyOn(campaignStore, 'handleGatewayRejectEntries');

      const socket = FakeWebSocket.instances.find((s) => s.url === `ws://test/${streamId}`)!;
      socket.emitOpen();
      await flush();
      socket.emitMessage(campaignWelcome(streamId));
      await flush();

      socket.emitMessage({
        t: 'ack',
        rid: 'r2',
        results: [{ id: '11111111-1111-7111-8111-111111111141', seq: 1 }],
      });
      await flush();
      expect(ackSpy).toHaveBeenCalledWith([{ id: '11111111-1111-7111-8111-111111111141', seq: 1 }]);

      socket.emitMessage({
        t: 'reject',
        rid: 'r3',
        results: [
          { id: '11111111-1111-7111-8111-111111111142', code: 'forbidden', message: 'nope' },
        ],
      });
      await flush();
      expect(rejectSpy).toHaveBeenCalledWith([
        { id: '11111111-1111-7111-8111-111111111142', code: 'forbidden', message: 'nope' },
      ]);
    });

    it('presence: sends on visibility state change, throttles a same-window re-flip (≥60s), and drops a repeated same-state fire', async () => {
      const campaignId = '00000000-0000-4000-8000-0000000000c9';
      const streamId = `camp:${campaignId}`;
      await TestBed.inject(CampaignsRepository).put({
        id: campaignId,
        name: 'A',
        system: 'srd-5e-2024',
        role: 'dm',
        lastSeq: 0,
        updatedAt: 1,
      });

      globalThis.fetch = routedFetch({
        '/api/characters': () => jsonResponse(200, []),
        '/api/campaigns': () => jsonResponse(200, []),
      });

      leaderState.set(true);
      TestBed.inject(SyncService);
      statusState.set('authed');
      TestBed.tick();
      await flush();

      const socket = FakeWebSocket.instances.find((s) => s.url === `ws://test/${streamId}`)!;
      socket.emitOpen();
      await flush();
      socket.emitMessage(campaignWelcome(streamId));
      await flush();

      const nowSpy = vi.spyOn(Date, 'now');
      try {
        nowSpy.mockReturnValue(1_000_000);
        visibilityDoc.visibilityState = 'hidden';
        visibilityDoc.fire();
        await flush();
        expect(socket.parsedSent().filter((m) => m.t === 'presence')).toEqual([
          { t: 'presence', state: 'idle' },
        ]);

        // Re-firing with the SAME state must not send again (doc-03: state CHANGE only).
        visibilityDoc.fire();
        await flush();
        expect(socket.parsedSent().filter((m) => m.t === 'presence')).toHaveLength(1);

        // A genuine flip WITHIN the 60s throttle window is dropped (no queueing).
        nowSpy.mockReturnValue(1_000_000 + 59_000);
        visibilityDoc.visibilityState = 'visible';
        visibilityDoc.fire();
        await flush();
        expect(socket.parsedSent().filter((m) => m.t === 'presence')).toHaveLength(1);

        // Past the 60s window, the SAME flip now goes through.
        nowSpy.mockReturnValue(1_000_000 + 60_000);
        visibilityDoc.fire();
        await flush();
        expect(socket.parsedSent().filter((m) => m.t === 'presence')).toEqual([
          { t: 'presence', state: 'idle' },
          { t: 'presence', state: 'active' },
        ]);
      } finally {
        nowSpy.mockRestore();
      }
    });

    it('presence: independent per-session throttling — a fresh session sends immediately even while another is still throttled', async () => {
      const campaignIdA = '00000000-0000-4000-8000-0000000000ca';
      const campaignIdB = '00000000-0000-4000-8000-0000000000cb';
      const streamIdA = `camp:${campaignIdA}`;
      const streamIdB = `camp:${campaignIdB}`;
      const campaignsRepository = TestBed.inject(CampaignsRepository);
      await campaignsRepository.put({
        id: campaignIdA,
        name: 'A',
        system: 'srd-5e-2024',
        role: 'dm',
        lastSeq: 0,
        updatedAt: 1,
      });

      globalThis.fetch = routedFetch({
        '/api/characters': () => jsonResponse(200, []),
        '/api/campaigns': () => jsonResponse(200, []),
      });

      leaderState.set(true);
      TestBed.inject(SyncService);
      statusState.set('authed');
      TestBed.tick();
      await flush();

      const socketA = FakeWebSocket.instances.find((s) => s.url === `ws://test/${streamIdA}`)!;
      socketA.emitOpen();
      await flush();
      socketA.emitMessage(campaignWelcome(streamIdA));
      await flush();

      const nowSpy = vi.spyOn(Date, 'now');
      try {
        nowSpy.mockReturnValue(2_000_000);
        visibilityDoc.visibilityState = 'hidden';
        visibilityDoc.fire();
        await flush();
        expect(socketA.parsedSent().filter((m) => m.t === 'presence')).toEqual([
          { t: 'presence', state: 'idle' },
        ]);

        // Campaign B's session starts LATER, well within A's own throttle window — it must still
        // get its own first presence send once a fresh flip happens (no shared throttle state).
        await campaignsRepository.put({
          id: campaignIdB,
          name: 'B',
          system: 'srd-5e-2024',
          role: 'dm',
          lastSeq: 0,
          updatedAt: 1,
        });
        // Reuses the same auth-gated leader transition to force a fresh `reconcileCampaigns` pass
        // that picks up the just-added row (mirrors the "onCreate" shortcut's own generation-based
        // safety net — see class doc).
        leaderState.set(false);
        TestBed.tick();
        leaderState.set(true);
        TestBed.tick();
        await flush();

        const socketB = FakeWebSocket.instances.find((s) => s.url === `ws://test/${streamIdB}`)!;
        socketB.emitOpen();
        await flush();
        socketB.emitMessage(campaignWelcome(streamIdB));
        await flush();

        nowSpy.mockReturnValue(2_000_000 + 5_000); // well within A's 60s window
        visibilityDoc.visibilityState = 'visible';
        visibilityDoc.fire();
        await flush();

        // A: still throttled — no second send.
        expect(socketA.parsedSent().filter((m) => m.t === 'presence')).toHaveLength(1);
        // B: brand new session, no prior send recorded — goes through immediately.
        expect(socketB.parsedSent().filter((m) => m.t === 'presence')).toEqual([
          { t: 'presence', state: 'active' },
        ]);
      } finally {
        nowSpy.mockRestore();
      }
    });

    it("gateway attach: CampaignStore.setGateway tracks the session matching the store's open campaign, and detaches once that session is torn down", async () => {
      const campaignId = '00000000-0000-4000-8000-0000000000cc';
      const streamId = `camp:${campaignId}`;
      const campaignsRepository = TestBed.inject(CampaignsRepository);
      await campaignsRepository.put({
        id: campaignId,
        name: 'X',
        system: 'srd-5e-2024',
        role: 'dm',
        lastSeq: 0,
        updatedAt: 1,
      });

      globalThis.fetch = routedFetch({
        '/api/characters': () => jsonResponse(200, []),
        '/api/campaigns': () => jsonResponse(200, []),
      });

      leaderState.set(true);
      TestBed.inject(SyncService);
      statusState.set('authed');
      TestBed.tick();
      await flush();

      const campaignStore = TestBed.inject(CampaignStore);
      const setGatewaySpy = vi.spyOn(campaignStore, 'setGateway');

      await campaignStore.open(streamId);
      TestBed.tick();
      await flush();

      expect(setGatewaySpy).toHaveBeenCalled();
      const lastCall = setGatewaySpy.mock.calls.at(-1)!;
      expect(lastCall[0]).toBeDefined();
      expect(typeof lastCall[0]?.sendRaw).toBe('function');

      setGatewaySpy.mockClear();
      statusState.set('anon'); // logout tears down every session, including this campaign's
      TestBed.tick();
      await flush();

      expect(setGatewaySpy).toHaveBeenCalledWith(undefined);
    });
  });
});
