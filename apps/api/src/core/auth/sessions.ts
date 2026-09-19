/**
 * Session lifecycle (ADR-012 §Sessions): lookup-by-cookie-token, sliding-expiry touch
 * (throttled to 1/day), logout/logout-all, and the devices list + single-session revoke.
 */
import type { Db } from '../db/index.ts';
import { sha256Hex } from '../crypto.ts';
import {
  deleteSession,
  deleteSessionById,
  deleteSessionsForUser,
  findSessionByTokenHash,
  listSessions,
  touchSession,
  type Session,
} from '../db/queries.ts';

export const SESSION_COOKIE_NAME = 'hk_session';
/** 180 days, sliding (ADR-012 §Sessions — exact value). */
export const SESSION_TTL_MS = 180 * 24 * 60 * 60 * 1000;
/** Touch `lastSeenAt`/`expiresAt` at most once per this interval, so an active user's every
 * request doesn't write to the sessions table (ADR-012/task-4-brief: "throttled to 1/day"). */
export const SESSION_TOUCH_THROTTLE_MS = 24 * 60 * 60 * 1000;

export interface ResolvedSession {
  readonly session: Session;
  readonly tokenHash: string;
}

/** Looks up the session a raw cookie token names (hashing it first — the raw token is never
 * stored or compared directly), sliding its expiry forward when the touch throttle has elapsed.
 * `undefined` for a missing, unknown, or expired token. */
export async function resolveSessionToken(db: Db, token: string, now: number): Promise<ResolvedSession | undefined> {
  const tokenHash = await sha256Hex(token);
  const session = await findSessionByTokenHash(db, tokenHash, now);
  if (!session) return undefined;

  if (now - session.lastSeenAt >= SESSION_TOUCH_THROTTLE_MS) {
    const expiresAt = now + SESSION_TTL_MS;
    await touchSession(db, tokenHash, now, expiresAt);
    return { session: { ...session, lastSeenAt: now, expiresAt }, tokenHash };
  }
  return { session, tokenHash };
}

export async function endSession(db: Db, tokenHash: string): Promise<void> {
  await deleteSession(db, tokenHash);
}

export async function endAllSessions(db: Db, userId: string): Promise<void> {
  await deleteSessionsForUser(db, userId);
}

export interface DeviceRow {
  readonly id: string | null;
  readonly deviceLabel: string;
  readonly createdAt: number;
  readonly lastSeenAt: number;
  readonly current: boolean;
}

/** The devices list (`GET /api/me/sessions`) — every session row for `userId`, newest-seen
 * first, with `current` marking the session the caller is authenticated with right now. */
export async function listDevices(db: Db, userId: string, currentTokenHash: string): Promise<DeviceRow[]> {
  const rows = await listSessions(db, userId);
  return rows.map((row) => ({
    id: row.id,
    deviceLabel: row.deviceLabel,
    createdAt: row.createdAt,
    lastSeenAt: row.lastSeenAt,
    current: row.tokenHash === currentTokenHash,
  }));
}

/**
 * Single-session revoke (`DELETE /api/me/sessions/:id`). Addressed by the session's public
 * `id` column (Task 4's additive migration `0001`), never by `tokenHash` — the sessions table's
 * PK is a hash of the bearer credential itself, so exposing it over HTTP (even to its owner)
 * would be handing back something equivalent to the session token's fingerprint for no reason.
 * Scoped to `userId` so one account can never revoke another's session by guessing/enumerating
 * ids; returns `false` (the route maps this to 404) for both "doesn't exist" and "exists but
 * isn't yours" — the two cases are intentionally indistinguishable from the response alone.
 */
export async function revokeDevice(db: Db, userId: string, sessionId: string): Promise<boolean> {
  return deleteSessionById(db, userId, sessionId);
}
