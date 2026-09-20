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
 * at the one place it actually matters (the schema itself).
 *
 * `DurableObjectStorage.transactionSync` (not a bare sequence of `sql.exec` calls) wraps every
 * multi-statement write (`append`, `deleteAll`) — SQLite-backed DO storage does not implicitly
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
      json TEXT NOT NULL
    );
  `);
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

  putPack(id: string, version: string, json: unknown): Promise<void> {
    this.storage.sql.exec(
      `INSERT INTO packs (id, version, json) VALUES (?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET version = excluded.version, json = excluded.json`,
      id,
      version,
      JSON.stringify(json),
    );
    return Promise.resolve();
  }

  getPack(id: string): Promise<StoredPack | undefined> {
    const rows = [
      ...this.storage.sql.exec<{ id: string; version: string; json: string }>(
        'SELECT id, version, json FROM packs WHERE id = ?',
        id,
      ),
    ];
    const row = rows[0];
    return Promise.resolve(
      row ? { id: row.id, version: row.version, json: JSON.parse(row.json) as unknown } : undefined,
    );
  }

  listPacks(): Promise<StoredPack[]> {
    const rows = [
      ...this.storage.sql.exec<{ id: string; version: string; json: string }>('SELECT id, version, json FROM packs'),
    ];
    return Promise.resolve(
      rows.map((row) => ({ id: row.id, version: row.version, json: JSON.parse(row.json) as unknown })),
    );
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
