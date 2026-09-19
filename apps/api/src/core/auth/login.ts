/** `POST /api/auth/login` (ADR-012 §Passwords/§Sessions). */
import { badRequest, tooManyRequests, unauthorized } from '../errors.ts';
import { constantTimeEqual, randomToken, sha256Hex } from '../crypto.ts';
import { uuidv7 } from '../ids.ts';
import type { Db } from '../db/index.ts';
import type { Config, RateLimit } from '../../ports/index.ts';
import { findUserByFoldedName, insertSession } from '../db/queries.ts';
import { foldUsername } from './username.ts';
import { hashVerifier, isValidVerifierShape } from './verifier.ts';
import { SESSION_TTL_MS } from './sessions.ts';

/** ADR-012 §Passwords exact value: "5 failures then exponential lockout (1 min → 1 h)". The
 * doubling itself (1, 2, 4, … up to 60 min) is explicitly assigned to `RateLimiterDO` — this
 * call always passes the SAME base `(limit, windowMs)` on every failed attempt for a given
 * username; the concrete `RateLimit` adapter (Cloudflare's `RateLimiterDO`, Task 8; Node's
 * in-memory limiter, Task 7) owns escalating the actual lockout duration per scope across
 * repeated triggers. The `RateLimit` port as scaffolded (Task 2) only returns `{ok,
 * retryAfterMs}` for one `(scope, limit, windowMs)` check — it has no way to hand back a raw hit
 * count core could use to compute the multiplier itself, so a persistent "how many times has
 * this scope been locked out" counter is adapter-owned state, not core logic. Core's contract
 * with the adapter is just: keep hitting this scope on failure; block me when told to.
 * Allows 5 failures through as 401; the 6th (and every one after, while the window has ≥5
 * failures in it) is blocked as 429 — see task-4-report.md's concerns section for the tested
 * behavior this produces with the in-memory test limiter. */
const LOGIN_FAIL_LIMIT = 5;
const LOGIN_FAIL_WINDOW_MS = 60_000;

// Fixed-shape dummy hash compared against for an unknown username, so the constant-time compare
// (and the work around it) runs the same whether or not the account exists — extends ADR-012's
// no-existence-oracle rule from the salt endpoint to login's response/timing shape.
const DUMMY_VERIFIER_HASH = '0'.repeat(64);

export interface LoginInput {
  readonly username: string;
  readonly verifier: string;
  readonly deviceLabel?: string;
}

export interface LoginResult {
  readonly userId: string;
  readonly token: string;
  readonly expiresAt: number;
  readonly deviceLabel: string;
}

export async function loginUser(
  db: Db,
  config: Config,
  rateLimit: RateLimit,
  input: LoginInput,
  now = Date.now(),
): Promise<LoginResult> {
  const { username, verifier } = input;
  if (typeof username !== 'string' || username.length === 0) throw badRequest('Invalid username');
  if (typeof verifier !== 'string' || !isValidVerifierShape(verifier)) throw badRequest('Invalid verifier');
  const deviceLabel = normalizeDeviceLabel(input.deviceLabel);

  const folded = foldUsername(username);
  const scope = `user:${folded}:login-fail`;

  // Whole-branch review finding 2 fix: peek the lockout BEFORE the verifier compare, not only
  // after a failed one. The pre-fix shape consulted `rateLimit.check` exclusively inside the
  // `!matches` branch below — during an ACTIVE lockout, a CORRECT verifier still fell through to
  // the success path (a locked-out scope never re-entered `!matches` to get blocked), so 429-vs-
  // 200 became a working existence/correctness oracle for exactly the attempts an attacker cares
  // about, and an escalated lockout never actually throttled a distributed (cross-IP) guesser who
  // kept sending the right guess mixed with wrong ones. `peek` never consumes a hit
  // (`ports/infra.ts`'s `RateLimit.peek` doc comment) — calling it here, for EVERY submitted
  // username, known or not, adds no new existence oracle: it's the same "always do identical work
  // regardless of whether the account exists" rule `hashVerifier` below already follows for the
  // exact same reason.
  const lock = await rateLimit.peek(scope);
  if (lock.locked) throw tooManyRequests('Too many failed attempts');

  const user = await findUserByFoldedName(db, folded);

  // Always hash+compare, even for an unknown user (against a fixed dummy), so control flow and
  // timing don't reveal account existence ahead of the rate-limit/401 response below.
  const candidateHash = await hashVerifier(config, verifier);
  const storedHash = user?.verifierHash ?? DUMMY_VERIFIER_HASH;
  const matches = user !== undefined && constantTimeEqual(candidateHash, storedHash);

  if (!matches) {
    const limit = await rateLimit.check(scope, LOGIN_FAIL_LIMIT, LOGIN_FAIL_WINDOW_MS);
    if (!limit.ok) throw tooManyRequests('Too many failed attempts');
    throw unauthorized('Invalid username or password');
  }
  // `matches` is only ever true when `user` is defined (see the `user !== undefined &&` above);
  // this re-check exists purely so TypeScript narrows `user` below without a non-null assertion.
  if (!user) throw unauthorized('Invalid username or password');

  const token = randomToken(32); // 256-bit session token (ADR-012 §Sessions exact value)
  const tokenHash = await sha256Hex(token);
  const expiresAt = now + SESSION_TTL_MS;

  await insertSession(db, {
    tokenHash,
    id: uuidv7(),
    userId: user.id,
    deviceLabel,
    createdAt: now,
    lastSeenAt: now,
    expiresAt,
  });

  return { userId: user.id, token, expiresAt, deviceLabel };
}

function normalizeDeviceLabel(label: string | undefined): string {
  const trimmed = typeof label === 'string' ? label.trim() : '';
  return trimmed.length === 0 ? 'Unknown device' : trimmed.slice(0, 128);
}
