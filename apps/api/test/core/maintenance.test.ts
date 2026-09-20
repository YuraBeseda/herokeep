/**
 * `core/maintenance.ts` tests (task-10-brief step 1): expired-session purge, `usage_daily`
 * writes, the quota chain (stream meta -> `characters.bytesUsed`/`eventCount` ->
 * `users.quota_bytes_used`), and the orphan check (report counts only, no destructive action).
 * Uses a REAL accounts DB (`test-db.ts`, every migration applied) and a hand-rolled
 * `MaintenanceStreams` double (no real stream storage needed — `core/maintenance.ts` only ever
 * calls the port's two methods).
 */
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MaintenanceStreams, StreamUsage } from '../../src/ports/stream.ts';
import { runDailyMaintenance } from '../../src/core/maintenance.ts';
import { campaigns, characters, sessions, usageDaily, users } from '../../src/core/db/schema.ts';
import { openTestDb, type TestDbHandle } from '../helpers/test-db.ts';

const DAY_MS = 24 * 60 * 60_000;

class FakeMaintenanceStreams implements MaintenanceStreams {
  private readonly usage = new Map<string, StreamUsage>();
  private streamIds: string[] = [];

  setUsage(streamId: string, usage: StreamUsage): void {
    this.usage.set(streamId, usage);
  }

  setListedStreamIds(ids: string[]): void {
    this.streamIds = ids;
  }

  getStreamUsage(streamId: string): Promise<StreamUsage> {
    return Promise.resolve(this.usage.get(streamId) ?? { bytesUsed: 0, eventCount: 0 });
  }

  listStreamIds(): Promise<string[]> {
    return Promise.resolve(this.streamIds);
  }
}

// `listStreamIds` is an OPTIONAL port method (`ports/stream.ts`'s doc comment) -- a double that
// doesn't want to implement it at all must OMIT the property, not implement it returning
// `undefined` (an actual `Promise<string[]>` is required whenever the property exists). This
// second double models the Cloudflare shape exactly: no `listStreamIds` in sight.
class FakeMaintenanceStreamsNoListing implements MaintenanceStreams {
  private readonly usage = new Map<string, StreamUsage>();

  setUsage(streamId: string, usage: StreamUsage): void {
    this.usage.set(streamId, usage);
  }

  getStreamUsage(streamId: string): Promise<StreamUsage> {
    return Promise.resolve(this.usage.get(streamId) ?? { bytesUsed: 0, eventCount: 0 });
  }
}

let handle: TestDbHandle;

beforeEach(() => {
  handle = openTestDb();
});

afterEach(() => {
  handle.close();
});

async function seedUser(id: string, usernameFolded: string, now: number): Promise<void> {
  await handle.db.insert(users).values({
    id,
    username: usernameFolded,
    usernameFolded,
    salt: 'a'.repeat(32),
    verifierHash: 'b'.repeat(64),
    createdAt: now,
    quotaBytesUsed: 0,
  });
}

async function seedCharacter(
  id: string,
  ownerId: string,
  now: number,
  overrides: Partial<{ bytesUsed: number; eventCount: number }> = {},
): Promise<void> {
  await handle.db.insert(characters).values({
    id,
    ownerId,
    name: 'Wisp',
    system: 'srd-5e-2024',
    campaignId: null,
    archivedAt: null,
    bytesUsed: overrides.bytesUsed ?? 0,
    eventCount: overrides.eventCount ?? 0,
    updatedAt: now,
  });
}

/** [plan-9 Task 9] Minimal, directly-inserted `campaigns` D1 row — mirrors `seedCharacter`'s
 * shape/spirit for the campaign table (Task 3's schema: `id, dmId, name, system, joinCode UNIQUE,
 * joinOpen, bytesUsed, updatedAt`). `joinCode` just needs to be unique per test, not a real
 * `generateJoinCode()` output — nothing in `core/maintenance.ts` ever reads it. */
async function seedCampaign(
  id: string,
  dmId: string,
  joinCode: string,
  now: number,
  overrides: Partial<{ bytesUsed: number }> = {},
): Promise<void> {
  await handle.db.insert(campaigns).values({
    id,
    dmId,
    name: 'The Sunless Citadel',
    system: 'srd-5e-2024',
    joinCode,
    joinOpen: true,
    bytesUsed: overrides.bytesUsed ?? 0,
    updatedAt: now,
  });
}

async function seedSession(tokenHash: string, userId: string, now: number, expiresAt: number): Promise<void> {
  await handle.db.insert(sessions).values({
    tokenHash,
    userId,
    deviceLabel: 'test-device',
    createdAt: now,
    lastSeenAt: now,
    expiresAt,
  });
}

describe('runDailyMaintenance — expired-session purge', () => {
  it('deletes only sessions whose expiresAt <= now, leaving unexpired ones intact', async () => {
    const now = Date.now();
    await seedUser('user-1', 'purge-user', now);
    await seedSession('expired-token', 'user-1', now, now - 1000);
    await seedSession('active-token', 'user-1', now, now + DAY_MS);

    const streams = new FakeMaintenanceStreams();
    const report = await runDailyMaintenance({ db: handle.db, streams, now });

    expect(report.expiredSessionsPurged).toBe(1);
    const remaining = await handle.db.select().from(sessions);
    expect(remaining.map((s) => s.tokenHash)).toEqual(['active-token']);
  });
});

describe('runDailyMaintenance — usage_daily counters', () => {
  it('writes activeSessions/users/characters/totalBytes/campaigns/campaignBytes rows for the day', async () => {
    const now = Date.UTC(2026, 8, 19, 3, 0, 0); // 2026-09-19T03:00:00Z
    await seedUser('user-1', 'counter-user', now);
    await seedCharacter('char-1', 'user-1', now, { bytesUsed: 1000, eventCount: 5 });
    await seedCharacter('char-2', 'user-1', now, { bytesUsed: 2000, eventCount: 7 });
    // [plan-9 Task 9] A campaign, with a STALE (pre-sync) bytesUsed already on the D1 row — the
    // usage snapshot must read this PRE-sync value (same "before this run's own write" convention
    // `totalBytes` already uses), not whatever step 3b syncs it to a moment later.
    await seedCampaign('camp-1', 'user-1', 'ABCDEFGH', now, { bytesUsed: 500 });
    await seedSession('active-token', 'user-1', now, now + DAY_MS);

    const streams = new FakeMaintenanceStreams();
    streams.setUsage('char:char-1', { bytesUsed: 1000, eventCount: 5 });
    streams.setUsage('char:char-2', { bytesUsed: 2000, eventCount: 7 });
    streams.setUsage('camp:camp-1', { bytesUsed: 9000, eventCount: 12 });

    const report = await runDailyMaintenance({ db: handle.db, streams, now });
    expect(report.day).toBe('2026-09-19');
    expect(report.usage).toEqual({
      activeSessions: 1,
      users: 1,
      characters: 2,
      totalBytes: 3000,
      campaigns: 1,
      campaignBytes: 500, // pre-sync D1 value, not the 9000 the stream's own meta reports.
    });

    const rows = await handle.db.select().from(usageDaily).where(eq(usageDaily.day, '2026-09-19'));
    const byMetric = Object.fromEntries(rows.map((r) => [r.metric, r.value]));
    expect(byMetric).toEqual({
      activeSessions: 1,
      users: 1,
      characters: 2,
      totalBytes: 3000,
      campaigns: 1,
      campaignBytes: 500,
    });
  });
});

describe('runDailyMaintenance — [plan-9 Task 9] campaign bytes_used sync', () => {
  it('syncs campaigns.bytesUsed from stream meta, per campaign, WITHOUT touching users.quota_bytes_used', async () => {
    const now = Date.now();
    await seedUser('dm-1', 'campaign-dm', now);
    // A character owned by the SAME user, small and unrelated to the (much larger) campaign byte
    // counts below — the only thing that should ever reach `users.quota_bytes_used`.
    await seedCharacter('char-owned-by-dm', 'dm-1', now, { bytesUsed: 0, eventCount: 0 });
    await seedCampaign('camp-a', 'dm-1', 'CAMPCODEA', now, { bytesUsed: 0 });
    await seedCampaign('camp-b', 'dm-1', 'CAMPCODEB', now, { bytesUsed: 0 });

    const streams = new FakeMaintenanceStreams();
    streams.setUsage('char:char-owned-by-dm', { bytesUsed: 42, eventCount: 1 });
    streams.setUsage('camp:camp-a', { bytesUsed: 4_000_000, eventCount: 30 });
    streams.setUsage('camp:camp-b', { bytesUsed: 6_000_000, eventCount: 50 });

    const report = await runDailyMaintenance({ db: handle.db, streams, now });
    expect(report.campaignsSynced).toBe(2);

    const [campA] = await handle.db.select().from(campaigns).where(eq(campaigns.id, 'camp-a'));
    const [campB] = await handle.db.select().from(campaigns).where(eq(campaigns.id, 'camp-b'));
    expect(campA?.bytesUsed).toBe(4_000_000);
    expect(campB?.bytesUsed).toBe(6_000_000);

    // doc-08: campaign quota is per-stream, not per-user — this DM's `users.quota_bytes_used`
    // must equal ONLY their character's synced bytes (42), never `42 + 4_000_000 + 6_000_000`.
    const [dm] = await handle.db.select().from(users).where(eq(users.id, 'dm-1'));
    expect(dm?.quotaBytesUsed).toBe(42);
  });

  it('does not touch updatedAt/name/joinCode on the synced campaign row', async () => {
    const now = Date.now();
    await seedUser('dm-2', 'campaign-dm-2', now);
    await seedCampaign('camp-c', 'dm-2', 'CAMPCODEC', now);
    const streams = new FakeMaintenanceStreams();
    streams.setUsage('camp:camp-c', { bytesUsed: 777, eventCount: 3 });

    await runDailyMaintenance({ db: handle.db, streams, now });

    const [campC] = await handle.db.select().from(campaigns).where(eq(campaigns.id, 'camp-c'));
    expect(campC).toMatchObject({ name: 'The Sunless Citadel', joinCode: 'CAMPCODEC', updatedAt: now });
  });
});

describe('runDailyMaintenance — the quota chain (controller ruling, quotas.ts)', () => {
  it('syncs characters.bytesUsed/eventCount from stream meta and recomputes users.quota_bytes_used per owner', async () => {
    const now = Date.now();
    await seedUser('owner-1', 'quota-owner', now);
    await seedCharacter('char-a', 'owner-1', now, { bytesUsed: 0, eventCount: 0 });
    await seedCharacter('char-b', 'owner-1', now, { bytesUsed: 0, eventCount: 0 });

    const streams = new FakeMaintenanceStreams();
    streams.setUsage('char:char-a', { bytesUsed: 4000, eventCount: 10 });
    streams.setUsage('char:char-b', { bytesUsed: 6000, eventCount: 20 });

    const report = await runDailyMaintenance({ db: handle.db, streams, now });
    expect(report.charactersSynced).toBe(2);
    expect(report.ownersQuotaRecomputed).toBe(1);

    const [charA] = await handle.db.select().from(characters).where(eq(characters.id, 'char-a'));
    const [charB] = await handle.db.select().from(characters).where(eq(characters.id, 'char-b'));
    expect(charA).toMatchObject({ bytesUsed: 4000, eventCount: 10 });
    expect(charB).toMatchObject({ bytesUsed: 6000, eventCount: 20 });

    const [owner] = await handle.db.select().from(users).where(eq(users.id, 'owner-1'));
    expect(owner?.quotaBytesUsed).toBe(10000);
  });

  it('zeroes a stale quota_bytes_used for an owner with no characters left (finding 4 fix)', async () => {
    // Whole-branch review finding 4: `maintenance.ts:147-149`'s pre-fix loop only ever wrote a
    // total for an owner appearing in `ownerTotals` — an owner who owned characters on a PRIOR
    // run but owns NONE today (every one hard-deleted since) never appears there at all, so their
    // stale `users.quota_bytes_used` from the last run they DID have characters survived forever,
    // permanently blocking `POST /api/characters`'s quota gate for an account that is actually
    // empty. RED-first: seed a user whose CURRENT `quota_bytes_used` is already stale-nonzero
    // (simulating "characters existed once, all deleted since") with NO character rows at all.
    const now = Date.now();
    await seedUser('owner-stale', 'stale-quota-owner', now);
    await handle.db.update(users).set({ quotaBytesUsed: 999_999 }).where(eq(users.id, 'owner-stale'));

    // A DIFFERENT owner, with a real character, must still get its normal recompute (not swept
    // to 0 too) — proves the fix is scoped to "no characters left", not "every user".
    await seedUser('owner-active', 'active-quota-owner', now);
    await seedCharacter('char-active', 'owner-active', now);
    const streams = new FakeMaintenanceStreams();
    streams.setUsage('char:char-active', { bytesUsed: 500, eventCount: 2 });

    const report = await runDailyMaintenance({ db: handle.db, streams, now });

    const [staleOwner] = await handle.db.select().from(users).where(eq(users.id, 'owner-stale'));
    expect(staleOwner?.quotaBytesUsed).toBe(0);

    const [activeOwner] = await handle.db.select().from(users).where(eq(users.id, 'owner-active'));
    expect(activeOwner?.quotaBytesUsed).toBe(500);

    // Both the real recompute (owner-active) and the zero-out (owner-stale) count as "recomputed".
    expect(report.ownersQuotaRecomputed).toBe(2);
  });

  it('leaves a user whose quota_bytes_used is already 0 and has no characters untouched (no spurious write needed)', async () => {
    const now = Date.now();
    await seedUser('owner-empty', 'empty-quota-owner', now);
    const streams = new FakeMaintenanceStreams();

    const report = await runDailyMaintenance({ db: handle.db, streams, now });

    const [owner] = await handle.db.select().from(users).where(eq(users.id, 'owner-empty'));
    expect(owner?.quotaBytesUsed).toBe(0);
    expect(report.ownersQuotaRecomputed).toBe(0);
  });

  it('does not touch updatedAt/name/archivedAt on the synced character row', async () => {
    const now = Date.now();
    await seedUser('owner-2', 'quota-owner-2', now);
    await seedCharacter('char-c', 'owner-2', now);
    const streams = new FakeMaintenanceStreams();
    streams.setUsage('char:char-c', { bytesUsed: 500, eventCount: 1 });

    await runDailyMaintenance({ db: handle.db, streams, now });

    const [charC] = await handle.db.select().from(characters).where(eq(characters.id, 'char-c'));
    expect(charC).toMatchObject({ name: 'Wisp', archivedAt: null, updatedAt: now });
  });
});

describe('runDailyMaintenance — orphan check (report only, no destructive action)', () => {
  it('counts characters whose stream has no events, without deleting anything', async () => {
    const now = Date.now();
    await seedUser('owner-3', 'orphan-owner', now);
    await seedCharacter('char-empty', 'owner-3', now);
    await seedCharacter('char-full', 'owner-3', now);

    const streams = new FakeMaintenanceStreams();
    streams.setUsage('char:char-empty', { bytesUsed: 0, eventCount: 0 });
    streams.setUsage('char:char-full', { bytesUsed: 100, eventCount: 3 });

    const report = await runDailyMaintenance({ db: handle.db, streams, now });
    expect(report.orphans.charactersWithNoStreamEvents).toBe(1);

    // No destructive action: both index rows still exist afterwards.
    const rows = await handle.db.select().from(characters);
    expect(rows).toHaveLength(2);
  });

  it('counts streams with no matching index row when listStreamIds is available', async () => {
    const now = Date.now();
    await seedUser('owner-4', 'orphan-owner-2', now);
    await seedCharacter('char-indexed', 'owner-4', now);

    const streams = new FakeMaintenanceStreams();
    streams.setUsage('char:char-indexed', { bytesUsed: 10, eventCount: 1 });
    streams.setListedStreamIds(['char:char-indexed', 'char:orphaned-stream']);

    const report = await runDailyMaintenance({ db: handle.db, streams, now });
    expect(report.orphans.streamsWithoutIndexRow).toBe(1);
  });

  it('reports streamsWithoutIndexRow as null when the adapter has no listStreamIds (Cloudflare shape)', async () => {
    const now = Date.now();
    await seedUser('owner-5', 'orphan-owner-3', now);
    await seedCharacter('char-only', 'owner-5', now);

    const streams = new FakeMaintenanceStreamsNoListing();
    streams.setUsage('char:char-only', { bytesUsed: 10, eventCount: 1 });

    const report = await runDailyMaintenance({ db: handle.db, streams, now });
    expect(report.orphans.streamsWithoutIndexRow).toBeNull();
  });

  it('[plan-9 Task 9 fix] a camp: stream with a matching D1 campaigns row no longer counts as a false-positive orphan, but an UNindexed camp: stream still genuinely does', async () => {
    const now = Date.now();
    await seedUser('owner-6', 'orphan-owner-campaign', now);
    await seedCharacter('char-indexed-2', 'owner-6', now);
    await seedCampaign('camp-indexed', 'owner-6', 'ORPHANFIX', now);

    const streams = new FakeMaintenanceStreams();
    streams.setUsage('char:char-indexed-2', { bytesUsed: 10, eventCount: 1 });
    streams.setUsage('camp:camp-indexed', { bytesUsed: 20, eventCount: 2 });
    // `camp:orphaned-campaign-stream` has NO matching `campaigns` D1 row at all (e.g. manual DB
    // surgery) — this one is a GENUINE orphan, before and after this task's fix.
    streams.setListedStreamIds(['char:char-indexed-2', 'camp:camp-indexed', 'camp:orphaned-campaign-stream']);

    const report = await runDailyMaintenance({ db: handle.db, streams, now });
    expect(report.orphans.streamsWithoutIndexRow).toBe(1);
  });
});
