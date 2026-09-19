/**
 * `StaticAssets` serving `apps/web/dist` from disk (ADR-014's Node `StaticAssets` row:
 * "`@hono/node-server/serve-static` from `apps/web/dist`"). Implemented as a small hand-rolled
 * `fetch` rather than wiring `@hono/node-server/serve-static` (a Hono MIDDLEWARE, which expects to
 * run inside a Hono request cycle with a `Context`) because the `StaticAssets` port's shape is
 * `fetch(request): Promise<Response | null>` — a plain function `core/app.ts` calls directly, twice
 * per unmatched request (once for the literal path, once for `/index.html` on a `null`, per that
 * file's SPA-fallback comment) — not a middleware slot. A ~20-line handler reading straight off
 * `node:fs/promises` satisfies that exact shape without adapting a middleware API to fit a
 * function-port API; `null` (not a 404 `Response`) on a miss is what lets `core/app.ts`'s own
 * fallback logic decide what happens next, per that port's own doc comment ("falls through to SPA
 * `index.html` handling AT THE CALL SITE").
 */
import { readFile, stat } from 'node:fs/promises';
import { join, normalize, resolve, sep } from 'node:path';
import type { StaticAssets } from '../../ports/infra.ts';

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
};

export class NodeStaticAssets implements StaticAssets {
  private readonly rootDir: string;

  constructor(rootDir: string) {
    this.rootDir = resolve(rootDir);
  }

  async fetch(request: Request): Promise<Response | null> {
    let pathname: string;
    try {
      pathname = decodeURIComponent(new URL(request.url).pathname);
    } catch {
      return null;
    }

    // Path-traversal guard: normalize, strip the leading slash, then confirm the resolved
    // absolute path still lives under `rootDir` before ever touching the filesystem — a
    // `..`-laden pathname (`/../../secrets`) resolves OUTSIDE `rootDir` and is refused as a plain
    // miss (`null`), same as any other not-found path.
    const relative = normalize(pathname).replace(/^([/\\])+/, '');
    const filePath = resolve(this.rootDir, relative);
    if (filePath !== this.rootDir && !filePath.startsWith(this.rootDir + sep)) return null;

    try {
      const stats = await stat(filePath);
      if (!stats.isFile()) return null;
      const body = await readFile(filePath);
      const ext = filePath.slice(filePath.lastIndexOf('.'));
      const contentType = MIME_TYPES[ext] ?? 'application/octet-stream';
      return new Response(body, { status: 200, headers: { 'content-type': contentType } });
    } catch {
      return null;
    }
  }
}

/** Test/doc helper mirroring the join used above, exported so a test can build an expected path
 * without duplicating the `resolve`/`normalize` logic. Not used by `fetch` itself (kept inline
 * there for locality with the traversal guard). */
export function staticAssetPath(rootDir: string, pathname: string): string {
  return join(resolve(rootDir), normalize(pathname).replace(/^([/\\])+/, ''));
}
