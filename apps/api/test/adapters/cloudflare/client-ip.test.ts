/**
 * `worker.ts`'s `stampClientIp` (task-8-brief obligation (a)): a client-forged `X-Hk-Client-Ip`
 * must not survive to reach `createApp` — verified the same way Node's equivalent test does
 * (`test/adapters/node/server.test.ts`): the ADR-012 30-requests/min/IP auth rate limit only
 * blocks the 31st request if every request lands in the SAME bucket, which only happens if the
 * adapter overwrote each request's own (different, forged) `X-Hk-Client-Ip` with the real,
 * trusted IP before core's `getClientIp` (`core/http/client-ip.ts`) ever reads it.
 */
import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

describe('Cloudflare Worker — X-Hk-Client-Ip (obligation (a))', () => {
  it('overwrites a client-forged X-Hk-Client-Ip with the trusted CF-Connecting-IP before the request reaches createApp', async () => {
    // `cf-connecting-ip` simulates what Cloudflare's real edge sets for every request from ONE
    // actual client (the pool-workers sandbox has no real edge in front of it) — a fresh,
    // run-unique value keeps this test's `RateLimiterDO` storage isolated from any other test run
    // that happened to reuse the same simulated IP. Each of the 31 requests below claims a
    // DIFFERENT FORGED `X-Hk-Client-Ip`: if `worker.ts` trusted it instead of overwriting it from
    // `cf-connecting-ip`, each would land in its own rate-limit scope and NONE would ever be blocked.
    const realIp = `203.0.113.${Date.now() % 250}`;
    const statuses: number[] = [];
    for (let i = 0; i < 31; i += 1) {
      const res = await SELF.fetch(`https://herokeep.test/api/auth/salt?username=probe-${i}`, {
        headers: { 'X-Hk-Client-Ip': `198.51.100.${i}`, 'cf-connecting-ip': realIp },
      });
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 30)).toEqual(Array.from({ length: 30 }, () => 200));
    expect(statuses[30]).toBe(429);
  });
});
