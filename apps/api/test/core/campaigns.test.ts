/**
 * Task 4: `/api/campaigns/*` routes + the WS handoff. Route-level tests run the REAL `createApp`
 * over `app.request()`, a real in-memory `Db` (`test/helpers/test-db.ts`), and a
 * `CampaignActorStreamHost` (this file's own test double, below) that wraps a REAL `CampaignActor`
 * over `FakeStreamStore`/`FakeConnections` — per task-4-brief ("prefer the real actor for the
 * event-emission assertions"), so assertions on committed `campaign.created`/`member.joined`/etc.
 * payloads and actors exercise the actual permission/meta pipeline (`campaign-actor.ts`,
 * `campaign-permissions.ts`), not a bare store pass-through.
 */
import type { Actor, Event } from '@hk/protocol';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/core/app.ts';
import { CampaignActor, campaignQuotas } from '../../src/core/streams/campaign-actor.ts';
import * as campaignPermissions from '../../src/core/campaign-permissions.ts';
import { uuidv7 } from '../../src/core/ids.ts';
import { CAMPAIGN_MEMBER_MAX } from '../../src/core/quotas.ts';
import { countMembers, findMembership, insertMembership, insertUser } from '../../src/core/db/queries.ts';
import { campaigns } from '../../src/core/db/schema.ts';
import type { AppendResult, StreamHandle, StreamHost } from '../../src/ports/stream.ts';
import type { StaticAssets, WsUpgradeContext } from '../../src/ports/infra.ts';
import { FakeConnections } from '../helpers/fake-connections.ts';
import { FakeStreamStore } from '../helpers/fake-stream-store.ts';
import { createTestConfig, InMemoryRateLimit } from '../helpers/fake-ports.ts';
import { openTestDb, type TestDbHandle } from '../helpers/test-db.ts';

const XRW = { 'X-Requested-With': 'herokeep', 'Content-Type': 'application/json' };
const APP_ORIGIN = 'https://app.test.local'; // matches fake-ports.ts's TEST_SECRETS.APP_ORIGIN
const CORE_PACK = { id: 'srd-5e-2024', version: '1.0.0' };

function verifierHex(seed = 'a'): string {
  return seed.repeat(Math.ceil(64 / seed.length)).slice(0, 64);
}
function saltHex(seed = 'b'): string {
  return seed.repeat(Math.ceil(32 / seed.length)).slice(0, 32);
}

/** Wraps a REAL `CampaignActor` (per stream id) over `FakeStreamStore`/`FakeConnections` behind
 * the plain `StreamHost` port — mirrors `NodeStreamHost.get`'s own `AppendOutcome -> AppendResult`
 * seq-range mapping exactly (`min`/`max` over ACKED seqs, `{0, 0}` when nothing acked), which is
 * what makes this test double a faithful stand-in for the route's own `appendOne`
 * rejection-detection heuristic (`campaigns.ts`'s header comment). */
class CampaignActorStreamHost implements StreamHost {
  private readonly actors = new Map<string, CampaignActor>();
  private readonly stores = new Map<string, FakeStreamStore>();

  get(streamId: string): StreamHandle {
    const actor = this.actorFor(streamId);
    return {
      append: async (events: Event[], appendActor: Actor): Promise<AppendResult> => {
        const outcome = await actor.append(events, appendActor);
        const seqs = outcome.acked.map((a) => a.seq);
        return { firstSeq: seqs.length > 0 ? Math.min(...seqs) : 0, lastSeq: seqs.length > 0 ? Math.max(...seqs) : 0 };
      },
      read: (fromSeq, limit) => this.storeFor(streamId).read(fromSeq, limit),
      head: () => this.storeFor(streamId).head(),
      notify: () => Promise.resolve(),
      deleteAll: () => this.storeFor(streamId).deleteAll(),
    };
  }

  /** Test-only inspection: every committed event on `streamId`, in commit order. */
  async eventsFor(streamId: string): Promise<Event[]> {
    const store = this.stores.get(streamId);
    if (!store) return [];
    return store.read(1, 1000);
  }

  private actorFor(streamId: string): CampaignActor {
    let actor = this.actors.get(streamId);
    if (actor) return actor;
    const store = new FakeStreamStore();
    const connections = new FakeConnections();
    actor = new CampaignActor({
      store,
      connections,
      quotas: campaignQuotas,
      permissions: campaignPermissions,
      streamId,
    });
    this.stores.set(streamId, store);
    this.actors.set(streamId, actor);
    return actor;
  }

  private storeFor(streamId: string): FakeStreamStore {
    this.actorFor(streamId); // ensure the paired store exists too
    const store = this.stores.get(streamId);
    if (!store) throw new Error(`campaign stream host: no store for ${streamId}`);
    return store;
  }
}

let handle: TestDbHandle;
let streamHost: CampaignActorStreamHost;
let wsUpgradeCalls: WsUpgradeContext[];
let app: ReturnType<typeof createApp>;

const fakeStaticAssets: StaticAssets = { fetch: () => Promise.resolve(null) };

beforeEach(() => {
  handle = openTestDb();
  streamHost = new CampaignActorStreamHost();
  wsUpgradeCalls = [];
  app = createApp({
    db: handle.db,
    config: createTestConfig(),
    rateLimit: new InMemoryRateLimit(),
    streamHost,
    wsUpgrade: {
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

async function createCampaign(
  cookie: string,
  overrides: Partial<{ id: string; name: string; system: string; corePack: unknown; displayName: string }> = {},
) {
  const body = {
    id: overrides.id ?? uuidv7(),
    name: overrides.name ?? 'The Sunless Citadel',
    system: overrides.system ?? '5e-2024',
    corePack: 'corePack' in overrides ? overrides.corePack : CORE_PACK,
    ...(overrides.displayName !== undefined ? { displayName: overrides.displayName } : {}),
  };
  const res = await app.request('/api/campaigns', {
    method: 'POST',
    headers: { ...XRW, cookie },
    body: JSON.stringify(body),
  });
  return { res, id: body.id };
}

describe('unauthenticated access', () => {
  it('401s every campaigns route without a session', async () => {
    const id = uuidv7();
    expect((await app.request('/api/campaigns')).status).toBe(401);
    expect(
      (
        await app.request('/api/campaigns', {
          method: 'POST',
          headers: XRW,
          body: JSON.stringify({ id, name: 'X', system: '5e-2024', corePack: CORE_PACK }),
        })
      ).status,
    ).toBe(401);
    expect(
      (await app.request('/api/campaigns/join', { method: 'POST', headers: XRW, body: JSON.stringify({ code: 'X' }) }))
        .status,
    ).toBe(401);
    expect((await app.request(`/api/campaigns/${id}/rotate-code`, { method: 'POST', headers: XRW })).status).toBe(401);
    expect((await app.request(`/api/campaigns/${id}/members/u1`, { method: 'DELETE', headers: XRW })).status).toBe(401);
    expect((await app.request(`/api/campaigns/${id}/ws`, { headers: { Origin: APP_ORIGIN } })).status).toBe(401);
  });
});

describe('POST /api/campaigns (create)', () => {
  it('writes a D1 campaign row + DM membership row, and emits campaign.created + member.joined', async () => {
    const cookie = await loginAndGetCookie('DungeonMaster', verifierHex('1'));
    const dmId = await meUserId(cookie);

    const { res, id } = await createCampaign(cookie, { name: 'The Sunless Citadel', system: '5e-2024' });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; name: string; system: string; role: string; joinCode: string };
    expect(body).toMatchObject({ id, name: 'The Sunless Citadel', system: '5e-2024', role: 'dm' });
    expect(typeof body.joinCode).toBe('string');
    expect(body.joinCode).toHaveLength(8);

    // D1 rows.
    const membership = await findMembership(handle.db, id, dmId);
    expect(membership).toMatchObject({ campaignId: id, userId: dmId, role: 'dm', displayName: 'DungeonMaster' });

    // Committed stream events.
    const events = await streamHost.eventsFor(`camp:${id}`);
    expect(events.map((e) => e.type)).toEqual(['campaign.created', 'member.joined']);
    expect(events[0]).toMatchObject({
      type: 'campaign.created',
      actor: { userId: dmId, role: 'dm' },
      payload: { name: 'The Sunless Citadel', system: '5e-2024', corePack: CORE_PACK },
    });
    expect(events[1]).toMatchObject({
      type: 'member.joined',
      actor: { userId: dmId, role: 'member' },
      payload: { userId: dmId, displayName: 'DungeonMaster', role: 'dm' },
    });
  });

  it('defaults displayName to the account username when none is supplied', async () => {
    const cookie = await loginAndGetCookie('Wren', verifierHex('2'));
    const dmId = await meUserId(cookie);
    const { id } = await createCampaign(cookie);

    const membership = await findMembership(handle.db, id, dmId);
    expect(membership?.displayName).toBe('Wren');
  });

  it('honors an explicit displayName over the account username', async () => {
    const cookie = await loginAndGetCookie('Wren2', verifierHex('2b'));
    const dmId = await meUserId(cookie);
    const { id } = await createCampaign(cookie, { displayName: 'The GM' });

    const membership = await findMembership(handle.db, id, dmId);
    expect(membership?.displayName).toBe('The GM');
  });

  it('re-creating the same id for the same owner is an idempotent 200, not a duplicate row', async () => {
    const cookie = await loginAndGetCookie('Idris', verifierHex('3'));
    const id = uuidv7();
    const first = await createCampaign(cookie, { id });
    expect(first.res.status).toBe(201);
    const second = await createCampaign(cookie, { id });
    expect(second.res.status).toBe(200);

    const events = await streamHost.eventsFor(`camp:${id}`);
    expect(events).toHaveLength(2); // no re-append on the idempotent retry
  });

  it('refuses a create whose id is already owned by someone else with 409', async () => {
    const cookieA = await loginAndGetCookie('Owner', verifierHex('4'));
    const cookieB = await loginAndGetCookie('Other', verifierHex('5'));
    const id = uuidv7();
    expect((await createCampaign(cookieA, { id })).res.status).toBe(201);
    const second = await createCampaign(cookieB, { id });
    expect(second.res.status).toBe(409);
  });

  it('400s a missing corePack, with no D1 rows left behind', async () => {
    const cookie = await loginAndGetCookie('Careless', verifierHex('6'));
    const id = uuidv7();
    const res = await app.request('/api/campaigns', {
      method: 'POST',
      headers: { ...XRW, cookie },
      body: JSON.stringify({ id, name: 'No Pack', system: '5e-2024' }),
    });
    expect(res.status).toBe(400);
    expect(await streamHost.eventsFor(`camp:${id}`)).toEqual([]);
  });

  it('400s missing id/name/system', async () => {
    const cookie = await loginAndGetCookie('Sparse', verifierHex('6b'));
    const res = await app.request('/api/campaigns', {
      method: 'POST',
      headers: { ...XRW, cookie },
      body: JSON.stringify({ name: 'X' }),
    });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/campaigns (list)', () => {
  it('lists campaigns the caller DMs and campaigns they are a member of, never leaking joinCode to a member', async () => {
    const dmCookie = await loginAndGetCookie('DMOne', verifierHex('7'));
    const memberCookie = await loginAndGetCookie('PlayerOne', verifierHex('8'));
    const memberId = await meUserId(memberCookie);
    const { id } = await createCampaign(dmCookie, { name: 'Party Campaign' });

    // Join via the query layer directly (join route is tested on its own below).
    await insertMembership(handle.db, {
      campaignId: id,
      userId: memberId,
      role: 'player',
      displayName: 'Player One',
      joinedAt: Date.now(),
    });

    const dmList = (await (await app.request('/api/campaigns', { headers: { ...XRW, cookie: dmCookie } })).json()) as {
      id: string;
      role: string;
      joinCode?: string;
    }[];
    expect(dmList).toHaveLength(1);
    expect(dmList[0]).toMatchObject({ id, role: 'dm' });
    expect(typeof dmList[0]!.joinCode).toBe('string');

    const memberList = (await (
      await app.request('/api/campaigns', { headers: { ...XRW, cookie: memberCookie } })
    ).json()) as { id: string; role: string; joinCode?: string }[];
    expect(memberList).toHaveLength(1);
    expect(memberList[0]).toMatchObject({ id, role: 'player' });
    expect(memberList[0]!.joinCode).toBeUndefined();
    expect(Object.keys(memberList[0]!)).not.toContain('joinCode');
  });

  it('is empty for a user with no campaigns', async () => {
    const cookie = await loginAndGetCookie('Lonely', verifierHex('9'));
    expect(await (await app.request('/api/campaigns', { headers: { ...XRW, cookie } })).json()).toEqual([]);
  });
});

describe('POST /api/campaigns/join', () => {
  it('happy path: inserts a membership row and emits member.joined with actor.role member', async () => {
    const dmCookie = await loginAndGetCookie('DMJoin', verifierHex('10'));
    const { id } = await createCampaign(dmCookie);
    const joinCodeRes = await app.request('/api/campaigns', { headers: { ...XRW, cookie: dmCookie } });
    const [row] = (await joinCodeRes.json()) as { id: string; joinCode: string }[];
    const joinCode = row!.joinCode;

    const memberCookie = await loginAndGetCookie('Joiner', verifierHex('11'));
    const memberId = await meUserId(memberCookie);

    const res = await app.request('/api/campaigns/join', {
      method: 'POST',
      headers: { ...XRW, cookie: memberCookie },
      body: JSON.stringify({ code: joinCode }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ campaignId: id });

    const membership = await findMembership(handle.db, id, memberId);
    expect(membership).toMatchObject({ role: 'player', displayName: 'Joiner' });

    const events = await streamHost.eventsFor(`camp:${id}`);
    const joined = events.find(
      (e) => e.type === 'member.joined' && (e.payload as { userId: string }).userId === memberId,
    );
    expect(joined).toMatchObject({ actor: { userId: memberId, role: 'member' }, payload: { role: 'player' } });
  });

  it('accepts a dash-grouped join code the same as the bare form', async () => {
    const dmCookie = await loginAndGetCookie('DMDash', verifierHex('12'));
    await createCampaign(dmCookie);
    const [row] = (await (await app.request('/api/campaigns', { headers: { ...XRW, cookie: dmCookie } })).json()) as {
      joinCode: string;
    }[];
    const grouped = `${row!.joinCode.slice(0, 4)}-${row!.joinCode.slice(4)}`.toLowerCase();

    const memberCookie = await loginAndGetCookie('DashJoiner', verifierHex('13'));
    const res = await app.request('/api/campaigns/join', {
      method: 'POST',
      headers: { ...XRW, cookie: memberCookie },
      body: JSON.stringify({ code: grouped }),
    });
    expect(res.status).toBe(200);
  });

  it('404s an unknown join code', async () => {
    const cookie = await loginAndGetCookie('NoSuchCode', verifierHex('14'));
    const res = await app.request('/api/campaigns/join', {
      method: 'POST',
      headers: { ...XRW, cookie },
      body: JSON.stringify({ code: 'ZZZZZZZZ' }),
    });
    expect(res.status).toBe(404);
  });

  it('403s a closed campaign', async () => {
    // join_open defaults true on create -- no settings-toggle route exists in this task's scope
    // (join.open is a DM-only WS-appended `campaign.settings_changed` concern, a later task), so
    // this test flips the D1 column directly via the schema/driver, mirroring `db.test.ts`'s own
    // "tests may import the concrete driver/schema" precedent.
    const dmCookie = await loginAndGetCookie('DMClosed', verifierHex('15'));
    const { id } = await createCampaign(dmCookie);
    const [row] = (await (await app.request('/api/campaigns', { headers: { ...XRW, cookie: dmCookie } })).json()) as {
      joinCode: string;
    }[];
    await handle.db.update(campaigns).set({ joinOpen: false }).where(eq(campaigns.id, id));

    const memberCookie = await loginAndGetCookie('Blocked', verifierHex('16'));
    const res = await app.request('/api/campaigns/join', {
      method: 'POST',
      headers: { ...XRW, cookie: memberCookie },
      body: JSON.stringify({ code: row!.joinCode }),
    });
    expect(res.status).toBe(403);
  });

  it('409s when the campaign already has 12 members', async () => {
    const dmCookie = await loginAndGetCookie('DMFull', verifierHex('17'));
    const { id } = await createCampaign(dmCookie);
    const [row] = (await (await app.request('/api/campaigns', { headers: { ...XRW, cookie: dmCookie } })).json()) as {
      joinCode: string;
    }[];

    // The DM already occupies one seat; seed the remaining CAMPAIGN_MEMBER_MAX - 1 via the query
    // layer (mirrors characters.test.ts's "seed via the query layer, not N HTTP calls"). A real
    // `users` row is required first -- `memberships.user_id` is FK-constrained (`schema.ts`).
    for (let i = 0; i < CAMPAIGN_MEMBER_MAX - 1; i += 1) {
      const seedUserId = uuidv7();
      await insertUser(handle.db, {
        id: seedUserId,
        username: `seed-user-${i}`,
        usernameFolded: `seed-user-${i}`,
        salt: saltHex(),
        verifierHash: verifierHex(),
        createdAt: Date.now(),
      });
      await insertMembership(handle.db, {
        campaignId: id,
        userId: seedUserId,
        role: 'player',
        displayName: `Seed ${i}`,
        joinedAt: Date.now(),
      });
    }
    expect(await countMembers(handle.db, id)).toBe(CAMPAIGN_MEMBER_MAX);

    const memberCookie = await loginAndGetCookie('OneTooMany', verifierHex('18'));
    const res = await app.request('/api/campaigns/join', {
      method: 'POST',
      headers: { ...XRW, cookie: memberCookie },
      body: JSON.stringify({ code: row!.joinCode }),
    });
    expect(res.status).toBe(409);
  });

  it('rejoining an existing membership is an idempotent 200, no duplicate event', async () => {
    const dmCookie = await loginAndGetCookie('DMDup', verifierHex('19'));
    const { id } = await createCampaign(dmCookie);
    const [row] = (await (await app.request('/api/campaigns', { headers: { ...XRW, cookie: dmCookie } })).json()) as {
      joinCode: string;
    }[];

    const memberCookie = await loginAndGetCookie('Rejoiner', verifierHex('20'));
    const first = await app.request('/api/campaigns/join', {
      method: 'POST',
      headers: { ...XRW, cookie: memberCookie },
      body: JSON.stringify({ code: row!.joinCode }),
    });
    expect(first.status).toBe(200);
    const eventsAfterFirst = await streamHost.eventsFor(`camp:${id}`);

    const second = await app.request('/api/campaigns/join', {
      method: 'POST',
      headers: { ...XRW, cookie: memberCookie },
      body: JSON.stringify({ code: row!.joinCode }),
    });
    expect(second.status).toBe(200);
    expect(await streamHost.eventsFor(`camp:${id}`)).toHaveLength(eventsAfterFirst.length);
  });
});

describe('POST /api/campaigns/:id/rotate-code', () => {
  it('DM-only: rotates the code, updates D1, and emits campaign.join_code_rotated', async () => {
    const dmCookie = await loginAndGetCookie('DMRotate', verifierHex('21'));
    const { id } = await createCampaign(dmCookie);
    const before = (await (await app.request('/api/campaigns', { headers: { ...XRW, cookie: dmCookie } })).json()) as {
      joinCode: string;
    }[];

    const res = await app.request(`/api/campaigns/${id}/rotate-code`, {
      method: 'POST',
      headers: { ...XRW, cookie: dmCookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { joinCode: string };
    expect(body.joinCode).not.toBe(before[0]!.joinCode);
    expect(body.joinCode).toHaveLength(8);

    const after = (await (await app.request('/api/campaigns', { headers: { ...XRW, cookie: dmCookie } })).json()) as {
      joinCode: string;
    }[];
    expect(after[0]!.joinCode).toBe(body.joinCode);

    const events = await streamHost.eventsFor(`camp:${id}`);
    const rotated = events.find((e) => e.type === 'campaign.join_code_rotated');
    expect(rotated).toMatchObject({ actor: { role: 'dm' }, payload: { joinCode: body.joinCode } });
  });

  it('403s a non-DM caller', async () => {
    const dmCookie = await loginAndGetCookie('DMRotate2', verifierHex('22'));
    const { id } = await createCampaign(dmCookie);
    const otherCookie = await loginAndGetCookie('NotTheDM', verifierHex('23'));

    const res = await app.request(`/api/campaigns/${id}/rotate-code`, {
      method: 'POST',
      headers: { ...XRW, cookie: otherCookie },
    });
    expect(res.status).toBe(403);
  });

  it('404s an unknown campaign', async () => {
    const cookie = await loginAndGetCookie('DMRotate3', verifierHex('24'));
    const res = await app.request(`/api/campaigns/${uuidv7()}/rotate-code`, {
      method: 'POST',
      headers: { ...XRW, cookie },
    });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/campaigns/:id/members/:userId', () => {
  it('DM-only: removes the membership row and emits member.removed', async () => {
    const dmCookie = await loginAndGetCookie('DMRemove', verifierHex('25'));
    const { id } = await createCampaign(dmCookie);
    const [row] = (await (await app.request('/api/campaigns', { headers: { ...XRW, cookie: dmCookie } })).json()) as {
      joinCode: string;
    }[];
    const memberCookie = await loginAndGetCookie('ToBeRemoved', verifierHex('26'));
    const memberId = await meUserId(memberCookie);
    await app.request('/api/campaigns/join', {
      method: 'POST',
      headers: { ...XRW, cookie: memberCookie },
      body: JSON.stringify({ code: row!.joinCode }),
    });

    const res = await app.request(`/api/campaigns/${id}/members/${memberId}`, {
      method: 'DELETE',
      headers: { ...XRW, cookie: dmCookie },
    });
    expect(res.status).toBe(204);

    expect(await findMembership(handle.db, id, memberId)).toBeUndefined();
    const events = await streamHost.eventsFor(`camp:${id}`);
    const removed = events.find((e) => e.type === 'member.removed');
    expect(removed).toMatchObject({ actor: { role: 'dm' }, payload: { userId: memberId, role: 'player' } });
  });

  it('403s a non-DM caller', async () => {
    const dmCookie = await loginAndGetCookie('DMRemove2', verifierHex('27'));
    const { id } = await createCampaign(dmCookie);
    const [row] = (await (await app.request('/api/campaigns', { headers: { ...XRW, cookie: dmCookie } })).json()) as {
      joinCode: string;
    }[];
    const memberCookie = await loginAndGetCookie('Bystander', verifierHex('28'));
    const memberId = await meUserId(memberCookie);
    await app.request('/api/campaigns/join', {
      method: 'POST',
      headers: { ...XRW, cookie: memberCookie },
      body: JSON.stringify({ code: row!.joinCode }),
    });

    const otherCookie = await loginAndGetCookie('AlsoNotTheDM', verifierHex('29'));
    const res = await app.request(`/api/campaigns/${id}/members/${memberId}`, {
      method: 'DELETE',
      headers: { ...XRW, cookie: otherCookie },
    });
    expect(res.status).toBe(403);
  });

  it('400s the DM attempting to remove themselves', async () => {
    const dmCookie = await loginAndGetCookie('DMSelf', verifierHex('30'));
    const dmId = await meUserId(dmCookie);
    const { id } = await createCampaign(dmCookie);

    const res = await app.request(`/api/campaigns/${id}/members/${dmId}`, {
      method: 'DELETE',
      headers: { ...XRW, cookie: dmCookie },
    });
    expect(res.status).toBe(400);
    expect(await findMembership(handle.db, id, dmId)).toBeDefined();
  });

  it('404s a member that does not exist', async () => {
    const dmCookie = await loginAndGetCookie('DMMissing', verifierHex('31'));
    const { id } = await createCampaign(dmCookie);
    const res = await app.request(`/api/campaigns/${id}/members/${uuidv7()}`, {
      method: 'DELETE',
      headers: { ...XRW, cookie: dmCookie },
    });
    expect(res.status).toBe(404);
  });
});

describe('WS handoff (GET /api/campaigns/:id/ws)', () => {
  it('stamps role dm + displayName for the campaign DM', async () => {
    const dmCookie = await loginAndGetCookie('DMWs', verifierHex('32'));
    const dmId = await meUserId(dmCookie);
    const { id } = await createCampaign(dmCookie);

    const res = await app.request(`/api/campaigns/${id}/ws`, { headers: { cookie: dmCookie, Origin: APP_ORIGIN } });
    expect(res.status).toBe(200);
    expect(wsUpgradeCalls).toEqual([{ streamId: `camp:${id}`, userId: dmId, role: 'dm', displayName: 'DMWs' }]);
  });

  it('stamps role member + displayName for a joined member', async () => {
    const dmCookie = await loginAndGetCookie('DMWs2', verifierHex('33'));
    const { id } = await createCampaign(dmCookie);
    const [row] = (await (await app.request('/api/campaigns', { headers: { ...XRW, cookie: dmCookie } })).json()) as {
      joinCode: string;
    }[];
    const memberCookie = await loginAndGetCookie('MemberWs', verifierHex('34'));
    const memberId = await meUserId(memberCookie);
    await app.request('/api/campaigns/join', {
      method: 'POST',
      headers: { ...XRW, cookie: memberCookie },
      body: JSON.stringify({ code: row!.joinCode }),
    });

    const res = await app.request(`/api/campaigns/${id}/ws`, { headers: { cookie: memberCookie, Origin: APP_ORIGIN } });
    expect(res.status).toBe(200);
    expect(wsUpgradeCalls).toEqual([
      { streamId: `camp:${id}`, userId: memberId, role: 'member', displayName: 'MemberWs' },
    ]);
  });

  it('refuses a non-member with 403, without leaking whether the campaign exists', async () => {
    const dmCookie = await loginAndGetCookie('DMWs3', verifierHex('35'));
    const { id } = await createCampaign(dmCookie);
    const strangerCookie = await loginAndGetCookie('Stranger', verifierHex('36'));

    const res = await app.request(`/api/campaigns/${id}/ws`, {
      headers: { cookie: strangerCookie, Origin: APP_ORIGIN },
    });
    expect(res.status).toBe(403);
    expect(wsUpgradeCalls).toEqual([]);

    const unknownRes = await app.request(`/api/campaigns/${uuidv7()}/ws`, {
      headers: { cookie: strangerCookie, Origin: APP_ORIGIN },
    });
    expect(unknownRes.status).toBe(403);
  });

  it('refuses a bad Origin with 403', async () => {
    const dmCookie = await loginAndGetCookie('DMWs4', verifierHex('37'));
    const { id } = await createCampaign(dmCookie);

    const res = await app.request(`/api/campaigns/${id}/ws`, {
      headers: { cookie: dmCookie, Origin: 'https://evil.example' },
    });
    expect(res.status).toBe(403);
    expect(wsUpgradeCalls).toEqual([]);
  });
});
