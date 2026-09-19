/** `GET /api/health` (task-6-brief). Deliberately dependency-free (no `Db`/port round-trip): a
 * liveness probe should answer even if a downstream dependency is unhealthy, so an operator can
 * tell "the process is up" apart from "the process is up AND its dependencies are" — the latter
 * is out of Task 6's scope (no readiness-probe requirement in the brief). No app version is
 * threaded in: `Config`'s `ConfigName` union (`ports/infra.ts`) is closed over the three ADR-012
 * secrets, and adding a version string there would stretch that port past its documented scope
 * for a "nice to have" field the brief itself marks optional ("+ version if trivially
 * available") — not available trivially here, so omitted.
 */
import { Hono } from 'hono';

export function createHealthRoutes(): Hono {
  const app = new Hono();
  app.get('/', (c) => c.json({ ok: true }));
  return app;
}
