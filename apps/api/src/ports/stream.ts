import type { Actor, Event } from '@hk/protocol';

/**
 * Runtime ports for addressing a stream and persisting its events (ADR-014's ports table;
 * docs/02-architecture/10-backend-architecture.md §Runtime ports). `StreamHost` finds/creates
 * the single-writer handler for a stream id; `StreamHandle` is that handler's append/read
 * surface; `StreamStore` is the durable storage a handle is backed by. Signatures are
 * intentionally the plan's verbatim table — see task-2-brief.md.
 */

/** Result of committing a batch of events to a stream in one transaction. */
export interface AppendResult {
  readonly firstSeq: number;
  readonly lastSeq: number;
}

/**
 * The single-writer handler for one stream (a `CharacterActor`/`CampaignActor` instance behind
 * a Durable Object on Cloudflare, or a `Map`-held actor guarded by a per-actor mutex on Node —
 * see ADR-014's `StreamHost` row). Core code (`StreamActor` and its subclasses) is the only
 * caller; adapters supply the concrete implementation.
 */
export interface StreamHandle {
  /** Runs the append pipeline (validate → permission → dedupe → seq → store-tx → fan-out). */
  append(events: Event[], actor: Actor): Promise<AppendResult>;
  /** Reads committed events starting at `fromSeq` (inclusive), at most `limit` events. */
  read(fromSeq: number, limit: number): Promise<Event[]>;
  /** The highest committed `seq` for this stream (0 if empty). */
  head(): Promise<number>;
  /**
   * Delivers events that were committed on another stream's handle to this one's connections
   * (e.g. a character stream's commit notifying the campaign stream it belongs to). `fromStream`
   * names the originating stream id. Phase 2: called by `Rpc`'s Node/Cloudflare implementation,
   * unused by CharacterActor directly since campaign streams are Phase 3.
   */
  notify(fromStream: string, events: Event[]): Promise<void>;
  /**
   * Wipes ALL durable data for this stream — Task 6's hard-delete design (doc-08 §Quotas
   * "Freeing space: archive → hard delete (`DELETE /api/characters/:id` ...) deletes the DO's
   * storage and D1 row"; ADR-003: "hard delete ... is what frees quota"). `DELETE
   * /api/characters/:id` (`core/routes/characters.ts`) calls this via `StreamHost.get(id)` —
   * deliberately NOT a bare `StreamStore.deleteAll()` call from the route — so the delete goes
   * through the same single-writer guarantee that serializes every `append` (ports/stream.ts's
   * `StreamHost` doc comment), which matters because a delete racing a concurrent append must
   * resolve one-after-the-other, never interleaved. Implementations delegate to
   * `StreamStore.deleteAll` (see that method's doc comment for the storage-level contract).
   */
  deleteAll(): Promise<void>;
}

/** Addresses a stream by id, returning (creating, on first access) its single-writer handle. */
export interface StreamHost {
  get(streamId: string): StreamHandle;
}

/** A single event as committed to durable storage — same shape a `StreamHandle.read` returns. */
export type StoredEvent = Event;

/** A previously stored content pack pin, as returned by `StreamStore.getPack`/`listPacks`. */
export interface StoredPack {
  readonly id: string;
  readonly version: string;
  readonly json: unknown;
}

/**
 * Durable storage behind one `StreamHandle` (DO SQLite on Cloudflare, a `better-sqlite3` file
 * keyed by `(stream_id, seq)` on Node — ADR-014's `StreamStore` row). One `StreamStore` instance
 * is scoped to a single stream; `StreamHandle` implementations own one and run the pipeline's
 * store-transaction step against it.
 */
export interface StreamStore {
  /** Assigns contiguous `seq` values to `events` and commits them in one transaction. */
  append(events: Event[]): Promise<AppendResult>;
  /** Reads committed events starting at `fromSeq` (inclusive), at most `limit` events. */
  read(fromSeq: number, limit: number): Promise<Event[]>;
  /** The highest committed `seq` for this stream (0 if empty). */
  head(): Promise<number>;
  /** Reads a small piece of stream metadata (e.g. `bytes_used`, `event_count`) by key. */
  getMeta(key: string): Promise<string | undefined>;
  /** Writes a small piece of stream metadata by key. */
  setMeta(key: string, value: string): Promise<void>;
  /**
   * Looks up already-committed events by id (Task 5's port-extension design decision — see
   * task-5-report.md for the full write-up). Two shapes were considered for letting
   * `StreamActor.append` implement doc-03's idempotent-retry rule ("duplicates (same id) are
   * acked with the existing seq"): (a) have `append` itself report per-event dedupe outcomes,
   * or (b) a separate lookup the actor calls BEFORE deciding what to store. (b) — this method —
   * was chosen: it keeps `append`'s contract simple ("assign seq to exactly what you're given,
   * once, in one transaction") instead of teaching it two different response shapes for "stored"
   * vs "already existed", and it maps directly onto the doc-02 schema's `events` table, which
   * has `id TEXT UNIQUE` — a plain `SELECT * FROM events WHERE id IN (...)` on both Node's
   * better-sqlite3 file and Cloudflare's DO SQLite (Tasks 7/8 implement it against real storage;
   * `test/helpers/fake-stream-store.ts` implements the same contract in memory). `StreamActor`
   * uses it for two things: cross-request dedupe (an id seen in a PRIOR append) and, later,
   * resolving `event.reverted`'s target event to check the "own events only" rule
   * (`core/permissions.ts`'s `canRevertOwn` hook). Returns only the events that exist; order is
   * unspecified — callers index by `.id`.
   */
  findByIds(ids: string[]): Promise<StoredEvent[]>;
  /** Caches a content pack's pinned JSON alongside the stream (offline/local read path). */
  putPack(id: string, version: string, json: unknown): Promise<void>;
  /** Reads a previously cached pack pin, if any. */
  getPack(id: string): Promise<StoredPack | undefined>;
  /** Lists every pack pinned to this stream. */
  listPacks(): Promise<StoredPack[]>;
  /**
   * Irrecoverably wipes every event, meta key, and cached pack for this stream — the storage-
   * level half of Task 6's hard-delete design (see `StreamHandle.deleteAll`'s doc comment for
   * why the route reaches this via `StreamHost.get(id)` rather than calling it directly). Tasks
   * 7/8 implement this against real storage (`DELETE FROM events/meta/packs WHERE ...` on Node's
   * better-sqlite3 file, or dropping the DO's own SQLite database on Cloudflare);
   * `test/helpers/fake-stream-store.ts` implements it by clearing its in-memory maps/array.
   * Named `deleteAll` (not `delete`/`clear`) so every call site reads unambiguously as "there is
   * no partial form of this operation" — it is the whole stream or nothing.
   */
  deleteAll(): Promise<void>;
}

/** A stream's `bytes_used`/`event_count` meta, as reported to the daily maintenance job. Same
 * shape as `core/quotas.ts`'s `StreamMetaSnapshot`, named separately here since `ports/**` must
 * not import `core/quotas.ts` (ports are consumed BY core, never the reverse). */
export interface StreamUsage {
  readonly bytesUsed: number;
  readonly eventCount: number;
}

/**
 * Per-stream USAGE lookup for the daily maintenance job (Task 10; `core/maintenance.ts`) — a
 * separate, narrower port from `StreamHost`/`StreamStore` (those are per-request, actor-owned,
 * one instance per stream) because maintenance runs OUTSIDE any actor's single-writer lock,
 * batch-reading meta for potentially every stream in one pass. Each adapter picks its own
 * efficient path:
 *   - Node (`adapters/node/maintenance-streams.ts`): queries the SAME shared `streams.sqlite`
 *     file's `meta`/`events` tables directly — no actor/mutex needed since this is read-only and
 *     `meta` writes are last-write-wins anyway (doc-10 §StreamActor: `meta.bytes_used` is only
 *     ever advanced by `StreamActor.append`, which this job never races against for anything
 *     stronger than "read a value that might be a few writes stale", which is fine for a ≤24h
 *     sync).
 *   - Cloudflare (`adapters/cloudflare/worker.ts`'s `CloudflareMaintenanceStreams`): one internal
 *     RPC call per `CharacterStreamDO` instance (`character-stream.do.ts`'s `getUsage` method) —
 *     a DO's own SQLite is private to that DO and unreachable except through the Worker's
 *     `CHARACTER_STREAM` binding, the same trust-boundary argument that file's header comment
 *     already makes for `append`/`read`/`head`/`notify`/`deleteAll`.
 */
export interface MaintenanceStreams {
  /** Reads one stream's current `bytes_used`/`event_count` meta. `{bytesUsed: 0, eventCount: 0}`
   * for a stream with no meta ever written (matches `StreamActor.readMeta`'s own default) —
   * never rejects/throws just because a character was registered in D1 but its stream has not
   * received its first `character.created` event yet. */
  getStreamUsage(streamId: string): Promise<StreamUsage>;
  /**
   * Best-effort listing of every stream id this storage currently holds ANY row for — used only
   * by the maintenance job's orphan check (`core/maintenance.ts`) to find "a stream exists with
   * no character index row". Node can answer this cheaply (`SELECT DISTINCT stream_id`); Cloudflare
   * has no API to enumerate Durable Object instances at all (a DO's only address is
   * `idFromName(name)`, which requires already knowing the name) — `CloudflareMaintenanceStreams`
   * therefore does not implement this method at all, and `runDailyMaintenance` treats a missing
   * `listStreamIds` as "this half of the orphan check is not checkable on this adapter" (reports
   * `null`, never a false zero).
   */
  listStreamIds?(): Promise<string[]>;
}
