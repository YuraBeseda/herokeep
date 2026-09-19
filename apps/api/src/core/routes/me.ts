/** `/api/me/*` (Task 4 brief). Every route here requires a valid session. */
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { AuthDeps } from '../auth/types.ts';
import { requireAuth, type AuthEnv } from '../auth/middleware.ts';
import { listDevices, revokeDevice } from '../auth/sessions.ts';
import { findUserById } from '../db/queries.ts';
import { requireXRequestedWith } from '../http/xrw-gate.ts';
import { installErrorHandler } from '../http/error-handler.ts';
import { notFound } from '../errors.ts';

const BODY_LIMIT_BYTES = 64 * 1024; // ADR-012 exact value

export function createMeRoutes(deps: AuthDeps) {
  const app = new Hono<AuthEnv>();
  installErrorHandler(app);

  app.use('*', requireXRequestedWith());
  app.use(
    '*',
    bodyLimit({
      maxSize: BODY_LIMIT_BYTES,
      onError: (c) => c.json({ error: 'payload_too_large', message: 'Request body too large' }, 413),
    }),
  );
  app.use('*', requireAuth(deps));

  app.get('/', async (c) => {
    const authed = c.get('user');
    const row = await findUserById(deps.db, authed.userId);
    // Defensive only: a valid session always names an existing user (sessions are deleted when
    // a user's credentials are reset/replaced) — this should be unreachable in practice.
    if (!row) throw notFound('User not found');
    return c.json({ userId: row.id, username: row.username });
  });

  app.get('/sessions', async (c) => {
    const authed = c.get('user');
    const devices = await listDevices(deps.db, authed.userId, authed.tokenHash);
    return c.json(devices);
  });

  app.delete('/sessions/:id', async (c) => {
    const authed = c.get('user');
    const id = c.req.param('id');
    const revoked = await revokeDevice(deps.db, authed.userId, id);
    if (!revoked) throw notFound('Session not found');
    return c.body(null, 204);
  });

  return app;
}
