/**
 * `MemoryRateLimit` — ADR-012's exponential lockout escalation curve (obligation (b)): "5 failures
 * then exponential lockout (1 min → 1 h)", doubling per subsequent trip, capped at 1 h; plus this
 * class's own documented decay policy (see `rate-limit.memory.ts`'s header comment). `now` is
 * injected so the whole curve — including 24-hour decay periods — is asserted deterministically,
 * with no real waiting and no fake-timer interaction with other test infrastructure.
 */
import { describe, expect, it } from 'vitest';
import type { RateLimitResult } from '../../../src/ports/infra.ts';
import { MemoryRateLimit } from '../../../src/adapters/node/rate-limit.memory.ts';

const LIMIT = 5;
const WINDOW_MS = 60_000;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Fires exactly `limit + 1` checks at the CURRENT `now` (core's real call pattern: it keeps
 * calling `check(scope, 5, 60_000)` on every failed attempt) and returns the last result — the one
 * that trips the window, per this class's "5 failures then lockout" contract. */
async function tripOnce(rl: MemoryRateLimit, scope: string): Promise<RateLimitResult> {
  let last: RateLimitResult = { ok: true, retryAfterMs: 0 };
  for (let i = 0; i <= LIMIT; i += 1) last = await rl.check(scope, LIMIT, WINDOW_MS);
  return last;
}

describe('MemoryRateLimit', () => {
  it('allows exactly `limit` hits through as ok, then blocks the next one', async () => {
    let now = 0;
    const rl = new MemoryRateLimit(() => now);
    const scope = 'user:alice:login-fail';

    for (let i = 0; i < LIMIT; i += 1) {
      const result = await rl.check(scope, LIMIT, WINDOW_MS);
      expect(result).toEqual({ ok: true, retryAfterMs: 0 });
      now += 1;
    }
    const sixth = await rl.check(scope, LIMIT, WINDOW_MS);
    expect(sixth).toEqual({ ok: false, retryAfterMs: MINUTE });
  });

  it('escalates the lockout duration 1 min -> 2 -> 4 -> 8 -> 16 -> 32 -> capped at 60 min, across repeated trips', async () => {
    let now = 0;
    const rl = new MemoryRateLimit(() => now);
    const scope = 'user:bob:login-fail';

    const expectedCurveMs = [MINUTE, 2 * MINUTE, 4 * MINUTE, 8 * MINUTE, 16 * MINUTE, 32 * MINUTE, HOUR, HOUR];

    for (const expectedMs of expectedCurveMs) {
      const result = await tripOnce(rl, scope);
      expect(result.ok).toBe(false);
      expect(result.retryAfterMs).toBe(expectedMs);
      now += expectedMs; // advance exactly past this lockout before triggering the next trip
    }
  });

  it('reports ok:false with a decreasing retryAfterMs while still inside an active lockout, without extending it', async () => {
    let now = 0;
    const rl = new MemoryRateLimit(() => now);
    const scope = 'user:carol:login-fail';

    const first = await tripOnce(rl, scope);
    expect(first).toEqual({ ok: false, retryAfterMs: MINUTE });

    now += 10_000; // still inside the 1-minute lockout
    const stillLocked = await rl.check(scope, LIMIT, WINDOW_MS);
    expect(stillLocked).toEqual({ ok: false, retryAfterMs: MINUTE - 10_000 });

    // A flood of MORE checks during the lockout must not push `lockedUntil` further out — the
    // lockout duration was already decided at trip time (class doc comment's "Escalation curve" §).
    for (let i = 0; i < 20; i += 1) await rl.check(scope, LIMIT, WINDOW_MS);
    const stillTheSame = await rl.check(scope, LIMIT, WINDOW_MS);
    expect(stillTheSame.retryAfterMs).toBe(MINUTE - 10_000);
  });

  it('escalation is scoped PER SCOPE — a different username/IP scope is unaffected', async () => {
    let now = 0;
    const rl = new MemoryRateLimit(() => now);

    await tripOnce(rl, 'user:dave:login-fail'); // level 0 -> locked at 1 min
    now += MINUTE;
    const second = await tripOnce(rl, 'user:dave:login-fail');
    expect(second.retryAfterMs).toBe(2 * MINUTE); // dave escalated to level 1

    const fresh = await tripOnce(rl, 'user:erin:login-fail');
    expect(fresh.retryAfterMs).toBe(MINUTE); // erin's own scope starts at level 0, unaffected
  });

  it('decays the escalation level by one per full 24h clean period since the last trip', async () => {
    let now = 0;
    const rl = new MemoryRateLimit(() => now);
    const scope = 'user:fay:login-fail';

    const first = await tripOnce(rl, scope); // lockLevel -> 1, lastTrippedAt = 0
    expect(first.retryAfterMs).toBe(MINUTE);

    // Skip straight to exactly one full decay period after the trip (well past the 1-minute
    // lockout itself) — no intervening trips.
    now = DAY;
    const afterOneDecay = await tripOnce(rl, scope);
    // Decayed lockLevel 1 -> 0 before this trip applies, so it's judged a FRESH first trip again.
    expect(afterOneDecay.retryAfterMs).toBe(MINUTE);
  });

  it('decays by MULTIPLE levels when multiple full clean periods have elapsed', async () => {
    let now = 0;
    const rl = new MemoryRateLimit(() => now);
    const scope = 'user:gale:login-fail';

    // Escalate to level 3 (lockouts of 1, 2, 4 min), landing at lastTrippedAt = the 3rd trip's
    // `now`.
    await tripOnce(rl, scope);
    now += MINUTE;
    await tripOnce(rl, scope);
    now += 2 * MINUTE;
    const third = await tripOnce(rl, scope); // lockLevel -> 3, retryAfterMs 4 min
    expect(third.retryAfterMs).toBe(4 * MINUTE);
    const lastTripAt = now;

    // Jump forward exactly 2 full decay periods (48h) from the last trip, well past the 4-minute
    // lockout itself.
    now = lastTripAt + 2 * DAY;
    const afterTwoDecays = await tripOnce(rl, scope);
    // lockLevel was 3, decays by 2 -> 1, so this trip fires at the level-1 duration (2 min), not
    // back at level-0 (1 min) and not still at level-3 (8 min).
    expect(afterTwoDecays.retryAfterMs).toBe(2 * MINUTE);
  });

  it('a scope that never trips stays a plain sliding window (no spurious lockout)', async () => {
    let now = 0;
    const rl = new MemoryRateLimit(() => now);
    const scope = 'ip:127.0.0.1:auth';

    for (let i = 0; i < 100; i += 1) {
      now += WINDOW_MS; // always outside the previous hits' window
      const result = await rl.check(scope, 30, WINDOW_MS);
      expect(result).toEqual({ ok: true, retryAfterMs: 0 });
    }
  });
});

/** `RateLimit.peek` (whole-branch review finding 2, `ports/infra.ts`'s doc comment on that
 * method): a NON-CONSUMING lockout check `core/auth/login.ts` calls BEFORE the verifier compare. */
describe('MemoryRateLimit.peek', () => {
  it('reports a never-seen scope as not locked', async () => {
    const rl = new MemoryRateLimit(() => 0);
    expect(await rl.peek('user:nobody:login-fail')).toEqual({ locked: false, retryAfterMs: 0 });
  });

  it('reports not-locked for a scope with hits still under the limit', async () => {
    let now = 0;
    const rl = new MemoryRateLimit(() => now);
    const scope = 'user:hank:login-fail';
    for (let i = 0; i < LIMIT; i += 1) {
      await rl.check(scope, LIMIT, WINDOW_MS);
      now += 1;
    }
    expect(await rl.peek(scope)).toEqual({ locked: false, retryAfterMs: 0 });
  });

  it('reports locked with a decreasing retryAfterMs once a scope has tripped, WITHOUT consuming a hit or extending the lockout', async () => {
    let now = 0;
    const rl = new MemoryRateLimit(() => now);
    const scope = 'user:ida:login-fail';
    await tripOnce(rl, scope); // locks for 1 minute
    expect(await rl.peek(scope)).toEqual({ locked: true, retryAfterMs: MINUTE });

    now += 10_000;
    expect(await rl.peek(scope)).toEqual({ locked: true, retryAfterMs: MINUTE - 10_000 });

    // A flood of `peek` calls during the lockout must not consume a sliding-window slot (unlike
    // `check`) or push `lockedUntil` further out — this is the whole point of it being
    // NON-CONSUMING (ports/infra.ts's `RateLimit.peek` doc comment).
    for (let i = 0; i < 50; i += 1) await rl.peek(scope);
    expect(await rl.peek(scope)).toEqual({ locked: true, retryAfterMs: MINUTE - 10_000 });

    now += 50_000; // past the 1-minute lockout entirely
    expect(await rl.peek(scope)).toEqual({ locked: false, retryAfterMs: 0 });
  });

  it('unlocks once the lockout window has fully elapsed, and a subsequent check still passes through normally', async () => {
    let now = 0;
    const rl = new MemoryRateLimit(() => now);
    const scope = 'user:jill:login-fail';
    await tripOnce(rl, scope);
    now = MINUTE; // exactly at the boundary
    expect((await rl.peek(scope)).locked).toBe(false);
    // The scope still works normally afterward — peek never poisoned `check`'s own state.
    const result = await rl.check(scope, LIMIT, WINDOW_MS);
    expect(result).toEqual({ ok: true, retryAfterMs: 0 });
  });
});
