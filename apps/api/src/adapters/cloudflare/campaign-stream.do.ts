/**
 * `CampaignStreamDO` — the Cloudflare half of `StreamHost`/`StreamHandle` for a CAMPAIGN stream
 * (ADR-014's `StreamHost`/`StreamStore`/`Connections` rows; plan-9 Task 8, obligation 5). One DO
 * instance = one campaign stream, addressed by `worker.ts`'s `env.CAMPAIGN_STREAM
 * .idFromName(streamId)` (`streamId` is `camp:<uuid>`, per `core/routes/campaigns.ts`). Wraps a
 * `CampaignActor` (plan-9 Task 5's core class, unmodified) with the SAME `DoSqlStreamStore`
 * (D1-adjacent SQLite-in-DO storage — reused verbatim, `store.sqlite-do.ts` has no
 * character-specific assumptions baked in, per that file's own header comment) and
 * `HibernatingConnections` `character-stream.do.ts` already uses.
 *
 * This file follows `character-stream.do.ts`'s hibernation-safe patterns EXACTLY (lazy
 * construction, no explicit constructor, narrow `unknown`-typed caches, the generation guard, the
 * `getUsage` RPC method) — see that file's header comment for the full "TypeScript-checker
 * performance note" and generation-guard rationale, both of which apply identically here and are
 * not re-derived in this file's comments.
 *
 * ## Trust boundary
 *
 * Identical argument to `character-stream.do.ts`'s own header comment: a Durable Object's
 * `fetch()`/RPC surface is never reachable from the public Internet — only `worker.ts`'s own
 * script (and, transitively, its own DOs calling each other via their `env` bindings) can ever
 * obtain a stub. `fetch()` below trusts the SAME internal headers
 * (`X-Hk-Internal-Stream-Id/User-Id/Role/Display-Name`, `internal-headers.ts`) that
 * `core/routes/campaigns.ts`'s `GET /:id/ws` route has already verified (session + membership +
 * `Origin`) before `worker.ts`'s `CloudflareWsUpgrade.upgrade()` ever calls this `fetch()`.
 *
 * ## The DO-to-DO gateway (obligation 3's Cloudflare half; `ports/infra.ts`'s `Rpc`)
 *
 * `CampaignActor`'s gateway/mirror-verify/subscribe-catch-up calls (`forwardAppend`/`hasEvent`/
 * `readStream`/`currentCampaignOf`) are backed here by direct DO-to-DO calls into a
 * `CharacterStreamDO` stub obtained from `this.env.CHARACTER_STREAM` — the SAME binding
 * `worker.ts` itself uses, available on this DO too because Cloudflare hands every Durable Object
 * the Worker script's own `env` (not a client-reachable surface — see the trust-boundary
 * paragraph above). This is the "DO-to-DO fetch/RPC" pattern the ledger names, and it is
 * INTERNAL-ONLY by the same transitive argument: nothing a client sends ever reaches this class's
 * methods at all, so the fact that THIS class, once reached, calls out to ANOTHER DO is not a new
 * surface a client could ever trigger directly.
 */
import { DurableObject } from 'cloudflare:workers';
import type { DurableObjectStorage } from '@cloudflare/workers-types';
import type { Actor, Event } from '@hk/protocol';
import { CampaignActor, campaignQuotas } from '../../core/streams/campaign-actor.ts';
import type { ConnAttachment } from '../../core/streams/stream-actor.ts';
// [plan-9 Task 8] `campaign-permissions.ts`, NOT `core/permissions.ts` — that character-stream
// module's `allowed()` early-returns `false` for any `'member'` role, which is correct for a
// character stream (no character-stream `EVENT_ACTORS` row ever grants `'member'`) but WRONG for
// a campaign stream (`member.joined`/`roll.logged`/etc. legitimately grant `'member'`) — see
// `campaign-permissions.ts`'s own header comment; `adapters/node/stream-host.ts` makes the same
// choice for the same reason.
import * as campaignPermissions from '../../core/campaign-permissions.ts';
import { WS_MESSAGE_BYTES_MAX } from '../../core/validate.ts';
import type { AppendResult } from '../../ports/stream.ts';
import type { Rpc, RpcAppendOutcome, RpcEventMatch } from '../../ports/infra.ts';
import { DoSqlStreamStore } from './store.sqlite-do.ts';
import { HibernatingConnections, type HibernationHost } from './connections.do.ts';
import {
  INTERNAL_DISPLAY_NAME_HEADER,
  INTERNAL_ROLE_HEADER,
  INTERNAL_STREAM_ID_HEADER,
  INTERNAL_USER_ID_HEADER,
} from './internal-headers.ts';
import type { Env } from './env.ts';

const WS_UPGRADE_RESPONSE_STATUS = 101;

/** `Rpc.hasEvent`'s page size — same number as `adapters/node/stream-host.ts`'s
 * `HAS_EVENT_PAGE_SIZE` (doc-03 §Catch-up performance's 200-events-per-frame convention), kept
 * local since this is a DO-to-DO paging loop, not a client-facing catch-up frame. */
const HAS_EVENT_PAGE_SIZE = 200;

/** The narrow slice of `CharacterStreamDO`'s own RPC surface this file's `Rpc` implementation
 * calls into (`character-stream.do.ts`'s `appendForGateway`/`read`/`currentCampaignOf`) — a
 * hand-written mirror, same "narrow interface over an `unknown`-cast stub" pattern `worker.ts`'s
 * own `CharacterStreamStub` uses, for the same `tsc`-performance reason (this file's header
 * comment / `character-stream.do.ts`'s "TypeScript-checker performance note"). */
interface CharacterStreamGatewayStub {
  appendForGateway(streamId: string, events: Event[], actor: Actor): Promise<RpcAppendOutcome>;
  read(streamId: string, fromSeq: number, limit: number): Promise<Event[]>;
  currentCampaignOf(streamId: string): Promise<string | undefined>;
}

function characterStub(env: Env, streamId: string): CharacterStreamGatewayStub {
  return env.CHARACTER_STREAM.get(env.CHARACTER_STREAM.idFromName(streamId));
}

/** Safely reads a `string` field off an event's payload — same defensive-read shape
 * `campaign-actor.ts`'s own `readStringField`/`adapters/node/stream-host.ts`'s `readCampaignId`
 * use, duplicated here for the same "adapter code, not core-internal" reason
 * `stream-host.ts`'s copy documents. */
function readCampaignId(payload: unknown): string | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined;
  const value = (payload as Record<string, unknown>)['campaignId'];
  return typeof value === 'string' ? value : undefined;
}

/** [plan-9 Task 8] `CampaignStreamDO`'s own `Rpc` — see this file's header comment. `notify` is
 * never called BY a `CampaignActor` itself (only `CharacterActor` ever calls `this.rpc.notify`
 * — `character-actor.ts`'s after-commit hook), so it stays a documented no-op here rather than a
 * hand-copied `NO_OP_RPC` spread (unlike `character-stream.do.ts`'s `buildRpc`, which spreads
 * `NO_OP_RPC` for its OWN four unused methods — this file's situation is the mirror image: one
 * unused method, not four, so a single inline no-op is clearer than importing the whole shape). */
function buildRpc(env: Env): Rpc {
  return {
    notify: () => Promise.resolve(),
    forwardAppend: (toStream, events, actor) => characterStub(env, toStream).appendForGateway(toStream, events, actor),
    hasEvent: async (stream, match: RpcEventMatch) => {
      let from = 1;
      for (;;) {
        const page = await characterStub(env, stream).read(stream, from, HAS_EVENT_PAGE_SIZE);
        if (page.length === 0) return false;
        for (const event of page) {
          if (event.type === match.type && readCampaignId(event.payload) === match.campaignId) return true;
        }
        if (page.length < HAS_EVENT_PAGE_SIZE) return false;
        from += page.length;
      }
    },
    readStream: (stream, fromSeq, limit) => characterStub(env, stream).read(stream, fromSeq, limit),
    currentCampaignOf: (stream) => characterStub(env, stream).currentCampaignOf(stream),
  };
}

/** `meta` key backing the generation guard — identical mechanism to
 * `character-stream.do.ts`'s own `GEN_META_KEY`/`deleteAll` doc comment (not re-derived here). */
const GEN_META_KEY = 'gen';

/** `ConnAttachment` plus the generation this connection was accepted under — same shape as
 * `character-stream.do.ts`'s `StampedAttachment`. */
interface StampedAttachment extends ConnAttachment {
  readonly gen: number;
}

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
): CampaignActor {
  return new CampaignActor({
    store,
    connections,
    quotas: campaignQuotas,
    permissions: campaignPermissions,
    streamId,
    rpc,
  });
}

export class CampaignStreamDO extends DurableObject<Env> {
  private storeCache: unknown;
  private connectionsCache: unknown;
  private actorPromise: Promise<CampaignActor> | undefined;

  private lazyStore(streamId: string): DoSqlStreamStore {
    this.storeCache ??= buildStore(this.ctx.storage, streamId);
    return this.storeCache as DoSqlStreamStore;
  }

  private async readGen(): Promise<number> {
    const store = this.storeCache as DoSqlStreamStore | undefined;
    if (!store) return 0;
    const raw = await store.getMeta(GEN_META_KEY);
    return raw ? Number(raw) : 0;
  }

  private lazyConnections(): HibernatingConnections<ConnAttachment> {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- see character-stream.do.ts's header comment
    this.connectionsCache ??= buildConnections(this.ctx as unknown as HibernationHost);
    return this.connectionsCache as HibernatingConnections<ConnAttachment>;
  }

  private async ensureActor(streamIdHint?: string): Promise<CampaignActor> {
    this.actorPromise ??= (async () => {
      const streamId = streamIdHint ?? (await this.ctx.storage.get<string>('stream_id'));
      if (!streamId) {
        throw new Error('CampaignStreamDO: streamId unknown (no hint given and none persisted yet)');
      }
      if (streamIdHint) await this.ctx.storage.put('stream_id', streamIdHint);
      return buildActor(this.lazyStore(streamId), this.lazyConnections(), streamId, buildRpc(this.env));
    })();
    return this.actorPromise;
  }

  /** The WS-upgrade handoff — same shape as `character-stream.do.ts`'s `fetch()`, except `role`
   * accepts `'dm'`/`'member'` (never `'owner'` — `core/routes/campaigns.ts`'s WS route: "design
   * ruling 1: campaign-socket role = 'dm' if memberships.role === 'dm', else 'member'") and the
   * attachment carries `displayName` when the route supplied one (plan-9 obligation 2 — a
   * campaign member's display name, threaded from `WsUpgradeContext.displayName` through
   * `worker.ts`'s `CloudflareWsUpgrade` as the `INTERNAL_DISPLAY_NAME_HEADER`). */
  override async fetch(request: Request): Promise<Response> {
    const streamId = request.headers.get(INTERNAL_STREAM_ID_HEADER);
    const userId = request.headers.get(INTERNAL_USER_ID_HEADER);
    const role = request.headers.get(INTERNAL_ROLE_HEADER);
    const displayName = request.headers.get(INTERNAL_DISPLAY_NAME_HEADER) ?? undefined;
    if (!streamId || !userId || (role !== 'dm' && role !== 'member')) {
      // Only ever reachable if `worker.ts` itself has a bug (this file's header comment: no
      // client request can reach this `fetch()` at all) — answered defensively regardless.
      return new Response('Bad internal request', { status: 400 });
    }
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Expected Upgrade: websocket', { status: 426 });
    }

    await this.ensureActor(streamId);
    const gen = await this.readGen();

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    const attachment: StampedAttachment = {
      userId,
      role,
      subs: [streamId],
      gen,
      ...(displayName !== undefined ? { displayName } : {}),
    };
    this.lazyConnections().accept(server, attachment);

    return new Response(null, { status: WS_UPGRADE_RESPONSE_STATUS, webSocket: client });
  }

  /** Hibernation API message handler — identical shape to `character-stream.do.ts`'s
   * `webSocketMessage` (size guard, then the generation guard, then text-vs-binary dispatch to
   * `actor.handleMessage`/`actor.handleBinaryMessage` — the latter is `CampaignActor`'s REAL blob-
   * relay entry point here, doc-07 §Blob transfer protocol). */
  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const byteLength = typeof message === 'string' ? new TextEncoder().encode(message).length : message.byteLength;
    if (byteLength > WS_MESSAGE_BYTES_MAX) {
      ws.close(1009, 'message too large');
      return;
    }

    const actor = await this.ensureActor();
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

  /** Hibernation API close handler — same shape as `character-stream.do.ts`'s `webSocketClose`,
   * but this DO's `onConnectionClosed` call is NOT symmetry-only: `CampaignActor` overrides it for
   * real (doc-10 §Presence's "on connect/close" broadcast + `BlobRelay`'s connection-close
   * cleanup, `campaign-actor.ts`). */
  override webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean): void {
    if (!wasClean) ws.close(code, reason);
    // [fix round 1, plan-9 Task 10 review] Best-effort, matching `campaigns.ts`'s
    // `closeConnectionsForUser`/rollback calls' existing `.catch(() => undefined)` stance: the
    // socket is already gone by the time this runs (this DO's presence rebroadcast is real work,
    // unlike `character-stream.do.ts`'s symmetry-only call — see this method's own header comment
    // — making a genuine failure here MORE likely, not less, so this is not merely defensive), so a
    // rejection must never surface as an unhandled promise rejection.
    void this.ensureActor()
      .then((actor) => actor.onConnectionClosed(ws))
      .catch(() => undefined);
  }

  // --- StreamHandle, as RPC methods — `worker.ts`'s `CloudflareStreamHost.get(streamId)` calls
  // these directly on the stub, exactly like `character-stream.do.ts`'s own RPC methods.

  async append(streamId: string, events: unknown, actor: unknown): Promise<AppendResult> {
    const campaignActor = await this.ensureActor(streamId);
    const outcome = await campaignActor.append(events as Event[], actor as Actor);
    const seqs = outcome.acked.map((a) => a.seq);
    return { firstSeq: seqs.length > 0 ? Math.min(...seqs) : 0, lastSeq: seqs.length > 0 ? Math.max(...seqs) : 0 };
  }

  async read(streamId: string, fromSeq: number, limit: number): Promise<unknown> {
    await this.ensureActor(streamId);
    return this.lazyStore(streamId).read(fromSeq, limit);
  }

  async head(streamId: string): Promise<number> {
    await this.ensureActor(streamId);
    return this.lazyStore(streamId).head();
  }

  /** `StreamHandle.notify` AND `Rpc.notify`'s real Cloudflare target (`character-stream.do.ts`'s
   * `buildRpc` calls this by name) — delegates to `CampaignActor.handleNotify`
   * (`campaign-actor.ts`), which implements doc-08's roster/visibility-gated fan-out. Deliberately
   * NOT a blind broadcast (unlike `character-stream.do.ts`'s own `notify`, which stays a
   * contract-completion blind fan-out because nothing real ever calls it — this method IS called
   * for real, by every linked character's after-commit hook). */
  async notify(streamId: string, fromStream: string, events: unknown): Promise<void> {
    const campaignActor = await this.ensureActor(streamId);
    const eventList = events as Event[];
    if (eventList.length === 0) return;
    await campaignActor.handleNotify(fromStream, eventList);
  }

  /** Same round-2 hard-delete fix as `character-stream.do.ts`'s `deleteAll` (that method's doc
   * comment has the full rationale — not re-derived here: evict both memoized caches, bump the
   * generation before restoring the persisted `stream_id` hint). */
  async deleteAll(streamId: string): Promise<void> {
    const actor = await this.ensureActor(streamId);
    const genBeforeWipe = await this.readGen();

    await actor.deleteAll();

    this.actorPromise = undefined;
    this.storeCache = undefined;

    const freshStore = this.lazyStore(streamId);
    await freshStore.setMeta(GEN_META_KEY, String(genBeforeWipe + 1));
    await this.ctx.storage.put('stream_id', streamId);
  }

  /** `MaintenanceStreams.getStreamUsage`'s shape, for parity with `character-stream.do.ts`'s own
   * `getUsage` — NOT wired into `worker.ts`'s `CloudflareMaintenanceStreams` yet (plan-9's own
   * scoping: `runDailyMaintenance` only iterates `char:` streams via `listAllCharacters`; the full
   * campaign `bytes_used` daily-sync is Task 9's job). Present now so Task 9 has a real RPC method
   * to call rather than needing its own adapter-touching task. */
  async getUsage(streamId: string): Promise<{ bytesUsed: number; eventCount: number }> {
    await this.ensureActor(streamId);
    const store = this.lazyStore(streamId);
    const [bytesRaw, countRaw] = await Promise.all([store.getMeta('bytes_used'), store.getMeta('event_count')]);
    return { bytesUsed: bytesRaw ? Number(bytesRaw) : 0, eventCount: countRaw ? Number(countRaw) : 0 };
  }

  /** `StreamHandle.closeConnectionsForUser`'s Cloudflare target (plan-9 Task 9;
   * `worker.ts`'s `CloudflareStreamHost.get(streamId)` calls this by name, exactly like every
   * other RPC method here) — delegates to `CampaignActor.byeCloseUser` (`stream-actor.ts`), THE
   * real caller for this plan (`core/routes/campaigns.ts`'s member-removal route). */
  async closeConnectionsForUser(streamId: string, userId: string, reason: string): Promise<void> {
    const actor = await this.ensureActor(streamId);
    actor.byeCloseUser(userId, reason);
  }
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null; // fails `parseClientMessage`'s discriminated-union check -> 1008 close, by design.
  }
}
