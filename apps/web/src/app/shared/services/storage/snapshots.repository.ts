import { inject, Injectable } from '@angular/core';
import { ENGINE_VERSION, type Snapshot } from '@hk/engine';
import { HkDb, type SnapshotRow } from './dexie.db';

/**
 * One-snapshot-per-stream cache. `get` prunes (deletes) a row whose `engineVersion` no longer
 * matches the running engine — `reduce` would ignore its `facts` anyway, so a stale row is only
 * ever dead weight — and returns `undefined` so the caller falls back to a full replay.
 */
@Injectable({ providedIn: 'root' })
export class SnapshotsRepository {
  private readonly db = inject(HkDb);

  async put(stream: string, snapshot: Snapshot): Promise<void> {
    const row: SnapshotRow = {
      stream,
      seq: snapshot.seq,
      engineVersion: snapshot.engineVersion,
      json: snapshot,
    };
    await this.db.snapshots.put(row);
  }

  async get(stream: string): Promise<Snapshot | undefined> {
    const row = await this.db.snapshots.get(stream);
    if (!row) return undefined;
    if (row.engineVersion !== ENGINE_VERSION) {
      await this.db.snapshots.delete(stream);
      return undefined;
    }
    return row.json;
  }
}
