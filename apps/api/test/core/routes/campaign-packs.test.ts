/**
 * [plan-16 Task 1] `PUT`/`GET /api/campaigns/:campaignId/packs/:packId/:version` — the campaign
 * pack-body relay (ADR-008: "a campaign's DO stores the JSON of every non-core pack it has enabled
 * (≤ 5 MB each) so joiners can fetch them without the DM online"). Runs the REAL `createApp` over
 * `app.request()`, a real in-memory accounts `Db`, and the REAL Node `StreamHost` over a `:memory:`
 * `streams.sqlite` — so the route, `CampaignActor.putPackBody`'s total-bytes cap, and the real
 * `SqliteFileStreamStore` pack rows are exercised together, through the same single-writer lock a
 * production request takes.
 */
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Event } from '@hk/protocol';
import { NodeStreamHost } from '../../../src/adapters/node/stream-host.ts';
import { openStreamsDb } from '../../../src/adapters/node/store.sqlite-file.ts';
import { createApp } from '../../../src/core/app.ts';
import { sha256Hex } from '../../../src/core/crypto.ts';
import { findCampaignById } from '../../../src/core/db/queries.ts';
import { uuidv7 } from '../../../src/core/ids.ts';
import {
  CAMPAIGN_NON_CORE_PACK_MAX,
  CAMPAIGN_PACK_BYTES_MAX,
  CAMPAIGN_PACK_BYTES_TOTAL_MAX,
} from '../../../src/core/quotas.ts';
import type { StaticAssets } from '../../../src/ports/infra.ts';
import { createTestConfig, InMemoryRateLimit } from '../../helpers/fake-ports.ts';
import { openTestDb, type TestDbHandle } from '../../helpers/test-db.ts';

const XRW = { 'X-Requested-With': 'herokeep', 'Content-Type': 'application/json' };
const CORE_PACK = { id: 'srd-5e-2024', version: '1.0.0' };
const fakeStaticAssets: StaticAssets = { fetch: () => Promise.resolve(null) };

let handle: TestDbHandle;
let streamsDb: Database.Database;
let streamHost: NodeStreamHost;
let app: ReturnType<typeof createApp>;

beforeEach(() => {
  handle = openTestDb();
  streamsDb = openStreamsDb(':memory:');
  streamHost = new NodeStreamHost(streamsDb);
  app = createApp({
    db: handle.db,
    config: createTestConfig(),
    rateLimit: new InMemoryRateLimit(),
    streamHost,
    wsUpgrade: { upgrade: () => Promise.resolve(new Response(null, { status: 200 })) },
    staticAssets: fakeStaticAssets,
  });
});

afterEach(() => {
  handle.close();
  streamsDb.close();
});

/** Sorted-key `JSON.stringify` — the same canonical form `@hk/pack-tools`/the web client produce
 * (`canonicalJson`), built here independently so the test does not just echo the route's own twin. */
function canonical(value: unknown): string {
  const sortKeys = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sortKeys);
    if (v && typeof v === 'object') {
      const record = v as Record<string, unknown>;
      return Object.fromEntries(
        Object.keys(record)
          .sort()
          .map((k) => [k, sortKeys(record[k])]),
      );
    }
    return v;
  };
  return JSON.stringify(sortKeys(value));
}

/** A pack in its NORMALIZED form — every top-level field `PackSchema` defaults is spelled out, as
 * `canonicalJson(parsePack(x).pack)` (what `pack-tools build` and the web client store) carries it. */
function packObject(id: string, version: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    format: 1,
    id,
    version,
    kind: 'content',
    system: 'test-system',
    name: 'Homebrew',
    authors: [],
    dependencies: [],
    locale: 'en',
    entities: [],
    overrides: [],
    assets: [],
    i18n: {},
    ...extra,
  };
}

function packJson(id: string, version: string, extra: Record<string, unknown> = {}): string {
  return canonical(packObject(id, version, extra));
}

/** A schema-valid canonical pack padded (via translation strings — the one pack field with no
 * count cap, each value ≤ 20 KB) to roughly `targetBytes`, never over it. */
function paddedPackJson(id: string, version: string, targetBytes: number): string {
  const chunk = 'x'.repeat(20_000);
  const strings: Record<string, { text: string }> = {};
  const base = packJson(id, version, { i18n: { en: {} } }).length;
  const perEntry = canonical({ k00000: { text: chunk } }).length;
  const entries = Math.max(0, Math.floor((targetBytes - base) / perEntry));
  for (let i = 0; i < entries; i += 1) strings[`k${String(i).padStart(5, '0')}`] = { text: chunk };
  const json = packJson(id, version, { i18n: { en: strings } });
  if (json.length > targetBytes) throw new Error(`padded pack overshot: ${json.length} > ${targetBytes}`);
  return json;
}

let userCounter = 0;
async function login(): Promise<string> {
  userCounter += 1;
  const username = `packs-user-${userCounter}-${uuidv7().slice(-6)}`;
  await app.request('/api/auth/register', {
    method: 'POST',
    headers: XRW,
    body: JSON.stringify({ username, verifier: 'a'.repeat(64), salt: 'b'.repeat(32) }),
  });
  const res = await app.request('/api/auth/login', {
    method: 'POST',
    headers: XRW,
    body: JSON.stringify({ username, verifier: 'a'.repeat(64), deviceLabel: 'Test device' }),
  });
  const setCookie = res.headers.get('set-cookie');
  if (!setCookie) throw new Error('login did not set a session cookie');
  return setCookie.split(';')[0]!;
}

async function createCampaign(cookie: string): Promise<{ id: string; joinCode: string }> {
  const id = uuidv7();
  const res = await app.request('/api/campaigns', {
    method: 'POST',
    headers: { ...XRW, cookie },
    body: JSON.stringify({ id, name: 'Pack Relay', system: '5e-2024', corePack: CORE_PACK }),
  });
  expect(res.status).toBe(201);
  const body = (await res.json()) as { joinCode: string };
  return { id, joinCode: body.joinCode };
}

async function join(cookie: string, code: string): Promise<void> {
  const res = await app.request('/api/campaigns/join', {
    method: 'POST',
    headers: { ...XRW, cookie },
    body: JSON.stringify({ code }),
  });
  expect(res.status).toBe(200);
}

function putPack(cookie: string, campaignId: string, packId: string, version: string, body: string) {
  return app.request(`/api/campaigns/${campaignId}/packs/${packId}/${version}`, {
    method: 'PUT',
    headers: { ...XRW, cookie },
    body,
  });
}

function getPack(
  cookie: string,
  campaignId: string,
  packId: string,
  version: string,
  headers: Record<string, string> = {},
) {
  return app.request(`/api/campaigns/${campaignId}/packs/${packId}/${version}`, { headers: { cookie, ...headers } });
}

/** A request body with NO Content-Length (a chunked upload), 64 KiB per chunk up to `totalBytes`.
 * `highWaterMark: 0` means nothing is pulled until someone actually reads the body, so `pulled()`
 * is exactly the number of bytes the server consumed. */
function trackedStream(totalBytes: number): { stream: ReadableStream<Uint8Array>; pulled: () => number } {
  let sent = 0;
  const stream = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        if (sent >= totalBytes) {
          controller.close();
          return;
        }
        const size = Math.min(64 * 1024, totalBytes - sent);
        controller.enqueue(new Uint8Array(size).fill(0x20));
        sent += size;
      },
    },
    { highWaterMark: 0 },
  );
  return { stream, pulled: () => sent };
}

function putPackStream(
  cookie: string | undefined,
  campaignId: string,
  packId: string,
  version: string,
  body: ReadableStream<Uint8Array>,
) {
  const request = new Request(`http://localhost/api/campaigns/${campaignId}/packs/${packId}/${version}`, {
    method: 'PUT',
    headers: cookie === undefined ? XRW : { ...XRW, cookie },
    body,
    duplex: 'half',
  });
  expect(request.headers.get('content-length'), 'a chunked upload carries no Content-Length').toBeNull();
  return app.request(request);
}

/** Uploads `packId@version` as the DM, then appends `pack.enabled` on the campaign stream as the
 * DM (the same stream handle the route stores bodies through). */
async function enablePack(dm: string, campaignId: string, packId: string, version: string): Promise<void> {
  const put = await putPack(dm, campaignId, packId, version, packJson(packId, version));
  expect(put.status, `PUT ${packId}@${version}`).toBe(200);
  const { sha256 } = (await put.json()) as { sha256: string };
  const dmId = (await findCampaignById(handle.db, campaignId))?.dmId ?? '';
  const streamId = `camp:${campaignId}`;
  const event: Event = {
    id: uuidv7(),
    stream: streamId,
    ts: '2026-10-25T12:00:00.000Z',
    actor: { userId: dmId, deviceId: 'test-device', role: 'dm' },
    type: 'pack.enabled',
    v: 1,
    payload: { packId, version, sha256 },
  };
  const result = await streamHost.get(streamId).append([event], { userId: dmId, role: 'dm' });
  expect(result.lastSeq, `pack.enabled ${packId}@${version} committed`).toBeGreaterThan(0);
}

interface Fixture {
  readonly dm: string;
  readonly member: string;
  readonly stranger: string;
  readonly campaignId: string;
}

async function seed(): Promise<Fixture> {
  const dm = await login();
  const member = await login();
  const stranger = await login();
  const { id, joinCode } = await createCampaign(dm);
  await join(member, joinCode);
  return { dm, member, stranger, campaignId: id };
}

describe('PUT /api/campaigns/:campaignId/packs/:packId/:version', () => {
  it('stores the DM’s canonical body and answers {sha256}: bare hex over the exact received bytes', async () => {
    const { dm, campaignId } = await seed();
    const json = packJson('homebrew-pack', '1.0.0');

    const res = await putPack(dm, campaignId, 'homebrew-pack', '1.0.0', json);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { sha256: string };
    expect(body).toEqual({ sha256: await sha256Hex(json) });
    expect(body.sha256).toMatch(/^[0-9a-f]{64}$/);

    const read = await getPack(dm, campaignId, 'homebrew-pack', '1.0.0');
    expect(read.status).toBe(200);
    expect(await read.text()).toBe(json);
  });

  it('accepts a body far above the 64 KB JSON-route cap (only the 5 MiB pack cap applies here)', async () => {
    const { dm, campaignId } = await seed();
    const json = paddedPackJson('big-pack', '1.0.0', 1024 * 1024);
    expect(json.length).toBeGreaterThan(64 * 1024);
    const res = await putPack(dm, campaignId, 'big-pack', '1.0.0', json);
    expect(res.status).toBe(200);
  });

  it('refuses a member (not the DM) with 403 and stores nothing', async () => {
    const { dm, member, campaignId } = await seed();
    const res = await putPack(member, campaignId, 'homebrew-pack', '1.0.0', packJson('homebrew-pack', '1.0.0'));
    expect(res.status).toBe(403);
    expect((await getPack(dm, campaignId, 'homebrew-pack', '1.0.0')).status).toBe(404);
  });

  it('refuses a non-member with 403', async () => {
    const { stranger, campaignId } = await seed();
    const res = await putPack(stranger, campaignId, 'homebrew-pack', '1.0.0', packJson('homebrew-pack', '1.0.0'));
    expect(res.status).toBe(403);
  });

  it('answers 413 for a body over 5 MiB', async () => {
    const { dm, campaignId } = await seed();
    const res = await putPack(dm, campaignId, 'homebrew-pack', '1.0.0', 'x'.repeat(CAMPAIGN_PACK_BYTES_MAX + 1));
    expect(res.status).toBe(413);
  });

  // [fix round 1] Authentication and the DM check run BEFORE the 5 MiB body limit, so nobody but
  // the DM can make the server buffer a pack upload. A chunked body (no Content-Length) is the
  // case that matters: Hono's `bodyLimit` reads such a body in full (up to the limit) before it
  // calls `next()`, so if it ran first it would buffer up to 5 MiB for any caller.
  it('refuses a member’s oversized upload with 403 (not 413): the DM check runs before the body limit', async () => {
    const { member, campaignId } = await seed();
    const res = await putPack(member, campaignId, 'homebrew-pack', '1.0.0', 'x'.repeat(CAMPAIGN_PACK_BYTES_MAX + 1));
    expect(res.status).toBe(403);
  });

  it('reads no byte of a chunked upload from an unauthenticated caller (401) or a non-DM (403)', async () => {
    const { member, stranger, campaignId } = await seed();
    for (const [label, cookie, status] of [
      ['unauthenticated', undefined, 401],
      ['member', member, 403],
      ['non-member', stranger, 403],
    ] as const) {
      const body = trackedStream(CAMPAIGN_PACK_BYTES_MAX + 1);
      const res = await putPackStream(cookie, campaignId, 'homebrew-pack', '1.0.0', body.stream);
      expect(res.status, label).toBe(status);
      expect(body.pulled(), `${label}: bytes read from the request body`).toBe(0);
    }
  });

  it('still answers 413 to the DM for a chunked upload over 5 MiB', async () => {
    const { dm, campaignId } = await seed();
    const body = trackedStream(CAMPAIGN_PACK_BYTES_MAX + 64 * 1024);
    const res = await putPackStream(dm, campaignId, 'homebrew-pack', '1.0.0', body.stream);
    expect(res.status).toBe(413);
    expect((await getPack(dm, campaignId, 'homebrew-pack', '1.0.0')).status).toBe(404);
  });

  it('answers 400 for a body that is valid JSON but not canonical (whitespace or unsorted keys)', async () => {
    const { dm, campaignId } = await seed();
    const pretty = JSON.stringify(JSON.parse(packJson('homebrew-pack', '1.0.0')), null, 2);
    expect((await putPack(dm, campaignId, 'homebrew-pack', '1.0.0', pretty)).status).toBe(400);

    const unsorted = JSON.stringify({
      name: 'Homebrew',
      format: 1,
      id: 'homebrew-pack',
      version: '1.0.0',
      kind: 'content',
      system: 'test-system',
    });
    expect((await putPack(dm, campaignId, 'homebrew-pack', '1.0.0', unsorted)).status).toBe(400);

    // Sorted and compact, but not the NORMALIZED form: the strict parse would fill in the
    // defaulted fields, so `canonicalJson(parsed)` differs from the received body.
    const unnormalized = canonical({
      format: 1,
      id: 'homebrew-pack',
      version: '1.0.0',
      kind: 'content',
      system: 'test-system',
      name: 'Homebrew',
    });
    expect((await putPack(dm, campaignId, 'homebrew-pack', '1.0.0', unnormalized)).status).toBe(400);
    expect((await getPack(dm, campaignId, 'homebrew-pack', '1.0.0')).status).toBe(404);
  });

  it('answers 400 for malformed JSON, a strict-schema failure, or a body naming another id/version', async () => {
    const { dm, campaignId } = await seed();
    const cases: readonly [string, string][] = [
      ['malformed JSON', '{"format":1,'],
      ['unknown key (strict pack schema)', packJson('homebrew-pack', '1.0.0', { bogus: true })],
      ['content pack without a system', canonical({ ...packObject('homebrew-pack', '1.0.0'), system: undefined })],
      ['id differs from the URL', packJson('other-pack', '1.0.0')],
      ['version differs from the URL', packJson('homebrew-pack', '1.0.1')],
    ];
    for (const [label, body] of cases) {
      const res = await putPack(dm, campaignId, 'homebrew-pack', '1.0.0', body);
      expect(res.status, label).toBe(400);
    }
    expect((await getPack(dm, campaignId, 'homebrew-pack', '1.0.0')).status).toBe(404);
  });

  it('answers 400 for a malformed packId or version path segment', async () => {
    const { dm, campaignId } = await seed();
    expect((await putPack(dm, campaignId, 'Not_A_Pack', '1.0.0', packJson('homebrew-pack', '1.0.0'))).status).toBe(400);
    expect((await putPack(dm, campaignId, 'homebrew-pack', 'one', packJson('homebrew-pack', '1.0.0'))).status).toBe(
      400,
    );
  });

  it('caps total stored pack bytes per campaign at 30 MiB (409 quota_exceeded); replacing a packId counts it once', async () => {
    const { dm, campaignId } = await seed();
    const perPack = CAMPAIGN_PACK_BYTES_MAX - 64 * 1024;
    const count = CAMPAIGN_PACK_BYTES_TOTAL_MAX / CAMPAIGN_PACK_BYTES_MAX;
    for (let i = 0; i < count; i += 1) {
      const res = await putPack(dm, campaignId, `pack-${i}`, '1.0.0', paddedPackJson(`pack-${i}`, '1.0.0', perPack));
      expect(res.status, `pack #${i + 1} fits`).toBe(200);
    }

    const over = await putPack(dm, campaignId, 'one-more', '1.0.0', paddedPackJson('one-more', '1.0.0', 512 * 1024));
    expect(over.status).toBe(409);
    expect(((await over.json()) as { error: string }).error).toBe('quota_exceeded');
    expect((await getPack(dm, campaignId, 'one-more', '1.0.0')).status).toBe(404);

    const replace = await putPack(dm, campaignId, 'pack-0', '2.0.0', paddedPackJson('pack-0', '2.0.0', perPack));
    expect(replace.status, 'a new version of a stored packId replaces its old body').toBe(200);
    expect((await getPack(dm, campaignId, 'pack-0', '1.0.0')).status, 'one version per packId').toBe(404);
  });

  // [final fix wave, F3] Members install only `kind: content` packs (`parseExternalPack`), so a
  // stored body of any other kind could never be installed.
  it('answers 400 bad_request for a schema-valid pack whose kind is not content, and stores nothing', async () => {
    const { dm, campaignId } = await seed();
    const cases: readonly [string, string][] = [
      ['theme', packJson('other-kind', '1.0.0', { kind: 'theme' })],
      [
        'translation',
        packJson('other-kind', '1.0.0', {
          kind: 'translation',
          locale: 'ru',
          translates: { id: 'srd-5e-2024', range: '^1.0.0' },
          strings: {},
        }),
      ],
    ];
    for (const [label, body] of cases) {
      const res = await putPack(dm, campaignId, 'other-kind', '1.0.0', body);
      expect(res.status, label).toBe(400);
      expect(((await res.json()) as { error: string }).error, label).toBe('bad_request');
    }
    expect((await getPack(dm, campaignId, 'other-kind', '1.0.0')).status).toBe(404);
  });

  // [final fix wave, F4] A body whose `pack.enabled` would be refused `quota` is never stored, so
  // it cannot sit in the 30 MiB total with no way for the DM to free it.
  it(`refuses a NEW packId once ${CAMPAIGN_NON_CORE_PACK_MAX} distinct packs are enabled (409 quota_exceeded); a new version of an enabled one is accepted`, async () => {
    const { dm, campaignId } = await seed();
    for (let i = 0; i < CAMPAIGN_NON_CORE_PACK_MAX; i += 1) await enablePack(dm, campaignId, `pack-${i}`, '1.0.0');

    const seventh = await putPack(dm, campaignId, 'one-too-many', '1.0.0', packJson('one-too-many', '1.0.0'));
    expect(seventh.status).toBe(409);
    expect(((await seventh.json()) as { error: string }).error).toBe('quota_exceeded');
    expect((await getPack(dm, campaignId, 'one-too-many', '1.0.0')).status, 'nothing stored').toBe(404);

    const versionChange = await putPack(dm, campaignId, 'pack-0', '2.0.0', packJson('pack-0', '2.0.0'));
    expect(versionChange.status, 'an enabled packId may still change version').toBe(200);
  });
});

describe('GET /api/campaigns/:campaignId/packs/:packId/:version', () => {
  it('serves a member the exact stored body with ETag "<sha256>", and 304 on a matching If-None-Match', async () => {
    const { dm, member, campaignId } = await seed();
    const json = packJson('homebrew-pack', '1.0.0');
    const put = await putPack(dm, campaignId, 'homebrew-pack', '1.0.0', json);
    const { sha256 } = (await put.json()) as { sha256: string };

    const res = await getPack(member, campaignId, 'homebrew-pack', '1.0.0');
    expect(res.status).toBe(200);
    expect(res.headers.get('etag')).toBe(`"${sha256}"`);
    expect(res.headers.get('content-type')).toMatch(/^application\/json/);
    expect(await res.text()).toBe(json);

    const cached = await getPack(member, campaignId, 'homebrew-pack', '1.0.0', { 'If-None-Match': `"${sha256}"` });
    expect(cached.status).toBe(304);
    expect(cached.headers.get('etag')).toBe(`"${sha256}"`);
    expect(await cached.text()).toBe('');

    const stale = await getPack(member, campaignId, 'homebrew-pack', '1.0.0', {
      'If-None-Match': `"${'0'.repeat(64)}"`,
    });
    expect(stale.status).toBe(200);
  });

  it('refuses a non-member with 403', async () => {
    const { dm, stranger, campaignId } = await seed();
    await putPack(dm, campaignId, 'homebrew-pack', '1.0.0', packJson('homebrew-pack', '1.0.0'));
    expect((await getPack(stranger, campaignId, 'homebrew-pack', '1.0.0')).status).toBe(403);
  });

  it('answers 404 for an unknown pack or a version other than the stored one', async () => {
    const { dm, member, campaignId } = await seed();
    await putPack(dm, campaignId, 'homebrew-pack', '1.0.0', packJson('homebrew-pack', '1.0.0'));
    expect((await getPack(member, campaignId, 'missing-pack', '1.0.0')).status).toBe(404);
    expect((await getPack(member, campaignId, 'homebrew-pack', '1.0.1')).status).toBe(404);
  });

  it('keeps each campaign’s pack bodies separate (same packId in two campaigns)', async () => {
    const { dm, campaignId } = await seed();
    const other = await createCampaign(dm);
    const a = packJson('shared-pack', '1.0.0', { name: 'Campaign A copy' });
    const b = packJson('shared-pack', '2.0.0', { name: 'Campaign B copy' });
    expect((await putPack(dm, campaignId, 'shared-pack', '1.0.0', a)).status).toBe(200);
    expect((await putPack(dm, other.id, 'shared-pack', '2.0.0', b)).status).toBe(200);
    expect(await (await getPack(dm, campaignId, 'shared-pack', '1.0.0')).text()).toBe(a);
    expect(await (await getPack(dm, other.id, 'shared-pack', '2.0.0')).text()).toBe(b);
  });
});
