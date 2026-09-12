import { Injectable } from '@angular/core';
import Dexie, { type EntityTable } from 'dexie';
import type { Event, Pack } from '@hk/protocol';
import type { Snapshot } from '@hk/engine';

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
 * One row per event. `seq` is set at local-commit time (Task 16's `EventsRepository.append`,
 * via `nextSeq`) — this device is the only writer for now, so every row `append` itself writes
 * always has a `seq`. `pendingOrder` is reserved for Phase 2 sync (a monotonic per-stream
 * ordinal for events a sync layer stores before this device assigns their real `seq`); it is not
 * written by anything in Task 16, but `EventsRepository.byStream` already orders any seq-less row
 * by it, so the field's storage shape is ready for that future writer.
 */
export interface EventRow {
  id: string;
  stream: string;
  seq?: number;
  pendingOrder?: number;
  json: Event;
}

/**
 * One row per character stream's latest snapshot (`&stream` — at most one per stream).
 * `SnapshotsRepository.get` prunes a row whose `engineVersion` no longer matches the running
 * engine: `reduce` would ignore its `facts` anyway, so a stale row is only ever dead weight.
 */
export interface SnapshotRow {
  stream: string;
  seq: number;
  engineVersion: string;
  json: Snapshot;
}

/**
 * Library index row — one per character, kept in sync with its event stream by
 * `CharactersRepository.upsertFromFacts` so the browse list never has to replay every stream's
 * full event log just to show a name.
 */
export interface CharacterRow {
  id: string;
  name: string;
  system: string;
  archived: boolean;
  updatedAt: number;
  portraitThumbHash?: string;
}

/** Content-addressed binary blob (portraits, etc.); `hash` is the primary key. */
export interface BlobRow {
  hash: string;
  mime: string;
  bytes: Uint8Array;
  size: number;
}

/**
 * The app's single IndexedDB database. Schema version 1; future migrations are added as new
 * `this.version(n).stores(...)` calls in this constructor, never by editing an existing one
 * (docs/02-architecture/09-frontend-architecture.md). Dexie merges each version's `stores()` call
 * onto the accumulated schema from every earlier version, so version(2) below only needs to list
 * the tables it adds — `packs`/`settings` carry forward from version(1) untouched.
 */
@Injectable({ providedIn: 'root' })
export class HkDb extends Dexie {
  packs!: EntityTable<PackRow, 'key'>;
  settings!: EntityTable<SettingsRow, 'key'>;
  events!: EntityTable<EventRow, 'id'>;
  snapshots!: EntityTable<SnapshotRow, 'stream'>;
  characters!: EntityTable<CharacterRow, 'id'>;
  blobs!: EntityTable<BlobRow, 'hash'>;

  constructor() {
    super('hk-db');
    this.version(1).stores({
      packs: '&key, id, version, kind',
      settings: '&key',
    });
    // Task 16: events/snapshots/characters/blobs for the character storage layer.
    this.version(2).stores({
      events: '&id, stream, [stream+seq]',
      snapshots: '&stream',
      characters: '&id, name, updatedAt',
      blobs: '&hash',
    });
  }
}
