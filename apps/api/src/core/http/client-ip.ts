/**
 * The client-IP seam (task-4-brief: "how the IP arrives differs per adapter; take it from a
 * connection-info argument the adapter supplies to createApp or a header set by the adapter —
 * design the seam cleanly and document; do NOT trust X-Forwarded-For blindly in core").
 *
 * Decision: core reads ONE adapter-internal header, `X-Hk-Client-Ip`, and never parses
 * `X-Forwarded-For`/`CF-Connecting-IP` itself (both are trivially spoofable by anyone who can
 * reach the origin directly, which on Node — no fronting proxy required — is the actual client).
 * Each adapter is responsible for setting `X-Hk-Client-Ip` from ITS OWN trusted source before
 * core's `createApp` Hono instance ever sees the request:
 *   - Cloudflare (Task 8): `request.headers.get('cf-connecting-ip')` — Cloudflare's edge sets
 *     this itself; a client-supplied one is overwritten at the edge, so it's trustworthy there.
 *   - Node (Task 7): `socket.remoteAddress` from the raw TCP connection (optionally behind a
 *     locally-configured trusted reverse proxy per the self-hosting recipe — that trust decision
 *     belongs to the Node adapter, not core).
 * This keeps `src/core/**` genuinely runtime-agnostic (no header-trust policy baked in) while
 * still giving every rate-limit scope key a real, adapter-verified IP to key off.
 */
import type { Context } from 'hono';

export const CLIENT_IP_HEADER = 'X-Hk-Client-Ip';

/** Reads the caller's IP for rate-limit scope keys, as set by the adapter (see module header).
 * Falls back to a fixed `'unknown'` bucket if no adapter set it (e.g. a bare test app) — every
 * caller without a real IP shares one rate-limit bucket rather than bypassing the limit. */
export function getClientIp(c: Context): string {
  return c.req.header(CLIENT_IP_HEADER) ?? 'unknown';
}
