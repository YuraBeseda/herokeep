/** A minimal Hono app assembling Task 4's `/api/auth` and `/api/me` sub-apps for `app.request()`
 * tests — not `createApp` (Task 6 owns the full factory with WS handoff and static-asset
 * serving); this is scoped to exactly what auth.test.ts exercises. */
import { Hono } from 'hono';
import { createAuthRoutes } from '../../src/core/routes/auth.ts';
import { createMeRoutes } from '../../src/core/routes/me.ts';
import { securityHeaders } from '../../src/core/http/security-headers.ts';
import type { AuthDeps } from '../../src/core/auth/types.ts';

export function createTestApp(deps: AuthDeps): Hono {
  const app = new Hono();
  app.use('*', securityHeaders());
  app.route('/api/auth', createAuthRoutes(deps));
  app.route('/api/me', createMeRoutes(deps));
  return app;
}
