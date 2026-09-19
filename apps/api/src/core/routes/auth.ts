/** `/api/auth/*` (Task 4 brief). Mounted by the caller (a test app here; Task 6's `createApp`
 * in production) at `/api/auth` via `app.route('/api/auth', createAuthRoutes(deps))`. */
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { AuthDeps } from '../auth/types.ts';
import { registerUser, type RegisterInput } from '../auth/register.ts';
import { resolveSalt } from '../auth/salt.ts';
import { loginUser, type LoginInput } from '../auth/login.ts';
import { resetWithRecoveryCode, type ResetInput } from '../auth/recovery.ts';
import { endAllSessions, endSession } from '../auth/sessions.ts';
import { requireAuth, type AuthEnv } from '../auth/middleware.ts';
import { setSessionCookie, clearSessionCookie } from '../http/session-cookie.ts';
import { ipAuthRateLimit } from '../http/rate-limit.ts';
import { requireXRequestedWith } from '../http/xrw-gate.ts';
import { installErrorHandler } from '../http/error-handler.ts';
import { badRequest } from '../errors.ts';

const BODY_LIMIT_BYTES = 64 * 1024; // ADR-012 exact value

export function createAuthRoutes(deps: AuthDeps) {
  const app = new Hono<AuthEnv>();
  installErrorHandler(app);

  app.use('*', ipAuthRateLimit(deps.rateLimit));
  app.use('*', requireXRequestedWith());
  app.use(
    '*',
    bodyLimit({
      maxSize: BODY_LIMIT_BYTES,
      onError: (c) => c.json({ error: 'payload_too_large', message: 'Request body too large' }, 413),
    }),
  );

  app.post('/register', async (c) => {
    const body = await parseJsonBody<Partial<RegisterInput>>(c);
    const result = await registerUser(deps.db, deps.config, {
      username: body.username ?? '',
      verifier: body.verifier ?? '',
      salt: body.salt ?? '',
    });
    return c.json(result, 201);
  });

  app.get('/salt', async (c) => {
    const username = c.req.query('username');
    if (!username) throw badRequest('username is required');
    const salt = await resolveSalt(deps.db, deps.config, username);
    return c.json({ salt });
  });

  app.post('/login', async (c) => {
    const body = await parseJsonBody<Partial<LoginInput>>(c);
    const result = await loginUser(deps.db, deps.config, deps.rateLimit, {
      username: body.username ?? '',
      verifier: body.verifier ?? '',
      deviceLabel: body.deviceLabel,
    });
    setSessionCookie(c, result.token);
    return c.json({ userId: result.userId });
  });

  app.post('/logout', requireAuth(deps), async (c) => {
    const user = c.get('user');
    await endSession(deps.db, user.tokenHash);
    clearSessionCookie(c);
    return c.body(null, 204);
  });

  app.post('/logout-all', requireAuth(deps), async (c) => {
    const user = c.get('user');
    await endAllSessions(deps.db, user.userId);
    clearSessionCookie(c);
    return c.body(null, 204);
  });

  app.post('/reset', async (c) => {
    const body = await parseJsonBody<Partial<ResetInput>>(c);
    const result = await resetWithRecoveryCode(deps.db, deps.config, {
      username: body.username ?? '',
      recoveryCode: body.recoveryCode ?? '',
      newSalt: body.newSalt ?? '',
      newVerifier: body.newVerifier ?? '',
    });
    return c.json(result);
  });

  return app;
}

async function parseJsonBody<T>(c: Context): Promise<T> {
  try {
    return await c.req.json();
  } catch {
    throw badRequest('Invalid JSON body');
  }
}
