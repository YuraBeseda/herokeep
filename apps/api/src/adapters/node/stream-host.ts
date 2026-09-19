/**
 * `StreamHost` over an in-process `Map<id, actor>` with a per-actor mutex (ADR-014's Node
 * `StreamHost` row: "In-process `Map<id, StreamActor>` with a per-actor async mutex"). Phase 2
 * ships only `CharacterActor` (doc-10 §CampaignActor: Phase 3) so every `streamId` this host is
 * ever asked for is a `char:<uuid>` — `.get()` always constructs a `CharacterActor`, never
 * branches on the id's prefix; a `camp:` id reaching this host would simply get a `CharacterActor`
 * that no route ever creates one for, which is harmless today and intentionally NOT special-cased
 * here (that branch belongs to whichever Phase-3 task adds `CampaignActor`).
 *
 * Beyond the `StreamHost` port itself (`get(streamId): StreamHandle`, consumed by
 * `core/routes/characters.ts`'s `DELETE` route), this class exposes one Node-only extra —
 * `getRuntime(streamId)` — that `server.ts`'s WS-upgrade handling (`ports/infra.ts`'s `WsUpgrade`
 * Node implementation) uses to reach the actor's `handleMessage`/`hello` surface and its
 * `Connections` instance directly, neither of which the narrow `StreamHandle` port exposes. This
 * is adapter-internal wiring, not a port — `core/**` never sees `StreamRuntime`.
 */
import type { Actor, Event } from '@hk/protocol';
import type Database from 'better-sqlite3';
import { CharacterActor } from '../../core/streams/character-actor.ts';
import type { ConnAttachment } from '../../core/streams/stream-actor.ts';
import * as permissions from '../../core/permissions.ts';
import * as quotas from '../../core/quotas.ts';
import type { AppendResult, StreamHandle, StreamHost } from '../../ports/stream.ts';
import { SqliteFileStreamStore } from './store.sqlite-file.ts';
import { WsConnections } from './connections.ws.ts';

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
  readonly actor: CharacterActor;
  readonly store: SqliteFileStreamStore;
  readonly connections: WsConnections<ConnAttachment>;
  withLock<T>(fn: () => Promise<T>): Promise<T>;
}

export class NodeStreamHost implements StreamHost {
  private readonly db: Database.Database;
  private readonly runtimes = new Map<string, StreamRuntime>();

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
      // this stream's connections. Unused in Phase 2 (no `Rpc` caller exists yet — see that
      // port's doc comment), implemented as a plain fan-out for contract completeness: every
      // connection currently on this stream receives an `events` frame naming the ORIGINATING
      // stream id, mirroring `StreamActor`'s own private `fanOut` shape.
      notify: (fromStream: string, events: Event[]): Promise<void> => {
        if (events.length === 0) return Promise.resolve();
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
    };
  }

  /** Adapter-only extra (see this file's header comment) — `server.ts`'s WS upgrade handling uses
   * this to reach the actor/connections a `StreamHandle` alone can't expose. Lazily creates the
   * runtime exactly like `.get()` (in fact delegates to the same lazy constructor), so a WS
   * handoff arriving before any HTTP route ever called `.get()` for this stream still works. */
  getRuntime(streamId: string): StreamRuntime {
    return this.runtimeFor(streamId);
  }

  private runtimeFor(streamId: string): StreamRuntime {
    let runtime = this.runtimes.get(streamId);
    if (runtime) return runtime;

    const store = new SqliteFileStreamStore(this.db, streamId);
    const connections = new WsConnections<ConnAttachment>();
    const actor = new CharacterActor({ store, connections, quotas, permissions, streamId });
    const mutex = new Mutex();
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
