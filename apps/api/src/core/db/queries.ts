/**
 * Typed query functions over the accounts schema (`./schema.ts`), used by routes (auth in
 * Task 4, character index in Task 6). Every function takes a `Db` as its first argument (no
 * module-level connection) and `await`s every call — see `./index.ts`'s header comment for why
 * that's required for the type to work identically against the sync better-sqlite3 driver and
 * the async D1 driver.
 *
 * This is the query surface named in the phase-2 plan's Task 3 row; more may be added later
 * (controller ruling R-pf1) as routes need them — nothing here is meant to be exhaustive of
 * every possible accounts query.
 */
import { and, eq, isNull, sql } from 'drizzle-orm';
import { type Db } from './index.ts';
import { characters, recoveryCodes, sessions, usageDaily, users } from './schema.ts';

export type NewUser = typeof users.$inferInsert;
export type User = typeof users.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type NewRecoveryCode = typeof recoveryCodes.$inferInsert;
export type RecoveryCode = typeof recoveryCodes.$inferSelect;
export type NewCharacter = typeof characters.$inferInsert;
export type Character = typeof characters.$inferSelect;

// --- users -----------------------------------------------------------------------------------

/** Looks up a user by NFKC-case-folded username (the DB-enforced uniqueness key — see
 * `./fold.ts`). Returns `undefined` for no match (callers must not use this to distinguish
 * "unknown user" from a real one at the HTTP layer — ADR-012's no-existence-oracle rule is
 * enforced in Task 4's route, not here). */
export async function findUserByFoldedName(db: Db, usernameFolded: string): Promise<User | undefined> {
  const [row] = await db.select().from(users).where(eq(users.usernameFolded, usernameFolded)).limit(1);
  return row;
}

/** Looks up a user by primary key — used by session-authenticated routes (`GET /api/me`, Task 4)
 * that already know the user id from the session and need the display username. */
export async function findUserById(db: Db, id: string): Promise<User | undefined> {
  const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return row;
}

/** Inserts a new account. Throws (constraint violation) if `usernameFolded` already exists. */
export async function insertUser(db: Db, user: NewUser): Promise<User> {
  const [row] = await db.insert(users).values(user).returning();
  if (!row) throw new Error('insertUser: insert returned no row');
  return row;
}

/** Replaces a user's salt/verifier hash (password reset or change) — does not touch sessions;
 * callers that need "reset burns all sessions" (ADR-012) call `deleteSessionsForUser` too. */
export async function updateUserCredentials(db: Db, userId: string, salt: string, verifierHash: string): Promise<void> {
  await db.update(users).set({ salt, verifierHash }).where(eq(users.id, userId));
}

/** Reads a user's current `quota_bytes_used` (fix round 1, controller ruling — see
 * `core/quotas.ts`'s `USER_QUOTA_BYTES_MAX` doc comment) — the per-user 10 MB gate `POST
 * /api/characters` checks at create time. `0` for an unknown/never-set user rather than
 * `undefined`: this is a comparison input (`bytesUsed >= USER_QUOTA_BYTES_MAX`), and the schema's
 * own `quotaBytesUsed` column default is already `0` (`schema.ts`), so a missing row and a
 * present-but-fresh row read identically here. */
/** Every user row, unordered — the admin export CLI's `users.ndjson` dump (Task 10: "accounts
 * minus sessions"; sessions are excluded by never being exported at all, not by stripping
 * fields) and the daily maintenance job's `users` usage counter. Never exposed over HTTP; only
 * adapter-internal (CLI, maintenance) code calls this. */
export async function listAllUsers(db: Db): Promise<User[]> {
  return db.select().from(users);
}

export async function getUserQuotaBytes(db: Db, userId: string): Promise<number> {
  const [row] = await db
    .select({ quotaBytesUsed: users.quotaBytesUsed })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row?.quotaBytesUsed ?? 0;
}

/** Adjusts a user's `quota_bytes_used` by `delta` (positive or negative), floored at 0 in the
 * SAME statement (`MAX(0, ... )`, not a read-then-write) so concurrent adjustments never race
 * each other into a negative intermediate value. Fix round 1's DELETE route uses this for the
 * best-effort immediate decrement the controller ruling calls for (`core/quotas.ts`'s
 * `USER_QUOTA_BYTES_MAX` doc comment: "hard delete additionally does a best-effort immediate
 * decrement so freed space is usable without waiting a day") — "best-effort" because this number
 * is inherently approximate between daily maintenance syncs (this module's `upsertCharacterIndexRow`
 * doc comment), not because this particular write can silently fail. */
export async function adjustUserQuotaBytes(db: Db, userId: string, delta: number): Promise<void> {
  await db
    .update(users)
    .set({ quotaBytesUsed: sql`max(0, ${users.quotaBytesUsed} + ${delta})` })
    .where(eq(users.id, userId));
}

/** Sets (not adjusts) a user's `quota_bytes_used` to an ABSOLUTE value — the daily maintenance
 * job's recompute step (Task 10, `core/maintenance.ts`; the controller ruling quoted in full in
 * `core/quotas.ts`'s `USER_QUOTA_BYTES_MAX` doc comment: "recompute `users.quota_bytes_used` per
 * owner"). Contrast `adjustUserQuotaBytes`'s relative `delta`, used by the hard-delete route's
 * best-effort immediate decrement — this one replaces the value outright, since the maintenance
 * job always computes it from scratch as the sum of the owner's characters' freshly-synced
 * `bytesUsed`. */
export async function setUserQuotaBytes(db: Db, userId: string, value: number): Promise<void> {
  await db.update(users).set({ quotaBytesUsed: value }).where(eq(users.id, userId));
}

/** Count of every account — one of the daily maintenance job's `usage_daily` metrics (Task 10). */
export async function countUsers(db: Db): Promise<number> {
  const [row] = await db.select({ count: sql<number>`count(*)` }).from(users);
  return row?.count ?? 0;
}

// --- sessions ----------------------------------------------------------------------------------

export async function insertSession(db: Db, session: NewSession): Promise<Session> {
  const [row] = await db.insert(sessions).values(session).returning();
  if (!row) throw new Error('insertSession: insert returned no row');
  return row;
}

/** Looks up a session by `sha256(token)`. Expired sessions (`expiresAt <= now`) are treated as
 * not found — the caller never sees a stale session row, matching ADR-012's 180-day sliding
 * expiry. */
export async function findSessionByTokenHash(db: Db, tokenHash: string, now: number): Promise<Session | undefined> {
  const [row] = await db
    .select()
    .from(sessions)
    .where(and(eq(sessions.tokenHash, tokenHash), sql`${sessions.expiresAt} > ${now}`))
    .limit(1);
  return row;
}

/** Slides a session's expiry forward (throttled to 1/day at the call site, per ADR-012). */
export async function touchSession(db: Db, tokenHash: string, lastSeenAt: number, expiresAt: number): Promise<void> {
  await db.update(sessions).set({ lastSeenAt, expiresAt }).where(eq(sessions.tokenHash, tokenHash));
}

export async function deleteSession(db: Db, tokenHash: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.tokenHash, tokenHash));
}

/** Deletes every session for a user (logout-all; also fired by a successful recovery-code
 * reset, ADR-012). */
export async function deleteSessionsForUser(db: Db, userId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.userId, userId));
}

/** Count of sessions not yet expired as of `now` — the daily maintenance job's `activeSessions`
 * `usage_daily` metric (Task 10). */
export async function countActiveSessions(db: Db, now: number): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(sessions)
    .where(sql`${sessions.expiresAt} > ${now}`);
  return row?.count ?? 0;
}

/** Deletes every session whose `expiresAt` has already passed as of `now` — the daily
 * maintenance job's expired-session purge (Task 10, doc-10 §Daily maintenance). Returns the
 * number of rows actually removed, for `MaintenanceReport.expiredSessionsPurged`. */
export async function deleteExpiredSessions(db: Db, now: number): Promise<number> {
  const result = await db
    .delete(sessions)
    .where(sql`${sessions.expiresAt} <= ${now}`)
    .returning({ tokenHash: sessions.tokenHash });
  return result.length;
}

/** Lists every session row for a user (the devices list, Task 4), newest-seen first. Includes
 * expired rows — Task 4's route filters/labels those as it sees fit; this is the raw index. */
export async function listSessions(db: Db, userId: string): Promise<Session[]> {
  return db
    .select()
    .from(sessions)
    .where(eq(sessions.userId, userId))
    .orderBy(sql`${sessions.lastSeenAt} DESC`);
}

/** Looks up a session by its public `id` (Task 4's additive column — never `tokenHash`, which
 * stays internal). Used by the single-session-revoke route to confirm ownership before deleting. */
export async function findSessionById(db: Db, id: string): Promise<Session | undefined> {
  const [row] = await db.select().from(sessions).where(eq(sessions.id, id)).limit(1);
  return row;
}

/** Deletes one session by its public `id`, scoped to `userId` so one account can never revoke
 * another's session. Returns whether a row was actually deleted (`false` — the route maps this
 * to 404 — when `id` doesn't exist or belongs to someone else). */
export async function deleteSessionById(db: Db, userId: string, id: string): Promise<boolean> {
  const result = await db
    .delete(sessions)
    .where(and(eq(sessions.id, id), eq(sessions.userId, userId)))
    .returning({ tokenHash: sessions.tokenHash });
  return result.length > 0;
}

// --- recovery codes ------------------------------------------------------------------------

/** Inserts a batch of hashed recovery codes (six, at registration — ADR-012). */
export async function insertRecoveryCodes(db: Db, codes: NewRecoveryCode[]): Promise<void> {
  if (codes.length === 0) return;
  await db.insert(recoveryCodes).values(codes);
}

/** Every recovery-code row (hashes and `usedAt` only — never a raw code, which is never stored
 * at all) — the admin export CLI's `recovery-codes.ndjson` dump (Task 10 brief: "needed for a
 * faithful move" between targets). */
export async function listAllRecoveryCodes(db: Db): Promise<RecoveryCode[]> {
  return db.select().from(recoveryCodes);
}

/** Deletes every recovery-code row for a user — `herokeep-admin reset-recovery`'s "burns old"
 * step (Task 10), run immediately before inserting 6 freshly generated codes via
 * `insertRecoveryCodes`. */
export async function deleteRecoveryCodesForUser(db: Db, userId: string): Promise<void> {
  await db.delete(recoveryCodes).where(eq(recoveryCodes.userId, userId));
}

/** Finds a still-usable (`usedAt IS NULL`) recovery code for a user by its hash. */
export async function findUnusedRecoveryCode(
  db: Db,
  userId: string,
  codeHash: string,
): Promise<RecoveryCode | undefined> {
  const [row] = await db
    .select()
    .from(recoveryCodes)
    .where(and(eq(recoveryCodes.userId, userId), eq(recoveryCodes.codeHash, codeHash), isNull(recoveryCodes.usedAt)))
    .limit(1);
  return row;
}

/** Marks a recovery code used — atomically one-time: the `usedAt IS NULL` guard in the WHERE
 * clause means a second call for the same code affects zero rows. Returns whether this call
 * actually burned it (`false` if it was already used or doesn't exist). */
export async function burnRecoveryCode(db: Db, userId: string, codeHash: string, usedAt: number): Promise<boolean> {
  const result = await db
    .update(recoveryCodes)
    .set({ usedAt })
    .where(and(eq(recoveryCodes.userId, userId), eq(recoveryCodes.codeHash, codeHash), isNull(recoveryCodes.usedAt)))
    .returning({ userId: recoveryCodes.userId });
  return result.length > 0;
}

// --- characters ----------------------------------------------------------------------------

/** Index rows for every character a user owns (`GET /api/characters`, Task 6). */
export async function listCharactersForOwner(db: Db, ownerId: string): Promise<Character[]> {
  return db.select().from(characters).where(eq(characters.ownerId, ownerId));
}

/** Every character index row across every owner — the daily maintenance job's quota-sync source
 * (Task 10, `core/maintenance.ts`: "a `listAllCharacters(db)` query + StreamHost/StreamStore
 * access per stream") and the admin export CLI's `characters.ndjson` dump. Unlike
 * `listCharactersForOwner`, not scoped to one user. */
export async function listAllCharacters(db: Db): Promise<Character[]> {
  return db.select().from(characters);
}

/** Looks up one character's index row by id (Task 6: ownership checks for the archive/delete/WS-
 * handoff routes, and the create route's collision check). Returns `undefined` for no match. */
export async function findCharacterById(db: Db, id: string): Promise<Character | undefined> {
  const [row] = await db.select().from(characters).where(eq(characters.id, id)).limit(1);
  return row;
}

/** Inserts a character's index row, or replaces it if the id already exists. The REAL write
 * path (fix round 1, reviewer finding 2 — this replaces an earlier comment here that described
 * a "StreamActor syncs counters on every append" flow that does not exist: `StreamActor` has no
 * `Db` handle at all, core/quotas.ts's header comment): `core/routes/characters.ts`'s create
 * route calls this once with `{bytesUsed: 0, eventCount: 0, ...}` at registration, and its
 * archive route calls it again to flip only `archivedAt`/`updatedAt` (spreading the existing
 * row, so `bytesUsed`/`eventCount` pass through unchanged). The ONLY writer that ever moves
 * `bytesUsed`/`eventCount` away from 0 is the daily maintenance job (Task 10, doc-10 §Daily
 * maintenance: "Usage counters → `usage_daily`"), which periodically reads each stream's own
 * `meta.bytes_used`/`event_count` (the actual source of truth, doc-02: "D1 is an index ... truth
 * for game data is the streams") and syncs them here — see `quotas.ts`'s `USER_QUOTA_BYTES_MAX`
 * doc comment for the full controller ruling on why that sync's ≤24h staleness is acceptable. */
export async function upsertCharacterIndexRow(db: Db, character: NewCharacter): Promise<void> {
  await db
    .insert(characters)
    .values(character)
    .onConflictDoUpdate({
      target: characters.id,
      set: {
        name: character.name,
        system: character.system,
        campaignId: character.campaignId,
        archivedAt: character.archivedAt,
        bytesUsed: character.bytesUsed,
        eventCount: character.eventCount,
        updatedAt: character.updatedAt,
      },
    });
}

/** Removes a character's index row (hard delete, frees quota — doc-03 §Quota). Does not touch
 * the stream's own storage; callers drop that separately via `StreamStore`. */
export async function deleteCharacterIndexRow(db: Db, id: string): Promise<void> {
  await db.delete(characters).where(eq(characters.id, id));
}

/** Writes a character index row's `bytesUsed`/`eventCount` directly from its stream's own meta —
 * the ONLY call site that should ever do this outside a test (the daily maintenance job, Task
 * 10; see `upsertCharacterIndexRow`'s doc comment: "The ONLY writer that ever moves
 * bytesUsed/eventCount away from 0 is the daily maintenance job"). Deliberately narrower than
 * `upsertCharacterIndexRow`: it touches only these two columns, never `updatedAt`/`name`/
 * `archivedAt`/etc, so a nightly sync never perturbs a character's "last touched" ordering in a
 * list view. */
export async function updateCharacterUsage(db: Db, id: string, bytesUsed: number, eventCount: number): Promise<void> {
  await db.update(characters).set({ bytesUsed, eventCount }).where(eq(characters.id, id));
}

/** Count of a user's character index rows, for the 50-characters/user quota (ADR-012). Counts
 * every row regardless of `archivedAt` — whether an archived character still counts against
 * quota is doc-08's call and is verified/adjusted in Task 6, which owns the archive semantics. */
export async function countCharactersForOwner(db: Db, ownerId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(characters)
    .where(eq(characters.ownerId, ownerId));
  return row?.count ?? 0;
}

// --- usage -----------------------------------------------------------------------------------

/** Accumulates a daily usage counter (`usage_daily`, controller ruling R-pf3): creates the
 * `(day, metric)` row on first use, otherwise adds `delta` to the existing value. Used by the
 * maintenance job (Task 10) and, eventually, per-request counters. */
export async function addUsage(db: Db, day: string, metric: string, delta: number): Promise<void> {
  await db
    .insert(usageDaily)
    .values({ day, metric, value: delta })
    .onConflictDoUpdate({
      target: [usageDaily.day, usageDaily.metric],
      set: { value: sql`${usageDaily.value} + ${delta}` },
    });
}
