/**
 * `RateLimit` over an in-memory map (ADR-014's Node `RateLimit` row) implementing ADR-012's
 * exponential lockout curve: "5 failures then exponential lockout (1 min → 1 h)". `login.ts`'s own
 * doc comment is explicit about the split of responsibility this class owns: core always calls
 * `check(scope, 5, 60_000)` with the SAME `(limit, windowMs)` on every failed attempt for a given
 * scope; "the concrete `RateLimit` adapter ... owns escalating the actual lockout duration per
 * scope across repeated triggers." This class is that adapter, for both call sites that matter
 * (`ip:<ip>:auth` — 30/min, no escalation language in ADR-012 for this scope, so it degrades to a
 * PLAIN sliding window at `limit`; `user:<folded>:login-fail` — 5/min, WITH escalation): the same
 * implementation serves both because escalation only ever engages once a scope has actually
 * tripped its window more than once in a way this class's decay policy (below) doesn't erase.
 *
 * ## Escalation curve
 *
 * Per SCOPE (not global), a `lockLevel` starts at 0. The FIRST time a scope's sliding window is
 * exceeded, the lockout is `BASE_LOCKOUT_MS` (1 min) and `lockLevel` becomes 1. Every SUBSEQUENT
 * trip doubles the previous lockout (`BASE_LOCKOUT_MS * 2 ** lockLevel`), capped at
 * `MAX_LOCKOUT_MS` (1 h) — level 0→1 min, 1→2 min, 2→4 min, 3→8 min, 4→16 min, 5→32 min, 6→64 min
 * (capped to 60 min), matching ADR-012's "1 min → 1 h" range exactly. While a scope is locked out,
 * `check()` answers `{ok: false, retryAfterMs}` immediately (from `lockedUntil`) WITHOUT consuming
 * another slot in the sliding window — a locked-out scope doesn't need its window refreshed to
 * stay locked, and doing so would let a flood of requests during the lockout itself extend/reset
 * the window in a way that has no effect on the already-decided lockout duration.
 *
 * ## Decay
 *
 * An attacker (or a user who mistypes a password once) should not accumulate an ever-worsening
 * lockout forever. Decay policy (a design choice this task makes explicit, since ADR-012 doesn't
 * specify one): `lockLevel` decays by ONE for every full `DECAY_PERIOD_MS` (24 h) of continuous
 * quiet — no NEW trip — that elapses since the scope's `lastTrippedAt`. This is computed lazily on
 * every `check()` call (no timers/background sweep needed for an in-memory map this small): if
 * `now - lastTrippedAt` spans N whole decay periods, `lockLevel` drops by N (floored at 0) and
 * `lastTrippedAt` is advanced by `N * DECAY_PERIOD_MS` so a LATER partial period continues counting
 * from where the last full one left off, rather than restarting the clock from `now` (which would
 * let a scope that decays one level, then trips again immediately, decay a second level for the
 * same elapsed time). A full day of good behavior after the most recent trip is judged "clearly
 * not an ongoing attack" without being so short that a genuinely malicious actor gets an easy
 * reset by pausing briefly.
 *
 * `now` is injectable (defaults to `Date.now`) purely so tests can assert the escalation/decay
 * curve deterministically without real 24-hour waits or `vi.useFakeTimers()` interacting with
 * `setTimeout`-based test infrastructure elsewhere.
 */
import type { RateLimit, RateLimitPeek, RateLimitResult } from '../../ports/infra.ts';

const BASE_LOCKOUT_MS = 60_000; // 1 minute
const MAX_LOCKOUT_MS = 60 * 60_000; // 1 hour
const DECAY_PERIOD_MS = 24 * 60 * 60_000; // 24 hours

interface ScopeState {
  /** Sliding-window hit timestamps, newest last (same shape as `fake-ports.ts`'s test double). */
  hits: number[];
  /** Escalation level: 0 = never tripped (or fully decayed back to it). */
  lockLevel: number;
  /** `now` at/after which this scope is no longer locked out (0 = not currently locked). */
  lockedUntil: number;
  /** `now` at the most recent trip — the decay clock's reference point. `NEVER_TRIPPED` (`-1`,
   * NOT `0`) until the first trip: an injected test clock legitimately starts at `now() === 0`,
   * so `0` cannot double as a "never tripped" sentinel without colliding with a real trip that
   * happens to occur at `now === 0` — exactly what a real `Date.now()` can never produce but a
   * test clock can (and does, in `rate-limit.test.ts`'s escalation-curve tests). */
  lastTrippedAt: number;
}

const NEVER_TRIPPED = -1;

function freshState(): ScopeState {
  return { hits: [], lockLevel: 0, lockedUntil: 0, lastTrippedAt: NEVER_TRIPPED };
}

export class MemoryRateLimit implements RateLimit {
  private readonly scopes = new Map<string, ScopeState>();
  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  check(scope: string, limit: number, windowMs: number): Promise<RateLimitResult> {
    const now = this.now();
    const state = this.scopes.get(scope) ?? freshState();

    this.decay(state, now);

    if (now < state.lockedUntil) {
      this.scopes.set(scope, state);
      return Promise.resolve({ ok: false, retryAfterMs: state.lockedUntil - now });
    }

    const cutoff = now - windowMs;
    state.hits = state.hits.filter((t) => t > cutoff);
    state.hits.push(now);

    if (state.hits.length <= limit) {
      this.scopes.set(scope, state);
      return Promise.resolve({ ok: true, retryAfterMs: 0 });
    }

    const lockoutMs = Math.min(BASE_LOCKOUT_MS * 2 ** state.lockLevel, MAX_LOCKOUT_MS);
    state.lockedUntil = now + lockoutMs;
    state.lockLevel += 1;
    state.lastTrippedAt = now;
    state.hits = []; // the window itself resets — see class doc comment's "Escalation curve" §.
    this.scopes.set(scope, state);
    return Promise.resolve({ ok: false, retryAfterMs: lockoutMs });
  }

  /** `RateLimit.peek` (`ports/infra.ts`'s doc comment on that method — read in full for the full
   * "why" this exists): reports whether `scope` is CURRENTLY inside an already-decided lockout
   * window (`state.lockedUntil`, set by a PRIOR `check()` trip), without touching `hits`,
   * `lockLevel`, or `lastTrippedAt` at all — this method never calls `this.decay` or mutates the
   * map. `lockedUntil` is the one field that already carries the exact end-of-lockout instant a
   * trip decided; decay only ever affects the ESCALATION LEVEL used for a FUTURE trip's duration,
   * never retroactively shortens/extends a lockout already in effect, so skipping the decay step
   * here changes nothing about whether `scope` reads as locked right now. A scope never seen
   * before (no entry in `this.scopes` at all) is never locked, by construction. */
  peek(scope: string): Promise<RateLimitPeek> {
    const now = this.now();
    const state = this.scopes.get(scope);
    if (!state) return Promise.resolve({ locked: false, retryAfterMs: 0 });
    const locked = now < state.lockedUntil;
    return Promise.resolve({ locked, retryAfterMs: locked ? state.lockedUntil - now : 0 });
  }

  /** Mutates `state` in place, decaying `lockLevel` by one per full `DECAY_PERIOD_MS` elapsed
   * since `lastTrippedAt` — see class doc comment's "Decay" § for the full rationale. No-op for a
   * scope that has never tripped (`lastTrippedAt === NEVER_TRIPPED`) or already fully decayed
   * (`lockLevel === 0`, in which case `lastTrippedAt` is left alone; it's meaningless once
   * nothing is escalated). */
  private decay(state: ScopeState, now: number): void {
    if (state.lastTrippedAt === NEVER_TRIPPED || state.lockLevel === 0) return;
    const periods = Math.floor((now - state.lastTrippedAt) / DECAY_PERIOD_MS);
    if (periods <= 0) return;
    state.lockLevel = Math.max(0, state.lockLevel - periods);
    state.lastTrippedAt = state.lockLevel > 0 ? state.lastTrippedAt + periods * DECAY_PERIOD_MS : NEVER_TRIPPED;
  }
}
