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
  it('rejects every event as forbidden when the actor role is not owner (direct-socket-only rule)', async () => {
    const system = makeCharacterSystem();
    const dmActor: Actor = { userId: 'user-2', role: 'dm' };
    // hp.changed is DM-allowed in the general ADR-012 table, but CharacterActor refuses it
    // outright on a direct socket regardless — this is the assertion that matters here.
    const hpChanged = makeNoteEvent({ type: 'hp.changed', v: 1, payload: { delta: -1, kind: 'damage' } });

    const outcome = await system.actor.append([hpChanged], dmActor);

    expect(outcome.acked).toEqual([]);
    expect(outcome.rejected).toHaveLength(1);
    expect(outcome.rejected[0]).toMatchObject({ id: hpChanged.id, code: 'forbidden' });
    expect(system.store.length).toBe(0);
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
