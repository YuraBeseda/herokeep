import { Injectable } from '@angular/core';
import Dexie, { type EntityTable } from 'dexie';
import type { Pack } from '@hk/protocol';

/** One row per installed pack; `key` is `<id>@<version>`, unique across the whole table. */
export interface PackRow {
  key: string;
  id: string;
  version: string;
  kind: Pack['kind'];
  locale?: string;
  json: Pack;
}

/** Small key/value rows for persisted preferences (`SettingsRepository`, Task 13). */
export interface SettingsRow {
  key: string;
  value: unknown;
}

/**
 * The app's single IndexedDB database. Schema version 1; future migrations are added as new
 * `this.version(n).stores(...)` calls in this constructor, never by editing an existing one
 * (docs/02-architecture/09-frontend-architecture.md).
 */
@Injectable({ providedIn: 'root' })
export class HkDb extends Dexie {
  packs!: EntityTable<PackRow, 'key'>;
  settings!: EntityTable<SettingsRow, 'key'>;

  constructor() {
    super('hk-db');
    this.version(1).stores({
      packs: '&key, id, version, kind',
      settings: '&key',
    });
  }
}
