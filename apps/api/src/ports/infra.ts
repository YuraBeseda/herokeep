import type { Actor, Event, RejectCode } from '@hk/protocol';

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

/** One event successfully committed (or idempotently re-acked) via `Rpc.forwardAppend` — same
 * shape as `core/streams/stream-actor.ts`'s `AckResult`, duplicated here (not imported) because
 * `ports/**` must not depend on `core/**` (Global Constraints: core imports ports, never the
 * reverse) — the two are kept structurally identical by convention, not by a shared type. */
export interface RpcAckResult {
  readonly id: string;
  readonly seq: number;
}

/** One event rejected via `Rpc.forwardAppend` — mirrors `core/streams/stream-actor.ts`'s
 * `RejectResult`, same "duplicated, not imported" rationale as `RpcAckResult` above. */
export interface RpcRejectResult {
  readonly id: string;
  readonly code: RejectCode;
  readonly message: string;
}

/** The full result of one `Rpc.forwardAppend` call — same shape as `core/streams/stream-actor.ts`'s
 * `AppendOutcome`, so `CampaignActor`'s gateway (plan-9 Task 6) can merge a forwarded group's
 * outcome directly into its own `acked`/`rejected` arrays without translation. */
export interface RpcAppendOutcome {
  readonly acked: RpcAckResult[];
  readonly rejected: RpcRejectResult[];
}

/** The narrow match `Rpc.hasEvent` checks a target stream's committed events against (plan-9 Task
 * 6's mirror-verification design — see that method's doc comment for why this is deliberately
 * narrower than a general query capability). `campaignId` is read off the CANDIDATE event's own
 * payload (every mirror-event payload in doc-02's catalog carries one: `character.campaign_joined`/
 * `character.campaign_left`'s `{campaignId}`) — the CHARACTER half of the match (which char:
 * stream to even look at) is expressed by the `stream` argument `hasEvent` takes alongside this,
 * not by a field in here, since doc-02's catalog never puts a redundant `characterId` inside a
 * character-stream event's own payload (the stream id already names the character).
 */
export interface RpcEventMatch {
  readonly type: string;
  readonly campaignId: string;
}

/**
 * Stream↔stream notification and cross-stream gateway calls (ADR-014's `Rpc` row): a campaign
 * stream's DO calling a character stream's DO on Cloudflare, or a direct in-process method call
 * between actors on Node. Typed now so `CampaignActor`'s gateway (Phase 3, plan-9 Task 6) has a
 * stable signature to target; every method here has a REAL core caller as of Task 6
 * (`CampaignActor.append`'s gateway-forward path, its mirror-verification path, and its
 * subscribe catch-up path; `CharacterActor.append`'s after-commit campaign-notify hook) — only
 * the ADAPTER implementations remain a later task (plan-9 Task 8: Node backs every method with a
 * direct in-process call via `StreamHost`/`StreamStore`; Cloudflare backs it with a DO-to-DO
 * binding `fetch`/RPC call — the trust-boundary patterns from the plan-7 `WsUpgrade`/`Rpc` doc
 * comments apply identically). See docs/02-architecture/10-backend-architecture.md §CampaignActor
 * and docs/02-architecture/03-sync-protocol.md §Gateway/§Permission enforcement point/§Ordering
 * (cross-stream mirrors) for the BINDING semantics every method below implements.
 */
export interface Rpc {
  /** Forwards `events` committed on `fromStream` to `toStream`'s handle for fan-out/append —
   * the AFTER-COMMIT notify path (doc-03 §Permission enforcement point / doc-10 §CharacterActor:
   * "After each commit, if `campaignId` is set, calls `StreamHost.get(campaignId).notify(...)`
   * so campaign sockets receive character events that originated on solo sockets"). The target
   * stream's own actor (`CampaignActor.handleNotify`, matching `StreamHandle.notify`'s
   * `(fromStream, events)` shape exactly so an adapter can delegate to it directly) decides
   * fan-out visibility; this port call itself never inspects `events`. */
  notify(toStream: string, fromStream: string, events: Event[]): Promise<void>;

  /**
   * THE GATEWAY (doc-03 §Permission enforcement point, verbatim: "for character-stream events
   * [the CampaignStream] calls `CharacterStream.append(events, actor)` by RPC, which re-checks
   * (owner/DM) against its own `meta`"). `actor` here is ALREADY the gateway-mapped actor
   * (`CampaignActor`'s design-ruling-1 role mapping — `dm` when the sender is this campaign's own
   * DM, `owner` when the sender is an established member acting on their OWN character), never
   * the raw campaign-socket actor — `forwardAppend` itself performs no further mapping, only the
   * cross-DO/in-process call and relaying `toStream`'s own `append` pipeline's outcome back
   * verbatim (that target pipeline re-checks permissions/schema/quota against ITS OWN meta
   * regardless of what the gateway already decided — defense in depth, doc-03's own words).
   * `toStream` is always a `char:<uuid>` id in this plan (nothing forwards to a `camp:` stream via
   * this method). */
  forwardAppend(toStream: string, events: Event[], actor: Actor): Promise<RpcAppendOutcome>;

  /**
   * Cross-stream MIRROR verification (doc-03 §Ordering and commit rules, verbatim: "the DO for
   * the campaign verifies the character event exists before accepting the mirror (RPC read), so
   * a half-join is not possible"). Reads `stream`'s (a `char:<uuid>` id) own committed events and
   * reports whether any one of them matches `match` (`{type, campaignId}` — see `RpcEventMatch`'s
   * doc comment for why `characterId` is expressed by `stream` itself, not a payload field here).
   * Deliberately narrower than a general query capability (`readStream` below already exists for
   * anything needing the raw events) — a mirror check only ever needs a yes/no answer to "does
   * this one specific event exist", and keeping that intent explicit in the port's own shape is
   * worth the second, more general method existing alongside it. */
  hasEvent(stream: string, match: RpcEventMatch): Promise<boolean>;

  /**
   * Reads `stream`'s own committed events starting at `fromSeq` (inclusive), at most `limit` —
   * the DM-subscribe CATCH-UP path (doc-03: `subscribe {stream, lastSeq?}`; `CampaignActor`'s
   * `handleSubscribe` calls this to page a member/DM's character-stream history through the
   * campaign socket the same way `StreamActor.hello`'s own catch-up pages a stream's OWN history —
   * see that method's doc comment for the paging shape this mirrors). Same signature as
   * `StreamHandle.read` (`ports/stream.ts`) by design, so a Node adapter's implementation is a
   * one-line delegation to `StreamHost.get(stream).read(fromSeq, limit)`. */
  readStream(stream: string, fromSeq: number, limit: number): Promise<Event[]>;

  /**
   * [fix round 1, Critical 4] The CURRENT (live) campaign link for a character stream — reads the
   * target `CharacterActor`'s own `meta.campaignId` DIRECTLY, never a scan of its event history.
   * Exists because `hasEvent` alone is a STALENESS hole for cross-stream mirror verification:
   * `hasEvent` only proves a matching event exists SOMEWHERE in history, which — events being
   * immutable — stays true forever once committed, even long after a character has since left (or
   * re-joined a different campaign). `CampaignActor.verifyCharacterMirror` uses this to check the
   * character's link RIGHT NOW, not merely "at some point in the past" (see that method's doc
   * comment for the full join-vs-left semantics, which are NOT symmetric). Returns `undefined` for
   * "not currently linked to any campaign" — including when no live target can be reached at all
   * (`NO_OP_RPC`'s default): this is a deliberate FAIL-CLOSED default, since `undefined` can never
   * equal a real campaign id, so an unconfigured/unreachable `Rpc` can never make a JOIN mirror
   * verify SUCCEED — only ever fail — and for LEFT it correctly reports "not (re)linked to this
   * campaign" (see `verifyCharacterMirror`), which is also the safe default there. */
  currentCampaignOf(stream: string): Promise<string | undefined>;
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
