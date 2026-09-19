/** In-memory `Config`/`RateLimit` port doubles for Task 4's auth tests — fixed test-only secret
 * values (never real secrets), and a REAL (not mocked) sliding-window rate limiter so the
 * lockout tests exercise actual scope/limit/window arithmetic rather than a canned response. */
import type { Config, ConfigName, RateLimit, RateLimitResult } from '../../src/ports/index.ts';

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
}
