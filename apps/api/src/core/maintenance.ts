/**
 * The daily maintenance job (doc-10 §Daily maintenance; task-10-brief). Cloudflare drives this
 * from a Cron Trigger's `scheduled()` (`adapters/cloudflare/worker.ts`); Node drives it from
 * `Scheduler.daily` (`adapters/node/server.ts`, `IntervalScheduler`). Runtime-agnostic
 * (`src/core/**`'s boundary rule): depends only on `./db/queries.ts` (itself boundary-clean —
 * `drizzle-orm`/`drizzle-orm/sqlite-core` only) and the `MaintenanceStreams` port
 * (`ports/stream.ts`) each adapter implements over its own stream storage.
 *
 * No logging happens here (Global Constraints: "Security of logs: ... counters and error
 * classes only" — but even so, core code never calls `console.*` at all): a plain
 * `MaintenanceReport` is returned and each adapter decides what, if anything, to log from it.
 *
 * Runs, in order, exactly what doc-10 names plus the controller-ruling addition (quoted in full
 * in `quotas.ts`'s `USER_QUOTA_BYTES_MAX` doc comment):
 *   1. Usage counters -> `usage_daily` (`activeSessions`, `users`, `characters`, `totalBytes` —
 *      see `usage`'s local doc comment below for why these four).
 *   2. Expired-session purge.
 *   3. THE QUOTA CHAIN (controller ruling): sync every character's `bytesUsed`/`eventCount`
 *      from its stream's own meta (`MaintenanceStreams.getStreamUsage`), then recompute each
 *      owner's `users.quota_bytes_used` as the sum of their characters' freshly-synced
 *      `bytesUsed`.
 *   4. Orphan check — LOG (report) counts only, no destructive action (see `OrphanCounts`' doc
 *      comment for exactly what "orphan" means here and why one half is best-effort/adapter-
 *      dependent).
 */
import type { Db } from '../ports/db.ts';
import type { MaintenanceStreams, StreamUsage } from '../ports/stream.ts';
import {
  type Character,
  addUsage,
  countActiveSessions,
  countUsers,
  deleteExpiredSessions,
  listAllCharacters,
  listAllUsers,
  setUserQuotaBytes,
  updateCharacterUsage,
} from './db/queries.ts';

export interface MaintenanceDeps {
  readonly db: Db;
  readonly streams: MaintenanceStreams;
  /** Injectable clock, default `Date.now()` — same pattern as `auth/register.ts`'s `now`
   * parameter, for deterministic tests. */
  readonly now?: number;
}

/**
 * `usage_daily`'s four metrics for this run (task-10-brief: "pick sensible metrics:
 * activeSessions, users, characters, totalBytes — document"):
 *   - `activeSessions` / `users` / `characters`: point-in-time counts, useful for spotting
 *     sudden drops (an outage) or unexpected growth (abuse) at a glance.
 *   - `totalBytes`: the sum of every character's `bytesUsed` AS OF THE START of this run (i.e.
 *     BEFORE step 3's sync below writes fresh numbers) — `usage_daily` is a historical
 *     day-over-day series; using "before this run's own write" consistently, every day, keeps
 *     consecutive days comparable, rather than day N reading a post-sync number while day N+1
 *     (whose run hasn't happened yet when day N is computed) would implicitly read a pre-sync
 *     one. This mirrors the accepted ≤24h staleness `quotas.ts`'s `USER_QUOTA_BYTES_MAX` doc
 *     comment already documents for the same underlying number.
 */
export interface UsageCounters {
  readonly activeSessions: number;
  readonly users: number;
  readonly characters: number;
  readonly totalBytes: number;
}

/**
 * "Orphan" here means exactly the two doc-10 names ("orphan check"): a D1 `characters` row whose
 * stream has never received an event (created but never actually written to — possibly an
 * abandoned `POST /api/characters` that never got its `character.created` event), and a stream
 * that holds data but has NO matching D1 index row at all (a D1 row that was deleted/lost while
 * its stream's storage survived — e.g. a crash between `StreamHandle.deleteAll` and
 * `deleteCharacterIndexRow` in the hard-delete route, or manual DB surgery). Counted, never
 * acted on (task-10-brief: "LOG counts only, no destructive action") — both are recoverable
 * situations a human should look at, not conditions safe to silently delete/repair.
 */
export interface OrphanCounts {
  readonly charactersWithNoStreamEvents: number;
  /** `null` when the adapter's `MaintenanceStreams` has no `listStreamIds` (Cloudflare — see
   * that port method's doc comment: there is no API to enumerate Durable Object instances) —
   * "not checked on this adapter", never a false zero. */
  readonly streamsWithoutIndexRow: number | null;
}

export interface MaintenanceReport {
  readonly day: string;
  readonly usage: UsageCounters;
  readonly expiredSessionsPurged: number;
  readonly charactersSynced: number;
  readonly ownersQuotaRecomputed: number;
  readonly orphans: OrphanCounts;
}

/** `usage_daily.day`'s exact key shape (`schema.ts`'s doc comment: "a `YYYY-MM-DD` TEXT key").
 * `toISOString` is UTC and locale-independent, never a `toLocale*`/`Intl` call. */
function dayKey(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

interface SyncResult {
  readonly character: Character;
  readonly usage: StreamUsage;
}

export async function runDailyMaintenance(deps: MaintenanceDeps): Promise<MaintenanceReport> {
  const now = deps.now ?? Date.now();
  const day = dayKey(now);
  const { db, streams } = deps;

  const charactersBeforeSync = await listAllCharacters(db);

  // --- 1. Usage counters -> usage_daily (see `UsageCounters`' doc comment for the "before sync"
  // choice on totalBytes). --------------------------------------------------------------------
  const usage: UsageCounters = {
    activeSessions: await countActiveSessions(db, now),
    users: await countUsers(db),
    characters: charactersBeforeSync.length,
    totalBytes: charactersBeforeSync.reduce((sum, c) => sum + c.bytesUsed, 0),
  };
  // `addUsage` is ADDITIVE (accumulates `delta` onto any existing `(day, metric)` row) — a
  // same-UTC-day double fire of this job (e.g. a manual re-trigger) double-counts these
  // telemetry numbers. Accepted: `usage_daily` is an informational counter series, not an
  // enforcement path — the actual enforcement number, `users.quota_bytes_used` (step 3 below),
  // is written via an absolute `setUserQuotaBytes`, so it stays correct (idempotent) regardless
  // of how many times this job runs in one day.
  await addUsage(db, day, 'activeSessions', usage.activeSessions);
  await addUsage(db, day, 'users', usage.users);
  await addUsage(db, day, 'characters', usage.characters);
  await addUsage(db, day, 'totalBytes', usage.totalBytes);

  // --- 2. Expired-session purge. --------------------------------------------------------------
  const expiredSessionsPurged = await deleteExpiredSessions(db, now);

  // --- 3. The quota chain (controller ruling): stream meta -> characters.bytesUsed/eventCount
  // -> users.quota_bytes_used, per owner. ------------------------------------------------------
  const syncResults: SyncResult[] = [];
  for (const character of charactersBeforeSync) {
    const streamUsage = await streams.getStreamUsage(`char:${character.id}`);
    await updateCharacterUsage(db, character.id, streamUsage.bytesUsed, streamUsage.eventCount);
    syncResults.push({ character, usage: streamUsage });
  }

  const ownerTotals = new Map<string, number>();
  for (const { character, usage: streamUsage } of syncResults) {
    ownerTotals.set(character.ownerId, (ownerTotals.get(character.ownerId) ?? 0) + streamUsage.bytesUsed);
  }
  for (const [ownerId, total] of ownerTotals) {
    await setUserQuotaBytes(db, ownerId, total);
  }
  let ownersQuotaZeroed = 0;
  // Whole-branch review finding 4: an owner with ZERO characters left (the hard-delete route
  // removed their last one since the previous run) never appears in `ownerTotals` above at all —
  // the pre-fix loop only ever WROTE a total for an owner who owns at least one character today,
  // so that owner's `users.quota_bytes_used` kept whatever stale non-zero value the LAST run (when
  // they still had characters) left behind, forever, blocking `POST /api/characters`'s quota gate
  // for an account that is actually empty. Every user whose current `quota_bytes_used` is nonzero
  // and who owns no characters as of `charactersBeforeSync` is swept to 0 here, the same absolute-
  // set write `setUserQuotaBytes` already uses above (never a negative-delta adjustment, which
  // `adjustUserQuotaBytes` already floors at 0 anyway but is the WRONG tool here regardless: this
  // is a full recompute-from-scratch, matching every other owner's treatment in the loop above).
  for (const user of await listAllUsers(db)) {
    if (ownerTotals.has(user.id) || user.quotaBytesUsed === 0) continue;
    await setUserQuotaBytes(db, user.id, 0);
    ownersQuotaZeroed += 1;
  }

  // --- 4. Orphan check (LOG ONLY — see `OrphanCounts`' doc comment). --------------------------
  const charactersWithNoStreamEvents = syncResults.filter((r) => r.usage.eventCount === 0).length;
  let streamsWithoutIndexRow: number | null = null;
  if (streams.listStreamIds) {
    const allStreamIds = await streams.listStreamIds();
    const indexedIds = new Set(charactersBeforeSync.map((c) => `char:${c.id}`));
    streamsWithoutIndexRow = allStreamIds.filter((id) => !indexedIds.has(id)).length;
  }

  return {
    day,
    usage,
    expiredSessionsPurged,
    charactersSynced: syncResults.length,
    ownersQuotaRecomputed: ownerTotals.size + ownersQuotaZeroed,
    orphans: { charactersWithNoStreamEvents, streamsWithoutIndexRow },
  };
}
