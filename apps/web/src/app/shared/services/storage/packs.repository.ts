import { inject, Injectable } from '@angular/core';
import type { Pack } from '@hk/protocol';
import { HkDb, type PackRow } from './dexie.db';

@Injectable({ providedIn: 'root' })
export class PacksRepository {
  private readonly db = inject(HkDb);

  // Methods
  async putPack(pack: Pack): Promise<void> {
    const row: PackRow = {
      key: `${pack.id}@${pack.version}`,
      id: pack.id,
      version: pack.version,
      kind: pack.kind,
      locale: pack.kind === 'translation' ? pack.locale : undefined,
      json: pack,
    };
    await this.db.packs.put(row);
  }

  async getAll(): Promise<Pack[]> {
    const rows = await this.db.packs.toArray();
    return rows.map((row) => row.json);
  }

  async remove(key: string): Promise<void> {
    await this.db.packs.delete(key);
  }
}
