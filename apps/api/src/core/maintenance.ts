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
 * in `quotas.ts`'s `USER_QUOTA_BYTES_MAX` doc comment) and plan-9 Task 9's campaign extension:
 *   1. Usage counters -> `usage_daily` (`activeSessions`, `users`, `characters`, `totalBytes`,
 *      `campaigns`, `campaignBytes` — see `usage`'s local doc comment below for why these six).
 *   2. Expired-session purge.
 *   3. THE QUOTA CHAIN (controller ruling): sync every character's `bytesUsed`/`eventCount`
 *      from its stream's own meta (`MaintenanceStreams.getStreamUsage`), then recompute each
 *      owner's `users.quota_bytes_used` as the sum of their characters' freshly-synced
 *      `bytesUsed`.
 *   3b. [plan-9 Task 9] CAMPAIGN bytes_used sync: the same per-stream `getStreamUsage` sync as
 *      3, but written to `campaigns.bytes_used` (`updateCampaignUsage`) — and, deliberately, going
 *      NO FURTHER than that. doc-08: "Campaign stream | 20 MB events ... | Enforced by CampaignStream"
 *      — campaign quota is PER-STREAM, not per-user, so unlike step 3 above there is no owner-total
 *      rollup step for campaigns at all: `users.quota_bytes_used` (character bytes only) is never
 *      touched by this step, and a campaign's DM's own `users.quota_bytes_used` is computed purely
 *      from their OWN characters exactly as before this task.
 *   4. Orphan check — LOG (report) counts only, no destructive action (see `OrphanCounts`' doc
 *      comment for exactly what "orphan" means here and why one half is best-effort/adapter-
 *      dependent). [plan-9 Task 9 fix] `streamsWithoutIndexRow` now also recognizes a `camp:`
 *      stream with a matching D1 `campaigns` row as indexed (see that field's doc comment for the
 *      false-positive this closes).
 */
import type { Db } from '../ports/db.ts';
import type { MaintenanceStreams, StreamUsage } from '../ports/stream.ts';
import {
  type Campaign,
  type Character,
  addUsage,
  countActiveSessions,
  countUsers,
  deleteExpiredSessions,
  listAllCampaigns,
  listAllCharacters,
  listAllUsers,
  setUserQuotaBytes,
  updateCampaignUsage,
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
 * `usage_daily`'s six metrics for this run (task-10-brief: "pick sensible metrics:
 * activeSessions, users, characters, totalBytes — document"; plan-9 Task 9 additively extends
 * this with the campaign analogues, same "pick sensible metrics, document" instruction):
 *   - `activeSessions` / `users` / `characters` / `campaigns`: point-in-time counts, useful for
 *     spotting sudden drops (an outage) or unexpected growth (abuse) at a glance.
 *   - `totalBytes` / `campaignBytes`: the sum of every character's / campaign's `bytesUsed` AS OF
 *     THE START of this run (i.e. BEFORE step 3/3b's sync below writes fresh numbers) —
 *     `usage_daily` is a historical day-over-day series; using "before this run's own write"
 *     consistently, every day, keeps consecutive days comparable, rather than day N reading a
 *     post-sync number while day N+1 (whose run hasn't happened yet when day N is computed) would
 *     implicitly read a pre-sync one. This mirrors the accepted ≤24h staleness `quotas.ts`'s
 *     `USER_QUOTA_BYTES_MAX` doc comment already documents for the same underlying number.
 */
export interface UsageCounters {
  readonly activeSessions: number;
  readonly users: number;
  readonly characters: number;
  readonly totalBytes: number;
  /** [plan-9 Task 9] Every campaign index row that exists right now — same point-in-time-count
   * shape as `characters` above. */
  readonly campaigns: number;
  /** [plan-9 Task 9] Sum of every campaign's `bytes_used` AS OF THE START of this run (the same
   * pre-sync convention `totalBytes` documents above) — informational only; never rolled into any
   * user's `quota_bytes_used` (doc-08: campaign quota is per-stream, not per-user). */
  readonly campaignBytes: number;
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
   * "not checked on this adapter", never a false zero.
   *
   * [plan-9 Task 9 fix] Before this task, "indexed" meant "has a matching D1 `characters` row"
   * ONLY — a `camp:` stream (which by construction never has one, campaigns are a different D1
   * table) was unconditionally miscounted as an orphan, documented as an accepted false positive
   * in `test/adapters/node/maintenance-streams.test.ts`'s Task 8 coverage. Fixed by recognizing
   * BOTH index tables now: a stream id counts as indexed if it matches either a `char:<id>`
   * character row OR a `camp:<id>` campaign row (`run` below builds the combined set from
   * `charactersBeforeSync`/`campaignsBeforeSync`). A `camp:` stream with no real D1 `campaigns`
   * row (e.g. manual DB surgery, or a crash between the campaign D1 write and its first event —
   * the exact same "recoverable, a human should look" cases `charactersWithNoStreamEvents`'s doc
   * comment already names for characters) is still correctly counted as a genuine orphan. */
  readonly streamsWithoutIndexRow: number | null;
}

export interface MaintenanceReport {
  readonly day: string;
  readonly usage: UsageCounters;
  readonly expiredSessionsPurged: number;
  readonly charactersSynced: number;
  /** [plan-9 Task 9] Count of campaign index rows whose `bytes_used` was synced this run (step
   * 3b) — the campaign analogue of `charactersSynced`, kept as a SEPARATE field rather than
   * folded into it, since the two sync different D1 tables via different query functions and a
   * caller may care about either independently. */
  readonly campaignsSynced: number;
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

/** [plan-9 Task 9] The campaign analogue of `SyncResult` above — kept as a separate type (not a
 * generic `{index: Character | Campaign, usage}` union) for the same "each table's own sync loop
 * is simple to read on its own" reason `SyncResult` already exists at all. */
interface CampaignSyncResult {
  readonly campaign: Campaign;
  readonly usage: StreamUsage;
}

export async function runDailyMaintenance(deps: MaintenanceDeps): Promise<MaintenanceReport> {
  const now = deps.now ?? Date.now();
  const day = dayKey(now);
  const { db, streams } = deps;

  const charactersBeforeSync = await listAllCharacters(db);
  const campaignsBeforeSync = await listAllCampaigns(db);

  // --- 1. Usage counters -> usage_daily (see `UsageCounters`' doc comment for the "before sync"
  // choice on totalBytes/campaignBytes). --------------------------------------------------------
  const usage: UsageCounters = {
    activeSessions: await countActiveSessions(db, now),
    users: await countUsers(db),
    characters: charactersBeforeSync.length,
    totalBytes: charactersBeforeSync.reduce((sum, c) => sum + c.bytesUsed, 0),
    campaigns: campaignsBeforeSync.length,
    campaignBytes: campaignsBeforeSync.reduce((sum, c) => sum + c.bytesUsed, 0),
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
  await addUsage(db, day, 'campaigns', usage.campaigns);
  await addUsage(db, day, 'campaignBytes', usage.campaignBytes);

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

  // --- 3b. [plan-9 Task 9] Campaign bytes_used sync: stream meta -> campaigns.bytes_used, per
  // campaign. Deliberately STOPS there — no owner-total rollup step (see `UsageCounters.
  // campaignBytes`'s doc comment / this file's own header comment: campaign quota is per-stream,
  // `users.quota_bytes_used` is character-bytes-only and untouched by this loop). ---------------
  const campaignSyncResults: CampaignSyncResult[] = [];
  for (const campaign of campaignsBeforeSync) {
    const streamUsage = await streams.getStreamUsage(`camp:${campaign.id}`);
    await updateCampaignUsage(db, campaign.id, streamUsage.bytesUsed);
    campaignSyncResults.push({ campaign, usage: streamUsage });
  }

  // --- 4. Orphan check (LOG ONLY — see `OrphanCounts`' doc comment). --------------------------
  const charactersWithNoStreamEvents = syncResults.filter((r) => r.usage.eventCount === 0).length;
  let streamsWithoutIndexRow: number | null = null;
  if (streams.listStreamIds) {
    const allStreamIds = await streams.listStreamIds();
    // [plan-9 Task 9 fix] "indexed" now means EITHER a char: row OR a camp: row — see
    // `OrphanCounts.streamsWithoutIndexRow`'s doc comment for the false-positive this closes.
    const indexedIds = new Set([
      ...charactersBeforeSync.map((c) => `char:${c.id}`),
      ...campaignsBeforeSync.map((c) => `camp:${c.id}`),
    ]);
    streamsWithoutIndexRow = allStreamIds.filter((id) => !indexedIds.has(id)).length;
  }

  return {
    day,
    usage,
    expiredSessionsPurged,
    charactersSynced: syncResults.length,
    campaignsSynced: campaignSyncResults.length,
    ownersQuotaRecomputed: ownerTotals.size + ownersQuotaZeroed,
    orphans: { charactersWithNoStreamEvents, streamsWithoutIndexRow },
  };
}
