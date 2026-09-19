/**
 * `RateLimiterDO` — the Cloudflare half of the `RateLimit` port (ADR-014's `RateLimit` row;
 * task-8-brief obligation (b)), implementing the SAME escalation contract as Node's
 * `MemoryRateLimit` (`adapters/node/rate-limit.memory.ts`, read in full for the curve's
 * rationale — this file reproduces its "Escalation curve"/"Decay" doc comments' MATH exactly,
 * adapted from an in-memory `Map<scope, ScopeState>` to one DO instance's own durable storage):
 * 5 failures/window trip a lockout starting at 1 minute and doubling per subsequent trip, capped
 * at 1 hour; a full `DECAY_PERIOD_MS` (24h) of quiet decays the escalation level by one.
 *
 * ## Addressing: one DO instance PER SCOPE, via `idFromName(scope)`
 *
 * `worker.ts`'s `CloudflareRateLimit.check(scope, limit, windowMs)` looks up
 * `env.RATE_LIMITER.idFromName(scope)` and calls `.check(limit, windowMs)` on that stub — so a
 * DIFFERENT scope string (`user:<folded>:login-fail`, `ip:<ip>:auth`, …) always addresses a
 * DIFFERENT DO instance, each with its own small, independent storage. This (rather than one
 * global DO fanning every scope's check through a single object, or a `Map<scope, ScopeState>`
 * inside one DO) is the Cloudflare-recommended shape for a large number of independent, low-
 * traffic keyed rate limiters (per Cloudflare's own Durable Objects guidance: prefer many small,
 * independently-addressed DO instances over one DO serializing unrelated work behind a single
 * object) — each auth attempt's rate-limit check only ever contends with OTHER attempts against
 * the exact same scope, never with unrelated users'/IPs' traffic, and per-DO storage size stays
 * tiny (one `ScopeState` record) regardless of how many distinct scopes the app has ever seen.
 *
 * ## Storage: the classic key/value API, not `state.storage.sql`
 *
 * `wrangler.jsonc` still declares this class under `new_sqlite_classes` (task-8-brief's
 * deliverable: BOTH DO classes SQLite-backed — new DO classes must be), but this store's actual
 * data is one small JSON-shaped record — no relational queries, no `findByIds`-style access
 * patterns the way `StreamStore` needs. SQLite-backed DO storage still fully supports the classic
 * `storage.get`/`storage.put` key/value API (it's implemented on top of the same SQLite database
 * internally), so using it here — rather than hand-writing a one-row SQL table — is the simpler,
 * equally-durable choice for this shape of data.
 */
import { DurableObject } from 'cloudflare:workers';
import type { Env } from './env.ts';
import type { RateLimitResult } from '../../ports/infra.ts';

const BASE_LOCKOUT_MS = 60_000; // 1 minute — same constant as MemoryRateLimit.
const MAX_LOCKOUT_MS = 60 * 60_000; // 1 hour.
const DECAY_PERIOD_MS = 24 * 60 * 60_000; // 24 hours.
const NEVER_TRIPPED = -1;
const STORAGE_KEY = 'scope_state';

interface ScopeState {
  hits: number[];
  lockLevel: number;
  lockedUntil: number;
  lastTrippedAt: number;
}

function freshState(): ScopeState {
  return { hits: [], lockLevel: 0, lockedUntil: 0, lastTrippedAt: NEVER_TRIPPED };
}

/** Mutates `state` in place — identical decay rule to `MemoryRateLimit.decay`; see that method's
 * doc comment (`adapters/node/rate-limit.memory.ts`) for the full "why 24h, why lazy" rationale,
 * reproduced verbatim here rather than re-derived. */
function decay(state: ScopeState, now: number): void {
  if (state.lastTrippedAt === NEVER_TRIPPED || state.lockLevel === 0) return;
  const periods = Math.floor((now - state.lastTrippedAt) / DECAY_PERIOD_MS);
  if (periods <= 0) return;
  state.lockLevel = Math.max(0, state.lockLevel - periods);
  state.lastTrippedAt = state.lockLevel > 0 ? state.lastTrippedAt + periods * DECAY_PERIOD_MS : NEVER_TRIPPED;
}

export class RateLimiterDO extends DurableObject<Env> {
  /** Injectable clock — same purpose as `MemoryRateLimit`'s constructor argument: lets tests
   * assert the escalation/decay curve deterministically. Defaults to the real clock; test code
   * reaching this DO via `runInDurableObject` (`cloudflare:test`) can override it before calling
   * `check`. */
  private now: () => number = Date.now;

  /** Test-only hook (not part of any port) — see `now`'s doc comment. */
  setClockForTest(now: () => number): void {
    this.now = now;
  }

  async check(limit: number, windowMs: number): Promise<RateLimitResult> {
    const now = this.now();
    const state = (await this.ctx.storage.get<ScopeState>(STORAGE_KEY)) ?? freshState();

    decay(state, now);

    if (now < state.lockedUntil) {
      await this.ctx.storage.put(STORAGE_KEY, state);
      return { ok: false, retryAfterMs: state.lockedUntil - now };
    }

    const cutoff = now - windowMs;
    state.hits = state.hits.filter((t) => t > cutoff);
    state.hits.push(now);

    if (state.hits.length <= limit) {
      await this.ctx.storage.put(STORAGE_KEY, state);
      return { ok: true, retryAfterMs: 0 };
    }

    const lockoutMs = Math.min(BASE_LOCKOUT_MS * 2 ** state.lockLevel, MAX_LOCKOUT_MS);
    state.lockedUntil = now + lockoutMs;
    state.lockLevel += 1;
    state.lastTrippedAt = now;
    state.hits = [];
    await this.ctx.storage.put(STORAGE_KEY, state);
    return { ok: false, retryAfterMs: lockoutMs };
  }
}
