/** Transport/content hardening headers (ADR-012 §Transport; doc-08 §Content and transport
 * hardening). Every response gets the JSON-API "basics"; an HTML response additionally gets
 * HSTS/CSP/frame-ancestors, since those specifically mitigate browser-rendered-document threats
 * (injected scripts, framing) that don't apply to a JSON payload. Task 4's own routes are
 * JSON-only, but this is written generically so Task 6's static-HTML serving reuses it unchanged. */
import type { MiddlewareHandler } from 'hono';

const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self' wss:; font-src 'self'; frame-ancestors 'none'; base-uri 'none'";

export function securityHeaders(): MiddlewareHandler {
  return async (c, next) => {
    await next();
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Referrer-Policy', 'no-referrer');
    c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

    const contentType = c.res.headers.get('content-type') ?? '';
    if (contentType.includes('text/html')) {
      c.header('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
      c.header('Content-Security-Policy', CSP);
    }
  };
}
