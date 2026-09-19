/** Session-cookie → `c.get('user')` middleware, with the sliding touch handled inside
 * `resolveSessionToken` (`./sessions.ts`, throttled to 1/day). */
import type { MiddlewareHandler } from 'hono';
import { unauthorized } from '../errors.ts';
import { readSessionCookie } from '../http/session-cookie.ts';
import { resolveSessionToken } from './sessions.ts';
import type { AuthDeps } from './types.ts';

export interface AuthedUser {
  readonly userId: string;
  readonly tokenHash: string;
  readonly deviceLabel: string;
}

/** Hono's `Variables` generic for every route that needs `c.get('user')` — routes/middleware
 * that use it are instantiated as `new Hono<AuthEnv>()` rather than a bare `new Hono()`. */
export interface AuthEnv {
  Variables: { user: AuthedUser };
}

/** Requires a valid, unexpired session cookie; 401s otherwise. Sets `c.get('user')` for
 * downstream handlers on success. */
export function requireAuth(deps: AuthDeps): MiddlewareHandler<AuthEnv> {
  return async (c, next) => {
    const token = readSessionCookie(c);
    if (!token) throw unauthorized('Missing session');

    const resolved = await resolveSessionToken(deps.db, token, Date.now());
    if (!resolved) throw unauthorized('Invalid or expired session');

    c.set('user', {
      userId: resolved.session.userId,
      tokenHash: resolved.tokenHash,
      deviceLabel: resolved.session.deviceLabel,
    });
    await next();
  };
}
