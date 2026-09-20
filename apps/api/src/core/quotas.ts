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

/**
 * doc-08 "Campaign stream" row: "20 MB events; 12 members; 6 non-core packs × 5 MB". This module
 * only ever covers the BYTES half of that row (mirroring the character-stream row's own scoping
 * comment above) — the 12-member and 6-pack counts are per-append COUNT checks against
 * `CampaignActor`'s own event-sourced `meta.members`/`meta.packs`, not a byte/event-count
 * projection this generic module can express, so `CampaignActor` enforces those two itself
 * (task-5-report.md's "quota-machinery extension design" write-up). Campaign streams have no
 * stated per-stream EVENT-COUNT cap (unlike character streams' 20,000) — modeled as
 * `Number.POSITIVE_INFINITY` in `CAMPAIGN_QUOTA_LIMITS` below so `checkAppend`'s event-count
 * branch can never trip for a campaign stream, without needing a second code path.
 */
export const CAMPAIGN_BYTES_MAX = 20 * 1024 * 1024; // 20 MB

/** doc-08 "Campaign stream" row's member-count half: 12 members max. Enforced by `CampaignActor`
 * itself (this module has no notion of "members" — a campaign-specific meta concept) and, per the
 * Global Constraints, ALSO at the join route (Task 4) as the primary gate; the actor's own check
 * is defense-in-depth (cheap: one `meta.members.size` read already in hand for the append). */
export const CAMPAIGN_MEMBER_MAX = 12;

/** doc-08 "Campaign stream" row's non-core-pack half: 6 packs max (the core pack named by
 * `campaign.created.corePack` is tracked in the settings document, never via `pack.enabled`, so
 * every `pack.enabled` this module/`CampaignActor` ever counts is non-core by construction). */
export const CAMPAIGN_NON_CORE_PACK_MAX = 6;

/** The per-stream counters `StreamActor` reads from/writes to `StreamStore.getMeta`/`setMeta`. */
export interface StreamMetaSnapshot {
  readonly bytesUsed: number;
  readonly eventCount: number;
}

/**
 * Task 5's quota-machinery extension: `quotaFor`/`checkAppend` below were hardcoded to the
 * CHARACTER-stream numbers (`STREAM_BYTES_MAX`/`STREAM_EVENT_COUNT_MAX`) — correct for
 * `CharacterActor`, wrong for `CampaignActor` (20 MB, no stated event-count cap). Rather than a
 * second copy of both functions (which WOULD drift — the warning-ratio/reject-vs-warning
 * classification logic is identical for both stream kinds, only the two numbers differ),
 * `quotaFor`/`checkAppend` take an optional `limits` parameter defaulting to the character-stream
 * numbers (so every EXISTING call site — `StreamActor`'s own pipeline via the injected
 * `QuotasPort`, `character-actor.ts`, every Phase-2 test — is unchanged, source and behavior,
 * without touching a single call site). `campaign-actor.ts` builds its own `QuotasPort` value
 * (see that file's `campaignQuotas`) that closes over `CAMPAIGN_QUOTA_LIMITS` instead — the
 * `QuotasPort` interface itself (`stream-actor.ts`) never needed to change, since both shapes
 * satisfy `(meta) => QuotaShape` / `(meta, events) => QuotaCheckResult` identically.
 */
export interface QuotaLimits {
  readonly bytesMax: number;
  readonly eventCountMax: number;
}

const CHARACTER_QUOTA_LIMITS: QuotaLimits = { bytesMax: STREAM_BYTES_MAX, eventCountMax: STREAM_EVENT_COUNT_MAX };

/** `CampaignActor`'s limits — see `CAMPAIGN_BYTES_MAX`'s doc comment above for the member/pack
 * counts this deliberately excludes. */
export const CAMPAIGN_QUOTA_LIMITS: QuotaLimits = {
  bytesMax: CAMPAIGN_BYTES_MAX,
  eventCountMax: Number.POSITIVE_INFINITY,
};

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

/** `welcome.streams[].quota` shape, computed from the stream's current (pre-append) meta.
 * `limits` defaults to the character-stream numbers — see this file's `QuotaLimits` doc comment. */
export function quotaFor(meta: StreamMetaSnapshot, limits: QuotaLimits = CHARACTER_QUOTA_LIMITS): QuotaShape {
  return { bytesUsed: meta.bytesUsed, bytesMax: limits.bytesMax, eventCount: meta.eventCount };
}

/**
 * Projects `meta` forward by the byte/event cost of `events` and classifies the result.
 * `events` must be exactly the events about to be NEWLY stored by this append — callers must
 * exclude anything that deduped to an existing seq (idempotent retries add no new cost) and
 * anything already rejected for other reasons (invalid/forbidden/duplicate/txId-group
 * casualties never reach the store either). `reject` at or over 100% of either the byte or the
 * event-count limit; `warning` at or over 80% of either (and not already rejecting); `ok`
 * otherwise. The 16 KB per-event cap is `validate.ts`'s job, not this one — this module only
 * ever looks at the STREAM-level totals. `limits` defaults to the character-stream numbers — see
 * this file's `QuotaLimits` doc comment.
 */
export function checkAppend(
  meta: StreamMetaSnapshot,
  events: readonly Event[],
  limits: QuotaLimits = CHARACTER_QUOTA_LIMITS,
): QuotaCheckResult {
  const addedBytes = events.reduce((sum, event) => sum + measureEventBytes(event), 0);
  const bytesAfter = meta.bytesUsed + addedBytes;
  const eventCountAfter = meta.eventCount + events.length;

  if (bytesAfter > limits.bytesMax || eventCountAfter > limits.eventCountMax) {
    return { verdict: 'reject', bytesAfter, eventCountAfter };
  }
  const atWarning =
    bytesAfter >= limits.bytesMax * QUOTA_WARNING_RATIO ||
    eventCountAfter >= limits.eventCountMax * QUOTA_WARNING_RATIO;
  return { verdict: atWarning ? 'warning' : 'ok', bytesAfter, eventCountAfter };
}
