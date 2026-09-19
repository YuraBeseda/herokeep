/** CSRF defense in depth (ADR-012 §Sessions / doc-08): state-changing requests must carry
 * `X-Requested-With: herokeep`. A cross-site form/simple-fetch can't attach a custom header, so
 * this alone blocks classic CSRF even though the session cookie is `SameSite=Lax` (which still
 * allows a top-level cross-site GET navigation to carry it). GET is exempt: it's the one verb a
 * plain cross-site navigation can trigger, and none of this API's GET routes mutate state. */
import type { MiddlewareHandler } from 'hono';
import { forbidden } from '../errors.ts';

const REQUIRED_VALUE = 'herokeep';

export function requireXRequestedWith(): MiddlewareHandler {
  return async (c, next) => {
    if (c.req.method !== 'GET' && c.req.header('X-Requested-With') !== REQUIRED_VALUE) {
      throw forbidden('Missing X-Requested-With header');
    }
    await next();
  };
}
