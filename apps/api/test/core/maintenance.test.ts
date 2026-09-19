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
import { characters, sessions, usageDaily, users } from '../../src/core/db/schema.ts';
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
  it('writes activeSessions/users/characters/totalBytes rows for the day', async () => {
    const now = Date.UTC(2026, 8, 19, 3, 0, 0); // 2026-09-19T03:00:00Z
    await seedUser('user-1', 'counter-user', now);
    await seedCharacter('char-1', 'user-1', now, { bytesUsed: 1000, eventCount: 5 });
    await seedCharacter('char-2', 'user-1', now, { bytesUsed: 2000, eventCount: 7 });
    await seedSession('active-token', 'user-1', now, now + DAY_MS);

    const streams = new FakeMaintenanceStreams();
    streams.setUsage('char:char-1', { bytesUsed: 1000, eventCount: 5 });
    streams.setUsage('char:char-2', { bytesUsed: 2000, eventCount: 7 });

    const report = await runDailyMaintenance({ db: handle.db, streams, now });
    expect(report.day).toBe('2026-09-19');
    expect(report.usage).toEqual({ activeSessions: 1, users: 1, characters: 2, totalBytes: 3000 });

    const rows = await handle.db.select().from(usageDaily).where(eq(usageDaily.day, '2026-09-19'));
    const byMetric = Object.fromEntries(rows.map((r) => [r.metric, r.value]));
    expect(byMetric).toEqual({ activeSessions: 1, users: 1, characters: 2, totalBytes: 3000 });
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
});
