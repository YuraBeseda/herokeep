/**
 * Accounts database schema (doc-02 §Entities "server-side, D1" table, reproduced verbatim
 * here as Drizzle sqlite-core tables). D1 is an *index* — lists, lookups, quotas, auth; truth
 * for game data is the per-character event stream (a separate SQLite database per doc-02
 * §Streams, not modeled here).
 *
 * Driver: `drizzle-orm/sqlite-core` only — this file (like the rest of `src/core/**`) must not
 * import a concrete driver (`drizzle-orm/better-sqlite3`, `drizzle-orm/d1`); the ESLint
 * core-boundary rule enforces that. Adapters import this schema and pick a driver.
 *
 * Timestamp convention: every `*_at`/`created_at`/`updated_at` column is an INTEGER storing
 * Unix epoch MILLISECONDS (`Date.now()`-compatible), never a TEXT/ISO string — one convention
 * for the whole schema, chosen so every timestamp sorts and compares as a plain number on both
 * the better-sqlite3 and D1 drivers.
 *
 * `campaigns`/`memberships` (doc-02 §Entities, reproduced verbatim below) land here in the
 * additive migration `0002` — Phase 3 plan 9, Task 3. Booleans (`campaigns.joinOpen`) use
 * Drizzle's `integer(..., { mode: 'boolean' })`: the column is a plain SQLite `INTEGER` (0/1,
 * the sqlite norm — there is no native boolean type), Drizzle just maps it to/from a JS
 * `boolean` at the query-builder layer. `users.flags` is a DIFFERENT shape, not the same
 * pattern under another name: it's a plain `integer(...)` (no `{ mode: 'boolean' }`), reserved
 * as a numeric bitfield for future per-user flags and currently unread/unwritten by any query —
 * it shares the underlying SQLite `INTEGER` column type with `joinOpen`, nothing more.
 */
import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { uuidv7 } from '../ids.ts';

/** Accounts. `username` is the display spelling; `username_folded` (NFKC + lowercase, see
 * `./fold.ts`) is what uniqueness is enforced on (ADR-012). */
export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  username: text('username').notNull(),
  usernameFolded: text('username_folded').notNull().unique(),
  salt: text('salt').notNull(),
  verifierHash: text('verifier_hash').notNull(),
  createdAt: integer('created_at').notNull(),
  quotaBytesUsed: integer('quota_bytes_used').notNull().default(0),
  flags: integer('flags').notNull().default(0),
});

/** Sessions. `tokenHash` is `sha256(token)` (ADR-012) — the raw token is never stored. Sliding
 * expiry: `lastSeenAt`/`expiresAt` are touched (throttled) on use.
 *
 * `id` (Task 4, additive migration `0001`): a server-generated uuidv7, public/opaque, safe to
 * hand to the client for the single-session-revoke route (`DELETE /api/me/sessions/:id`).
 * `tokenHash` is the PK and is NEVER exposed over HTTP — leaking it would let a client
 * reconstruct which token hashes to fish for, so devices-list/revoke address sessions by this
 * `id` column instead. Nullable at the SQL level (no `NOT NULL`/`DEFAULT` clause) purely so the
 * additive `ALTER TABLE ... ADD COLUMN` stays trivially safe in SQLite (which requires a
 * constant `DEFAULT` for a `NOT NULL` column added after the fact); `$defaultFn` guarantees
 * every application-level insert always supplies a real id regardless, so the column is
 * non-null in practice from the moment this migration exists (there is no pre-Task-4
 * production data to backfill — Phase 2 hasn't shipped yet). */
export const sessions = sqliteTable(
  'sessions',
  {
    tokenHash: text('token_hash').primaryKey(),
    id: text('id')
      .unique()
      .$defaultFn(() => uuidv7()),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    deviceLabel: text('device_label').notNull(),
    createdAt: integer('created_at').notNull(),
    lastSeenAt: integer('last_seen_at').notNull(),
    expiresAt: integer('expires_at').notNull(),
  },
  (t) => [index('sessions_user_id_idx').on(t.userId)],
);

/** One-time recovery codes (six issued at registration, ADR-012). No declared primary key —
 * doc-02 lists none for this table; SQLite's implicit rowid is sufficient and queries key off
 * `(user_id, code_hash)`. */
export const recoveryCodes = sqliteTable(
  'recovery_codes',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    codeHash: text('code_hash').notNull(),
    usedAt: integer('used_at'),
  },
  (t) => [index('recovery_codes_user_id_idx').on(t.userId)],
);

/** Character index rows — one per stream, owned by exactly one user in Phase 2 (no campaigns
 * yet, so `campaignId` is always NULL until Phase 3). `bytesUsed`/`eventCount` mirror the
 * stream's own meta (doc-02) so quota checks don't need a stream round-trip. */
export const characters = sqliteTable(
  'characters',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => users.id),
    name: text('name').notNull(),
    system: text('system').notNull(),
    campaignId: text('campaign_id'),
    archivedAt: integer('archived_at'),
    bytesUsed: integer('bytes_used').notNull().default(0),
    eventCount: integer('event_count').notNull().default(0),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [index('characters_owner_id_idx').on(t.ownerId)],
);

/** Daily usage counters for the maintenance job (doc-10; controller ruling R-pf3 fixes this
 * exact shape: one row per `(day, metric)`, the value accumulated by `addUsage`). `day` is a
 * `YYYY-MM-DD` TEXT key (not a timestamp), so it sorts lexicographically and is stable across
 * timezones without needing the epoch-ms convention above. */
export const usageDaily = sqliteTable(
  'usage_daily',
  {
    day: text('day').notNull(),
    metric: text('metric').notNull(),
    value: integer('value').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.day, t.metric] })],
);

/** Campaigns (doc-02 §Entities, D1 "campaigns" row, reproduced verbatim: `campaigns(id PK,
 * dm_id, name, system, join_code UNIQUE, join_open, bytes_used, updated_at)`) — one row per
 * campaign stream (`camp:<id>`), the D1 index the host/list/join routes (Task 4) read and write.
 * `joinCode` is the 8-char Crockford-base32-no-vowels code from doc-02 §Identifiers
 * (`./join-code.ts` generates it); UNIQUE so `findCampaignByJoinCode` can never return more than
 * one row. `joinOpen` gates whether `POST /api/campaigns/join` may create a membership
 * (ADR-004/doc-08's permission matrix). `bytesUsed` mirrors the campaign stream's own
 * `meta.bytes_used` on the same ≤24h-staleness contract as `characters.bytesUsed` above — synced
 * by the daily maintenance job, never written per-event. */
export const campaigns = sqliteTable('campaigns', {
  id: text('id').primaryKey(),
  dmId: text('dm_id')
    .notNull()
    .references(() => users.id),
  name: text('name').notNull(),
  system: text('system').notNull(),
  joinCode: text('join_code').notNull().unique(),
  joinOpen: integer('join_open', { mode: 'boolean' }).notNull().default(true),
  bytesUsed: integer('bytes_used').notNull().default(0),
  updatedAt: integer('updated_at').notNull(),
});

/** Memberships (doc-02 §Entities, D1 "memberships" row, reproduced verbatim: `memberships
 * (campaign_id, user_id, role: 'dm'|'player', display_name, joined_at, PRIMARY KEY(campaign_id,
 * user_id))`) — one row per `(campaign, user)` pair; the composite primary key enforces "a user
 * joins a campaign at most once" at the DB level (a second `insertMembership` for the same pair
 * rejects — Task 3's red-first coverage). `role` mirrors the D1-vs-stream role mapping from the
 * phase-3 plan's design ruling 1 (`'dm'|'player'` here vs the campaign-stream actor's
 * `'owner'|'dm'|'member'`); the DM's own row here is kept in sync with `campaigns.dmId` by
 * whichever route writes both (Task 4), not derived from it by a trigger. `displayName` is the
 * per-campaign display name a member picks on join — independent of `users.username`. */
export const memberships = sqliteTable(
  'memberships',
  {
    campaignId: text('campaign_id')
      .notNull()
      .references(() => campaigns.id),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    role: text('role', { enum: ['dm', 'player'] }).notNull(),
    displayName: text('display_name').notNull(),
    joinedAt: integer('joined_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.campaignId, t.userId] })],
);

export const schema = { users, sessions, recoveryCodes, characters, usageDaily, campaigns, memberships };
