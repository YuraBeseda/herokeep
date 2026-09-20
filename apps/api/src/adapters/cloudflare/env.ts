/**
 * The Cloudflare Worker's binding surface (`wrangler.jsonc`'s bindings, typed — ADR-014's
 * Cloudflare column). Every adapter file in this directory that needs a binding imports this
 * `Env` type rather than re-declaring its own ad-hoc shape, so `wrangler.jsonc` and this file
 * stay the one place bindings are named.
 *
 * `CHARACTER_STREAM`/`RATE_LIMITER` ARE typed against their real DO classes
 * (`DurableObjectNamespace<CharacterStreamDO>`/`<RateLimiterDO>`, Workers' RPC-aware generic) —
 * this is safe: task-8-report.md's bisection found the ACTUAL `tsc --noEmit` performance cliff to
 * be a class extending `DurableObject<Env>` having any member typed as the FULL
 * `DurableObjectState` alongside `@hk/protocol`'s large `Event` union (fixed inside
 * `character-stream.do.ts` itself — see that file's header comment), not this generic. Typing the
 * namespace precisely is what lets `test/adapters/cloudflare/character-stream-do.test.ts`'s
 * `runInDurableObject` infer a real `instance: CharacterStreamDO` instead of an opaque stub.
 */
import type { D1Database, DurableObjectNamespace, Fetcher } from '@cloudflare/workers-types';
import type { CampaignStreamDO } from './campaign-stream.do.ts';
import type { CharacterStreamDO } from './character-stream.do.ts';
import type { RateLimiterDO } from './rate-limiter.do.ts';

export interface Env {
  readonly ASSETS: Fetcher;
  readonly DB: D1Database;
  readonly CHARACTER_STREAM: DurableObjectNamespace<CharacterStreamDO>;
  /** [plan-9 Task 8] One DO instance per CAMPAIGN stream, addressed by `idFromName('camp:<uuid>')`
   * — the campaign half of `CHARACTER_STREAM`'s pattern (`campaign-stream.do.ts`). A separate DO
   * CLASS (not a shared one branching internally on the id prefix) because the two wrap different
   * concrete actor types (`CharacterActor` vs `CampaignActor`) with genuinely different RPC
   * surfaces (`appendForGateway`/`currentCampaignOf` are campaign-gateway-only concerns). */
  readonly CAMPAIGN_STREAM: DurableObjectNamespace<CampaignStreamDO>;
  readonly RATE_LIMITER: DurableObjectNamespace<RateLimiterDO>;
  /** `Config` port secrets (ADR-012 §Auth exact values) — Worker secrets (`wrangler secret put`)
   * in production, `.dev.vars` locally (this file's sibling `.dev.vars.example`). */
  readonly SESSION_PEPPER: string;
  readonly SALT_HMAC_KEY: string;
  readonly APP_ORIGIN: string;
}
