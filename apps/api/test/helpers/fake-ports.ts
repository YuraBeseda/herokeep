/** In-memory `Config`/`RateLimit` port doubles for Task 4's auth tests — fixed test-only secret
 * values (never real secrets), and a REAL (not mocked) sliding-window rate limiter so the
 * lockout tests exercise actual scope/limit/window arithmetic rather than a canned response. */
import type { Config, ConfigName, RateLimit, RateLimitPeek, RateLimitResult } from '../../src/ports/index.ts';

const TEST_SECRETS: Record<ConfigName, string> = {
  SESSION_PEPPER: 'test-only-session-pepper-not-a-real-secret',
  SALT_HMAC_KEY: 'test-only-salt-hmac-key-not-a-real-secret',
  APP_ORIGIN: 'https://app.test.local',
};

export function createTestConfig(overrides: Partial<Record<ConfigName, string>> = {}): Config {
  return {
    get: (name) => overrides[name] ?? TEST_SECRETS[name],
  };
}

/**
 * A real in-memory sliding-window `RateLimit`: `check` keeps a per-scope array of hit
 * timestamps, drops any older than `windowMs`, appends `now`, and reports `ok` iff the
 * surviving count is at most `limit`. Fresh per test (no persistence across instances) — see
 * `RateLimit`'s port doc comment (`src/ports/infra.ts`) for the contract this implements.
 */
export class InMemoryRateLimit implements RateLimit {
  private readonly hits = new Map<string, number[]>();

  check(scope: string, limit: number, windowMs: number): Promise<RateLimitResult> {
    const now = Date.now();
    const cutoff = now - windowMs;
    const existing = (this.hits.get(scope) ?? []).filter((t) => t > cutoff);
    existing.push(now);
    this.hits.set(scope, existing);

    const ok = existing.length <= limit;
    const oldest = existing[0] ?? now;
    const retryAfterMs = ok ? 0 : Math.max(0, oldest + windowMs - now);
    return Promise.resolve({ ok, retryAfterMs });
  }

  /** `RateLimit.peek` — this double is a plain sliding window (no separate persisted "locked
   * until" state the way `MemoryRateLimit`/`RateLimiterDO` model a real escalating lockout, per
   * this class's own doc comment), so it never reports a scope as locked; tests asserting the
   * finding-2 peek-then-block behavior use the real `MemoryRateLimit` adapter instead (see
   * `test/core/auth.test.ts`), which actually has lockout state for `peek` to read. Kept here only
   * so every OTHER test in the suite that constructs this double still satisfies the `RateLimit`
   * port's full interface. */
  peek(_scope: string): Promise<RateLimitPeek> {
    return Promise.resolve({ locked: false, retryAfterMs: 0 });
  }
}
