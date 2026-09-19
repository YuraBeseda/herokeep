import type { Event } from '@hk/protocol';

/** Result of a `RateLimit.check` — `retryAfterMs` is 0 when `ok` is true. */
export interface RateLimitResult {
  readonly ok: boolean;
  readonly retryAfterMs: number;
}

/**
 * Sliding-window rate limiting per scope (ADR-012's exact limits — 5 auth failures/username
 * with exponential lockout, 30 auth requests/min/IP). Cloudflare backs this with a
 * `RateLimiterDO`; Node backs it with an in-memory map (ADR-014's `RateLimit` row).
 */
export interface RateLimit {
  /** Records one hit against `scope` and reports whether it stays within `limit` per `windowMs`. */
  check(scope: string, limit: number, windowMs: number): Promise<RateLimitResult>;
}

/**
 * Registers the daily maintenance job (usage counters, expired-session purge, orphan check —
 * docs/02-architecture/10-backend-architecture.md §Daily maintenance). Cloudflare drives this
 * from a Cron Trigger's `scheduled()`; Node drives it from `setInterval`/`node-cron`.
 */
export interface Scheduler {
  daily(fn: () => Promise<void> | void): void;
}

/** The three secrets the backend core ever reads (ADR-012 §Auth exact values). */
export type ConfigName = 'SESSION_PEPPER' | 'SALT_HMAC_KEY' | 'APP_ORIGIN';

/**
 * Secret/config access (ADR-014's `Secrets`/`Config` row): Worker secrets/bindings on
 * Cloudflare, a gitignored `.env` file on Node. Core code never reads `process.env` or
 * `env.SESSION_PEPPER` directly — only through this port, so it stays adapter-agnostic.
 */
export interface Config {
  get(name: ConfigName): string;
}

/**
 * Serves the built Angular app for non-`/api` requests (ADR-014's `StaticAssets` row): Workers
 * static assets on Cloudflare, `@hono/node-server/serve-static` from `apps/web/dist` on Node.
 * Returns `null` when the request isn't a static asset this port can answer (falls through to
 * SPA `index.html` handling at the call site, or to the next handler).
 */
export interface StaticAssets {
  fetch(request: Request): Promise<Response | null>;
}

/**
 * Stream↔stream notification (ADR-014's `Rpc` row): a campaign stream's DO calling a character
 * stream's DO on Cloudflare, or a direct in-process method call between actors on Node. Typed
 * now so `CampaignActor`'s gateway (Phase 3) has a stable signature to target, but nothing in
 * Phase 2 calls it — `CharacterActor` is the only actor this phase ships, and it has no
 * campaign to notify. See docs/02-architecture/10-backend-architecture.md §CampaignActor.
 */
export interface Rpc {
  /** Forwards `events` committed on `fromStream` to `toStream`'s handle for fan-out/append. */
  notify(toStream: string, fromStream: string, events: Event[]): Promise<void>;
}
