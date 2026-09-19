/**
 * `createApp(ports): Hono` — THE composition point (task-6-brief; doc-10 §Layout: "Hono app
 * factory: createApp(ports) → routes + middleware"). Every adapter (Node's `server.ts`,
 * Cloudflare's `worker.ts`) calls this ONE function with its own port implementations and gets
 * back a plain `Hono` it serves — no adapter re-implements or re-orders any middleware/routing
 * decision made here. `core/index.ts` re-exports this plus the actors adapters instantiate.
 *
 * Doc-10 §Request routing, implemented in the order given there:
 *   `/*` → static assets with SPA fallback → `index.html`; `/api/*` → Hono with security
 *   headers, session cookie, JSON body limit, `X-Requested-With`, rate limiting — each
 *   individually already wired inside `createAuthRoutes`/`createMeRoutes`/`createCharacterRoutes`
 *   (Tasks 4 and 6), so this file's own job is: global security headers (the one piece that
 *   isn't route-specific), mounting each sub-app at its prefix, and the static/SPA fall-through.
 */
import { Hono } from 'hono';
import type { StaticAssets } from '../ports/infra.ts';
import { createAuthRoutes } from './routes/auth.ts';
import { createMeRoutes } from './routes/me.ts';
import { createCharacterRoutes, type CharactersDeps } from './routes/characters.ts';
import { createHealthRoutes } from './routes/health.ts';
import { securityHeaders } from './http/security-headers.ts';
import { installErrorHandler } from './http/error-handler.ts';

/** Every port `createApp` needs, across every sub-app it mounts (`AuthDeps` — `db`, `config`,
 * `rateLimit` — plus `CharactersDeps`'s `streamHost`/`wsUpgrade`, plus `staticAssets` for the
 * fall-through route). One flat interface (rather than nested `{auth: AuthDeps, characters:
 * CharactersDeps, ...}`) because every port is a singleton shared across every sub-app anyway
 * (one `Db`, one `Config`, ...) — nesting would just make every adapter's `createApp(...)` call
 * repeat the same values under multiple keys for no benefit. */
export interface AppPorts extends CharactersDeps {
  readonly staticAssets: StaticAssets;
}

export function createApp(ports: AppPorts): Hono {
  const app = new Hono();
  installErrorHandler(app);
  app.use('*', securityHeaders());

  app.route('/api/auth', createAuthRoutes(ports));
  app.route('/api/me', createMeRoutes(ports));
  app.route('/api/characters', createCharacterRoutes(ports));
  app.route('/api/health', createHealthRoutes());

  // Static assets + SPA fallback (task-6-brief: "GET /* → StaticAssets.fetch with SPA fallback
  // (core calls the port; adapters supply the implementation)"). Registered LAST: Hono's router
  // matches the mounted `/api/*` sub-apps above regardless of registration order (they're more
  // specific routes, not a catch-all), so this only ever runs for a request none of them claimed.
  // `StaticAssets.fetch`'s own doc comment (`ports/infra.ts`) says a `null` result "falls through
  // to SPA index.html handling AT THE CALL SITE" — this is that call site: a second `fetch` for
  // `/index.html` on the SAME `StaticAssets` port, not a different mechanism, so a Node adapter's
  // `serve-static` and a Cloudflare adapter's Workers-assets binding both get SPA fallback for
  // free from implementing `fetch` once.
  app.get('*', async (c) => {
    const direct = await ports.staticAssets.fetch(c.req.raw);
    if (direct) return direct;
    const indexUrl = new URL('/index.html', c.req.url);
    const fallback = await ports.staticAssets.fetch(new Request(indexUrl, { method: 'GET' }));
    return fallback ?? c.notFound();
  });

  return app;
}
