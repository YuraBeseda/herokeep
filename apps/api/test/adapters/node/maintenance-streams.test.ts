/**
 * `NodeMaintenanceStreams` (`adapters/node/maintenance-streams.ts`) tests, fix round 1 (Task 10
 * review, Important finding): the real SQL-backed adapter the production quota chain depends on
 * had zero coverage — `test/core/maintenance.test.ts`'s quota-chain assertions only ever drive
 * `runDailyMaintenance` against `FakeMaintenanceStreams`, an in-memory double. This file seeds
 * REAL `meta`/`events` rows via `SqliteFileStreamStore`/`openStreamsDb` (a real temp-dir sqlite
 * file, exactly like `test/adapters/node/store.test.ts`), then:
 *   1. unit-tests `NodeMaintenanceStreams.getStreamUsage`/`.listStreamIds` directly against that
 *      real storage, and
 *   2. drives `runDailyMaintenance` END-TO-END over the real Node stack (real
 *      `NodeMaintenanceStreams` + a real accounts db via `openAccountsDb`, no fakes anywhere),
 *      asserting `characters.bytesUsed`/`eventCount` are synced from the real stream meta AND
 *      `users.quota_bytes_used` is recomputed as the sum, AND `listStreamIds` enumerates the
 *      seeded streams (via the orphan check's `streamsWithoutIndexRow` reading 0).
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import type { Event } from '@hk/protocol';
import { openAccountsDb, type AccountsDbHandle } from '../../../src/adapters/node/db.sqlite.ts';
import { openStreamsDb, SqliteFileStreamStore } from '../../../src/adapters/node/store.sqlite-file.ts';
import { NodeMaintenanceStreams } from '../../../src/adapters/node/maintenance-streams.ts';
import { runDailyMaintenance } from '../../../src/core/maintenance.ts';
import { measureEventBytes } from '../../../src/core/validate.ts';
import { uuidv7 } from '../../../src/core/ids.ts';
import { insertUser, listAllCharacters, listAllUsers, upsertCharacterIndexRow } from '../../../src/core/db/queries.ts';

function makeEvent(streamId: string, overrides: Partial<Event> = {}): Event {
  return {
    id: uuidv7(),
    stream: streamId,
    ts: new Date().toISOString(),
    actor: { userId: 'user-1', deviceId: 'device-1', role: 'owner' },
    type: 'note.added',
    v: 1,
    payload: { note: uuidv7() },
    ...overrides,
  };
}

/** Mirrors what `StreamActor.append`'s real `writeMeta` step does after a real commit (this
 * test seeds storage directly, bypassing the actor, so it reproduces that bookkeeping by hand —
 * see this file's header comment): sums `measureEventBytes` over the COMMITTED (seq-stamped)
 * events, matching `stream-actor.ts`'s own "ground-truth measurement" comment. */
async function seedStreamWithRealMeta(
  db: Database.Database,
  streamId: string,
  eventCount: number,
): Promise<{ bytesUsed: number; eventCount: number }> {
  const store = new SqliteFileStreamStore(db, streamId);
  const drafts = Array.from({ length: eventCount }, () => makeEvent(streamId));
  const result = await store.append(drafts);
  const committed = drafts.map((event, i) => ({ ...event, seq: result.firstSeq + i }));
  const bytesUsed = committed.reduce((sum, event) => sum + measureEventBytes(event), 0);
  await store.setMeta('bytes_used', String(bytesUsed));
  await store.setMeta('event_count', String(eventCount));
  return { bytesUsed, eventCount };
}

let dir: string;
let accounts: AccountsDbHandle;
let streamsSqlite: ReturnType<typeof openStreamsDb>;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'hk-maintenance-streams-'));
  accounts = openAccountsDb(join(dir, 'accounts.sqlite'));
  streamsSqlite = openStreamsDb(join(dir, 'streams.sqlite'));
});

afterEach(() => {
  accounts.sqlite.close();
  streamsSqlite.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('NodeMaintenanceStreams — direct unit coverage over real storage', () => {
  it('getStreamUsage reads back real bytes_used/event_count meta written via SqliteFileStreamStore', async () => {
    const streamId = `char:${uuidv7()}`;
    const seeded = await seedStreamWithRealMeta(streamsSqlite, streamId, 4);

    const maintenanceStreams = new NodeMaintenanceStreams(streamsSqlite);
    const usage = await maintenanceStreams.getStreamUsage(streamId);
    expect(usage).toEqual(seeded);
  });

  it('getStreamUsage returns zeros for a stream with no meta ever written', async () => {
    const maintenanceStreams = new NodeMaintenanceStreams(streamsSqlite);
    const usage = await maintenanceStreams.getStreamUsage(`char:${uuidv7()}`);
    expect(usage).toEqual({ bytesUsed: 0, eventCount: 0 });
  });

  it('listStreamIds enumerates every stream with events or meta in the shared file', async () => {
    const streamA = `char:${uuidv7()}`;
    const streamB = `char:${uuidv7()}`;
    await seedStreamWithRealMeta(streamsSqlite, streamA, 2);
    await seedStreamWithRealMeta(streamsSqlite, streamB, 1);

    const maintenanceStreams = new NodeMaintenanceStreams(streamsSqlite);
    const ids = await maintenanceStreams.listStreamIds();
    expect([...ids].sort()).toEqual([streamA, streamB].sort());
  });
});

describe('NodeMaintenanceStreams — a camp: stream present does not break maintenance (plan-9 Task 8 obligation)', () => {
  // [plan-9 Task 8] Scope note (ledgered, not a bug this task fixes): `getStreamUsage`/
  // `listStreamIds` are prefix-AGNOSTIC (plain SQL over the shared `streams.sqlite` file, no
  // `char:`/`camp:` branching at all) — they already handle a `camp:` stream mechanically. What
  // this test actually proves is that `runDailyMaintenance` (`core/maintenance.ts`), which only
  // ever iterates `char:` streams via `listAllCharacters`, does not CRASH or mis-sync a `char:`
  // character's own numbers just because a `camp:` stream also exists in the same shared file —
  // it does not. The one KNOWN, DOCUMENTED limitation this surfaces (not fixed here — the plan
  // scopes the full campaign `bytes_used` sync to Task 9): a `camp:` stream has no matching D1
  // `characters` row by construction (it isn't a character at all), so the orphan check's
  // `streamsWithoutIndexRow` count currently includes it as a false-positive "orphan" — see this
  // test's own assertion below and task-8-report.md for the full write-up.
  it('a camp: stream alongside char: streams does not crash getStreamUsage/listStreamIds, and runDailyMaintenance still syncs the char: characters correctly', async () => {
    const now = Date.now();
    const ownerId = uuidv7();
    await insertUser(accounts.db, {
      id: ownerId,
      username: 'CampCoexistOwner',
      usernameFolded: 'campcoexistowner',
      salt: 'a'.repeat(32),
      verifierHash: 'b'.repeat(64),
      createdAt: now,
      quotaBytesUsed: 0,
    });
    const characterId = uuidv7();
    await upsertCharacterIndexRow(accounts.db, {
      id: characterId,
      ownerId,
      name: 'Toma',
      system: 'srd-5e-2024',
      campaignId: null,
      archivedAt: null,
      bytesUsed: 0,
      eventCount: 0,
      updatedAt: now,
    });

    const charStream = `char:${characterId}`;
    const campStream = `camp:${uuidv7()}`;
    const usage = await seedStreamWithRealMeta(streamsSqlite, charStream, 2);
    await seedStreamWithRealMeta(streamsSqlite, campStream, 3);

    const maintenanceStreams = new NodeMaintenanceStreams(streamsSqlite);

    // Direct unit coverage: neither method throws, and both see the camp: stream mechanically
    // (prefix-agnostic SQL — this file's header comment).
    const campUsage = await maintenanceStreams.getStreamUsage(campStream);
    expect(campUsage.eventCount).toBe(3);
    const ids = await maintenanceStreams.listStreamIds();
    expect([...ids].sort()).toEqual([campStream, charStream].sort());

    // End-to-end: runDailyMaintenance does not crash, and the char: character's own numbers sync
    // correctly regardless of the camp: stream's presence.
    const report = await runDailyMaintenance({ db: accounts.db, streams: maintenanceStreams, now });
    expect(report.charactersSynced).toBe(1);
    const [synced] = await listAllCharacters(accounts.db);
    expect(synced).toMatchObject(usage);

    // Documented, ACCEPTED limitation (see this describe block's own comment + task-8-report.md):
    // the camp: stream has no D1 characters row, so it counts as a false-positive "orphan" here —
    // asserted explicitly (not just left unchecked) so this test also PROVES the limitation is
    // real, not merely claimed, and will fail loudly if a future task's fix changes this count
    // without this assertion being updated alongside it.
    expect(report.orphans.streamsWithoutIndexRow).toBe(1);
  });
});

describe('runDailyMaintenance — end-to-end over the real Node stack (no fakes)', () => {
  it('syncs characters.bytesUsed/eventCount from real stream meta and recomputes users.quota_bytes_used', async () => {
    const now = Date.now();
    const ownerId = uuidv7();
    await insertUser(accounts.db, {
      id: ownerId,
      username: 'RealStackOwner',
      usernameFolded: 'realstackowner',
      salt: 'a'.repeat(32),
      verifierHash: 'b'.repeat(64),
      createdAt: now,
      quotaBytesUsed: 0,
    });

    const characterIdA = uuidv7();
    const characterIdB = uuidv7();
    await upsertCharacterIndexRow(accounts.db, {
      id: characterIdA,
      ownerId,
      name: 'Wisp',
      system: 'srd-5e-2024',
      campaignId: null,
      archivedAt: null,
      bytesUsed: 0,
      eventCount: 0,
      updatedAt: now,
    });
    await upsertCharacterIndexRow(accounts.db, {
      id: characterIdB,
      ownerId,
      name: 'Gale',
      system: 'srd-5e-2024',
      campaignId: null,
      archivedAt: null,
      bytesUsed: 0,
      eventCount: 0,
      updatedAt: now,
    });

    const streamA = `char:${characterIdA}`;
    const streamB = `char:${characterIdB}`;
    const usageA = await seedStreamWithRealMeta(streamsSqlite, streamA, 3);
    const usageB = await seedStreamWithRealMeta(streamsSqlite, streamB, 5);

    const maintenanceStreams = new NodeMaintenanceStreams(streamsSqlite);
    const report = await runDailyMaintenance({ db: accounts.db, streams: maintenanceStreams, now });

    expect(report.charactersSynced).toBe(2);
    expect(report.ownersQuotaRecomputed).toBe(1);
    // Both seeded streams have a matching characters index row, so the "stream with no index
    // row" half of the orphan check reads 0 -- this is also the assertion that `listStreamIds`
    // really did enumerate the two real, seeded streams (a bug there would either miss one,
    // reporting a false negative here, or -- if it returned nothing at all -- this being 0 for
    // the wrong reason is ruled out by the direct `listStreamIds` unit test above already
    // proving it returns exactly `[streamA, streamB]`).
    expect(report.orphans.streamsWithoutIndexRow).toBe(0);
    expect(report.orphans.charactersWithNoStreamEvents).toBe(0);

    const syncedCharacters = await listAllCharacters(accounts.db);
    const byId = new Map(syncedCharacters.map((c) => [c.id, c]));
    expect(byId.get(characterIdA)).toMatchObject(usageA);
    expect(byId.get(characterIdB)).toMatchObject(usageB);

    const [owner] = await listAllUsers(accounts.db);
    expect(owner?.quotaBytesUsed).toBe(usageA.bytesUsed + usageB.bytesUsed);
  });
});
