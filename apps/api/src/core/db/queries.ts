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

/** Lists every session row for a user (the devices list, Task 4), newest-seen first. Includes
 * expired rows — Task 4's route filters/labels those as it sees fit; this is the raw index. */
export async function listSessions(db: Db, userId: string): Promise<Session[]> {
  return db
    .select()
    .from(sessions)
    .where(eq(sessions.userId, userId))
    .orderBy(sql`${sessions.lastSeenAt} DESC`);
}

// --- recovery codes ------------------------------------------------------------------------

/** Inserts a batch of hashed recovery codes (six, at registration — ADR-012). */
export async function insertRecoveryCodes(db: Db, codes: NewRecoveryCode[]): Promise<void> {
  if (codes.length === 0) return;
  await db.insert(recoveryCodes).values(codes);
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

/** Inserts a character's index row, or replaces it if the id already exists (StreamActor commits
 * update `bytesUsed`/`eventCount`/`updatedAt` on every append — this is the write path for
 * both "register a new character" and "sync its counters"). */
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
