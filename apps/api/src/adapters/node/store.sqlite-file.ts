/**
 * `StreamStore` over `better-sqlite3` (ADR-014's Node `StreamStore` row; doc-10 §node: "one
 * `streams.sqlite` in WAL mode keyed by `(stream_id, seq)`"). ONE file backs every stream: doc-02's
 * per-stream `events(seq PK, id UNIQUE, type, v, ts, actor_json, tx_id, payload_json, bytes)` /
 * `meta(key PK, value)` / `packs(id, version, json)` tables are each widened with a leading
 * `stream_id` column and re-keyed `(stream_id, ...)` so a single SQLite database — not one file
 * per character — holds every stream (task-7-brief: "keyed `(stream_id, seq)`"); a `StreamStore`
 * INSTANCE stays scoped to exactly one `streamId` (`ports/stream.ts`'s class doc comment), it just
 * shares the underlying `Database` handle/file with every other stream's instance.
 *
 * `events.id` is UNIQUE PER STREAM (`(stream_id, id)`), not globally — doc-02's bare `id TEXT
 * UNIQUE` describes a per-stream-database schema (Cloudflare: one DO SQLite database per stream);
 * widened to a shared file, the uniqueness constraint has to widen with it or two unrelated
 * streams could never reuse the same uuidv7, which is not a real constraint doc-02 intends.
 */
import Database from 'better-sqlite3';
import type { Event } from '@hk/protocol';
import type { AppendResult, StoredEvent, StoredPack, StreamStore } from '../../ports/stream.ts';

/** Creates the shared schema if this is a fresh `streams.sqlite` file. Idempotent (`IF NOT
 * EXISTS` throughout) so every adapter boot (dev restart, test reopen) can call it unconditionally
 * instead of tracking "have I already created this" separately from the migration itself — there
 * is exactly one shape, forever (this store has no migration history the way the accounts DB
 * does: it's an append-only event log, never altered in place). */
export function ensureStreamsSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      stream_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      id TEXT NOT NULL,
      type TEXT NOT NULL,
      v INTEGER NOT NULL,
      ts TEXT NOT NULL,
      actor_json TEXT NOT NULL,
      tx_id TEXT,
      payload_json TEXT NOT NULL,
      bytes INTEGER NOT NULL,
      PRIMARY KEY (stream_id, seq)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS events_stream_event_id_idx ON events (stream_id, id);
    CREATE TABLE IF NOT EXISTS meta (
      stream_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      PRIMARY KEY (stream_id, key)
    );
    CREATE TABLE IF NOT EXISTS packs (
      stream_id TEXT NOT NULL,
      id TEXT NOT NULL,
      version TEXT NOT NULL,
      json TEXT NOT NULL,
      PRIMARY KEY (stream_id, id)
    );
  `);
}

interface EventRow {
  readonly stream_id: string;
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

function rowToEvent(row: EventRow): StoredEvent {
  return {
    id: row.id,
    stream: row.stream_id,
    seq: row.seq,
    ts: row.ts,
    actor: JSON.parse(row.actor_json) as Event['actor'],
    type: row.type,
    v: row.v,
    txId: row.tx_id ?? undefined,
    payload: JSON.parse(row.payload_json) as unknown,
  };
}

/** One `StreamStore` scoped to `streamId`, backed by the shared `db` handle (see this file's
 * header comment). Every query below filters/keys on `stream_id` so instances sharing a `db`
 * never see each other's rows. */
export class SqliteFileStreamStore implements StreamStore {
  private readonly db: Database.Database;
  private readonly streamId: string;

  constructor(db: Database.Database, streamId: string) {
    this.db = db;
    this.streamId = streamId;
  }

  append(events: Event[]): Promise<AppendResult> {
    if (events.length === 0) return Promise.resolve({ firstSeq: 0, lastSeq: 0 });
    const insert = this.db.prepare(
      `INSERT INTO events (stream_id, seq, id, type, v, ts, actor_json, tx_id, payload_json, bytes)
       VALUES (@streamId, @seq, @id, @type, @v, @ts, @actorJson, @txId, @payloadJson, @bytes)`,
    );
    const headStmt = this.db.prepare('SELECT MAX(seq) AS head FROM events WHERE stream_id = ?');
    // ONE transaction (ports/stream.ts's `StreamStore.append` contract: "commits them in one
    // transaction"): the head read and every insert happen atomically under better-sqlite3's
    // synchronous transaction wrapper, so a concurrent append against the SAME streamId (guarded
    // upstream by the adapter's per-actor mutex — see `stream-host.ts` — but defended here too,
    // since this store is a reusable unit any caller could misuse) can never observe/assign an
    // overlapping seq range.
    const runAppend = this.db.transaction((batch: Event[]) => {
      const headRow = headStmt.get(this.streamId) as { head: number | null };
      let seq = (headRow.head ?? 0) + 1;
      const firstSeq = seq;
      for (const event of batch) {
        const payloadJson = JSON.stringify(event.payload ?? null);
        insert.run({
          streamId: this.streamId,
          seq,
          id: event.id,
          type: event.type,
          v: event.v,
          ts: event.ts,
          actorJson: JSON.stringify(event.actor),
          txId: event.txId ?? null,
          payloadJson,
          bytes: Buffer.byteLength(payloadJson, 'utf8'),
        });
        seq += 1;
      }
      return { firstSeq, lastSeq: seq - 1 };
    });
    return Promise.resolve(runAppend(events));
  }

  read(fromSeq: number, limit: number): Promise<StoredEvent[]> {
    const rows = this.db
      .prepare('SELECT * FROM events WHERE stream_id = ? AND seq >= ? ORDER BY seq ASC LIMIT ?')
      .all(this.streamId, fromSeq, limit) as EventRow[];
    return Promise.resolve(rows.map(rowToEvent));
  }

  head(): Promise<number> {
    const row = this.db.prepare('SELECT MAX(seq) AS head FROM events WHERE stream_id = ?').get(this.streamId) as {
      head: number | null;
    };
    return Promise.resolve(row.head ?? 0);
  }

  getMeta(key: string): Promise<string | undefined> {
    const row = this.db.prepare('SELECT value FROM meta WHERE stream_id = ? AND key = ?').get(this.streamId, key) as
      { value: string } | undefined;
    return Promise.resolve(row?.value);
  }

  setMeta(key: string, value: string): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO meta (stream_id, key, value) VALUES (?, ?, ?)
         ON CONFLICT (stream_id, key) DO UPDATE SET value = excluded.value`,
      )
      .run(this.streamId, key, value);
    return Promise.resolve();
  }

  /** `ports/stream.ts`'s dedupe-lookup extension (Task 5): one `IN (...)` query per call, scoped
   * to this stream. Placeholder count is built from `ids.length` — safe from SQL injection since
   * every bound value goes through `better-sqlite3`'s parameter binding, never string-interpolated
   * into the query text itself. */
  findByIds(ids: string[]): Promise<StoredEvent[]> {
    if (ids.length === 0) return Promise.resolve([]);
    const placeholders = ids.map(() => '?').join(', ');
    const rows = this.db
      .prepare(`SELECT * FROM events WHERE stream_id = ? AND id IN (${placeholders})`)
      .all(this.streamId, ...ids) as EventRow[];
    return Promise.resolve(rows.map(rowToEvent));
  }

  /** `ports/stream.ts`'s revert-target `txId` resolution extension (final whole-branch review,
   * second wave) — "ANY one" per that doc comment's own reasoning; `LIMIT 1` is all this needs. */
  findAnyByTxId(txId: string): Promise<StoredEvent | undefined> {
    const row = this.db
      .prepare('SELECT * FROM events WHERE stream_id = ? AND tx_id = ? LIMIT 1')
      .get(this.streamId, txId) as EventRow | undefined;
    return Promise.resolve(row ? rowToEvent(row) : undefined);
  }

  putPack(id: string, version: string, json: unknown): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO packs (stream_id, id, version, json) VALUES (?, ?, ?, ?)
         ON CONFLICT (stream_id, id) DO UPDATE SET version = excluded.version, json = excluded.json`,
      )
      .run(this.streamId, id, version, JSON.stringify(json));
    return Promise.resolve();
  }

  getPack(id: string): Promise<StoredPack | undefined> {
    const row = this.db
      .prepare('SELECT id, version, json FROM packs WHERE stream_id = ? AND id = ?')
      .get(this.streamId, id) as { id: string; version: string; json: string } | undefined;
    return Promise.resolve(
      row ? { id: row.id, version: row.version, json: JSON.parse(row.json) as unknown } : undefined,
    );
  }

  listPacks(): Promise<StoredPack[]> {
    const rows = this.db.prepare('SELECT id, version, json FROM packs WHERE stream_id = ?').all(this.streamId) as {
      id: string;
      version: string;
      json: string;
    }[];
    return Promise.resolve(rows.map((r) => ({ id: r.id, version: r.version, json: JSON.parse(r.json) as unknown })));
  }

  /** `ports/stream.ts`'s hard-delete extension (Task 6): wipes every row this streamId owns
   * across all three tables, in one transaction — "the whole stream or nothing" (that doc
   * comment). Other streams sharing the same `db` file/handle are untouched (every statement is
   * `WHERE stream_id = ?`). */
  deleteAll(): Promise<void> {
    const runDelete = this.db.transaction(() => {
      this.db.prepare('DELETE FROM events WHERE stream_id = ?').run(this.streamId);
      this.db.prepare('DELETE FROM meta WHERE stream_id = ?').run(this.streamId);
      this.db.prepare('DELETE FROM packs WHERE stream_id = ?').run(this.streamId);
    });
    runDelete();
    return Promise.resolve();
  }
}

/** Opens (creating if absent) `streams.sqlite` at `path` in WAL mode with the shared schema ready
 * — the ONE `Database` handle every `SqliteFileStreamStore` instance for this process shares
 * (`stream-host.ts` constructs one per `streamId` against the same handle). WAL mode (doc-10 §node,
 * ADR-014's `StreamStore` row: "in WAL mode") lets readers and the single writer proceed without
 * blocking each other and is what makes the self-host backup recipe's "safe to copy after
 * `PRAGMA wal_checkpoint`" claim (ADR-014 §Adapter B deployment recipe) true. */
export function openStreamsDb(path: string): Database.Database {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  ensureStreamsSchema(db);
  return db;
}
