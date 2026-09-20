/**
 * `StreamHost` over an in-process `Map<id, actor>` with a per-actor mutex (ADR-014's Node
 * `StreamHost` row: "In-process `Map<id, StreamActor>` with a per-actor async mutex"). [plan-9
 * Task 8] `.get()`/`.getRuntime()` now branch on the `streamId`'s prefix (`char:` vs `camp:`,
 * `@hk/protocol`'s `StreamIdSchema`) — Phase 2 always built a `CharacterActor` (doc-10
 * §CampaignActor was Phase-3-only back then); Phase 3's `CampaignActor` (plan-9 Task 5) is now
 * real, so a `camp:` id gets a real `CampaignActor` instead of silently falling through to a
 * `CharacterActor` no route would ever construct one for.
 *
 * Beyond the `StreamHost` port itself (`get(streamId): StreamHandle`, consumed by
 * `core/routes/characters.ts`'s `DELETE` route and `core/routes/campaigns.ts`'s event-append
 * calls), this class exposes one Node-only extra — `getRuntime(streamId)` — that `server.ts`'s
 * WS-upgrade handling (`ports/infra.ts`'s `WsUpgrade` Node implementation) uses to reach the
 * actor's `handleMessage`/`hello`/`handleBinaryMessage`/`onConnectionClosed` surface and its
 * `Connections` instance directly, neither of which the narrow `StreamHandle` port exposes. This
 * is adapter-internal wiring, not a port — `core/**` never sees `StreamRuntime`.
 *
 * [plan-9 Task 8] `Rpc` (`ports/infra.ts`): this host is ALSO the Node adapter's real `Rpc`
 * implementation — a direct in-process call between actors (ADR-014's `Rpc` row: "a direct
 * in-process method call between actors on Node", contrasted with Cloudflare's DO-to-DO binding
 * call, `adapters/cloudflare/campaign-stream.do.ts`/`character-stream.do.ts`). Built once as
 * `this.rpc` (a plain object of bound closures over `this`) and threaded into EVERY actor this
 * host constructs, so `CharacterActor.append`'s after-commit `this.rpc.notify(...)` and
 * `CampaignActor.append`'s gateway/mirror/subscribe-catch-up calls all reach a REAL target actor's
 * runtime instead of the fail-closed `NO_OP_RPC` default (`stream-actor.ts`). No adapter-side
 * "reach across the network" concern exists on Node at all — `this.runtimeFor(otherStreamId)` is
 * just another entry in the SAME `Map` this host already owns, guarded by that OTHER stream's own
 * `Mutex` where a call actually mutates storage (`forwardAppend`), and left unlocked for the
 * READ-shaped calls (`hasEvent`/`readStream`/`currentCampaignOf`/`notify`) — consistent with every
 * other read this codebase performs outside an actor's own append pipeline (e.g.
 * `CampaignActor.sendSubscribeCatchUp` already reads a foreign stream's history unlocked).
 */
import type { Actor, Event } from '@hk/protocol';
import type Database from 'better-sqlite3';
import { CampaignActor, campaignQuotas } from '../../core/streams/campaign-actor.ts';
import { CharacterActor } from '../../core/streams/character-actor.ts';
import type { ConnAttachment } from '../../core/streams/stream-actor.ts';
import * as permissions from '../../core/permissions.ts';
import * as campaignPermissions from '../../core/campaign-permissions.ts';
import * as quotas from '../../core/quotas.ts';
import type { Rpc, RpcAppendOutcome, RpcEventMatch } from '../../ports/infra.ts';
import type { AppendResult, StreamHandle, StreamHost } from '../../ports/stream.ts';
import { SqliteFileStreamStore } from './store.sqlite-file.ts';
import { WsConnections } from './connections.ws.ts';

/** Every concrete actor type this host can construct (plan-9 Task 8). */
export type StreamRuntimeActor = CharacterActor | CampaignActor;

/** `Rpc.hasEvent`'s page size for the Node search loop below — same number as
 * `stream-actor.ts`'s own `CATCH_UP_PAGE_SIZE`/`campaign-actor.ts`'s `SUBSCRIBE_CATCH_UP_PAGE_SIZE`
 * (doc-03 §Catch-up performance: "the DO pages 200 events per frame"), kept as its own local
 * constant since this loop pages a THIRD, independent thing (a linear existence search, not a
 * client-facing catch-up frame). */
const HAS_EVENT_PAGE_SIZE = 200;

/** Safely reads a `string` field off an event's payload (mirrors `campaign-actor.ts`'s own
 * `readStringField`, duplicated here rather than imported — this is adapter code, `core/**` is
 * upstream of it, and the field being read (`campaignId`) is a plain JSON payload field, not a
 * core-internal type). */
function readCampaignId(payload: unknown): string | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined;
  const value = (payload as Record<string, unknown>)['campaignId'];
  return typeof value === 'string' ? value : undefined;
}

/** A simple promise-chain mutex (task-7-brief: "a simple promise-chain mutex like
 * CharacterStore's queue"). `run(fn)` guarantees `fn` never starts until every `fn` queued before
 * it has SETTLED (resolved or rejected) — the "single-writer" guarantee `StreamHost`'s port doc
 * comment names. A rejection from one `run()` call is returned to ITS OWN caller and does not
 * poison the queue for subsequent calls (the internal `tail` promise always resolves, via the
 * `.then(noop, noop)` below, regardless of how `fn` settled). */
export class Mutex {
  private tail: Promise<void> = Promise.resolve();

  run<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.tail.then(fn, fn);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

/** Everything one stream's runtime needs: the actor, the store/connections it was built from (for
 * inspection — mainly tests), and `withLock`, the single chokepoint every stateful operation on
 * this stream (an HTTP-route-triggered `append`/`deleteAll` via the `StreamHandle` port, OR a raw
 * WS `'message'` event calling `actor.handleMessage` directly) must go through, so the two paths
 * can never interleave a write against the same stream. */
export interface StreamRuntime {
  readonly streamId: string;
  readonly actor: StreamRuntimeActor;
  readonly store: SqliteFileStreamStore;
  readonly connections: WsConnections<ConnAttachment>;
  withLock<T>(fn: () => Promise<T>): Promise<T>;
}

export class NodeStreamHost implements StreamHost {
  private readonly db: Database.Database;
  private readonly runtimes = new Map<string, StreamRuntime>();
  /** [plan-9 Task 8] This host's own `Rpc` implementation — see this file's header comment. */
  private readonly rpc: Rpc = {
    notify: (toStream, fromStream, events) => this.get(toStream).notify(fromStream, events),
    forwardAppend: (toStream, events, actor) => this.rpcForwardAppend(toStream, events, actor),
    hasEvent: (stream, match) => this.rpcHasEvent(stream, match),
    readStream: (stream, fromSeq, limit) => this.get(stream).read(fromSeq, limit),
    currentCampaignOf: (stream) => this.rpcCurrentCampaignOf(stream),
  };

  constructor(db: Database.Database) {
    this.db = db;
  }

  get(streamId: string): StreamHandle {
    const runtime = this.runtimeFor(streamId);
    return {
      append: (events: Event[], actor: Actor): Promise<AppendResult> =>
        runtime.withLock(async () => {
          const outcome = await runtime.actor.append(events, actor);
          // `AppendOutcome.acked` (core/streams/stream-actor.ts) is in original-event order, NOT
          // seq order (idempotently-deduped entries are pushed before newly-committed ones — see
          // that file's `append` doc comment) — min/max over the acked seqs, not
          // first/last-array-element, is what actually answers "the range of seqs this call
          // touched" the `StreamHandle.append` port contract promises.
          const seqs = outcome.acked.map((a) => a.seq);
          const firstSeq = seqs.length > 0 ? Math.min(...seqs) : 0;
          const lastSeq = seqs.length > 0 ? Math.max(...seqs) : 0;
          return { firstSeq, lastSeq };
        }),
      read: (fromSeq: number, limit: number): Promise<Event[]> => runtime.store.read(fromSeq, limit),
      head: (): Promise<number> => runtime.store.head(),
      // `StreamHandle.notify` (ports/stream.ts): delivers events committed on ANOTHER stream to
      // this stream's connections. [plan-9 Task 8] Now a REAL delivery path (`this.rpc.notify`
      // above delegates straight here): a `CampaignActor` target delegates to its OWN
      // `handleNotify` (`campaign-actor.ts`), which implements doc-08's roster/visibility-gated
      // fan-out — NOT a blind broadcast. A `CharacterActor` target (never actually reached by any
      // real caller in this plan — nothing notifies a character stream) keeps the old
      // contract-completion blind fan-out, unchanged, for port-shape completeness only.
      notify: (fromStream: string, events: Event[]): Promise<void> => {
        if (events.length === 0) return Promise.resolve();
        if (runtime.actor instanceof CampaignActor) {
          return runtime.actor.handleNotify(fromStream, events);
        }
        for (const conn of runtime.connections.all()) {
          runtime.connections.send(conn, { t: 'events', stream: fromStream, events });
        }
        return Promise.resolve();
      },
      deleteAll: (): Promise<void> =>
        runtime.withLock(async () => {
          await runtime.actor.deleteAll();
          // Round-2 fix (whole-branch re-review): `StreamActor.deleteAll` sets `closed = true`
          // PERMANENTLY on `runtime.actor` (that class's own doc comment — it never resets) so a
          // recreate with the SAME character id (`POST /api/characters` after the D1 row is gone,
          // which no longer collides — see `core/routes/characters.ts`'s create route) must get a
          // BRAND NEW actor, not this now-permanently-closed one. Evicting the map entry here means
          // the NEXT `.get(streamId)`/`.getRuntime(streamId)` call (a fresh HTTP route call, or a
          // fresh WS upgrade) builds a fresh `StreamRuntime` via `runtimeFor` below (`closed`
          // starts `false` again). This is SAFE for the original finding-3 protection: `server.ts`'s
          // WS upgrade handler captures `runtime` ONCE via `getRuntime` at accept time and closes
          // over that SAME reference for the connection's whole lifetime (`ws.on('message', ...)`
          // never re-looks-up the host) — any socket that was already live when THIS delete ran
          // keeps talking to THIS (still-closed-forever) `runtime`/`actor` object, never the fresh
          // one a later recreate builds, regardless of what this map holds afterward.
          this.runtimes.delete(streamId);
        }),
      // [plan-9 Task 9] `StreamHandle.closeConnectionsForUser` — a thin, unlocked delegation to
      // the runtime's own `byeCloseUser` (`stream-actor.ts`): sending a `bye` frame and closing a
      // socket touches ONLY `Connections`, never the store, so this needs no `withLock` the way
      // `append`/`deleteAll` do (same "no lock needed" reasoning `read`/`head` above already
      // apply).
      closeConnectionsForUser: (userId: string, reason: string): Promise<void> =>
        Promise.resolve(runtime.actor.byeCloseUser(userId, reason)),
    };
  }

  /** Adapter-only extra (see this file's header comment) — `server.ts`'s WS upgrade handling uses
   * this to reach the actor/connections a `StreamHandle` alone can't expose. Lazily creates the
   * runtime exactly like `.get()` (in fact delegates to the same lazy constructor), so a WS
   * handoff arriving before any HTTP route ever called `.get()` for this stream still works. */
  getRuntime(streamId: string): StreamRuntime {
    return this.runtimeFor(streamId);
  }

  /** [plan-9 Task 8] `Rpc.forwardAppend` — THE GATEWAY's actual cross-actor call (`campaign-
   * actor.ts`'s `forwardGroupsToCharacterStreams`). Goes through the TARGET stream's own `Mutex`
   * (a genuine mutating append), which is a DIFFERENT `Mutex` instance from whatever lock the
   * CALLING campaign stream's own message dispatch is already holding — no deadlock risk (see
   * this file's header comment). `CharacterActor.append`'s return shape (`AppendOutcome`,
   * `{acked, rejected}`) is already structurally identical to `RpcAppendOutcome` (both files'
   * own doc comments note this intentional shape-sharing), so no translation is needed. */
  private rpcForwardAppend(toStream: string, events: Event[], actor: Actor): Promise<RpcAppendOutcome> {
    const runtime = this.runtimeFor(toStream);
    return runtime.withLock(() => runtime.actor.append(events, actor));
  }

  /** [plan-9 Task 8] `Rpc.hasEvent` — the cross-stream mirror-verify EXISTENCE check
   * (`campaign-actor.ts`'s `verifyCharacterMirror`). `StreamStore`/`StreamHandle` expose no
   * generic "search by type/payload field" method (`ports/stream.ts`'s own surface is
   * read-by-range or read-by-id only), so this pages the target stream's FULL history via
   * `store.read` — bounded in practice by `STREAM_BYTES_MAX`/`STREAM_EVENT_COUNT_MAX`
   * (`quotas.ts`), same "linear scan of a bounded stream" shape `CampaignActor`'s own catch-up
   * loops already use. Unlocked (a plain read) — see this file's header comment. */
  private async rpcHasEvent(stream: string, match: RpcEventMatch): Promise<boolean> {
    const runtime = this.runtimeFor(stream);
    let from = 1;
    for (;;) {
      const page = await runtime.store.read(from, HAS_EVENT_PAGE_SIZE);
      if (page.length === 0) return false;
      for (const event of page) {
        if (event.type === match.type && readCampaignId(event.payload) === match.campaignId) return true;
      }
      if (page.length < HAS_EVENT_PAGE_SIZE) return false;
      from += page.length;
    }
  }

  /** [plan-9 Task 8] `Rpc.currentCampaignOf` — the cross-stream mirror-verify CURRENCY check
   * (`campaign-actor.ts`'s `verifyCharacterMirror`, fix round 1's Critical 4). Reads the target
   * `CharacterActor`'s own LIVE `meta.campaignId` directly (never a history scan) — fails closed
   * (`undefined`) for a `camp:` target or anything else that isn't a `CharacterActor`, matching
   * `Rpc.currentCampaignOf`'s own documented fail-closed default (`ports/infra.ts`). */
  private async rpcCurrentCampaignOf(stream: string): Promise<string | undefined> {
    const runtime = this.runtimeFor(stream);
    if (!(runtime.actor instanceof CharacterActor)) return undefined;
    const meta = await runtime.actor.getCharacterMeta();
    return meta.campaignId;
  }

  /** [plan-9 Task 8] Branches on the `streamId` prefix (`@hk/protocol`'s `StreamIdSchema`:
   * `char:<uuid>` / `camp:<uuid>`) to construct the right concrete actor — see this file's header
   * comment. `CampaignActor` gets its own quotas (`campaignQuotas`, `campaign-actor.ts`'s 20 MB/
   * uncapped-event-count limits) instead of the character-stream default every OTHER actor keeps
   * getting for free (`quotas.ts`'s `CampaignActor`'s own doc comment on `campaignQuotas`).
   * `CampaignActor` also gets its OWN `permissions` module — `campaign-permissions.ts`, NOT
   * `core/permissions.ts` — that file's own header comment spells out why reusing the character
   * module here would be a real (if silent) bug: `core/permissions.ts`'s `allowed()` has an early
   * `role !== 'owner' && role !== 'dm' -> false` short-circuit that is CORRECT for a character
   * stream (no character-stream `EVENT_ACTORS` row ever grants `'member'`) but WRONG for a
   * campaign stream (several campaign rows legitimately grant `'member'` — `member.joined`,
   * `roll.logged`, etc.) — it would reject every member-authored campaign event outright. This
   * host's own `rpc` (built once, above) is shared by both actor kinds. */
  private runtimeFor(streamId: string): StreamRuntime {
    let runtime = this.runtimes.get(streamId);
    if (runtime) return runtime;

    const store = new SqliteFileStreamStore(this.db, streamId);
    const connections = new WsConnections<ConnAttachment>();
    const mutex = new Mutex();
    const actor: StreamRuntimeActor = streamId.startsWith('camp:')
      ? new CampaignActor({
          store,
          connections,
          quotas: campaignQuotas,
          permissions: campaignPermissions,
          streamId,
          rpc: this.rpc,
        })
      : new CharacterActor({ store, connections, quotas, permissions, streamId, rpc: this.rpc });
    runtime = {
      streamId,
      actor,
      store,
      connections,
      withLock: <T>(fn: () => Promise<T>) => mutex.run(fn),
    };
    this.runtimes.set(streamId, runtime);
    return runtime;
  }
}
