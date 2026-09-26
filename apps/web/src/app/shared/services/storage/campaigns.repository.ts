import { inject, Injectable } from '@angular/core';
import { HkDb, type CampaignRow } from './dexie.db';

/**
 * Cached list-view index over campaign streams; `id` is the primary key, so `put` is naturally
 * idempotent — writing the same id twice just overwrites. Mirrors `CharactersRepository`'s CRUD
 * shape exactly (plan 10 Task 2 brief: "follow their established patterns"). Campaign TRUTH is
 * the `camp:<id>` event stream (Task 3's `campaign-projection.ts`) plus the server; this table
 * exists purely so the campaigns list view never has to replay a full campaign log just to show
 * a name/role — a future task's projector/store is expected to call `put` after every reduce,
 * the same way `CharactersRepository.upsertFromFacts` does for characters (no such helper is
 * added here yet: this task ships storage only, no projection/store wiring — scope guard).
 */
@Injectable({ providedIn: 'root' })
export class CampaignsRepository {
  private readonly db = inject(HkDb);

  /** All campaigns, most recently updated first. Sorted in memory rather than via `orderBy`:
   * the `campaigns` table's only index is `&id` (brief's exact schema), so `updatedAt` isn't
   * indexed — fine for a locally-cached list expected to hold a handful of rows per device. */
  async list(): Promise<CampaignRow[]> {
    const rows = await this.db.campaigns.toArray();
    return rows.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async get(id: string): Promise<CampaignRow | undefined> {
    return this.db.campaigns.get(id);
  }

  async put(row: CampaignRow): Promise<void> {
    await this.db.campaigns.put(row);
  }

  async remove(id: string): Promise<void> {
    await this.db.campaigns.delete(id);
  }
}
