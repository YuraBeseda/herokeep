/** Maps `ApiError` (`../errors.ts`) onto its HTTP response; installed on each `core/routes/*.ts`
 * sub-app (Task 4). Task 6's `createApp` composes those sub-apps via `.route()`, under which a
 * mounted sub-app's own `onError` handler still fires for errors thrown within it. */
import type { Env, Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { ApiError } from '../errors.ts';

export function installErrorHandler<E extends Env>(app: Hono<E>): void {
  app.onError((err, c) => {
    if (err instanceof ApiError) {
      return c.json({ error: err.code, message: err.message }, err.status as ContentfulStatusCode);
    }
    // Never leak an unexpected error's message/stack over the wire (doc-08 §Logging: no bodies,
    // no details) — the caller only ever sees a generic 500.
    return c.json({ error: 'internal_error', message: 'Internal server error' }, 500);
  });
}
