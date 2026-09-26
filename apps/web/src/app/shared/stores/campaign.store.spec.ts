import { signal, type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { Event, Pack } from '@hk/protocol';
import { AuthService, type AuthUser } from '../services/auth/auth.service';
import { CampaignsRepository } from '../services/storage/campaigns.repository';
import { HkDb } from '../services/storage/dexie.db';
import { EventsRepository } from '../services/storage/events.repository';
import { LeaderService } from '../services/storage/leader.service';
import { PackStore } from './pack.store';
import {
  CampaignGatewayUnavailableError,
  CampaignStore,
  CampaignStoreNotAuthenticatedError,
  CampaignStoreNotLeaderError,
} from './campaign.store';
import { SyncGapError } from './character.store';

/**
 * `CampaignStore` never inspects any `Pack` field beyond `id`/`version` (`create()`'s own
 * `corePack: {id, version}` payload) — unlike `character.store.spec.ts`, which needs the REAL
 * built SRD pack because `CharacterStore.sheet`/`facts` actually derive against it, this store has
 * no such computed signal. A minimal stub avoids a filesystem dependency on `pnpm --filter
 * @hk/content build:pack` having already run.
 */
const FAKE_CORE_PACK = { id: 'srd-5e-2024', version: '1.0.0' } as Pack;

/** `navigator.locks` is absent in jsdom — same single-holder exclusive-lock queue stub
 * `character.store.spec.ts` uses (see that file's header comment for why), duplicated here rather
 * than imported (a test-only fixture, not production code). */
class StubLockManager {
  private held = false;
  private readonly queue: (() => void)[] = [];

  request(
    _name: string,
    _options: { mode?: string },
    callback: () => Promise<void>,
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const attempt = (): void => {
        if (this.held) {
          this.queue.push(attempt);
          return;
        }
        this.held = true;
        callback().then(
          () => {
            this.held = false;
            resolve();
            this.queue.shift()?.();
          },
          (err: unknown) => {
            this.held = false;
            reject(err instanceof Error ? err : new Error(String(err)));
            this.queue.shift()?.();
          },
        );
      };
      attempt();
    });
  }
}

function installStubLocks(): StubLockManager {
  const stub = new StubLockManager();
  (navigator as unknown as { locks?: StubLockManager }).locks = stub;
  return stub;
}

function removeLocks(): void {
  delete (navigator as unknown as { locks?: StubLockManager }).locks;
}

// --- fetch stubbing (same style as auth.service.spec.ts's own routedFetch) ---------------------

type Handler = (init: RequestInit | undefined) => Response | Promise<Response>;

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function routedFetch(routes: Record<string, Handler>): ReturnType<typeof vi.fn<typeof fetch>> {
  return vi.fn<typeof fetch>(async (input, init) => {
    const url = requestUrl(input);
    const key = Object.keys(routes).find((k) =>
      k.endsWith('*') ? url.startsWith(k.slice(0, -1)) : url === k,
    );
    if (!key) throw new Error(`routedFetch: no handler declared for ${url}`);
    return routes[key](init);
  });
}

/** Polls until `predicate()` is true, so a test can wait out `gatewayAppend`'s internal `await`
 * points (`actor()`'s real Dexie `deviceId()` round trip runs BEFORE its `sendRaw` call) without
 * depending on exactly how many macrotask hops fake-indexeddb's own scheduling needs — a single
 * fixed `setTimeout(0)` flush proved flaky (real IndexedDB backends resolve over an
 * implementation-defined number of ticks). Throws loudly on timeout rather than hanging the run. */
async function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor: timed out waiting for predicate');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

interface RequestBody {
  id?: string;
  name?: string;
  system?: string;
  code?: string;
  displayName?: string;
  corePack?: { id: string; version: string };
}

function jsonBody(init: RequestInit | undefined): RequestBody {
  return JSON.parse(init!.body as string) as RequestBody;
}

/** Builds a raw, already-server-seq'd (or pending, when `seq` is omitted) campaign event for
 * `applyServerCommit`/`commitPending`/`dropPending` fixtures — same role `character.store.spec.ts`'s
 * inline `serverEvent` object literals play, factored into one helper since this file needs many. */
function campaignEvent(
  streamId: string,
  id: string,
  type: string,
  v: number,
  payload: unknown,
  actor: Event['actor'],
  seq?: number,
): Event {
  return {
    id,
    stream: streamId,
    ...(seq !== undefined ? { seq } : {}),
    ts: new Date().toISOString(),
    actor,
    type,
    v,
    payload,
  };
}

const DM_ACTOR: Event['actor'] = { userId: 'u1', deviceId: 'srv', role: 'dm' };

function configure(): {
  userState: WritableSignal<AuthUser | null>;
  readyState: WritableSignal<boolean>;
} {
  const userState = signal<AuthUser | null>({ userId: 'u1', username: 'alice' });
  const readyState = signal(true);
  TestBed.configureTestingModule({
    providers: [
      { provide: PackStore, useValue: { ready: readyState, corePack: signal(FAKE_CORE_PACK) } },
      { provide: AuthService, useValue: { user: userState } },
    ],
  });
  return { userState, readyState };
}

describe('CampaignStore', () => {
  let userState: WritableSignal<AuthUser | null>;
  let readyState: WritableSignal<boolean>;
  const originalFetch = globalThis.fetch;

  beforeEach(async () => {
    ({ userState, readyState } = configure());
    const db = TestBed.inject(HkDb);
    await Promise.all([db.events.clear(), db.campaigns.clear(), db.settings.clear()]);
  });

  afterEach(() => {
    removeLocks();
    globalThis.fetch = originalFetch;
    TestBed.inject(HkDb).close();
  });

  // --- open ------------------------------------------------------------------------------------

  it('open of a stream with no local events yields loaded=true, a blank projected state, and seeds a defensive player-role index row', async () => {
    const store = TestBed.inject(CampaignStore);
    const streamId = 'camp:11111111-1111-1111-1111-111111111111';

    await store.open(streamId);

    expect(store.streamId()).toBe(streamId);
    expect(store.campaignId()).toBe('11111111-1111-1111-1111-111111111111');
    expect(store.loaded()).toBe(true);
    expect(store.events()).toEqual([]);
    expect(store.role()).toBeUndefined();
    expect(store.state()).toEqual({
      name: '',
      system: '',
      settings: null,
      members: new Map(),
      roster: new Map(),
      packs: new Map(),
      overviews: new Map(),
      session: { active: false },
      log: [],
      dmNotes: new Map(),
      archived: false,
    });

    // Defensive fallback (class doc's `upsertCampaignRow` note): a row is seeded even though this
    // stream was never create()d/join()ed through this store.
    const row = await TestBed.inject(CampaignsRepository).get(
      '11111111-1111-1111-1111-111111111111',
    );
    expect(row?.role).toBe('player');
  });

  // --- create ----------------------------------------------------------------------------------

  describe('create', () => {
    it('POSTs {id,name,system,corePack} with a fresh uuidv7 id, caches the DM index row, and opens the (still-empty) stream', async () => {
      globalThis.fetch = routedFetch({
        '/api/campaigns': (init) => {
          const body = jsonBody(init);
          expect(body.name).toBe('My Campaign');
          expect(body.system).toBe('dnd5e-2024');
          expect(body.corePack).toEqual({ id: 'srd-5e-2024', version: '1.0.0' });
          expect(typeof body.id).toBe('string');
          expect(body.displayName).toBeUndefined();
          return jsonResponse(201, {
            id: body.id,
            name: body.name,
            system: body.system,
            role: 'dm',
            joinCode: 'ABCD-2345',
          });
        },
      });

      const store = TestBed.inject(CampaignStore);
      const streamId = await store.create('My Campaign', 'dnd5e-2024');

      expect(streamId).toMatch(
        /^camp:[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
      expect(store.streamId()).toBe(streamId);
      expect(store.loaded()).toBe(true);
      expect(store.role()).toBe('dm');
      // Blank until a live session catches the stream up — class doc's "Always-synced" section.
      expect(store.state()?.name).toBe('');

      const row = await TestBed.inject(CampaignsRepository).get(store.campaignId()!);
      expect(row?.updatedAt).toEqual(expect.any(Number));
      expect(row).toEqual({
        id: store.campaignId(),
        name: 'My Campaign',
        system: 'dnd5e-2024',
        role: 'dm',
        joinCode: 'ABCD-2345',
        lastSeq: 0,
        updatedAt: row?.updatedAt,
      });
    });

    it('uses opts.id instead of generating one, and forwards opts.displayName', async () => {
      const fixedId = '22222222-2222-2222-2222-222222222222';
      globalThis.fetch = routedFetch({
        '/api/campaigns': (init) => {
          const body = jsonBody(init);
          expect(body.id).toBe(fixedId);
          expect(body.displayName).toBe('DM Bob');
          return jsonResponse(201, { id: fixedId, name: 'X', system: 'sys', role: 'dm' });
        },
      });

      const store = TestBed.inject(CampaignStore);
      const streamId = await store.create('X', 'sys', { id: fixedId, displayName: 'DM Bob' });

      expect(streamId).toBe(`camp:${fixedId}`);
    });

    it('throws CampaignStoreNotLeaderError without ever calling fetch, when this tab is not the leader', async () => {
      installStubLocks();
      const otherTab = TestBed.runInInjectionContext(() => new LeaderService());
      await otherTab.acquire();

      const fetchMock = vi.fn<typeof fetch>();
      globalThis.fetch = fetchMock;
      const store = TestBed.inject(CampaignStore);

      await expect(store.create('X', 'sys')).rejects.toThrow(CampaignStoreNotLeaderError);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('throws CampaignStoreNotAuthenticatedError without ever calling fetch, when no user is signed in', async () => {
      userState.set(null);
      const fetchMock = vi.fn<typeof fetch>();
      globalThis.fetch = fetchMock;
      const store = TestBed.inject(CampaignStore);

      await expect(store.create('X', 'sys')).rejects.toThrow(CampaignStoreNotAuthenticatedError);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('throws without calling fetch when packs are not ready yet', async () => {
      readyState.set(false);
      const fetchMock = vi.fn<typeof fetch>();
      globalThis.fetch = fetchMock;
      const store = TestBed.inject(CampaignStore);

      await expect(store.create('X', 'sys')).rejects.toThrow(/packs are not ready/);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  // --- join ------------------------------------------------------------------------------------

  describe('join', () => {
    it('POSTs {code,displayName?}, seeds a placeholder player row on a fresh join, and opens the stream', async () => {
      globalThis.fetch = routedFetch({
        '/api/campaigns/join': (init) => {
          const body = jsonBody(init);
          expect(body.code).toBe('ABCD-1234');
          expect(body.displayName).toBeUndefined();
          return jsonResponse(200, { campaignId: '33333333-3333-3333-3333-333333333333' });
        },
      });

      const store = TestBed.inject(CampaignStore);
      const streamId = await store.join('ABCD-1234');

      expect(streamId).toBe('camp:33333333-3333-3333-3333-333333333333');
      expect(store.role()).toBe('player');
      const row = await TestBed.inject(CampaignsRepository).get(
        '33333333-3333-3333-3333-333333333333',
      );
      expect(row?.updatedAt).toEqual(expect.any(Number));
      expect(row).toEqual({
        id: '33333333-3333-3333-3333-333333333333',
        name: '',
        system: '',
        role: 'player',
        joinCode: undefined,
        lastSeq: 0,
        updatedAt: row?.updatedAt,
      });
    });

    it('on a rejoin, preserves the existing cached row name/system/role/joinCode verbatim', async () => {
      await TestBed.inject(CampaignsRepository).put({
        id: '44444444-4444-4444-4444-444444444444',
        name: 'Old Name',
        system: 'old-sys',
        role: 'dm',
        joinCode: 'ZZZZ-0000',
        lastSeq: 7,
        updatedAt: 1,
      });
      globalThis.fetch = routedFetch({
        '/api/campaigns/join': () =>
          jsonResponse(200, { campaignId: '44444444-4444-4444-4444-444444444444' }),
      });

      const store = TestBed.inject(CampaignStore);
      await store.join('WHATEVER-CODE');

      const row = await TestBed.inject(CampaignsRepository).get(
        '44444444-4444-4444-4444-444444444444',
      );
      expect(row?.name).toBe('Old Name');
      expect(row?.system).toBe('old-sys');
      expect(row?.role).toBe('dm');
      expect(row?.joinCode).toBe('ZZZZ-0000');
    });

    it('throws CampaignStoreNotLeaderError without ever calling fetch, when this tab is not the leader', async () => {
      installStubLocks();
      const otherTab = TestBed.runInInjectionContext(() => new LeaderService());
      await otherTab.acquire();

      const fetchMock = vi.fn<typeof fetch>();
      globalThis.fetch = fetchMock;
      const store = TestBed.inject(CampaignStore);

      await expect(store.join('CODE')).rejects.toThrow(CampaignStoreNotLeaderError);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('throws CampaignStoreNotAuthenticatedError without ever calling fetch, when no user is signed in', async () => {
      userState.set(null);
      const fetchMock = vi.fn<typeof fetch>();
      globalThis.fetch = fetchMock;
      const store = TestBed.inject(CampaignStore);

      await expect(store.join('CODE')).rejects.toThrow(CampaignStoreNotAuthenticatedError);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  // --- appendTx --------------------------------------------------------------------------------

  describe('appendTx', () => {
    it('writes seq-less pending rows against the open stream, and state reflects them immediately', async () => {
      const store = TestBed.inject(CampaignStore);
      const streamId = 'camp:55555555-5555-5555-5555-555555555555';
      await store.open(streamId);

      await store.appendTx([{ type: 'campaign.renamed', v: 1, payload: { name: 'New Name' } }]);

      expect(store.state()?.name).toBe('New Name');
      const last = store.events().at(-1);
      expect(last?.seq).toBeUndefined();
      expect(last?.actor.userId).toBe('u1');
      const persisted = await TestBed.inject(EventsRepository).byStream(streamId);
      expect(persisted.at(-1)?.seq).toBeUndefined();
    });

    it('accepts member.renamed with a payload carrying ONLY displayName — never injects a userId (MemberRenamedV1 has none)', async () => {
      const store = TestBed.inject(CampaignStore);
      await store.open('camp:66666666-6666-6666-6666-666666666666');

      await store.appendTx([
        { type: 'member.renamed', v: 1, payload: { displayName: 'New Name' } },
      ]);

      expect(store.events().at(-1)?.payload).toEqual({ displayName: 'New Name' });
    });

    it('refuses an event.reverted draft outright — campaign streams have no revert()', async () => {
      const store = TestBed.inject(CampaignStore);
      await store.open('camp:77777777-7777-7777-7777-777777777777');

      await expect(store.appendTx([{ type: 'event.reverted', v: 1, payload: {} }])).rejects.toThrow(
        /event\.reverted/,
      );
    });

    it('throws when no campaign is open', async () => {
      const store = TestBed.inject(CampaignStore);
      await expect(
        store.appendTx([{ type: 'campaign.renamed', v: 1, payload: { name: 'X' } }]),
      ).rejects.toThrow(/no campaign loaded/);
    });

    it('throws CampaignStoreNotLeaderError when this tab is not the leader', async () => {
      installStubLocks();
      const otherTab = TestBed.runInInjectionContext(() => new LeaderService());
      await otherTab.acquire();
      const store = TestBed.inject(CampaignStore);

      await expect(
        store.appendTx([{ type: 'campaign.renamed', v: 1, payload: { name: 'X' } }]),
      ).rejects.toThrow(CampaignStoreNotLeaderError);
    });

    it('onLocalAppend fires with the pending events after the write has durably committed', async () => {
      const store = TestBed.inject(CampaignStore);
      const streamId = 'camp:88888888-8888-8888-8888-888888888888';
      await store.open(streamId);

      const calls: { streamId: string; events: Event[] }[] = [];
      const unsubscribe = store.onLocalAppend((sid, events) =>
        calls.push({ streamId: sid, events }),
      );

      await store.appendTx([{ type: 'campaign.renamed', v: 1, payload: { name: 'First' } }]);
      expect(calls).toHaveLength(1);
      expect(calls[0]?.streamId).toBe(streamId);
      expect(calls[0]?.events).toHaveLength(1);
      const persisted = await TestBed.inject(EventsRepository).byStream(streamId);
      expect(persisted.at(-1)?.seq).toBeUndefined();

      unsubscribe();
      await store.appendTx([{ type: 'campaign.renamed', v: 1, payload: { name: 'Second' } }]);
      expect(calls).toHaveLength(1); // still 1 — unsubscribed
    });
  });

  // --- applyServerCommit -------------------------------------------------------------------------

  describe('applyServerCommit', () => {
    it('appends new events at their given server seqs and updates state', async () => {
      const store = TestBed.inject(CampaignStore);
      const streamId = 'camp:99999999-9999-9999-9999-999999999999';
      await store.open(streamId);

      const created = campaignEvent(
        streamId,
        '10000000-0000-0000-0000-000000000001',
        'campaign.created',
        1,
        { name: 'Server Camp', system: 'sys', corePack: { id: 'srd-5e-2024', version: '1.0.0' } },
        DM_ACTOR,
        1,
      );

      await store.applyServerCommit(streamId, [created]);

      expect(store.state()?.name).toBe('Server Camp');
      const persisted = await TestBed.inject(EventsRepository).byStream(streamId);
      expect(persisted.find((e) => e.id === created.id)?.seq).toBe(1);
    });

    it("TRANSITIONS a pending echo of this device's own event in place — the projected log ends up with exactly ONE entry, not two (Task 3 review contract pin)", async () => {
      const store = TestBed.inject(CampaignStore);
      const streamId = 'camp:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
      await store.open(streamId);

      const created = campaignEvent(
        streamId,
        '10000000-0000-0000-0000-000000000002',
        'campaign.created',
        1,
        { name: 'Camp', system: 'sys', corePack: { id: 'srd-5e-2024', version: '1.0.0' } },
        DM_ACTOR,
        1,
      );
      await store.applyServerCommit(streamId, [created]);

      await store.appendTx([
        { type: 'chat.message', v: 1, payload: { text: 'hi', visibility: 'everyone' } },
      ]);
      const pendingEvent = store.events().at(-1)!;
      expect(pendingEvent.seq).toBeUndefined();
      expect(store.state()?.log.filter((l) => l.kind === 'chat')).toHaveLength(1);

      const echo: Event = { ...pendingEvent, seq: 2 };
      await store.applyServerCommit(streamId, [echo]);

      expect(store.events().filter((e) => e.id === pendingEvent.id)).toHaveLength(1);
      expect(store.events().find((e) => e.id === pendingEvent.id)?.seq).toBe(2);
      expect(store.state()?.log.filter((l) => l.kind === 'chat')).toHaveLength(1);
      const persisted = await TestBed.inject(EventsRepository).byStream(streamId);
      expect(persisted.filter((e) => e.id === pendingEvent.id)).toHaveLength(1);
    });

    it('throws SyncGapError on a genuine gap, writing nothing', async () => {
      const store = TestBed.inject(CampaignStore);
      const streamId = 'camp:bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
      await store.open(streamId);

      const gappy = campaignEvent(
        streamId,
        '10000000-0000-0000-0000-000000000003',
        'campaign.renamed',
        1,
        { name: 'X' },
        DM_ACTOR,
        5,
      );

      await expect(store.applyServerCommit(streamId, [gappy])).rejects.toThrow(SyncGapError);
      const persisted = await TestBed.inject(EventsRepository).byStream(streamId);
      expect(persisted).toHaveLength(0);
    });

    it('tolerates a benign echo of an already-committed row, and throws on a disagreeing one', async () => {
      const store = TestBed.inject(CampaignStore);
      const streamId = 'camp:cccccccc-cccc-cccc-cccc-cccccccccccc';
      await store.open(streamId);
      const created = campaignEvent(
        streamId,
        '10000000-0000-0000-0000-000000000004',
        'campaign.created',
        1,
        { name: 'Camp', system: 'sys', corePack: { id: 'srd-5e-2024', version: '1.0.0' } },
        DM_ACTOR,
        1,
      );
      await store.applyServerCommit(streamId, [created]);

      await expect(store.applyServerCommit(streamId, [created])).resolves.toBeUndefined();
      await expect(store.applyServerCommit(streamId, [{ ...created, seq: 99 }])).rejects.toThrow(
        SyncGapError,
      );
    });

    it('throws CampaignStoreNotLeaderError when this tab is not the leader', async () => {
      installStubLocks();
      const otherTab = TestBed.runInInjectionContext(() => new LeaderService());
      await otherTab.acquire();
      const store = TestBed.inject(CampaignStore);

      await expect(
        store.applyServerCommit('camp:dddddddd-dddd-dddd-dddd-dddddddddddd', []),
      ).rejects.toThrow(CampaignStoreNotLeaderError);
    });
  });

  // --- commitPending / dropPending, including gateway-id routing ---------------------------------

  describe('commitPending', () => {
    it('a full ack commits the pending rows at their server seqs', async () => {
      const store = TestBed.inject(CampaignStore);
      const streamId = 'camp:eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
      await store.open(streamId);
      await store.appendTx([{ type: 'campaign.renamed', v: 1, payload: { name: 'Synced Name' } }]);
      const pendingEvent = store.events().at(-1)!;

      await store.commitPending(streamId, [{ id: pendingEvent.id, seq: 1 }]);

      const persisted = await TestBed.inject(EventsRepository).byStream(streamId);
      expect(persisted.find((e) => e.id === pendingEvent.id)?.seq).toBe(1);
      expect(store.state()?.name).toBe('Synced Name');
    });

    it('a PARTIAL prefix ack commits only the acked rows, leaving the rest pending', async () => {
      const store = TestBed.inject(CampaignStore);
      const streamId = 'camp:ffffffff-ffff-ffff-ffff-ffffffffffff';
      await store.open(streamId);
      await store.appendTx([
        { type: 'campaign.renamed', v: 1, payload: { name: 'One' } },
        { type: 'campaign.renamed', v: 1, payload: { name: 'Two' } },
        { type: 'campaign.renamed', v: 1, payload: { name: 'Three' } },
      ]);
      const before = await TestBed.inject(EventsRepository).byStream(streamId);
      const pending = before.filter((e) => e.seq === undefined);
      expect(pending).toHaveLength(3);

      await store.commitPending(streamId, [{ id: pending[0].id, seq: 1 }]);

      const after = await TestBed.inject(EventsRepository).byStream(streamId);
      const stillPending = after.filter((e) => e.seq === undefined);
      expect(stillPending.map((e) => e.id)).toEqual([pending[1].id, pending[2].id]);
      expect(after.find((e) => e.id === pending[0].id)?.seq).toBe(1);
      expect(store.state()?.name).toBe('Three');
    });

    it('throws SyncGapError on an ack-seq mismatch, writing nothing', async () => {
      const store = TestBed.inject(CampaignStore);
      const streamId = 'camp:12121212-1212-1212-1212-121212121212';
      await store.open(streamId);
      await store.appendTx([{ type: 'campaign.renamed', v: 1, payload: { name: 'Pending' } }]);
      const pendingEvent = store.events().at(-1)!;

      await expect(
        store.commitPending(streamId, [{ id: pendingEvent.id, seq: 99 }]),
      ).rejects.toThrow(SyncGapError);
      const persisted = await TestBed.inject(EventsRepository).byStream(streamId);
      expect(persisted.find((e) => e.id === pendingEvent.id)?.seq).toBeUndefined();
    });

    it("routes an ack belonging to an outstanding gatewayAppend call to that call instead of the campaign's own pending-prefix walk, without throwing", async () => {
      const store = TestBed.inject(CampaignStore);
      const streamId = 'camp:13131313-1313-1313-1313-131313131313';
      await store.open(streamId);
      const sendRaw = vi.fn();
      store.setGateway({ sendRaw });

      const promise = store.gatewayAppend('bbbbbbbb-0000-0000-0000-000000000001', [
        { type: 'character.renamed', v: 1, payload: { name: 'Pregen' } },
      ]);
      await waitFor(() => sendRaw.mock.calls.length > 0);
      const sentId = (sendRaw.mock.calls[0][0] as { events: Event[] }).events[0].id;

      await expect(
        store.commitPending(streamId, [{ id: sentId, seq: 999 }]),
      ).resolves.toBeUndefined();
      await expect(promise).resolves.toEqual({ acked: [{ id: sentId, seq: 999 }], rejected: [] });

      // Never entered the campaign's own Dexie stream.
      const persisted = await TestBed.inject(EventsRepository).byStream(streamId);
      expect(persisted.some((e) => e.id === sentId)).toBe(false);
    });

    it('throws CampaignStoreNotLeaderError when this tab is not the leader', async () => {
      installStubLocks();
      const otherTab = TestBed.runInInjectionContext(() => new LeaderService());
      await otherTab.acquire();
      const store = TestBed.inject(CampaignStore);

      await expect(
        store.commitPending('camp:14141414-1414-1414-1414-141414141414', []),
      ).rejects.toThrow(CampaignStoreNotLeaderError);
    });
  });

  describe('dropPending', () => {
    it('removes the named pending rows and replays without them', async () => {
      const store = TestBed.inject(CampaignStore);
      const streamId = 'camp:15151515-1515-1515-1515-151515151515';
      await store.open(streamId);
      await store.appendTx([{ type: 'campaign.renamed', v: 1, payload: { name: 'Rejected' } }]);
      const rejectedId = store.events().at(-1)!.id;

      await store.dropPending(streamId, [rejectedId]);

      expect(store.state()?.name).toBe('');
      expect(store.events().some((e) => e.id === rejectedId)).toBe(false);
      const persisted = await TestBed.inject(EventsRepository).byStream(streamId);
      expect(persisted.some((e) => e.id === rejectedId)).toBe(false);
    });

    it('routes a reject belonging to an outstanding gatewayAppend call to that call — rejected entry carries {id} only, code/message unavailable', async () => {
      const store = TestBed.inject(CampaignStore);
      const streamId = 'camp:16161616-1616-1616-1616-161616161616';
      await store.open(streamId);
      const sendRaw = vi.fn();
      store.setGateway({ sendRaw });

      const promise = store.gatewayAppend('bbbbbbbb-0000-0000-0000-000000000002', [
        { type: 'character.renamed', v: 1, payload: { name: 'Pregen' } },
      ]);
      await waitFor(() => sendRaw.mock.calls.length > 0);
      const sentId = (sendRaw.mock.calls[0][0] as { events: Event[] }).events[0].id;

      await expect(store.dropPending(streamId, [sentId])).resolves.toBeUndefined();
      await expect(promise).resolves.toEqual({ acked: [], rejected: [{ id: sentId }] });
    });

    it('throws CampaignStoreNotLeaderError when this tab is not the leader', async () => {
      installStubLocks();
      const otherTab = TestBed.runInInjectionContext(() => new LeaderService());
      await otherTab.acquire();
      const store = TestBed.inject(CampaignStore);

      await expect(
        store.dropPending('camp:17171717-1717-1717-1717-171717171717', []),
      ).rejects.toThrow(CampaignStoreNotLeaderError);
    });
  });

  // --- gatewayAppend -----------------------------------------------------------------------------

  describe('gatewayAppend', () => {
    it('throws CampaignGatewayUnavailableError immediately when no gateway is attached', async () => {
      const store = TestBed.inject(CampaignStore);
      await expect(
        store.gatewayAppend('bbbbbbbb-0000-0000-0000-000000000003', [
          { type: 'character.renamed', v: 1, payload: { name: 'X' } },
        ]),
      ).rejects.toThrow(CampaignGatewayUnavailableError);
    });

    it("sends a char:<id> append frame via sendRaw and does NOT write anything to the campaign's own Dexie stream", async () => {
      const store = TestBed.inject(CampaignStore);
      const streamId = 'camp:18181818-1818-1818-1818-181818181818';
      await store.open(streamId);
      const sendRaw = vi.fn();
      store.setGateway({ sendRaw });

      const promise = store.gatewayAppend('bbbbbbbb-0000-0000-0000-000000000004', [
        { type: 'character.renamed', v: 1, payload: { name: 'Pregen Name' } },
      ]);
      await waitFor(() => sendRaw.mock.calls.length > 0);

      expect(sendRaw).toHaveBeenCalledTimes(1);
      const msg = sendRaw.mock.calls[0][0] as { t: string; rid: string; events: Event[] };
      expect(msg.t).toBe('append');
      expect(msg.events).toHaveLength(1);
      expect(msg.events[0].stream).toBe('char:bbbbbbbb-0000-0000-0000-000000000004');
      expect(msg.events[0].seq).toBeUndefined();
      const sentId = msg.events[0].id;

      const persisted = await TestBed.inject(EventsRepository).byStream(streamId);
      expect(persisted.some((e) => e.id === sentId)).toBe(false);

      await store.commitPending(streamId, [{ id: sentId, seq: 7 }]);
      await expect(promise).resolves.toEqual({ acked: [{ id: sentId, seq: 7 }], rejected: [] });
    });

    it('resolves with a MIXED outcome once every event in the batch has been acked or rejected', async () => {
      const store = TestBed.inject(CampaignStore);
      const streamId = 'camp:19191919-1919-1919-1919-191919191919';
      await store.open(streamId);
      const sendRaw = vi.fn();
      store.setGateway({ sendRaw });

      const promise = store.gatewayAppend('bbbbbbbb-0000-0000-0000-000000000005', [
        { type: 'character.renamed', v: 1, payload: { name: 'A' } },
        { type: 'character.renamed', v: 1, payload: { name: 'B' } },
      ]);
      await waitFor(() => sendRaw.mock.calls.length > 0);
      const sentEvents = sendRaw.mock.calls[0][0] as { events: Event[] };
      const [idA, idB] = sentEvents.events.map((e) => e.id);

      await store.commitPending(streamId, [{ id: idA, seq: 3 }]);
      await store.dropPending(streamId, [idB]);

      await expect(promise).resolves.toEqual({
        acked: [{ id: idA, seq: 3 }],
        rejected: [{ id: idB }],
      });
    });

    it('setGateway(undefined) rejects every currently in-flight call with CampaignGatewayUnavailableError', async () => {
      const store = TestBed.inject(CampaignStore);
      await store.open('camp:20202020-2020-2020-2020-202020202020');
      const sendRaw = vi.fn();
      store.setGateway({ sendRaw });

      const promise = store.gatewayAppend('bbbbbbbb-0000-0000-0000-000000000006', [
        { type: 'character.renamed', v: 1, payload: { name: 'X' } },
      ]);
      // Let the batch actually register (sendRaw called) BEFORE detaching, so this pins the
      // "already in flight" case rather than racing gatewayAppend's own synchronous port check.
      await waitFor(() => sendRaw.mock.calls.length > 0);
      expect(sendRaw).toHaveBeenCalledTimes(1);

      store.setGateway(undefined);

      await expect(promise).rejects.toThrow(CampaignGatewayUnavailableError);
    });

    it('throws CampaignStoreNotLeaderError without ever calling sendRaw, when this tab is not the leader', async () => {
      installStubLocks();
      const otherTab = TestBed.runInInjectionContext(() => new LeaderService());
      await otherTab.acquire();
      const store = TestBed.inject(CampaignStore);
      const sendRaw = vi.fn();
      store.setGateway({ sendRaw });

      await expect(
        store.gatewayAppend('bbbbbbbb-0000-0000-0000-000000000007', [
          { type: 'character.renamed', v: 1, payload: { name: 'X' } },
        ]),
      ).rejects.toThrow(CampaignStoreNotLeaderError);
      expect(sendRaw).not.toHaveBeenCalled();
    });
  });
});
