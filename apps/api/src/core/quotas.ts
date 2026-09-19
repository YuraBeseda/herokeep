/**
 * Per-STREAM quota checks for `StreamActor.append` (doc-10 §StreamActor; doc-03 §Quota
 * signalling). doc-08 §Quotas' table has TWO rows that both talk about "bytes used" and are
 * easy to conflate — this module implements only the first one:
 *
 *   "Character stream | 2 MB events, 20,000 events | CharacterStream `meta.bytes_used`"
 *     — a PER-STREAM limit, tracked on the stream's own meta (`StreamStore.getMeta('bytes_used'
 *     | 'event_count')`), checked on every `append`. This is what `welcome.streams[].quota`
 *     (doc-03) reports and what this module's `checkAppend`/`quotaFor` compute.
 *
 *   "User total | 10 MB across characters; 50 characters | D1 `users.quota_bytes_used`,
 *     checked on create and reported at 80%"
 *     — a PER-USER limit, tracked in the ACCOUNTS database (`users.quota_bytes_used`, Task 3's
 *     schema), checked when a character is CREATED (Task 6's `POST /api/characters` route), not
 *     on every stream append. `StreamActor` has no user id and no accounts `Db` — it only ever
 *     sees one stream's `meta` — so it has no way to enforce this row even if it wanted to, and
 *     must not be asked to: conflating "2 MB, this stream" with "10 MB, all of this user's
 *     characters" would either double-enforce the wrong number against the wrong scope, or
 *     (worse) let a single character silently consume the user's entire 10 MB budget without
 *     that ever being checked, since 2 MB × several characters can exceed 10 MB.
 *
 * This finding (which quota this module is, and which it explicitly is not) is recorded again
 * in task-5-report.md per the task brief's instruction to document it in both places.
 */
import type { Event } from '@hk/protocol';
import { measureEventBytes } from './validate.ts';

/** doc-08 "Character stream" row. */
export const STREAM_BYTES_MAX = 2 * 1024 * 1024; // 2 MB
export const STREAM_EVENT_COUNT_MAX = 20_000;
/** doc-03 §Quota signalling: "the DO sends `notice quota.warning` at 80%". */
export const QUOTA_WARNING_RATIO = 0.8;

/**
 * doc-08 "User total" row's character-COUNT half: "50 characters ... checked on create".
 * Enforced by `POST /api/characters` (`core/routes/characters.ts`) against
 * `countCharactersForOwner`'s count. The row's other half (10 MB across characters) is
 * `USER_QUOTA_BYTES_MAX` below.
 *
 * Archived-counting finding (task-6-brief: "verify against doc-08 whether archived characters
 * count toward the 50 cap"): they DO. doc-08 itself: "Freeing space: archive → hard delete
 * (`DELETE /api/characters/:id` with the name typed) deletes the DO's storage and D1 row" —
 * archiving is listed only as a STEP ON THE WAY to freeing space, not as freeing it itself; only
 * hard delete does. ADR-003 is explicit: "Delete is soft: `character.archived` event + 30-day
 * 'Trash' list; hard delete requires typing the name and **is what frees quota**." So an archived
 * character's D1 row is untouched by archiving and must keep counting against the cap — exactly
 * what `countCharactersForOwner`'s own doc comment already assumes ("Counts every row regardless
 * of `archivedAt`"). This constant's enforcement point (`POST /api/characters`) therefore counts
 * archived rows too, with no special-casing.
 */
export const USER_CHARACTER_COUNT_MAX = 50;

/**
 * doc-08 "User total" row's BYTE half: "10 MB across characters ... D1 `users.quota_bytes_used`,
 * checked on create and reported at 80%". Enforced by `POST /api/characters`
 * (`core/routes/characters.ts`) against `getUserQuotaBytes`'s read of `users.quota_bytes_used`.
 *
 * CONTROLLER RULING (fix round 1, recorded verbatim — this replaces an earlier version of this
 * comment that incorrectly claimed "nothing in the phase-2 plan names a task that updates
 * `users.quota_bytes_used`"; task-5-report.md's ledger already named Task 6 for this):
 *
 *   "the per-user 10 MB quota is enforced at CREATE time by reading `users.quota_bytes_used`;
 *   that column (and characters.bytesUsed/eventCount) is MAINTAINED by the daily maintenance job
 *   (Task 10 — doc-10's "Usage counters → usage_daily; orphan check" job will sync stream
 *   meta.bytes_used → characters.bytesUsed/eventCount and recompute users.quota_bytes_used per
 *   owner). Staleness ≤ 24 h is acceptable for a create-time anti-abuse gate because the realtime
 *   per-stream 2 MB cap bounds any burst; hard delete additionally does a best-effort immediate
 *   decrement so freed space is usable without waiting a day."
 *
 * Concretely, as of Task 6 (fix round 1): `POST /api/characters` reads `users.quota_bytes_used`
 * via `getUserQuotaBytes` and rejects `quotaExceeded` at or over this constant; `DELETE
 * /api/characters/:id` best-effort decrements it by the deleted row's `characters.bytesUsed` via
 * `adjustUserQuotaBytes` (floored at 0) — see that route's doc comment. Nothing yet increments
 * `users.quota_bytes_used` as a character's stream grows (that sync from stream `meta.bytes_used`
 * → `characters.bytesUsed`/`eventCount` → `users.quota_bytes_used` is Task 10's daily job, per
 * the ruling above) — a brand-new account's characters therefore read as 0 bytes against this
 * quota until the first daily sync runs, which is the accepted staleness window the ruling
 * names, not a bug.
 */
export const USER_QUOTA_BYTES_MAX = 10 * 1024 * 1024; // 10 MB

/** The per-stream counters `StreamActor` reads from/writes to `StreamStore.getMeta`/`setMeta`. */
export interface StreamMetaSnapshot {
  readonly bytesUsed: number;
  readonly eventCount: number;
}

/** `welcome.streams[].quota` (doc-03) — mirrors `@hk/protocol`'s `QuotaSchema` field names. */
export interface QuotaShape {
  readonly bytesUsed: number;
  readonly bytesMax: number;
  readonly eventCount: number;
}

export type QuotaVerdict = 'ok' | 'warning' | 'reject';

export interface QuotaCheckResult {
  readonly verdict: QuotaVerdict;
  /** Projected `bytesUsed`/`eventCount` if the checked events were committed — used by the
   * caller (`stream-actor.ts`) to update `meta` after a successful store append, so the
   * projection and the actual post-commit meta never have to be computed twice. */
  readonly bytesAfter: number;
  readonly eventCountAfter: number;
}

/** `welcome.streams[].quota` shape, computed from the stream's current (pre-append) meta. */
export function quotaFor(meta: StreamMetaSnapshot): QuotaShape {
  return { bytesUsed: meta.bytesUsed, bytesMax: STREAM_BYTES_MAX, eventCount: meta.eventCount };
}

/**
 * Projects `meta` forward by the byte/event cost of `events` and classifies the result.
 * `events` must be exactly the events about to be NEWLY stored by this append — callers must
 * exclude anything that deduped to an existing seq (idempotent retries add no new cost) and
 * anything already rejected for other reasons (invalid/forbidden/duplicate/txId-group
 * casualties never reach the store either). `reject` at or over 100% of either the byte or the
 * event-count limit; `warning` at or over 80% of either (and not already rejecting); `ok`
 * otherwise. The 16 KB per-event cap is `validate.ts`'s job, not this one — this module only
 * ever looks at the STREAM-level totals.
 */
export function checkAppend(meta: StreamMetaSnapshot, events: readonly Event[]): QuotaCheckResult {
  const addedBytes = events.reduce((sum, event) => sum + measureEventBytes(event), 0);
  const bytesAfter = meta.bytesUsed + addedBytes;
  const eventCountAfter = meta.eventCount + events.length;

  if (bytesAfter > STREAM_BYTES_MAX || eventCountAfter > STREAM_EVENT_COUNT_MAX) {
    return { verdict: 'reject', bytesAfter, eventCountAfter };
  }
  const atWarning =
    bytesAfter >= STREAM_BYTES_MAX * QUOTA_WARNING_RATIO ||
    eventCountAfter >= STREAM_EVENT_COUNT_MAX * QUOTA_WARNING_RATIO;
  return { verdict: atWarning ? 'warning' : 'ok', bytesAfter, eventCountAfter };
}
