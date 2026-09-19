/**
 * Cloudflare Worker smoke: `/api/health` over the real in-pool worker (`SELF`, `cloudflare:test`)
 * — task-8-brief step 1's "worker serves /api/health". `SELF` dispatches straight to this
 * project's `default.fetch` (`worker.ts`) inside the actual workerd runtime, exercising the real
 * `createApp`/routing, not a hand-built fake.
 */
import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

describe('Cloudflare Worker — GET /api/health', () => {
  it('answers 200 {ok: true}', async () => {
    const res = await SELF.fetch('https://herokeep.test/api/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});
