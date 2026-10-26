/**
 * `StreamStore` over a Durable Object's own SQLite storage (`state.storage.sql` — ADR-014's
 * Cloudflare `StreamStore` row; task-8-brief obligation (c)). Doc-02's per-stream
 * `events`/`meta`/`packs` tables are reproduced here VERBATIM, unlike Node's shared-file store
 * (`adapters/node/store.sqlite-file.ts`), which widens every table with a leading `stream_id`
 * column because one `streams.sqlite` file backs EVERY stream on that adapter. Here, per-DO
 * storage already IS the one-stream-per-database boundary (`idFromName(streamId)` in
 * `worker.ts`/`character-stream.do.ts` addresses a dedicated DO — and therefore a dedicated
 * SQLite database — per stream), so a `stream_id` column would be redundant: every row in THIS
 * store's tables belongs to exactly one stream by construction, not by a `WHERE stream_id = ?`
 * filter. This is the doc-02-vs-Node mapping obligation (c) asks to be documented, recorded here
 * at the one place it actually matters (the schema itself). One deliberate departure: a pack body
 * is split over `pack_chunks` rows under its `packs` row (`PACK_CHUNK_BYTES` below), because DO
 * SQLite caps a single value at 2 MB and a pack body may be up to 5 MiB.
 *
 * `DurableObjectStorage.transactionSync` (not a bare sequence of `sql.exec` calls) wraps every
 * multi-statement write (`append`, `putPack`, `deletePack`) — SQLite-backed DO storage does not implicitly
 * transaction multiple `sql.exec` calls together the way Node's `better-sqlite3` wraps a whole
 * `db.transaction(fn)` callback; `transactionSync`'s callback is Cloudflare's equivalent
 * synchronous-transaction primitive (`ports/stream.ts`'s `StreamStore.append` contract: "commits
 * them in one transaction").
 */
import type { DurableObjectStorage, SqlStorageValue } from '@cloudflare/workers-types';
import type { Event } from '@hk/protocol';
import type { AppendResult, StoredEvent, StoredPack, StreamStore } from '../../ports/stream.ts';

/** Idempotent (`IF NOT EXISTS`) — see `adapters/node/store.sqlite-file.ts`'s `ensureStreamsSchema`
 * for why this store, like that one, calls its schema setup unconditionally on every construction
 * rather than tracking "already created" separately. */
function ensureSchema(storage: DurableObjectStorage): void {
  storage.sql.exec(`
    CREATE TABLE IF NOT EXISTS events (
      seq INTEGER PRIMARY KEY,
      id TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL,
      v INTEGER NOT NULL,
      ts TEXT NOT NULL,
      actor_json TEXT NOT NULL,
      tx_id TEXT,
      payload_json TEXT NOT NULL,
      bytes INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS packs (
      id TEXT PRIMARY KEY,
      version TEXT NOT NULL,
      bytes INTEGER NOT NULL,
      chunks INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS pack_chunks (
      id TEXT NOT NULL,
      idx INTEGER NOT NULL,
      chunk BLOB NOT NULL,
      PRIMARY KEY (id, idx)
    );
  `);
  migrateLegacyPacks(storage);
}

/**
 * [plan-16 final fix wave, F1] Cloudflare's SQLite-backed Durable Objects cap one string, BLOB or
 * row at 2 MB (developers.cloudflare.com/durable-objects/platform/limits; a bigger bound value
 * throws `SQLITE_TOOBIG`), while a campaign pack body may be up to `CAMPAIGN_PACK_BYTES_MAX`
 * (5 MiB). So a body is stored as its UTF-8 bytes split into `pack_chunks` rows of at most this
 * size, under one `packs` row carrying `version`, the total `bytes` and the `chunks` count. The
 * split is by BYTES (BLOB rows), not by string index, so a chunk boundary may fall inside a
 * multi-byte character or a surrogate pair: the bytes are concatenated before decoding.
 */
const PACK_CHUNK_BYTES = 1024 * 1024;

/** The pre-chunking shape, `packs(id, version, json TEXT)` (doc-02's original table, unchanged
 * until plan 16's final fix wave), rewritten into the chunked shape once. Detected by its `json`
 * column (`PRAGMA table_info` is one of the PRAGMAs DO SQLite allows; `user_version` is not, so
 * there is no schema-version counter to read instead). Each legacy body was one TEXT value, so it
 * is necessarily under the 2 MB cap and safe to read in one row. */
function migrateLegacyPacks(storage: DurableObjectStorage): void {
  const columns = [...storage.sql.exec<{ name: string }>('PRAGMA table_info(packs)')].map((c) => c.name);
  if (!columns.includes('json')) return;
  storage.transactionSync(() => {
    const legacy = [
      ...storage.sql.exec<{ id: string; version: string; json: string }>('SELECT id, version, json FROM packs'),
    ];
    storage.sql.exec(`
      DROP TABLE packs;
      CREATE TABLE packs (
        id TEXT PRIMARY KEY,
        version TEXT NOT NULL,
        bytes INTEGER NOT NULL,
        chunks INTEGER NOT NULL
      );
    `);
    for (const row of legacy) writePackRows(storage, row.id, row.version, row.json);
  });
}

/** Replaces `id`'s `packs` row and every one of its `pack_chunks` rows. The caller wraps it in
 * `transactionSync`, so a reader never sees a half-written body. */
function writePackRows(storage: DurableObjectStorage, id: string, version: string, json: string): void {
  const bytes = new TextEncoder().encode(json);
  const chunks = Math.ceil(bytes.length / PACK_CHUNK_BYTES);
  storage.sql.exec('DELETE FROM pack_chunks WHERE id = ?', id);
  for (let idx = 0; idx < chunks; idx += 1) {
    const chunk = bytes.slice(idx * PACK_CHUNK_BYTES, (idx + 1) * PACK_CHUNK_BYTES);
    storage.sql.exec('INSERT INTO pack_chunks (id, idx, chunk) VALUES (?, ?, ?)', id, idx, chunk.buffer);
  }
  storage.sql.exec(
    `INSERT INTO packs (id, version, bytes, chunks) VALUES (?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET version = excluded.version, bytes = excluded.bytes, chunks = excluded.chunks`,
    id,
    version,
    bytes.length,
    chunks,
  );
}

interface PackRow extends Record<string, SqlStorageValue> {
  readonly id: string;
  readonly version: string;
  readonly bytes: number;
  readonly chunks: number;
}

/** Reassembles one stored body. `ignoreBOM: true` keeps a leading U+FEFF as text (the route
 * decodes the same way), so the result is exactly the string `putPack` received. A row whose
 * chunks do not add up is storage corruption, never silently served. */
function readPackBody(storage: DurableObjectStorage, row: PackRow): StoredPack {
  const parts = [
    ...storage.sql.exec<{ chunk: ArrayBuffer }>('SELECT chunk FROM pack_chunks WHERE id = ? ORDER BY idx', row.id),
  ];
  const bytes = new Uint8Array(row.bytes);
  let offset = 0;
  for (const part of parts) {
    const chunk = new Uint8Array(part.chunk);
    if (offset + chunk.length > bytes.length) break;
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  if (parts.length !== row.chunks || offset !== row.bytes) {
    throw new Error(
      `DoSqlStreamStore: pack ${row.id} is corrupt (${parts.length}/${row.chunks} chunks, ${offset}/${row.bytes} bytes)`,
    );
  }
  return {
    id: row.id,
    version: row.version,
    json: new TextDecoder('utf-8', { fatal: false, ignoreBOM: true }).decode(bytes),
  };
}

interface EventRow extends Record<string, SqlStorageValue> {
  readonly seq: number;
  readonly id: string;
  readonly type: string;
  readonly v: number;
  readonly ts: string;
  readonly actor_json: string;
  readonly tx_id: string | null;
  readonly payload_json: string;
  readonly bytes: number;
}

function rowToEvent(streamId: string, row: EventRow): StoredEvent {
  return {
    id: row.id,
    stream: streamId,
    seq: row.seq,
    ts: row.ts,
    actor: JSON.parse(row.actor_json) as Event['actor'],
    type: row.type,
    v: row.v,
    txId: row.tx_id ?? undefined,
    payload: JSON.parse(row.payload_json) as unknown,
  };
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** One `StreamStore` per DO instance — implicitly scoped to whichever stream that DO's id names
 * (`ports/stream.ts`'s "scoped to a single stream" contract), so unlike Node's store this class
 * takes no `streamId` constructor argument: there is only ever one stream's data in `storage`.
 * `streamId` is still needed to STAMP onto `StoredEvent.stream` for `read`/`findByIds` results
 * (the `Event` shape carries its own stream id — doc-02), so it's threaded through as a plain
 * constructor argument, purely for that stamping; it plays no role in scoping which rows this
 * store reads/writes (every query already implicitly targets only this DO's own database). */
export class DoSqlStreamStore implements StreamStore {
  private readonly storage: DurableObjectStorage;
  private readonly streamId: string;

  constructor(storage: DurableObjectStorage, streamId: string) {
    this.storage = storage;
    this.streamId = streamId;
    ensureSchema(this.storage);
  }

  append(events: Event[]): Promise<AppendResult> {
    if (events.length === 0) return Promise.resolve({ firstSeq: 0, lastSeq: 0 });
    const result = this.storage.transactionSync(() => {
      const sql = this.storage.sql;
      const headRows = [...sql.exec<{ head: SqlStorageValue }>('SELECT MAX(seq) AS head FROM events')];
      let seq = (Number(headRows[0]?.head) || 0) + 1;
      const firstSeq = seq;
      for (const event of events) {
        const payloadJson = JSON.stringify(event.payload ?? null);
        sql.exec(
          `INSERT INTO events (seq, id, type, v, ts, actor_json, tx_id, payload_json, bytes)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          seq,
          event.id,
          event.type,
          event.v,
          event.ts,
          JSON.stringify(event.actor),
          event.txId ?? null,
          payloadJson,
          byteLength(payloadJson),
        );
        seq += 1;
      }
      return { firstSeq, lastSeq: seq - 1 };
    });
    return Promise.resolve(result);
  }

  read(fromSeq: number, limit: number): Promise<StoredEvent[]> {
    const rows = [
      ...this.storage.sql.exec<EventRow>(
        'SELECT * FROM events WHERE seq >= ? ORDER BY seq ASC LIMIT ?',
        fromSeq,
        limit,
      ),
    ];
    return Promise.resolve(rows.map((row) => rowToEvent(this.streamId, row)));
  }

  head(): Promise<number> {
    const rows = [...this.storage.sql.exec<{ head: SqlStorageValue }>('SELECT MAX(seq) AS head FROM events')];
    return Promise.resolve(Number(rows[0]?.head) || 0);
  }

  getMeta(key: string): Promise<string | undefined> {
    const rows = [...this.storage.sql.exec<{ value: string }>('SELECT value FROM meta WHERE key = ?', key)];
    return Promise.resolve(rows[0]?.value);
  }

  setMeta(key: string, value: string): Promise<void> {
    this.storage.sql.exec(
      `INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
      key,
      value,
    );
    return Promise.resolve();
  }

  findByIds(ids: string[]): Promise<StoredEvent[]> {
    if (ids.length === 0) return Promise.resolve([]);
    const placeholders = ids.map(() => '?').join(', ');
    const rows = [...this.storage.sql.exec<EventRow>(`SELECT * FROM events WHERE id IN (${placeholders})`, ...ids)];
    return Promise.resolve(rows.map((row) => rowToEvent(this.streamId, row)));
  }

  /** `ports/stream.ts`'s revert-target `txId` resolution extension (final whole-branch review,
   * second wave) — "ANY one" per that doc comment's own reasoning; `LIMIT 1` is all this needs. */
  findAnyByTxId(txId: string): Promise<StoredEvent | undefined> {
    const rows = [...this.storage.sql.exec<EventRow>('SELECT * FROM events WHERE tx_id = ? LIMIT 1', txId)];
    return Promise.resolve(rows[0] ? rowToEvent(this.streamId, rows[0]) : undefined);
  }

  /** `json` is stored as the exact text received (`ports/stream.ts`'s `putPack` contract) — the
   * campaign pack relay hashes these bytes. Chunked (`PACK_CHUNK_BYTES`) so a body above the DO
   * SQLite 2 MB value cap fits; the header row and every chunk are replaced in one transaction.
   * The route only ever passes text decoded from valid UTF-8, so the UTF-8 round trip is exact. */
  putPack(id: string, version: string, json: string): Promise<void> {
    this.storage.transactionSync(() => {
      writePackRows(this.storage, id, version, json);
    });
    return Promise.resolve();
  }

  getPack(id: string): Promise<StoredPack | undefined> {
    const rows = [...this.storage.sql.exec<PackRow>('SELECT id, version, bytes, chunks FROM packs WHERE id = ?', id)];
    const row = rows[0];
    return Promise.resolve(row ? readPackBody(this.storage, row) : undefined);
  }

  listPacks(): Promise<StoredPack[]> {
    const rows = [...this.storage.sql.exec<PackRow>('SELECT id, version, bytes, chunks FROM packs')];
    return Promise.resolve(rows.map((row) => readPackBody(this.storage, row)));
  }

  deletePack(id: string): Promise<void> {
    this.storage.transactionSync(() => {
      this.storage.sql.exec('DELETE FROM pack_chunks WHERE id = ?', id);
      this.storage.sql.exec('DELETE FROM packs WHERE id = ?', id);
    });
    return Promise.resolve();
  }

  /** `ports/stream.ts`'s hard-delete contract ("the whole stream or nothing"): `storage.deleteAll()`
   * — a Durable Object storage primitive that wipes EVERY key/table this DO owns, tables included —
   * is the literal Cloudflare realization of that file's own doc comment ("dropping the DO's own
   * SQLite database on Cloudflare"), simpler and more complete than deleting each table
   * individually. If this stream's DO is ever addressed again afterward (not expected in Phase 2 —
   * `DELETE /api/characters/:id` also removes the D1 index row that's the only way a client learns
   * this streamId again — but a stray retry isn't a correctness bug either way), the NEXT
   * `DoSqlStreamStore` constructed against it just re-runs `ensureSchema` and starts a fresh, empty
   * stream, exactly like a brand-new one. */
  async deleteAll(): Promise<void> {
    await this.storage.deleteAll();
  }
}
