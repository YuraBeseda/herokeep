/**
 * The Cloudflare Worker's entrypoint (ADR-014 §Adapter A; doc-10 §cloudflare; task-8-brief).
 * `fetch()` wires every Cloudflare port implementation together and hands them to `createApp` —
 * the SAME composition-root role Node's `server.ts`/`startNodeServer` plays for that adapter, just
 * re-run per request rather than once at process boot (a Worker has no persistent "boot": every
 * `fetch` gets a fresh `env`/`ctx`, though the same isolate/module scope IS commonly reused across
 * requests — nothing here relies on that reuse for correctness, only for the trivial cost of
 * re-constructing a few thin wrapper objects per request).
 *
 * doc-10 §cloudflare's shape: "`worker.ts` fetch(): static assets + createApp(cfPorts);
 * scheduled(): daily job" — `createApp` (Task 6, `core/app.ts`) ALREADY owns the "static assets
 * with SPA fallback after every `/api/*` route" routing decision (its own doc comment: "a Node
 * adapter's `serve-static` and a Cloudflare adapter's Workers-assets binding both get SPA fallback
 * for free from implementing `fetch` once"). This file's job is therefore exactly Node's
 * `server.ts`'s job: stamp the trusted client IP, wire every port, call `createApp(ports).fetch`.
 * `wrangler.jsonc`'s `assets.run_worker_first: true` is what makes that routing decision actually
 * reach this file for every path, static or not — see that file's comment for why.
 */
import type { Actor, Event } from '@hk/protocol';
import { createApp } from '../../core/app.ts';
import type { AppPorts } from '../../core/app.ts';
import { runDailyMaintenance } from '../../core/maintenance.ts';
import { CLIENT_IP_HEADER } from '../../core/http/client-ip.ts';
import type { RateLimit, RateLimitResult, StaticAssets, WsUpgrade, WsUpgradeContext } from '../../ports/infra.ts';
import type { AppendResult, MaintenanceStreams, StreamHandle, StreamHost, StreamUsage } from '../../ports/stream.ts';
import { BindingsConfig, assertConfigured } from './config.bindings.ts';
import { openAccountsDb } from './db.d1.ts';
import {
  CharacterStreamDO,
  INTERNAL_ROLE_HEADER,
  INTERNAL_STREAM_ID_HEADER,
  INTERNAL_USER_ID_HEADER,
} from './character-stream.do.ts';
import { RateLimiterDO } from './rate-limiter.do.ts';
import type { Env } from './env.ts';

// `wrangler.jsonc`'s `durable_objects.bindings[].class_name` (`CharacterStreamDO`/`RateLimiterDO`)
// must be exported from THIS module — the one `main` points at — for the Workers runtime to bind
// them; re-exported here rather than requiring a separate entrypoint file per class.
export { CharacterStreamDO, RateLimiterDO };

/**
 * Hand-written mirrors of `CharacterStreamDO`'s/`RateLimiterDO`'s RPC method surfaces, used to
 * type a `DurableObjectStub` obtained from the PLAIN `DurableObjectNamespace` (`env.ts`'s doc
 * comment explains why the namespace itself is untyped-generic — a real TS performance cliff,
 * not a style preference). Each stub call below is cast through these narrow interfaces rather
 * than through workers-types' own RPC-stub-mirroring generic.
 */
interface CharacterStreamStub {
  fetch(request: Request): Promise<Response>;
  append(streamId: string, events: Event[], actor: Actor): Promise<AppendResult>;
  read(streamId: string, fromSeq: number, limit: number): Promise<Event[]>;
  head(streamId: string): Promise<number>;
  notify(streamId: string, fromStream: string, events: Event[]): Promise<void>;
  deleteAll(streamId: string): Promise<void>;
  getUsage(streamId: string): Promise<StreamUsage>;
}

interface RateLimiterStub {
  check(limit: number, windowMs: number): Promise<RateLimitResult>;
}

/** `Cloudflare's edge sets this itself; a client-supplied one is overwritten at the edge, so it's
 * trustworthy there` — `core/http/client-ip.ts`'s own doc comment, naming exactly this header as
 * the Cloudflare adapter's obligation. Task-8-brief obligation (a): overwrite (not merge/append)
 * whatever `X-Hk-Client-Ip` a client sent, on EVERY inbound request — both the ordinary `/api/*`
 * path and the WS-upgrade path (which, on Cloudflare, "arrives through fetch" too — this file's
 * header comment / obligation (a)'s own text — so one stamping point covers both, unlike Node's
 * two separate listeners for ordinary requests vs `'upgrade'` events). */
function stampClientIp(request: Request): Request {
  const headers = new Headers(request.headers);
  headers.set(CLIENT_IP_HEADER, request.headers.get('cf-connecting-ip') ?? 'unknown');
  return new Request(request, { headers });
}

/** `WsUpgrade` port (ADR-014; `ports/infra.ts`'s doc comment names this exact shape for
 * Cloudflare): forwards the ALREADY-VERIFIED upgrade (`core/routes/characters.ts`'s `GET
 * /:id/ws` route calls this only after session + ownership + `Origin` all passed) to the target
 * character's DO via an INTERNAL request carrying the verified `{streamId, userId, role}` as
 * headers the DO trusts — see `character-stream.do.ts`'s header comment for the full trust-
 * boundary argument (a client can never reach a DO's `fetch()` directly; only this Worker, which
 * holds the `CHARACTER_STREAM` binding, can). */
class CloudflareWsUpgrade implements WsUpgrade {
  private readonly namespace: Env['CHARACTER_STREAM'];

  constructor(namespace: Env['CHARACTER_STREAM']) {
    this.namespace = namespace;
  }

  upgrade(request: Request, ctx: WsUpgradeContext): Promise<Response> {
    const stub = this.namespace.get(this.namespace.idFromName(ctx.streamId)) as unknown as CharacterStreamStub;
    const internalHeaders = new Headers(request.headers);
    internalHeaders.set(INTERNAL_STREAM_ID_HEADER, ctx.streamId);
    internalHeaders.set(INTERNAL_USER_ID_HEADER, ctx.userId);
    internalHeaders.set(INTERNAL_ROLE_HEADER, ctx.role);
    const internalRequest = new Request(request.url, { method: request.method, headers: internalHeaders });
    return stub.fetch(internalRequest);
  }
}

/** `StreamHost` port: each `StreamHandle` method is a direct Workers RPC call on the DO stub
 * (`character-stream.do.ts`'s header comment explains why RPC, not `fetch`, for these) —
 * `streamId` is passed explicitly on every call rather than relying on the DO's own persisted
 * hint, matching that file's `append`/`read`/`head`/`notify`/`deleteAll` RPC method signatures. */
class CloudflareStreamHost implements StreamHost {
  private readonly namespace: Env['CHARACTER_STREAM'];

  constructor(namespace: Env['CHARACTER_STREAM']) {
    this.namespace = namespace;
  }

  get(streamId: string): StreamHandle {
    const stub = this.namespace.get(this.namespace.idFromName(streamId)) as unknown as CharacterStreamStub;
    return {
      append: (events, actor): Promise<AppendResult> => stub.append(streamId, events, actor),
      read: (fromSeq, limit) => stub.read(streamId, fromSeq, limit),
      head: () => stub.head(streamId),
      notify: (fromStream, events) => stub.notify(streamId, fromStream, events),
      deleteAll: () => stub.deleteAll(streamId),
    };
  }
}

/** `RateLimit` port: one `RateLimiterDO` instance per SCOPE (`rate-limiter.do.ts`'s header
 * comment explains why `idFromName(scope)` rather than one global DO or an in-DO scope map). */
class CloudflareRateLimit implements RateLimit {
  private readonly namespace: Env['RATE_LIMITER'];

  constructor(namespace: Env['RATE_LIMITER']) {
    this.namespace = namespace;
  }

  check(scope: string, limit: number, windowMs: number): Promise<RateLimitResult> {
    const stub = this.namespace.get(this.namespace.idFromName(scope)) as unknown as RateLimiterStub;
    return stub.check(limit, windowMs);
  }
}

/** `MaintenanceStreams` port (`ports/stream.ts`), Cloudflare's half: one internal RPC call
 * (`getUsage`) per `CharacterStreamDO` instance — see that method's doc comment on
 * `character-stream.do.ts` for the trust-boundary argument. Deliberately does NOT implement
 * `listStreamIds` (`ports/stream.ts`'s doc comment on that method: no API exists to enumerate
 * Durable Object instances) — `runDailyMaintenance` treats the missing method as "orphan check's
 * stream-side half is not checkable on this adapter" rather than a false zero. */
class CloudflareMaintenanceStreams implements MaintenanceStreams {
  private readonly namespace: Env['CHARACTER_STREAM'];

  constructor(namespace: Env['CHARACTER_STREAM']) {
    this.namespace = namespace;
  }

  getStreamUsage(streamId: string): Promise<StreamUsage> {
    const stub = this.namespace.get(this.namespace.idFromName(streamId)) as unknown as CharacterStreamStub;
    return stub.getUsage(streamId);
  }
}

/** `StaticAssets` port over the Workers assets binding (ADR-014's Cloudflare `StaticAssets` row).
 * `env.ASSETS.fetch` answers a plain 404 `Response` on a miss (not `null`) — translated to `null`
 * here so `core/app.ts`'s shared fallback logic (`ports/infra.ts`'s `StaticAssets.fetch` doc
 * comment: "`null` ... falls through to SPA `index.html` handling AT THE CALL SITE") behaves
 * identically to Node's `NodeStaticAssets`, which already returns `null` on its own miss. */
class CloudflareStaticAssets implements StaticAssets {
  private readonly assets: Env['ASSETS'];

  constructor(assets: Env['ASSETS']) {
    this.assets = assets;
  }

  async fetch(request: Request): Promise<Response | null> {
    const response = await this.assets.fetch(request);
    return response.status === 404 ? null : response;
  }
}

function buildPorts(env: Env): AppPorts {
  return {
    db: openAccountsDb(env.DB),
    config: new BindingsConfig(env),
    rateLimit: new CloudflareRateLimit(env.RATE_LIMITER),
    streamHost: new CloudflareStreamHost(env.CHARACTER_STREAM),
    wsUpgrade: new CloudflareWsUpgrade(env.CHARACTER_STREAM),
    staticAssets: new CloudflareStaticAssets(env.ASSETS),
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Fail fast (mirrors Node's `assertConfigured` call at the top of `startNodeServer` — see
    // `config.bindings.ts`'s doc comment for why a Worker checks this per-request instead of
    // once at boot: there is no separate boot step to check it at).
    assertConfigured(new BindingsConfig(env));

    const stamped = stampClientIp(request);
    const app = createApp(buildPorts(env));
    return app.fetch(stamped);
  },

  /**
   * Daily maintenance (doc-10 §Daily maintenance: "Cloudflare: Cron Trigger `0 3 * * *`" —
   * `wrangler.jsonc`'s `triggers.crons`). Task 8 left this as a documented no-op hook pending
   * `core/maintenance.ts`; Task 10 fills it in: `assertConfigured` (fail fast, mirroring
   * `fetch()` above), then `openAccountsDb(env.DB)` + `CloudflareMaintenanceStreams` wired
   * through `runDailyMaintenance` exactly like `fetch()` wires `buildPorts(env)`.
   */
  scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): void {
    ctx.waitUntil(runScheduledMaintenance(env));
  },
};

async function runScheduledMaintenance(env: Env): Promise<void> {
  assertConfigured(new BindingsConfig(env));
  const db = openAccountsDb(env.DB);
  const streams = new CloudflareMaintenanceStreams(env.CHARACTER_STREAM);
  const report = await runDailyMaintenance({ db, streams });
  // Security of logs (Global Constraints): no request bodies, no usernames — `MaintenanceReport`
  // is exactly "counters and error classes only", safe to log in full.
  console.log('herokeep daily maintenance', JSON.stringify(report));
}
