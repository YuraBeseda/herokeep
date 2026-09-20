/**
 * Task 6: `CharacterActor`, `/api/characters/*` routes, the WS handoff, and `createApp`'s
 * composition. Route-level tests run the REAL `createApp` (task-6-brief: "app-level tests where
 * they fit") over `app.request()`, a real in-memory `Db` (`test/helpers/test-db.ts`), and a
 * `FakeStreamHost`/`FakeStreamStore` for stream data; `CharacterActor`-level tests run directly
 * against `FakeStreamStore`/`FakeConnections`, mirroring `stream-actor.test.ts`'s own pattern.
 */
import type { Actor, Event } from '@hk/protocol';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/core/app.ts';
import { CharacterActor } from '../../src/core/streams/character-actor.ts';
import { uuidv7 } from '../../src/core/ids.ts';
import * as permissions from '../../src/core/permissions.ts';
import * as quotas from '../../src/core/quotas.ts';
import { USER_CHARACTER_COUNT_MAX, USER_QUOTA_BYTES_MAX } from '../../src/core/quotas.ts';
import {
  adjustUserQuotaBytes,
  countCharactersForOwner,
  getUserQuotaBytes,
  upsertCharacterIndexRow,
} from '../../src/core/db/queries.ts';
import type { StaticAssets } from '../../src/ports/infra.ts';
import { FakeConnections } from '../helpers/fake-connections.ts';
import { FakeStreamHost } from '../helpers/fake-stream-host.ts';
import { FakeStreamStore } from '../helpers/fake-stream-store.ts';
import { createTestConfig, InMemoryRateLimit } from '../helpers/fake-ports.ts';
import { openTestDb, type TestDbHandle } from '../helpers/test-db.ts';

const XRW = { 'X-Requested-With': 'herokeep', 'Content-Type': 'application/json' };
const APP_ORIGIN = 'https://app.test.local'; // matches fake-ports.ts's TEST_SECRETS.APP_ORIGIN

function verifierHex(seed = 'a'): string {
  return seed.repeat(Math.ceil(64 / seed.length)).slice(0, 64);
}
function saltHex(seed = 'b'): string {
  return seed.repeat(Math.ceil(32 / seed.length)).slice(0, 32);
}

let handle: TestDbHandle;
let streamHost: FakeStreamHost;
let wsUpgradeCalls: { streamId: string; userId: string; role: string }[];
let app: ReturnType<typeof createApp>;

const fakeStaticAssets: StaticAssets = { fetch: () => Promise.resolve(null) };

beforeEach(() => {
  handle = openTestDb();
  streamHost = new FakeStreamHost();
  wsUpgradeCalls = [];
  app = createApp({
    db: handle.db,
    config: createTestConfig(),
    rateLimit: new InMemoryRateLimit(),
    streamHost,
    wsUpgrade: {
      // A real adapter answers the WS handshake itself (Cloudflare: a genuine 101 from the DO;
      // Node: the raw `http.Server` upgrade, per this port's own doc comment) — the Fetch-spec
      // `Response` constructor rejects status 101 outright (only 200-599 are constructible), so
      // this fake stands in with an ordinary 200 + marker header, matching the port's "never
      // observed by a real client" contract for the Node case.
      upgrade: (_request, ctx) => {
        wsUpgradeCalls.push(ctx);
        return Promise.resolve(new Response(null, { status: 200, headers: { 'X-Ws-Upgrade': '1' } }));
      },
    },
    staticAssets: fakeStaticAssets,
  });
});

afterEach(() => {
  handle.close();
});

async function register(username: string, verifier: string) {
  return app.request('/api/auth/register', {
    method: 'POST',
    headers: XRW,
    body: JSON.stringify({ username, verifier, salt: saltHex() }),
  });
}

/** Registers (if not already) and logs in, returning the `name=value` cookie pair — same helper
 * shape as `auth-sessions.test.ts`'s `loginAndGetCookie`. */
async function loginAndGetCookie(username: string, verifier: string): Promise<string> {
  await register(username, verifier);
  const res = await app.request('/api/auth/login', {
    method: 'POST',
    headers: XRW,
    body: JSON.stringify({ username, verifier, deviceLabel: 'Test device' }),
  });
  const setCookie = res.headers.get('set-cookie');
  if (!setCookie) throw new Error('login did not set a session cookie');
  return setCookie.split(';')[0]!;
}

async function meUserId(cookie: string): Promise<string> {
  const res = await app.request('/api/me', { headers: { ...XRW, cookie } });
  const body = (await res.json()) as { userId: string };
  return body.userId;
}

describe('GET /api/health', () => {
  it('is 200 {ok: true} without a session', async () => {
    const res = await app.request('/api/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});

describe('unauthenticated access', () => {
  it('401s GET /api/characters without a session', async () => {
    expect((await app.request('/api/characters')).status).toBe(401);
  });

  it('401s POST /api/characters without a session', async () => {
    const res = await app.request('/api/characters', {
      method: 'POST',
      headers: XRW,
      body: JSON.stringify({ id: uuidv7(), name: 'Aria', system: 'srd-5e-2024' }),
    });
    expect(res.status).toBe(401);
  });

  it('401s DELETE /api/characters/:id without a session', async () => {
    expect((await app.request(`/api/characters/${uuidv7()}`, { method: 'DELETE', headers: XRW })).status).toBe(401);
  });

  it('401s POST /api/characters/:id/archive without a session', async () => {
    const res = await app.request(`/api/characters/${uuidv7()}/archive`, { method: 'POST', headers: XRW });
    expect(res.status).toBe(401);
  });

  it('401s GET /api/characters/:id/ws without a session', async () => {
    const res = await app.request(`/api/characters/${uuidv7()}/ws`, { headers: { Origin: APP_ORIGIN } });
    expect(res.status).toBe(401);
  });
});

describe('character create/list/delete lifecycle', () => {
  it('creates a character, lists it for its owner, and updates the D1 quota count', async () => {
    const cookie = await loginAndGetCookie('Wren', verifierHex('1'));
    const userId = await meUserId(cookie);
    const id = uuidv7();

    const createRes = await app.request('/api/characters', {
      method: 'POST',
      headers: { ...XRW, cookie },
      body: JSON.stringify({ id, name: 'Aria', system: 'srd-5e-2024' }),
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { id: string; name: string; archivedAt: number | null };
    expect(created).toMatchObject({ id, name: 'Aria', archivedAt: null });

    const listRes = await app.request('/api/characters', { headers: { ...XRW, cookie } });
    expect(listRes.status).toBe(200);
    const rows = (await listRes.json()) as { id: string }[];
    expect(rows.map((r) => r.id)).toEqual([id]);

    expect(await countCharactersForOwner(handle.db, userId)).toBe(1);
  });

  it('re-creating the same id for the same owner is an idempotent 200, not a duplicate row', async () => {
    const cookie = await loginAndGetCookie('Idris', verifierHex('2'));
    const userId = await meUserId(cookie);
    const id = uuidv7();
    const body = JSON.stringify({ id, name: 'Bram', system: 'srd-5e-2024' });

    const first = await app.request('/api/characters', { method: 'POST', headers: { ...XRW, cookie }, body });
    expect(first.status).toBe(201);
    const second = await app.request('/api/characters', { method: 'POST', headers: { ...XRW, cookie }, body });
    expect(second.status).toBe(200);

    expect(await countCharactersForOwner(handle.db, userId)).toBe(1);
  });

  it('refuses a create whose id is already owned by someone else with 409', async () => {
    const cookieA = await loginAndGetCookie('Owner', verifierHex('3'));
    const cookieB = await loginAndGetCookie('Other', verifierHex('4'));
    const id = uuidv7();

    const first = await app.request('/api/characters', {
      method: 'POST',
      headers: { ...XRW, cookie: cookieA },
      body: JSON.stringify({ id, name: 'Cato', system: 'srd-5e-2024' }),
    });
    expect(first.status).toBe(201);

    const second = await app.request('/api/characters', {
      method: 'POST',
      headers: { ...XRW, cookie: cookieB },
      body: JSON.stringify({ id, name: 'Hijack', system: 'srd-5e-2024' }),
    });
    expect(second.status).toBe(409);
  });

  it('the 51st character create is refused with an honest limit error, not a generic 409', async () => {
    const cookie = await loginAndGetCookie('Prolific', verifierHex('5'));
    const userId = await meUserId(cookie);

    // Seed 50 rows via the query layer (task-6-brief: "seed 50 via the query layer, not 50 HTTP
    // calls") — the create route's own D1 write path, called directly.
    for (let i = 0; i < USER_CHARACTER_COUNT_MAX; i += 1) {
      await upsertCharacterIndexRow(handle.db, {
        id: uuidv7(),
        ownerId: userId,
        name: `Seed ${i}`,
        system: 'srd-5e-2024',
        campaignId: null,
        archivedAt: null,
        bytesUsed: 0,
        eventCount: 0,
        updatedAt: Date.now(),
      });
    }
    expect(await countCharactersForOwner(handle.db, userId)).toBe(USER_CHARACTER_COUNT_MAX);

    const res = await app.request('/api/characters', {
      method: 'POST',
      headers: { ...XRW, cookie },
      body: JSON.stringify({ id: uuidv7(), name: 'One Too Many', system: 'srd-5e-2024' }),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('limit_exceeded');
  });

  it('a create is refused with an honest quota error when users.quota_bytes_used is at/over 10 MB', async () => {
    const cookie = await loginAndGetCookie('Bloated', verifierHex('5b'));
    const userId = await meUserId(cookie);

    // Seed the byte counter past the cap via the query layer (fix round 1: mirrors the 51st-
    // character test's "seed via the query layer, not via appends" approach) — this column is
    // normally maintained by the daily maintenance job (Task 10), so a direct DB write is the
    // correct way to simulate "a day has passed and this user is over budget".
    await adjustUserQuotaBytes(handle.db, userId, USER_QUOTA_BYTES_MAX);
    expect(await getUserQuotaBytes(handle.db, userId)).toBe(USER_QUOTA_BYTES_MAX);

    const res = await app.request('/api/characters', {
      method: 'POST',
      headers: { ...XRW, cookie },
      body: JSON.stringify({ id: uuidv7(), name: 'Over Budget', system: 'srd-5e-2024' }),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('quota_exceeded');
  });

  it('a create is allowed when users.quota_bytes_used is below the 10 MB cap', async () => {
    const cookie = await loginAndGetCookie('WithinBudget', verifierHex('5c'));
    const userId = await meUserId(cookie);
    expect(await getUserQuotaBytes(handle.db, userId)).toBe(0);

    const res = await app.request('/api/characters', {
      method: 'POST',
      headers: { ...XRW, cookie },
      body: JSON.stringify({ id: uuidv7(), name: 'Frugal', system: 'srd-5e-2024' }),
    });
    expect(res.status).toBe(201);
  });

  it('an archived character still counts toward the 50-character cap (doc-08 finding)', async () => {
    const cookie = await loginAndGetCookie('Hoarder', verifierHex('6'));
    const userId = await meUserId(cookie);
    const id = uuidv7();

    await app.request('/api/characters', {
      method: 'POST',
      headers: { ...XRW, cookie },
      body: JSON.stringify({ id, name: 'Zosia', system: 'srd-5e-2024' }),
    });
    await app.request(`/api/characters/${id}/archive`, { method: 'POST', headers: { ...XRW, cookie } });

    // Archiving alone must NOT free the slot — only hard delete does (ADR-003 / doc-08, see
    // quotas.ts's USER_CHARACTER_COUNT_MAX doc comment for the full citation).
    expect(await countCharactersForOwner(handle.db, userId)).toBe(1);
  });

  it('DELETE hard-deletes: wipes the stream store and removes the D1 row, freeing the quota count', async () => {
    const cookie = await loginAndGetCookie('Purger', verifierHex('7'));
    const userId = await meUserId(cookie);
    const id = uuidv7();
    const streamId = `char:${id}`;

    await app.request('/api/characters', {
      method: 'POST',
      headers: { ...XRW, cookie },
      body: JSON.stringify({ id, name: 'Temp', system: 'srd-5e-2024' }),
    });

    // Seed stream events directly into the fake store behind this streamId — as if the client
    // had already appended its `character.created` (+ more) events over WS.
    const store = streamHost.storeFor(streamId, true);
    await store.append([
      {
        id: uuidv7(),
        stream: streamId,
        ts: new Date().toISOString(),
        actor: { userId, deviceId: 'device-1', role: 'owner' },
        type: 'character.archived',
        v: 1,
        payload: {},
      },
    ]);
    await store.setMeta('bytes_used', '123');
    expect(store.length).toBe(1);

    const delRes = await app.request(`/api/characters/${id}`, { method: 'DELETE', headers: { ...XRW, cookie } });
    expect(delRes.status).toBe(204);

    expect(store.length).toBe(0);
    expect(await store.getMeta('bytes_used')).toBeUndefined();
    expect(await countCharactersForOwner(handle.db, userId)).toBe(0);

    const listRes = await app.request('/api/characters', { headers: { ...XRW, cookie } });
    expect(await listRes.json()).toEqual([]);
  });

  it('DELETE best-effort decrements users.quota_bytes_used by the deleted row bytesUsed, floored at 0', async () => {
    const cookie = await loginAndGetCookie('Slimmer', verifierHex('7b'));
    const userId = await meUserId(cookie);
    const id = uuidv7();

    await app.request('/api/characters', {
      method: 'POST',
      headers: { ...XRW, cookie },
      body: JSON.stringify({ id, name: 'Chonky', system: 'srd-5e-2024' }),
    });
    // Simulate the daily maintenance job (Task 10) having already synced this character's
    // bytesUsed and the user's overall quota_bytes_used from stream meta.
    await upsertCharacterIndexRow(handle.db, {
      id,
      ownerId: userId,
      name: 'Chonky',
      system: 'srd-5e-2024',
      campaignId: null,
      archivedAt: null,
      bytesUsed: 500_000,
      eventCount: 10,
      updatedAt: Date.now(),
    });
    await adjustUserQuotaBytes(handle.db, userId, 500_000);
    expect(await getUserQuotaBytes(handle.db, userId)).toBe(500_000);

    const delRes = await app.request(`/api/characters/${id}`, { method: 'DELETE', headers: { ...XRW, cookie } });
    expect(delRes.status).toBe(204);

    expect(await getUserQuotaBytes(handle.db, userId)).toBe(0);
  });

  it('DELETE never drives users.quota_bytes_used negative when the row bytesUsed exceeds it', async () => {
    const cookie = await loginAndGetCookie('Underflow', verifierHex('7c'));
    const userId = await meUserId(cookie);
    const id = uuidv7();

    await app.request('/api/characters', {
      method: 'POST',
      headers: { ...XRW, cookie },
      body: JSON.stringify({ id, name: 'Stale', system: 'srd-5e-2024' }),
    });
    // The user's overall counter is BELOW this one character's own bytesUsed — a plausible
    // staleness artifact between two daily syncs (quotas.ts's USER_QUOTA_BYTES_MAX doc comment).
    await upsertCharacterIndexRow(handle.db, {
      id,
      ownerId: userId,
      name: 'Stale',
      system: 'srd-5e-2024',
      campaignId: null,
      archivedAt: null,
      bytesUsed: 1_000_000,
      eventCount: 5,
      updatedAt: Date.now(),
    });
    await adjustUserQuotaBytes(handle.db, userId, 100_000);

    const delRes = await app.request(`/api/characters/${id}`, { method: 'DELETE', headers: { ...XRW, cookie } });
    expect(delRes.status).toBe(204);

    expect(await getUserQuotaBytes(handle.db, userId)).toBe(0);
  });

  it('404s deleting a character that does not exist or belongs to someone else', async () => {
    const cookieA = await loginAndGetCookie('Alpha', verifierHex('8'));
    const cookieB = await loginAndGetCookie('Beta', verifierHex('9'));
    const id = uuidv7();
    await app.request('/api/characters', {
      method: 'POST',
      headers: { ...XRW, cookie: cookieA },
      body: JSON.stringify({ id, name: 'Guarded', system: 'srd-5e-2024' }),
    });

    const res = await app.request(`/api/characters/${id}`, { method: 'DELETE', headers: { ...XRW, cookie: cookieB } });
    expect(res.status).toBe(404);
  });
});

describe('WS handoff (GET /api/characters/:id/ws)', () => {
  it('refuses a non-owner with 403', async () => {
    const ownerCookie = await loginAndGetCookie('Holder', verifierHex('a1'));
    const otherCookie = await loginAndGetCookie('Stranger', verifierHex('a2'));
    const id = uuidv7();
    await app.request('/api/characters', {
      method: 'POST',
      headers: { ...XRW, cookie: ownerCookie },
      body: JSON.stringify({ id, name: 'Guarded', system: 'srd-5e-2024' }),
    });

    const res = await app.request(`/api/characters/${id}/ws`, {
      headers: { cookie: otherCookie, Origin: APP_ORIGIN },
    });
    expect(res.status).toBe(403);
    expect(wsUpgradeCalls).toEqual([]);
  });

  it('refuses a bad Origin with 403', async () => {
    const cookie = await loginAndGetCookie('Owner2', verifierHex('a3'));
    const id = uuidv7();
    await app.request('/api/characters', {
      method: 'POST',
      headers: { ...XRW, cookie },
      body: JSON.stringify({ id, name: 'Guarded', system: 'srd-5e-2024' }),
    });

    const res = await app.request(`/api/characters/${id}/ws`, {
      headers: { cookie, Origin: 'https://evil.example' },
    });
    expect(res.status).toBe(403);
    expect(wsUpgradeCalls).toEqual([]);
  });

  it('hands off to the injected wsUpgrade port for the verified owner with a good Origin', async () => {
    const cookie = await loginAndGetCookie('Owner3', verifierHex('a4'));
    const userId = await meUserId(cookie);
    const id = uuidv7();
    await app.request('/api/characters', {
      method: 'POST',
      headers: { ...XRW, cookie },
      body: JSON.stringify({ id, name: 'Guarded', system: 'srd-5e-2024' }),
    });

    const res = await app.request(`/api/characters/${id}/ws`, { headers: { cookie, Origin: APP_ORIGIN } });
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Ws-Upgrade')).toBe('1');
    expect(wsUpgradeCalls).toEqual([{ streamId: `char:${id}`, userId, role: 'owner' }]);
  });

  it('404-backed character (never created) is refused with 403, not leaking existence', async () => {
    const cookie = await loginAndGetCookie('Owner4', verifierHex('a5'));
    const res = await app.request(`/api/characters/${uuidv7()}/ws`, { headers: { cookie, Origin: APP_ORIGIN } });
    expect(res.status).toBe(403);
  });
});

// --- CharacterActor (direct, no HTTP) --------------------------------------------------------

const STREAM_ID = `char:${uuidv7()}`;

function makeCharacterSystem() {
  const store = new FakeStreamStore();
  const connections = new FakeConnections();
  const actor = new CharacterActor({ store, connections, quotas, permissions, streamId: STREAM_ID });
  return { store, connections, actor };
}

function makeCharacterCreatedEvent(overrides: Partial<Event> = {}): Event {
  return {
    id: uuidv7(),
    stream: STREAM_ID,
    ts: new Date().toISOString(),
    actor: { userId: 'user-1', deviceId: 'device-1', role: 'owner' },
    type: 'character.created',
    v: 1,
    payload: {
      name: 'Aria',
      system: 'srd-5e-2024',
      corePack: { id: 'srd-5e-2024', version: '1.0.0' },
      engineVersion: '1.0.0',
      grammaticalGender: 'feminine',
    },
    ...overrides,
  };
}

function makeArchivedEvent(overrides: Partial<Event> = {}): Event {
  return {
    id: uuidv7(),
    stream: STREAM_ID,
    ts: new Date().toISOString(),
    actor: { userId: 'user-1', deviceId: 'device-1', role: 'owner' },
    type: 'character.archived',
    v: 1,
    payload: {},
    ...overrides,
  };
}

function makeNoteEvent(overrides: Partial<Event> = {}): Event {
  return {
    id: uuidv7(),
    stream: STREAM_ID,
    ts: new Date().toISOString(),
    actor: { userId: 'user-1', deviceId: 'device-1', role: 'owner' },
    type: 'note.added',
    v: 1,
    payload: { id: uuidv7() },
    ...overrides,
  };
}

describe('CharacterActor', () => {
  it('rejects every event as forbidden when the actor role is member (never a legitimate character-stream actor)', async () => {
    const system = makeCharacterSystem();
    const memberActor: Actor = { userId: 'user-2', role: 'member' };
    const hpChanged = makeNoteEvent({ type: 'hp.changed', v: 1, payload: { delta: -1, kind: 'damage' } });

    const outcome = await system.actor.append([hpChanged], memberActor);

    expect(outcome.acked).toEqual([]);
    expect(outcome.rejected).toHaveLength(1);
    expect(outcome.rejected[0]).toMatchObject({ id: hpChanged.id, code: 'forbidden' });
    expect(system.store.length).toBe(0);
  });

  // [plan-9 Task 6 — REVISION] A `'dm'` actor was refused outright here in Phase 2 (no
  // `CampaignActor`/`Rpc` gateway existed yet to ever legitimately produce one). Task 6 wires the
  // real gateway (`CampaignActor.append`'s forward path calls `CharacterActor.append` with a
  // gateway-mapped `role: 'dm'` actor via `Rpc.forwardAppend` — doc-03 §Permission enforcement
  // point) — so `'dm'` must now be let through to the SAME per-type `permissions.allowed` check an
  // `'owner'` actor gets, per doc-08's matrix row ("Append DM events ... Owner v (solo/self), DM
  // v"). This test (replacing the old "dm refused outright" one above) pins the NEW behavior.
  it('allows a dm actor to append a dm-class event (the gateway-forward path CharacterActor.append now accepts)', async () => {
    const system = makeCharacterSystem();
    const dmActor: Actor = { userId: 'user-2', role: 'dm' };
    const hpChanged = makeNoteEvent({ type: 'hp.changed', v: 1, payload: { delta: -1, kind: 'damage' } });

    const outcome = await system.actor.append([hpChanged], dmActor);

    expect(outcome.rejected).toEqual([]);
    expect(outcome.acked).toEqual([{ id: hpChanged.id, seq: 1 }]);
    expect(system.store.length).toBe(1);
  });

  it('sets meta.ownerId from the session actor when character.created commits', async () => {
    const system = makeCharacterSystem();
    const owner: Actor = { userId: 'user-42', role: 'owner' };
    const created = makeCharacterCreatedEvent();

    const outcome = await system.actor.append([created], owner);
    expect(outcome.rejected).toEqual([]);

    const meta = await system.actor.getCharacterMeta();
    expect(meta.ownerId).toBe('user-42');
    expect(meta.archived).toBe(false);
  });

  it('archiving is cosmetic: meta.archived flips true but appends still succeed', async () => {
    const system = makeCharacterSystem();
    const owner: Actor = { userId: 'user-1', role: 'owner' };

    await system.actor.append([makeCharacterCreatedEvent()], owner);
    const archiveOutcome = await system.actor.append([makeArchivedEvent()], owner);
    expect(archiveOutcome.rejected).toEqual([]);

    const meta = await system.actor.getCharacterMeta();
    expect(meta.archived).toBe(true);

    // Per doc-08/ADR-003 (see quotas.ts's USER_CHARACTER_COUNT_MAX doc comment): archiving does
    // not freeze the stream. A further owner append still succeeds.
    const noteOutcome = await system.actor.append([makeNoteEvent()], owner);
    expect(noteOutcome.rejected).toEqual([]);
    expect(noteOutcome.acked).toHaveLength(1);
  });

  it('restoring flips meta.archived back to false', async () => {
    const system = makeCharacterSystem();
    const owner: Actor = { userId: 'user-1', role: 'owner' };
    await system.actor.append([makeCharacterCreatedEvent(), makeArchivedEvent()], owner);
    expect((await system.actor.getCharacterMeta()).archived).toBe(true);

    const restored = makeNoteEvent({ type: 'character.restored', v: 1, payload: {} });
    await system.actor.append([restored], owner);

    expect((await system.actor.getCharacterMeta()).archived).toBe(false);
  });

  it('deleteAll wipes the backing store', async () => {
    const system = makeCharacterSystem();
    const owner: Actor = { userId: 'user-1', role: 'owner' };
    await system.actor.append([makeCharacterCreatedEvent()], owner);
    expect(system.store.length).toBe(1);

    await system.actor.deleteAll();

    expect(system.store.length).toBe(0);
    expect(await system.store.getMeta('owner_id')).toBeUndefined();
  });
});

// --- event.reverted: canRevertOwn enforcement (final whole-branch review, Important) ---------

/** ADR-012 §Authorization: "Owner ... event.reverted (only events the owner authored)" / "DM of
 * the character's campaign ... event.reverted (any)". `canRevertOwn` (permissions.ts) had ZERO
 * call sites before this fix — this describes the real wiring in `StreamActor.append`'s new
 * Stage 0 (`resolveRevertTarget`). */
describe('event.reverted: canRevertOwn enforcement', () => {
  function makeRevertEvent(overrides: Partial<Event> = {}): Event {
    return {
      id: uuidv7(),
      stream: STREAM_ID,
      ts: new Date().toISOString(),
      actor: { userId: 'user-1', deviceId: 'device-1', role: 'owner' },
      type: 'event.reverted',
      v: 1,
      payload: {},
      ...overrides,
    };
  }

  it('owner reverting a dm-authored event is rejected forbidden (ADR-012: owner may revert only events they authored)', async () => {
    const system = makeCharacterSystem();
    const owner: Actor = { userId: 'user-1', role: 'owner' };
    const dm: Actor = { userId: 'user-dm', role: 'dm' };
    await system.actor.append([makeCharacterCreatedEvent()], owner);
    const hpChanged = makeNoteEvent({
      type: 'hp.changed',
      v: 1,
      payload: { delta: -3, kind: 'damage' },
      actor: { userId: 'user-dm', deviceId: 'device-1', role: 'dm' },
    });
    await system.actor.append([hpChanged], dm);
    const beforeLength = system.store.length;

    const revert = makeRevertEvent({ payload: { targetId: hpChanged.id } });
    const outcome = await system.actor.append([revert], owner);

    expect(outcome.acked).toEqual([]);
    expect(outcome.rejected[0]).toMatchObject({ id: revert.id, code: 'forbidden' });
    expect(system.store.length).toBe(beforeLength); // nothing new committed — the target survives untouched
  });

  it('owner reverting their OWN event still works', async () => {
    const system = makeCharacterSystem();
    const owner: Actor = { userId: 'user-1', role: 'owner' };
    await system.actor.append([makeCharacterCreatedEvent()], owner);
    const note = makeNoteEvent();
    await system.actor.append([note], owner);

    const revert = makeRevertEvent({ payload: { targetId: note.id } });
    const outcome = await system.actor.append([revert], owner);

    expect(outcome.rejected).toEqual([]);
    expect(outcome.acked).toEqual([{ id: revert.id, seq: 3 }]);
  });

  it('dm reverting an owner-authored event succeeds (ADR-012: dm may revert any)', async () => {
    const system = makeCharacterSystem();
    const owner: Actor = { userId: 'user-1', role: 'owner' };
    const dm: Actor = { userId: 'user-dm', role: 'dm' };
    await system.actor.append([makeCharacterCreatedEvent()], owner);
    const note = makeNoteEvent();
    await system.actor.append([note], owner);

    const revert = makeRevertEvent({
      actor: { userId: 'user-dm', deviceId: 'device-1', role: 'dm' },
      payload: { targetId: note.id },
    });
    const outcome = await system.actor.append([revert], dm);

    expect(outcome.rejected).toEqual([]);
    expect(outcome.acked).toEqual([{ id: revert.id, seq: 3 }]);
  });

  it('dm reverting a dm-authored event also succeeds (trivially within "any")', async () => {
    const system = makeCharacterSystem();
    const owner: Actor = { userId: 'user-1', role: 'owner' };
    const dm: Actor = { userId: 'user-dm', role: 'dm' };
    await system.actor.append([makeCharacterCreatedEvent()], owner);
    const hpChanged = makeNoteEvent({
      type: 'hp.changed',
      v: 1,
      payload: { delta: -1, kind: 'damage' },
      actor: { userId: 'user-dm', deviceId: 'device-1', role: 'dm' },
    });
    await system.actor.append([hpChanged], dm);

    const revert = makeRevertEvent({
      actor: { userId: 'user-dm', deviceId: 'device-1', role: 'dm' },
      payload: { targetId: hpChanged.id },
    });
    const outcome = await system.actor.append([revert], dm);

    expect(outcome.rejected).toEqual([]);
  });

  // A same-batch target (never separately committed first, so `findByIds` can't resolve it) is
  // NOT specially resolved — `resolveRevertTarget`'s doc comment explains why that would be
  // provably-dead code: one `append()` call stamps every event with the SAME actor, so a
  // same-batch target's authorship is always the reverting actor's own, exactly what the
  // fail-open "unresolvable" default already grants. This test pins that it doesn't error or
  // behave oddly — it goes through the SAME fail-open path as a genuinely-nonexistent targetId.
  it('reverting a target in the SAME append batch (never separately committed) still succeeds, via the fail-open path', async () => {
    const system = makeCharacterSystem();
    const owner: Actor = { userId: 'user-1', role: 'owner' };
    await system.actor.append([makeCharacterCreatedEvent()], owner);
    const note = makeNoteEvent();
    const revert = makeRevertEvent({ payload: { targetId: note.id } });

    const outcome = await system.actor.append([note, revert], owner);

    expect(outcome.rejected).toEqual([]);
    expect(outcome.acked).toHaveLength(2);
  });

  it('a genuinely nonexistent targetId fails open (harmless — nothing resolvable to forbid, matches the engine reducer’s own silent no-op)', async () => {
    const system = makeCharacterSystem();
    const owner: Actor = { userId: 'user-1', role: 'owner' };
    await system.actor.append([makeCharacterCreatedEvent()], owner);

    const revert = makeRevertEvent({ payload: { targetId: uuidv7() } }); // no such event was ever committed
    const outcome = await system.actor.append([revert], owner);

    expect(outcome.rejected).toEqual([]);
  });

  // `findAnyByTxId` (the second-wave fix) is a STORE query — a same-batch group member was never
  // separately committed first, so it can't be found there either, exactly like `findByIds` can't
  // resolve a same-batch `targetId`. Same reasoning as the same-batch `targetId` test above: this
  // is provably harmless regardless (same `append()` call, same actor), not a gap.
  it('a same-batch txId-group revert (no targetId) still succeeds, via the same fail-open path (findAnyByTxId only sees committed history)', async () => {
    const system = makeCharacterSystem();
    const owner: Actor = { userId: 'user-1', role: 'owner' };
    await system.actor.append([makeCharacterCreatedEvent()], owner);
    const txId = uuidv7();
    const groupMember = makeNoteEvent({ txId });
    const revert = makeRevertEvent({ payload: { txId } });

    const outcome = await system.actor.append([groupMember, revert], owner);

    expect(outcome.rejected).toEqual([]);
    expect(outcome.acked).toHaveLength(2);
  });

  // [final whole-branch review, second wave, MUST-FIX — CLOSES the txId bypass] Formerly
  // `[disclosed gap] a cross-batch txId-only revert is NOT currently ownership-checked`, flipped:
  // `StreamStore.findAnyByTxId` now resolves a cross-batch `txId` group's representative actor via
  // a real store lookup (Stage 0, `stream-actor.ts`), so this now-real exploit is closed: a DM
  // gateway-forwards a `txId`-grouped batch to the owner's own character stream; the owner's own
  // socket legitimately observes the committed envelopes (including `txId`) via live fan-out; the
  // owner sends `event.reverted {txId: <the dm's tx>}` hoping Stage 0 resolves nothing. It now
  // resolves the DM's own committed group member, `canRevertOwn` sees a `dm`-authored target and a
  // non-`dm` reverting actor, and rejects.
  it('owner reverting a cross-batch, dm-authored txId GROUP is rejected forbidden — nothing new committed', async () => {
    const system = makeCharacterSystem();
    const owner: Actor = { userId: 'user-1', role: 'owner' };
    const dm: Actor = { userId: 'user-dm', role: 'dm' };
    await system.actor.append([makeCharacterCreatedEvent()], owner);
    const txId = uuidv7();
    const dmGroupMember = makeNoteEvent({
      type: 'hp.changed',
      v: 1,
      payload: { delta: -2, kind: 'damage' },
      actor: { userId: 'user-dm', deviceId: 'device-1', role: 'dm' },
      txId,
    });
    await system.actor.append([dmGroupMember], dm); // committed in a SEPARATE, earlier append call
    const beforeLength = system.store.length;

    const revert = makeRevertEvent({ payload: { txId } });
    const outcome = await system.actor.append([revert], owner); // owner, reverting a dm-authored group

    expect(outcome.acked).toEqual([]);
    expect(outcome.rejected[0]).toMatchObject({ id: revert.id, code: 'forbidden' });
    expect(system.store.length).toBe(beforeLength); // the revert never committed; the dm's group survives untouched
  });

  // Protects the REAL feature this fix must not break: the web client's own group-revert/
  // level-up-undo flow (`CharacterStore.revert({txId})`) always targets the OWNER'S OWN
  // transaction, committed in an EARLIER append call than the revert itself (cross-batch is the
  // NORMAL case for a real undo, not an edge case) — this must keep working.
  it('owner reverting their OWN cross-batch txId group still succeeds (protects the real level-up-undo flow)', async () => {
    const system = makeCharacterSystem();
    const owner: Actor = { userId: 'user-1', role: 'owner' };
    await system.actor.append([makeCharacterCreatedEvent()], owner);
    const txId = uuidv7();
    const groupMember = makeNoteEvent({ txId });
    await system.actor.append([groupMember], owner); // committed in a SEPARATE, earlier append call

    const revert = makeRevertEvent({ payload: { txId } });
    const outcome = await system.actor.append([revert], owner);

    expect(outcome.rejected).toEqual([]);
    expect(outcome.acked).toEqual([{ id: revert.id, seq: 3 }]);
  });
});

// --- [fix round 1, Important] owner backstop -------------------------------------------------

describe('CharacterActor — owner backstop (defense in depth vs. mapGatewayActor)', () => {
  it('refuses a forged owner-role actor whose userId does not match the established meta.ownerId, even when constructed directly (simulating a bypass past the gateway)', async () => {
    const system = makeCharacterSystem();
    const realOwner: Actor = { userId: 'user-real-owner', role: 'owner' };
    await system.actor.append(
      [makeCharacterCreatedEvent({ actor: { userId: realOwner.userId, deviceId: 'd1', role: 'owner' } })],
      realOwner,
    );
    expect(system.store.length).toBe(1);

    // Never actually reachable via a real gateway forward today (`mapGatewayActor` already maps
    // correctly) — this constructs the FORGED actor directly, exactly the way a bug in
    // `mapGatewayActor` (or any future caller of `CharacterActor.append`) could otherwise produce
    // one, proving THIS side is a genuine, independent gate, not merely trusting the caller.
    const forgedActor: Actor = { userId: 'user-attacker', role: 'owner' };
    const hpChanged = makeNoteEvent({ type: 'hp.changed', v: 1, payload: { delta: -1, kind: 'damage' } });
    const outcome = await system.actor.append([hpChanged], forgedActor);

    expect(outcome.acked).toEqual([]);
    expect(outcome.rejected).toEqual([
      expect.objectContaining({
        id: hpChanged.id,
        code: 'forbidden',
        message: expect.stringContaining("is not this character's established owner") as string,
      }),
    ]);
    expect(system.store.length).toBe(1); // nothing from the forged actor landed in the store
  });

  it('the legitimate direct-socket owner (userId matches meta.ownerId) still appends successfully with the backstop in place', async () => {
    const system = makeCharacterSystem();
    const owner: Actor = { userId: 'user-legit-direct', role: 'owner' };
    await system.actor.append(
      [makeCharacterCreatedEvent({ actor: { userId: owner.userId, deviceId: 'd1', role: 'owner' } })],
      owner,
    );

    const noteOutcome = await system.actor.append([makeNoteEvent()], owner);
    expect(noteOutcome.rejected).toEqual([]);
    expect(noteOutcome.acked).toHaveLength(1);
  });

  it('a legitimately gateway-forwarded owner (mapGatewayActor mapped a member acting on their OWN character) still appends successfully', async () => {
    const system = makeCharacterSystem();
    const owner: Actor = { userId: 'user-legit-forwarded', role: 'owner' };
    await system.actor.append(
      [makeCharacterCreatedEvent({ actor: { userId: owner.userId, deviceId: 'd1', role: 'owner' } })],
      owner,
    );

    // Simulates `CampaignActor.forwardGroupsToCharacterStreams`'s own call shape: an actor
    // MAPPED to `{userId: <the character's real owner>, role: 'owner'}` by `mapGatewayActor`,
    // with no `sourceConn` (matching `Rpc.forwardAppend`'s real call shape — a cross-actor call,
    // never a direct socket).
    const forwardedOwnerActor: Actor = { userId: owner.userId, role: 'owner' };
    const hpChanged = makeNoteEvent({ type: 'hp.changed', v: 1, payload: { delta: -3, kind: 'damage' } });
    const outcome = await system.actor.append([hpChanged], forwardedOwnerActor);

    expect(outcome.rejected).toEqual([]);
    expect(outcome.acked).toEqual([{ id: hpChanged.id, seq: 2 }]);
  });

  it('[fix round 2] character.created is NOT exempt from the backstop — a mismatched-owner actor cannot hijack ownership by replaying it', async () => {
    // [fix round 2, controller-ruled fix of a round-1 gap] Round 1 exempted `character.created`
    // from the mismatched-owner rejection loop, reasoning it "can never legitimately arrive via
    // the gateway forward path" — true, but the exemption fired on ANY branch entry, including a
    // FORGED actor's replay. `applyMetaHooks` unconditionally overwrites `meta.ownerId` from
    // `actor.userId` on every acked `character.created`, with no first-event guard anywhere — so
    // the round-1 exemption let a mismatched-owner actor silently HIJACK ownership by replaying
    // `character.created`, the one owner-class event that was still let through while every OTHER
    // owner-class event correctly stayed refused. This test pins the fixed behavior: rejected like
    // everything else, and the real owner's `meta.ownerId` is left untouched.
    const system = makeCharacterSystem();
    const firstOwner: Actor = { userId: 'user-first', role: 'owner' };
    await system.actor.append(
      [makeCharacterCreatedEvent({ actor: { userId: firstOwner.userId, deviceId: 'd1', role: 'owner' } })],
      firstOwner,
    );

    const hijacker: Actor = { userId: 'user-hijacker', role: 'owner' };
    const replayedCreate = makeCharacterCreatedEvent();
    const outcome = await system.actor.append([replayedCreate], hijacker);

    expect(outcome.acked).toEqual([]);
    expect(outcome.rejected).toEqual([
      expect.objectContaining({
        id: replayedCreate.id,
        code: 'forbidden',
        message: expect.stringContaining("is not this character's established owner") as string,
      }),
    ]);
    expect((await system.actor.getCharacterMeta()).ownerId).toBe(firstOwner.userId);
    expect(system.store.length).toBe(1); // still only the real owner's original character.created
  });

  it('[fix round 2] a fresh stream (no established owner yet) never enters the backstop branch — character.created still works normally', async () => {
    const system = makeCharacterSystem();
    const owner: Actor = { userId: 'user-fresh', role: 'owner' };
    const created = makeCharacterCreatedEvent({ actor: { userId: owner.userId, deviceId: 'd1', role: 'owner' } });

    const outcome = await system.actor.append([created], owner);

    expect(outcome.rejected).toEqual([]);
    expect(outcome.acked).toEqual([{ id: created.id, seq: 1 }]);
    expect((await system.actor.getCharacterMeta()).ownerId).toBe(owner.userId);
  });

  it('[fix round 2] an owner re-sending character.created on their OWN already-owned stream never enters the backstop branch', async () => {
    const system = makeCharacterSystem();
    const owner: Actor = { userId: 'user-resend', role: 'owner' };
    await system.actor.append(
      [makeCharacterCreatedEvent({ actor: { userId: owner.userId, deviceId: 'd1', role: 'owner' } })],
      owner,
    );

    // metaBefore.ownerId === actor.userId here — the backstop's mismatch condition is false, so
    // this must never be refused with the backstop's own "is not this character's established
    // owner" message (whatever else the underlying pipeline does with a second character.created
    // from its OWN real owner is out of this test's scope).
    const outcome = await system.actor.append([makeCharacterCreatedEvent()], owner);
    const backstopRejection = outcome.rejected.find((r) =>
      r.message.includes("is not this character's established owner"),
    );
    expect(backstopRejection).toBeUndefined();
  });
});
