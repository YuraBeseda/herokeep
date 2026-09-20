/**
 * `CharacterStreamDO` — the Cloudflare half of `StreamHost`/`StreamHandle` (ADR-014's
 * `StreamHost`/`StreamStore`/`Connections` rows; task-8-brief obligations (c) and (d)). One DO
 * instance = one character stream, addressed by `worker.ts`'s `env.CHARACTER_STREAM
 * .idFromName(streamId)` (`streamId` is `char:<uuid>`, per `core/routes/characters.ts`). Wraps a
 * `CharacterActor` (Task 6's core class, unmodified) with this adapter's own `DoSqlStreamStore`
 * (obligation (c)) and `HibernatingConnections` (obligation (d)).
 *
 * ## Trust boundary (obligation (d)'s "document the trust boundary")
 *
 * `fetch()` below trusts three internal headers (`X-Hk-Internal-Stream-Id/User-Id/Role`) to name
 * WHO is connecting and WHICH stream, with NO signature/token of its own protecting them. This is
 * safe, and deliberately unlike `client-ip.ts`'s `X-Hk-Client-Ip` (which core's OWN Hono app must
 * defend against a forged value, because a client can reach `worker.ts`'s `fetch()` directly over
 * the public Internet): a Durable Object's `fetch()` is NEVER reachable from the public Internet
 * at all. The ONLY way to obtain a stub that can call it is holding the `env.CHARACTER_STREAM`
 * binding — which only `worker.ts`'s own Worker script has (bindings are not something a client
 * request can forge or inject; they are wired by `wrangler.jsonc` at deploy time and handed to the
 * Worker's `fetch(request, env, ctx)` by the runtime itself). A client cannot address this DO
 * directly by any URL, id, or header of its own choosing — Cloudflare's routing always puts the
 * Worker script in between. `worker.ts`'s `CloudflareWsUpgrade.upgrade()` is therefore the ONLY
 * possible caller of this `fetch()`, and it is called only AFTER core's `GET /api/characters/:id/ws`
 * route (`core/routes/characters.ts`) has already verified the session, ownership (against D1),
 * and `Origin` — the internal headers below carry the RESULT of that verification, not a claim
 * this DO has to re-check. (Contrast with the RPC methods further down, which take `streamId` as
 * a typed parameter for the same reason, minus any header/trust concern at all — Workers RPC
 * arguments aren't headers a client could ever supply either way.)
 *
 * ## A TypeScript-checker performance note (read before "simplifying" the lazy-init below)
 *
 * This class deliberately has NO explicit `constructor` and never gives `this.ctx` (the
 * `DurableObjectState` `DurableObject`'s own base class exposes) a WIDE static type anywhere near
 * `DoSqlStreamStore`/`CharacterActor`. Verified at execution time (task-8-report.md has the full
 * bisection): a class extending `DurableObject<Env>` that has ANY member — constructor parameter,
 * field, or function parameter reachable from one of its methods — typed as the FULL
 * `DurableObjectState` (not narrowed to just `.storage`, or cast away first) in the same program
 * as `@hk/protocol`'s large discriminated-union `Event` type sends `tsc --noEmit` into a hang
 * (multiple CPU-minutes, never observed to complete) — isolated by bisecting a minimal
 * reproduction down to exactly that combination. Narrowing immediately at the point of use
 * (`this.ctx.storage` — a plain property read, typed `DurableObjectStorage`, not `DurableObjectState`
 * — for the store; `this.ctx as unknown as HibernationHost` for the connections, which only ever
 * needs `HibernationHost`'s two methods) resolves it. This is why every helper below takes the
 * NARROWEST possible type (`DurableObjectStorage`, `HibernationHost`) rather than the full
 * `DurableObjectState`, and why construction is lazy (triggered from `fetch`/RPC methods, not a
 * constructor) rather than eager.
 */
import { DurableObject } from 'cloudflare:workers';
import type { DurableObjectStorage } from '@cloudflare/workers-types';
import type { Actor, Event } from '@hk/protocol';
import { CharacterActor } from '../../core/streams/character-actor.ts';
import { NO_OP_RPC } from '../../core/streams/stream-actor.ts';
import type { AppendResult } from '../../ports/stream.ts';
import type { Rpc, RpcAppendOutcome } from '../../ports/infra.ts';
import type { ConnAttachment } from '../../core/streams/stream-actor.ts';
import * as permissions from '../../core/permissions.ts';
import * as quotas from '../../core/quotas.ts';
import { WS_MESSAGE_BYTES_MAX } from '../../core/validate.ts';
import { DoSqlStreamStore } from './store.sqlite-do.ts';
import { HibernatingConnections, type HibernationHost } from './connections.do.ts';
import { INTERNAL_ROLE_HEADER, INTERNAL_STREAM_ID_HEADER, INTERNAL_USER_ID_HEADER } from './internal-headers.ts';
import type { Env } from './env.ts';

const WS_UPGRADE_RESPONSE_STATUS = 101;

/** [plan-9 Task 8] `CharacterStreamDO`'s own `Rpc` — the DO-to-DO half of ADR-014's `Rpc` row
 * ("a campaign stream's DO calling a character stream's DO on Cloudflare"). `CharacterActor` only
 * ever calls `this.rpc.notify` (its after-commit campaign-notify hook, `character-actor.ts`'s
 * `notifyCampaignIfLinked`) — `forwardAppend`/`hasEvent`/`readStream`/`currentCampaignOf` are
 * `CampaignActor`-only concerns a `CharacterActor` never reaches, so those four stay exactly
 * `NO_OP_RPC`'s fail-closed shape (spread verbatim, not hand-copied — see that export's own doc
 * comment). `notify` reaches the target `CampaignStreamDO` via `env.CAMPAIGN_STREAM`, a binding
 * only THIS Worker's own script (and, by extension, its own DOs) holds — the SAME trust-boundary
 * argument this file's header comment already makes for `worker.ts`'s calls into `fetch()`/the
 * RPC methods below applies transitively here: a client cannot reach `CharacterStreamDO` at all,
 * so it certainly cannot reach whatever internal bindings this DO chooses to call out with. */
interface CampaignStreamNotifyStub {
  notify(streamId: string, fromStream: string, events: Event[]): Promise<void>;
}

function buildRpc(env: Env): Rpc {
  return {
    ...NO_OP_RPC,
    notify: async (toStream, fromStream, events) => {
      const stub: CampaignStreamNotifyStub = env.CAMPAIGN_STREAM.get(env.CAMPAIGN_STREAM.idFromName(toStream));
      await stub.notify(toStream, fromStream, events);
    },
  };
}

/** `meta` key backing the generation guard (round-2 fix, see `deleteAll`'s doc comment). */
const GEN_META_KEY = 'gen';

/** `ConnAttachment` plus the generation this connection was accepted under — round-2 fix. A
 * separate, adapter-local type (not folded into core's `ConnAttachment`, which Node's identical
 * `WsConnections`/`StreamActor` also use and has no need for this at all — see `deleteAll`'s doc
 * comment for why ONLY Cloudflare needs a generation guard). Structurally a `ConnAttachment`
 * (extends it), so passing one to `Connections<ConnAttachment>.accept`/`.send`/etc, which only
 * know about the narrower type, is unproblematic. */
interface StampedAttachment extends ConnAttachment {
  readonly gen: number;
}

/** Narrow constructors — see this file's "TypeScript-checker performance note" for why each
 * takes the narrowest possible type instead of the full `DurableObjectState`. */
function buildStore(storage: DurableObjectStorage, streamId: string): DoSqlStreamStore {
  return new DoSqlStreamStore(storage, streamId);
}

function buildConnections(host: HibernationHost): HibernatingConnections<ConnAttachment> {
  return new HibernatingConnections<ConnAttachment>(host);
}

function buildActor(
  store: DoSqlStreamStore,
  connections: HibernatingConnections<ConnAttachment>,
  streamId: string,
  rpc: Rpc,
): CharacterActor {
  return new CharacterActor({ store, connections, quotas, permissions, streamId, rpc });
}

export class CharacterStreamDO extends DurableObject<Env> {
  // Typed `unknown` (not `DoSqlStreamStore`/`HibernatingConnections<ConnAttachment>` directly) —
  // this file's header comment explains why a NAMED FIELD of one of those types on a class
  // extending `DurableObject` is itself enough to trigger the same checker hang; casting back to
  // the real type happens only at each accessor's return statement, in a function whose OWN
  // parameter/return types are the narrow, already-resolved real types.
  private storeCache: unknown;
  private connectionsCache: unknown;
  private actorPromise: Promise<CharacterActor> | undefined;

  private lazyStore(streamId: string): DoSqlStreamStore {
    this.storeCache ??= buildStore(this.ctx.storage, streamId);
    return this.storeCache as DoSqlStreamStore;
  }

  /** Reads the CURRENT generation (round-2 fix, see `deleteAll`'s doc comment) from whichever
   * store `lazyStore` has cached for this DO instance — every call site below calls this only
   * AFTER `lazyStore`/`ensureActor` has already run for the relevant `streamId`, so `storeCache`
   * is always populated by the time this reads it. `0` (never bumped — a stream that has never
   * been through a hard delete) when no `gen` meta key has ever been written, matching every other
   * meta-default-to-zero convention in this codebase (`readMeta`/`getCharacterMeta`, etc). */
  private async readGen(): Promise<number> {
    const store = this.storeCache as DoSqlStreamStore | undefined;
    if (!store) return 0;
    const raw = await store.getMeta(GEN_META_KEY);
    return raw ? Number(raw) : 0;
  }

  private lazyConnections(): HibernatingConnections<ConnAttachment> {
    // `this.ctx` (inherited from `DurableObject<Env>`) is the FULL `DurableObjectState` — cast
    // immediately to the narrow `HibernationHost` shape `HibernatingConnections` actually needs
    // (`acceptWebSocket`/`getWebSockets`), per this file's header comment, rather than letting the
    // wide type flow into `buildConnections`'s parameter position. ESLint flags the `as unknown as
    // HibernationHost` cast as unnecessary — TRUE for pure type-correctness (DurableObjectState
    // structurally satisfies HibernationHost either way), but it exists for a *compiler
    // performance* reason this rule doesn't model, not a type error; disabled with the reason
    // recorded rather than removed.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- see comment above
    this.connectionsCache ??= buildConnections(this.ctx as unknown as HibernationHost);
    return this.connectionsCache as HibernatingConnections<ConnAttachment>;
  }

  /**
   * Lazily builds (and memoizes for this DO instance's in-memory lifetime) the `CharacterActor`.
   * `streamIdHint`, when given (every call from `fetch()`/the RPC methods below DOES give one —
   * see each call site), is PERSISTED to this DO's own storage so a LATER wake-up after
   * hibernation — `webSocketMessage`/`webSocketClose`, which the runtime calls directly with no
   * accompanying `fetch()` to re-supply a hint — can recover it. A hint is trusted over a stale
   * persisted value (defensive: `idFromName(streamId)` guarantees one DO instance is only ever
   * addressed by one streamId across its whole lifetime in correct operation, so the two should
   * never actually disagree; re-persisting on every hinted call is cheap and keeps this method's
   * contract simple rather than asserting-and-throwing on a divergence that should be unreachable).
   */
  private async ensureActor(streamIdHint?: string): Promise<CharacterActor> {
    this.actorPromise ??= (async () => {
      const streamId = streamIdHint ?? (await this.ctx.storage.get<string>('stream_id'));
      if (!streamId) {
        throw new Error('CharacterStreamDO: streamId unknown (no hint given and none persisted yet)');
      }
      if (streamIdHint) await this.ctx.storage.put('stream_id', streamIdHint);
      return buildActor(this.lazyStore(streamId), this.lazyConnections(), streamId, buildRpc(this.env));
    })();
    return this.actorPromise;
  }

  /**
   * The WS-upgrade handoff (task-8-brief obligation (d)'s "worker-side verification already done
   * by core BEFORE the handoff"). Not RPC — a WebSocket upgrade needs a real `fetch()` returning a
   * `Response` constructed with `{status: 101, webSocket: client}`, which Workers RPC has no
   * equivalent for (see this file's header comment for why the OTHER operations below — append,
   * read, head, notify, deleteAll — are plain RPC methods instead, and only this one is `fetch`).
   */
  override async fetch(request: Request): Promise<Response> {
    const streamId = request.headers.get(INTERNAL_STREAM_ID_HEADER);
    const userId = request.headers.get(INTERNAL_USER_ID_HEADER);
    const role = request.headers.get(INTERNAL_ROLE_HEADER);
    if (!streamId || !userId || role !== 'owner') {
      // Only ever reachable if `worker.ts` itself has a bug (see this file's header comment: no
      // client request can reach this `fetch()` at all, let alone with these headers missing) —
      // answered defensively rather than assumed impossible.
      return new Response('Bad internal request', { status: 400 });
    }
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Expected Upgrade: websocket', { status: 426 });
    }

    await this.ensureActor(streamId);
    // Round-2 fix: stamp the CURRENT generation onto the attachment — `webSocketMessage` below
    // refuses any message whose attachment generation doesn't match the LATEST one (see
    // `deleteAll`'s doc comment). A stream that has never been deleted stamps `0` and never
    // notices this mechanism exists.
    const gen = await this.readGen();

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    const attachment: StampedAttachment = { userId, role: 'owner', subs: [streamId], gen };
    this.lazyConnections().accept(server, attachment);

    return new Response(null, { status: WS_UPGRADE_RESPONSE_STATUS, webSocket: client });
  }

  /** Hibernation API message handler (obligation (d)) — forwards to the actor exactly like
   * Node's `ws.on('message', ...)` wiring (`adapters/node/server.ts`) forwards to
   * `actor.handleMessage`/`handleBinaryMessage`. [plan-9 Task 8] A binary frame now routes to
   * `actor.handleBinaryMessage` (doc-07 §Blob transfer protocol RECEIVE side — Task 7 shipped only
   * the SEND side, `Connections.sendBinary`) — a virtual no-op on a plain `CharacterActor`
   * (`CampaignActor` overrides it for the real relay), same "call it uniformly, let the actor
   * decide" shape Node's `server.ts` now uses too. */
  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    // Whole-branch review finding 1: the Hibernation API has no `ws`-style `maxPayload` option of
    // its own (Node's `server.ts` enforces `core/validate.ts`'s `WS_MESSAGE_BYTES_MAX` at the
    // library layer instead) — this is the Cloudflare-side equivalent, a manual length guard
    // BEFORE any JSON parse/actor dispatch runs, so an oversized frame never reaches the actor at
    // all. Closed 1009 ("message too big"), matching Node's `ws` behavior for the same condition
    // exactly (`server.ts`'s doc comment on `maxPayload`) — enforced identically for a binary
    // `blob.chunk` frame (doc-03's WS message size limit applies to both frame kinds).
    const byteLength = typeof message === 'string' ? new TextEncoder().encode(message).length : message.byteLength;
    if (byteLength > WS_MESSAGE_BYTES_MAX) {
      ws.close(1009, 'message too large');
      return;
    }

    const actor = await this.ensureActor();
    // Round-2 fix (whole-branch re-review, finding-3 regression): unlike Node's `server.ts`, which
    // binds `runtime`/`actor` ONCE per connection via a closure captured at accept time (see
    // `stream-host.ts`'s `deleteAll` doc comment), THIS method resolves the actor FRESH on every
    // single message via `ensureActor()` above — memoized only until `deleteAll` (below) resets
    // that memo so a recreate-with-the-same-id gets a working (non-`closed`) actor. That reset is
    // exactly what makes a plain `closed`-flag check insufficient here: a message from a socket
    // that was accepted BEFORE a hard delete, arriving in the narrow window after `deleteAll` has
    // already reset the actor/store memo but the runtime hasn't yet delivered this socket's
    // `close(1001)` frame, would otherwise reach a brand-new, non-closed actor and silently
    // resurrect the "deleted" stream. The generation guard closes that window regardless of
    // delivery ordering: every accept stamps the CURRENT generation onto its `StampedAttachment`
    // (`fetch()` above); `deleteAll` bumps the persisted generation the moment it wipes the store;
    // a message whose attachment generation doesn't match the CURRENT persisted one is refused
    // outright, never reaching `actor.handleMessage`/`handleBinaryMessage`. [plan-9 Task 8] Moved
    // ABOVE the text/binary branch below (was only ever checked on the text path before this task,
    // since binary frames were dropped outright) — a binary `blob.chunk` on a stale generation
    // must be refused exactly like a stale text frame, not silently forwarded to a resurrected
    // actor.
    const attachment = ws.deserializeAttachment() as Partial<StampedAttachment> | null;
    const currentGen = await this.readGen();
    if ((attachment?.gen ?? 0) !== currentGen) {
      ws.close(1001, 'stream_closed');
      return;
    }

    if (typeof message !== 'string') {
      actor.handleBinaryMessage(ws, new Uint8Array(message));
      return;
    }
    await actor.handleMessage(ws, safeJsonParse(message));
  }

  /** Hibernation API close handler. `ws.close()` is Cloudflare's documented pattern for an
   * abrupt/non-clean close (`!wasClean`) — the Hibernation API's own bookkeeping (`getWebSockets`
   * excluding this socket going forward) needs no help from this class beyond that (see
   * `connections.do.ts`'s header comment: unlike Node's `WsConnections`, there is no separate
   * `Map`/`Set` here to prune).
   *
   * [plan-9 Task 8] Also calls the virtual `onConnectionClosed` hook (`stream-actor.ts`) — a
   * no-op on a plain `CharacterActor`, a real presence broadcast + blob-relay cleanup on a
   * `CampaignActor` (this DO never wraps one, but the call costs nothing and keeps both DOs'
   * `webSocketClose` symmetric). Fire-and-forget (`void`): the Hibernation API's own
   * `webSocketClose` signature is synchronous, matching the existing `!wasClean` branch above —
   * `connections.do.ts`'s header comment already establishes that `ctx.getWebSockets()` excludes
   * a closing socket automatically, satisfying the "call AFTER removal" ordering
   * `CampaignActor.onConnectionClosed`'s own doc comment requires without this class needing to
   * track removal itself. */
  override webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean): void {
    if (!wasClean) ws.close(code, reason);
    // [fix round 1, plan-9 Task 10 review] Best-effort, matching `campaigns.ts`'s
    // `closeConnectionsForUser`/rollback calls' existing `.catch(() => undefined)` stance: the
    // socket is already gone by the time this runs, so a rejection (e.g. DO storage erroring
    // mid-eviction) has nothing to report to and must never surface as an unhandled rejection.
    void this.ensureActor()
      .then((actor) => actor.onConnectionClosed(ws))
      .catch(() => undefined);
  }

  // --- StreamHandle, as RPC methods (this file's header comment explains why these are RPC,
  // not `fetch`) — `worker.ts`'s `CloudflareStreamHost.get(streamId)` calls these directly on the
  // stub. Each takes `streamId` explicitly (rather than relying on a persisted hint) because a
  // hard-delete (`deleteAll`) must work even for a stream whose DO was NEVER addressed by a `fetch`
  // upgrade before (e.g. a character created via `POST /api/characters` and deleted again without
  // ever opening a socket) — there would be no persisted `stream_id` for `ensureActor()` to fall
  // back to otherwise.
  //
  // Parameters/returns below are deliberately typed `unknown` rather than the real
  // `Event[]`/`Actor` types (cast to/from those real types just inside each method body): the
  // same checker-performance concern this file's header comment documents for `DurableObjectState`
  // applies to any large `@hk/protocol`-derived type appearing directly in a public method
  // signature of a class extending `DurableObject` — verified empirically during the same
  // bisection. `worker.ts`'s `CharacterStreamStub` interface is what actually gives call sites
  // their real, precise types; this class's own signatures were never load-bearing for that.

  async append(streamId: string, events: unknown, actor: unknown): Promise<AppendResult> {
    const characterActor = await this.ensureActor(streamId);
    const outcome = await characterActor.append(events as Event[], actor as Actor);
    const seqs = outcome.acked.map((a) => a.seq);
    return { firstSeq: seqs.length > 0 ? Math.min(...seqs) : 0, lastSeq: seqs.length > 0 ? Math.max(...seqs) : 0 };
  }

  /**
   * [plan-9 Task 8] `Rpc.forwardAppend`'s Cloudflare target — THE GATEWAY's cross-DO call
   * (`campaign-stream.do.ts`'s own `Rpc` calls this, never a client). Deliberately a SEPARATE RPC
   * method from `append` above, not a reuse of it: `append`'s return shape is the narrower
   * `StreamHandle`-port `AppendResult` (`{firstSeq, lastSeq}`, the min/max of whatever committed),
   * which cannot express doc-03's "acks/rejects relayed to the campaign socket" requirement — the
   * gateway needs the FULL per-event `{acked, rejected}` outcome (`RpcAppendOutcome`) to relay
   * individual results back. `CharacterActor.append`'s own return shape is already structurally
   * identical to `RpcAppendOutcome` (both files' doc comments note this intentional sharing), so
   * no translation is needed beyond the `unknown`-typed signature this file's header comment
   * explains (the same `tsc` performance concern as every other RPC method here).
   */
  async appendForGateway(streamId: string, events: unknown, actor: unknown): Promise<RpcAppendOutcome> {
    const characterActor = await this.ensureActor(streamId);
    return characterActor.append(events as Event[], actor as Actor);
  }

  /** [plan-9 Task 8] `Rpc.currentCampaignOf`'s Cloudflare target — reads this character's own LIVE
   * `meta.campaignId` directly (never a history scan), same fail-closed-via-`undefined` contract
   * `ports/infra.ts`'s `Rpc.currentCampaignOf` documents. Called only by a
   * `CampaignStreamDO`'s own `Rpc` (`campaign-stream.do.ts`), via the same DO-to-DO binding
   * argument this file's header comment makes for every other RPC method here. */
  async currentCampaignOf(streamId: string): Promise<string | undefined> {
    const characterActor = await this.ensureActor(streamId);
    const meta = await characterActor.getCharacterMeta();
    return meta.campaignId;
  }

  async read(streamId: string, fromSeq: number, limit: number): Promise<unknown> {
    await this.ensureActor(streamId);
    return this.lazyStore(streamId).read(fromSeq, limit);
  }

  async head(streamId: string): Promise<number> {
    await this.ensureActor(streamId);
    return this.lazyStore(streamId).head();
  }

  /** `StreamHandle.notify` — unused in Phase 2 (no `CampaignActor`/`Rpc` caller yet), implemented
   * for contract completeness exactly like Node's `NodeStreamHost.get(id).notify` (same plain
   * fan-out shape, same doc comment there for the full rationale). */
  async notify(streamId: string, fromStream: string, events: unknown): Promise<void> {
    await this.ensureActor(streamId);
    const eventList = events as Event[];
    if (eventList.length === 0) return;
    const connections = this.lazyConnections();
    for (const conn of connections.all()) {
      connections.send(conn, { t: 'events', stream: fromStream, events: eventList });
    }
  }

  /**
   * Round-2 fix (whole-branch re-review): the pre-fix version of this method wiped the store and
   * closed live sockets (finding 3), but left `this.actorPromise` memoized to the now-PERMANENTLY-
   * `closed` actor (`StreamActor.closed` never resets, by design) FOREVER — a later recreate with
   * the SAME character id (`POST /api/characters` succeeds once the D1 row is gone: no more id
   * collision, per `core/routes/characters.ts`'s create route) reaches this SAME DO instance
   * (`idFromName(streamId)` is deterministic on the streamId string, unchanged by a recreate) and
   * got a stream that was BRICKED forever — every append rejected `stream_closed` with no way out.
   *
   * Fixed by evicting BOTH memoized caches (`actorPromise`, `storeCache`) after the wipe, so the
   * NEXT `ensureActor(streamId)` call (from a fresh WS upgrade's `fetch()`, or another RPC call)
   * rebuilds a genuinely fresh `CharacterActor`/`DoSqlStreamStore` pair — `closed` starts `false`
   * again, and the fresh store's constructor re-runs `ensureSchema` (the wipe dropped the tables
   * `storage.deleteAll()` also owns, not just their rows).
   *
   * This reset is safe for the ORIGINAL finding-3 protection (a live socket can't resurrect an
   * orphan stream) for two independent reasons, one per Hibernation-API entry point:
   *   - Every connection on the stream was ALREADY closed (1001, `stream_closed`) by
   *     `actor.deleteAll()` just above, via `Connections.all()`/`.close()` — a well-behaved client
   *     sees the close and never sends another frame on that socket again.
   *   - For the residual, narrower race this alone doesn't cover — a message already in flight
   *     when `close()` ran, reaching `webSocketMessage` AFTER the cache reset below — the
   *     generation guard (`webSocketMessage`'s own doc comment) refuses it: the generation is
   *     bumped here, durably, BEFORE `stream_id` is restored (so even the narrower window where a
   *     stray call could race the `stream_id` restore below fails CLOSED: `ensureActor()` throws
   *     on a still-missing `stream_id` rather than ever reaching a mismatched-generation actor).
   *     Not provably 100%-fenced against every conceivable Workers-runtime scheduling order (the
   *     runtime's exact event-dispatch internals aren't public) — but every failure mode identified
   *     during this fix fails toward REJECTING a stale message, never toward re-committing one.
   */
  async deleteAll(streamId: string): Promise<void> {
    const actor = await this.ensureActor(streamId);
    const genBeforeWipe = await this.readGen();

    await actor.deleteAll(); // closes every live connection (1001/stream_closed) + wipes storage

    this.actorPromise = undefined;
    this.storeCache = undefined;

    // Rebuild a fresh store (its constructor re-runs `ensureSchema` — the wipe above dropped the
    // tables too) and bump the generation FIRST (synchronous under the hood — `DoSqlStreamStore`'s
    // `setMeta` is a plain `storage.sql.exec` call, no real `await`), THEN restore the persisted
    // `stream_id` hint LAST (a genuine async `storage.put`) — so by the time any hint-less
    // `ensureActor()` call could possibly succeed again, the bumped generation is already durably
    // in place for it to compare against.
    const freshStore = this.lazyStore(streamId);
    await freshStore.setMeta(GEN_META_KEY, String(genBeforeWipe + 1));
    await this.ctx.storage.put('stream_id', streamId);
  }

  /**
   * `MaintenanceStreams.getStreamUsage` (`ports/stream.ts`), Cloudflare's half — task-10-brief's
   * "a minimal internal endpoint/RPC method to `CharacterStreamDO`" for the daily maintenance
   * job's quota-sync step. Plain RPC, same trust-boundary reasoning as `append`/`read`/`head`/
   * `notify`/`deleteAll` above (this file's header comment): only `worker.ts`, which alone holds
   * the `CHARACTER_STREAM` binding, can ever obtain a stub to call this — there is no separate
   * header/token to check here for the same reason there isn't one on those methods either.
   */
  async getUsage(streamId: string): Promise<{ bytesUsed: number; eventCount: number }> {
    await this.ensureActor(streamId);
    const store = this.lazyStore(streamId);
    const [bytesRaw, countRaw] = await Promise.all([store.getMeta('bytes_used'), store.getMeta('event_count')]);
    return { bytesUsed: bytesRaw ? Number(bytesRaw) : 0, eventCount: countRaw ? Number(countRaw) : 0 };
  }

  /** `StreamHandle.closeConnectionsForUser` — contract completeness only (plan-9 Task 9's real
   * caller is `campaign-stream.do.ts`'s own copy; nothing in this plan bye-closes a character-
   * stream socket), same "implemented for port-shape completeness, unused in practice" stance as
   * `notify` above. Delegates to `CharacterActor.byeCloseUser` (inherited from `StreamActor`,
   * `stream-actor.ts`) — harmless if `userId` has no live connection on this stream. */
  async closeConnectionsForUser(streamId: string, userId: string, reason: string): Promise<void> {
    const actor = await this.ensureActor(streamId);
    actor.byeCloseUser(userId, reason);
  }
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null; // fails `parseClientMessage`'s discriminated-union check -> 1008 close, by design
    // (matches `adapters/node/server.ts`'s `safeJsonParse` exactly).
  }
}
