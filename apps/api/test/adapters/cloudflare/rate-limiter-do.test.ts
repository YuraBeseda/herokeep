/**
 * `RateLimiterDO.peek` (whole-branch review finding 2, `ports/infra.ts`'s `RateLimit.peek` doc
 * comment) — Cloudflare's half. `peek`/`check` are exercised as plain RPC calls through the DO
 * stub obtained from `env.RATE_LIMITER` — the SAME cast-through-`unknown` pattern `worker.ts`'s
 * own `CloudflareRateLimit` class already uses for `check` (this file is effectively that class's
 * production call path, minus the Worker routing around it) — rather than `runInDurableObject`'s
 * raw-instance access (`character-stream-do.test.ts`'s own pattern, needed THERE for methods like
 * `webSocketMessage` that aren't part of the plain RPC surface at all).
 *
 * Deliberately NOT `runInDurableObject<RateLimiterDO, ...>`: passing the REAL `RateLimiterDO`
 * class type into that generic (or into `DurableObjectStub<RateLimiterDO>` at all) sends `tsc`
 * into "Type instantiation is excessively deep and possibly infinite" (verified at execution
 * time) — the same class of `tsc`-performance cliff `character-stream.do.ts`'s own header comment
 * documents for a DIFFERENT wide-type combination. `check`/`peek` genuinely don't need raw-
 * instance access (unlike the DO's Hibernation-API handlers), so the fix here is the same one
 * `worker.ts` already uses in production: cast through `unknown` to a small hand-written
 * interface and call the stub directly, never letting the wide class type reach the checker.
 */
import { describe, expect, it } from 'vitest';
import { env } from './typed-env.ts';

const LIMIT = 5;
const WINDOW_MS = 60_000;
const MINUTE = 60_000;

interface RateLimiterPeek {
  readonly locked: boolean;
  readonly retryAfterMs: number;
}

interface RateLimiterCheck {
  readonly ok: boolean;
  readonly retryAfterMs: number;
}

/** Mirrors `worker.ts`'s own `RateLimiterStub` interface (that file's private type, not exported —
 * reproduced here rather than imported, matching how `character-stream-do.test.ts` reproduces
 * `character-stream.do.ts`'s internal header-name constants instead of importing them). */
interface RateLimiterStub {
  check(limit: number, windowMs: number): Promise<RateLimiterCheck>;
  peek(): Promise<RateLimiterPeek>;
}

function getStub(scope: string): RateLimiterStub {
  const id = env.RATE_LIMITER.idFromName(scope);
  // No cast needed here (eslint's `no-unnecessary-type-assertion` confirms it): the function's own
  // `RateLimiterStub` return-type annotation is enough for a plain one-directional assignability
  // check, which is cheap — the excessive-instantiation issue this file's header comment documents
  // is specific to `runInDurableObject`'s generic/`DurableObjectStub<RateLimiterDO>` mutual
  // structural comparison, not this simpler case.
  return env.RATE_LIMITER.get(id);
}

/** Trips the lockout the same way `login.ts`'s real call pattern does: `limit + 1` checks —
 * mirrors `test/adapters/node/rate-limit.test.ts`'s own `tripOnce` helper. */
async function tripOnce(stub: RateLimiterStub): Promise<void> {
  for (let i = 0; i <= LIMIT; i += 1) await stub.check(LIMIT, WINDOW_MS);
}

describe('RateLimiterDO.peek', () => {
  it('reports a never-tripped scope as not locked', async () => {
    const stub = getStub(`user:peek-fresh-${crypto.randomUUID()}:login-fail`);
    expect(await stub.peek()).toEqual({ locked: false, retryAfterMs: 0 });
  });

  it('reports locked (without consuming a hit) once check() has tripped the lockout, and does not extend it under a flood of peeks', async () => {
    const stub = getStub(`user:peek-trip-${crypto.randomUUID()}:login-fail`);

    await tripOnce(stub);
    const lockedPeek = await stub.peek();
    expect(lockedPeek.locked).toBe(true);
    expect(lockedPeek.retryAfterMs).toBeGreaterThan(0);
    expect(lockedPeek.retryAfterMs).toBeLessThanOrEqual(MINUTE);

    // RED-first against a pre-fix world with no `peek` at all: a flood of `peek` calls must not
    // consume a sliding-window slot or push the lockout further out — it's read-only.
    for (let i = 0; i < 20; i += 1) await stub.peek();
    const stillLocked = await stub.peek();
    expect(stillLocked.locked).toBe(true);
    expect(stillLocked.retryAfterMs).toBeLessThanOrEqual(lockedPeek.retryAfterMs);
    expect(stillLocked.retryAfterMs).toBeGreaterThan(0);
  });
});
