/** Per-IP request-rate ceiling for the whole `/api/auth/*` surface (doc-08's `ip:<ip>:auth`
 * scope: 30 requests/minute — exact value) — a coarse flood guard in front of the finer
 * per-username lockout in `../auth/login.ts`. */
import type { MiddlewareHandler } from 'hono';
import type { RateLimit } from '../../ports/index.ts';
import { tooManyRequests } from '../errors.ts';
import { getClientIp } from './client-ip.ts';

const IP_AUTH_LIMIT = 30;
const IP_AUTH_WINDOW_MS = 60_000;

export function ipAuthRateLimit(rateLimit: RateLimit): MiddlewareHandler {
  return async (c, next) => {
    const ip = getClientIp(c);
    const result = await rateLimit.check(`ip:${ip}:auth`, IP_AUTH_LIMIT, IP_AUTH_WINDOW_MS);
    if (!result.ok) throw tooManyRequests('Too many requests');
    await next();
  };
}
