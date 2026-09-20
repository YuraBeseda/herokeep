import type { Event } from '@hk/protocol';

/** Result of a `RateLimit.check` — `retryAfterMs` is 0 when `ok` is true. */
export interface RateLimitResult {
  readonly ok: boolean;
  readonly retryAfterMs: number;
}

/** Result of a `RateLimit.peek` — `retryAfterMs` is 0 when `locked` is false. */
export interface RateLimitPeek {
  readonly locked: boolean;
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
  /**
   * Whole-branch review finding 2: a NON-CONSUMING lockout check — reports whether `scope` is
   * CURRENTLY under an active lockout (from a PRIOR `check()` trip), without recording a hit or
   * otherwise mutating any state `check()` itself depends on (the sliding-window hit array, the
   * escalation level, the decay clock). `core/auth/login.ts` calls this BEFORE the verifier
   * compare, so an active per-username lockout also blocks a CORRECT verifier — not just wrong
   * guesses — closing the "429 = wrong password, 200 = right password" oracle a check-only,
   * failure-triggered gate would otherwise leave open during an active lockout window. Every
   * adapter implementing `RateLimit` must implement this too (both concrete adapters plus every
   * test double — see `adapters/node/rate-limit.memory.ts` and `adapters/cloudflare/rate-limiter.do.ts`).
   */
  peek(scope: string): Promise<RateLimitPeek>;
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

/** Context the WS-upgrade route (`GET /api/characters/:id/ws`, `core/routes/characters.ts`, Task
 * 6; `GET /api/campaigns/:id/ws`, `core/routes/campaigns.ts`, Task 4) hands to the adapter —
 * already fully verified by core (session, ownership/membership, `Origin`) before this ever runs.
 *
 * Plan-9 Task 4 finding (this field used to be typed as the literal `'owner'`, with a doc comment
 * arguing a future campaign-socket handoff should be "a visibly different port, not a silent
 * widening of this one"): widened here instead of adding a second method, because BOTH real
 * `WsUpgrade` implementations (`adapters/node/server.ts`'s `NodeWsUpgrade`,
 * `adapters/cloudflare/worker.ts`'s `CloudflareWsUpgrade`) treat `role`/`streamId`/`userId`
 * opaquely — they forward whatever they're given (as a header, or into `ConnAttachment`) without
 * ever narrowing/switching on the literal `'owner'` type — so a second method would duplicate an
 * identical shape for no behavioral difference, and would force Task 4 (routes only) to also
 * implement Task 8's campaign-adapter-wiring just to keep those two adapter files compiling.
 * `displayName` is new (design ruling 1 read together with task-5-report.md's presence finding:
 * `CampaignActor` has no `Db` port, so a D1-resolved display name must arrive through this
 * attachment, the same way `role`/`userId` already do) — optional so `characters.ts`'s existing
 * WS route (which never sets it) is unaffected. Neither adapter reads `ctx.displayName` into its
 * `ConnAttachment` yet (Task 8's job, once campaign-socket wiring actually lands on both
 * adapters); flagged here rather than speculatively wired into files outside this task's scope. */
export interface WsUpgradeContext {
  readonly streamId: string;
  readonly userId: string;
  readonly role: 'owner' | 'dm' | 'member';
  readonly displayName?: string;
}

/**
 * The WS-upgrade handoff (doc-10 §Request routing: core verifies session + ownership + `Origin`,
 * then "hands the upgrade to `StreamHost.get(id)`" — in practice, to whichever adapter mechanism
 * actually performs a WebSocket upgrade). Hono has no portable WS-upgrade primitive across
 * Cloudflare (Workers Hibernation API) and Node (the `ws` package), so core cannot perform the
 * upgrade itself; of the task brief's two suggested shapes ("an injected upgrade callback" vs.
 * "the route returns a sentinel the adapter intercepts"), this port takes the injected-callback
 * form, because it composes directly with Hono's handler contract (a route handler must return a
 * `Response`, which this port's return type already is) without needing either adapter to special-
 * case/intercept a particular route before Hono's own routing runs.
 *
 *   - Cloudflare (Task 8): forwards `request` to the `CharacterStreamDO` (keyed by `streamId`)
 *     via a binding `fetch`, carrying `ctx` (e.g. as headers or a sub-path the DO trusts because
 *     it only ever receives requests from the Worker, never the public Internet); the DO calls
 *     `acceptWebSocket` and returns the 101 `Response` directly back up this same call chain.
 *   - Node (Task 7): the adapter's own `http.Server` `'upgrade'` event (registered once, outside
 *     Hono, per `@hono/node-server`'s documented WS pattern) is what actually completes the
 *     handshake; this port's implementation there matches the in-flight upgrade request to `ctx`,
 *     registers the resulting socket with `streamId`'s `Connections`, and returns a `Response`
 *     that is never observed by a real client (the raw socket already answered the handshake) —
 *     satisfying Hono's handler contract without a second response being sent.
 */
export interface WsUpgrade {
  upgrade(request: Request, ctx: WsUpgradeContext): Promise<Response>;
}
