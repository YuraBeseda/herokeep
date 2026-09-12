import { inject, Injectable } from '@angular/core';
import { ENGINE_VERSION, type Snapshot } from '@hk/engine';
import { HkDb, type SnapshotRow } from './dexie.db';

/**
 * One-snapshot-per-stream cache. `get` prunes (deletes) a row whose `engineVersion` no longer
 * matches the running engine — `reduce` would ignore its `facts` anyway, so a stale row is only
 * ever dead weight — and returns `undefined` so the caller falls back to a full replay.
 *
 * Revert seam (see `preScanReverted` in `@hk/engine`'s reducer.ts for the engine-side half): a
 * snapshot freezes `reduce`'s revert pre-scan to only the events folded so far, so a
 * `event.reverted` appended AFTER a snapshot was taken cannot un-apply a target from before that
 * snapshot when reducing incrementally on top of it. Callers (the CharacterStore) MUST delete
 * this repository's row for a stream — or otherwise force a full replay from seq 0 — whenever an
 * `event.reverted` is appended to that stream.
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
