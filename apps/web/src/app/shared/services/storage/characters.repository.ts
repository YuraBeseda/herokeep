import { inject, Injectable } from '@angular/core';
import type { Facts } from '@hk/engine';
import { HkDb, type CharacterRow } from './dexie.db';

/**
 * Library index over character streams — CRUD plus `upsertFromFacts`, which plan 5's
 * `CharacterStore` calls after every reduce to keep the browse list in sync without replaying
 * every stream's full event log just to show a name.
 */
@Injectable({ providedIn: 'root' })
export class CharactersRepository {
  private readonly db = inject(HkDb);

  /** All characters, most recently updated first. */
  async list(): Promise<CharacterRow[]> {
    return this.db.characters.orderBy('updatedAt').reverse().toArray();
  }

  async get(id: string): Promise<CharacterRow | undefined> {
    return this.db.characters.get(id);
  }

  async put(row: CharacterRow): Promise<void> {
    await this.db.characters.put(row);
  }

  async remove(id: string): Promise<void> {
    await this.db.characters.delete(id);
  }

  /** Maps `Facts.name`/`system`/`archived`/`portrait.thumbHash` onto the `streamId`'s index row and stamps `updatedAt`. */
  async upsertFromFacts(streamId: string, facts: Facts): Promise<void> {
    const row: CharacterRow = {
      id: streamId,
      name: facts.name,
      system: facts.system,
      archived: facts.archived,
      updatedAt: Date.now(),
      portraitThumbHash: facts.portrait?.thumbHash,
    };
    await this.db.characters.put(row);
  }
}
