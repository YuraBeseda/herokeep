/**
 * `MaintenanceStreams` over the shared `streams.sqlite` file (`ports/stream.ts`'s doc comment;
 * ADR-014's Node `StreamStore` row: one file backs every stream). Reads `meta`/`events` directly
 * against the raw `better-sqlite3` handle rather than going through a per-stream
 * `SqliteFileStreamStore` instance — this is a batch, read-mostly job over potentially every
 * stream in the file, not a single stream's single-writer actor path.
 */
import type Database from 'better-sqlite3';
import type { MaintenanceStreams, StreamUsage } from '../../ports/stream.ts';

export class NodeMaintenanceStreams implements MaintenanceStreams {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  getStreamUsage(streamId: string): Promise<StreamUsage> {
    const rows = this.db
      .prepare('SELECT key, value FROM meta WHERE stream_id = ? AND key IN (?, ?)')
      .all(streamId, 'bytes_used', 'event_count') as { key: string; value: string }[];
    const byKey = new Map(rows.map((r) => [r.key, r.value]));
    const bytesUsedRaw = byKey.get('bytes_used');
    const eventCountRaw = byKey.get('event_count');
    return Promise.resolve({
      bytesUsed: bytesUsedRaw ? Number(bytesUsedRaw) : 0,
      eventCount: eventCountRaw ? Number(eventCountRaw) : 0,
    });
  }

  /** `MaintenanceStreams.listStreamIds` (`ports/stream.ts`'s doc comment) — cheap on Node: a
   * `UNION` of the distinct `stream_id`s in `events` and `meta` (a stream that has meta but zero
   * events — theoretically possible if `character.created` never lands — must still be counted
   * as "a stream that exists" for the orphan check to see it). */
  listStreamIds(): Promise<string[]> {
    const rows = this.db.prepare('SELECT stream_id FROM events UNION SELECT stream_id FROM meta').all() as {
      stream_id: string;
    }[];
    return Promise.resolve(rows.map((r) => r.stream_id));
  }
}
