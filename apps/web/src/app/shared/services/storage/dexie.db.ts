import { Inject, Injectable, InjectionToken } from '@angular/core';
import Dexie, { type EntityTable } from 'dexie';
import type { Event, MembershipRole, Pack } from '@hk/protocol';
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

/** Content-addressed binary blob (portraits, etc.); `hash` is the primary key.
 *
 * `kind`/`width`/`height` (plan-6 Task 8, design ruling 3) are TYPE-ONLY additions — they are
 * plain (non-indexed) fields Dexie just stores/returns as part of the row's structured-clone
 * payload, not schema-declared index keys, so adding them needed NO `version()` bump/migration
 * (Dexie only indexes fields listed in a `stores()` schema string — see `HkDb`'s own class doc).
 * `kind` is widened here (plan-10 Task 2) to the full doc-07 set (`icon`/`banner` added) — still
 * type-only, nothing writes those two values yet.
 *
 * `addedAt`/`lastUsedAt`/`pinned`/`origin` (plan-10 Task 2, doc-07 "Blob record") are REQUIRED,
 * unlike `kind`/`width`/`height` above — every row from here on must carry them, so they get a
 * real `version(3)` bump WITH an `.upgrade()` (see `HkDb`'s constructor) that backfills sane
 * defaults onto every pre-existing row; a type-only addition would leave old rows silently
 * `undefined` forever. Written by `BlobsRepository.put()` (which stamps the defaults) and read
 * back by `BlobUrlPipe`/a future by-kind lookup. The FIELDS only — `pinned`'s real cache-eviction
 * meaning (LRU cap, sweep) is Task 13; nothing here reads these fields for eviction decisions. */
export interface BlobRow {
  hash: string;
  mime: string;
  bytes: Uint8Array;
  size: number;
  kind?: 'icon' | 'portrait' | 'thumb' | 'token' | 'banner';
  width?: number;
  height?: number;
  /** Epoch ms this row was first written. */
  addedAt: number;
  /** Epoch ms this row was last written/touched; Task 13 updates this on read-driven "used". */
  lastUsedAt: number;
  /** Task 13's eviction never removes a pinned blob — this task ships the FIELD only (upgrade
   * default below; `BlobsRepository.put` defaults new writes to `false`), no eviction logic. */
  pinned: boolean;
  origin: 'upload' | 'peer' | 'import' | 'pack';
}

/**
 * Cached list-view index row for a campaign — mirrors `CharacterRow`'s role for characters.
 * Campaign TRUTH is the `camp:<id>` event stream (Task 3's `campaign-projection.ts`) plus the
 * server; this row is a local, denormalized read model so the campaigns list never has to replay
 * a full campaign log just to show a name/role. `role` matches the server's `CampaignDto`
 * (`apps/api/src/core/routes/campaigns.ts`) exactly: `'dm' | 'player'` via `@hk/protocol`'s
 * `MembershipRole`. `joinCode` is present only for a campaign this device DMs (the server never
 * sends it to a member — `CampaignDto`'s own doc comment) — optional, never `null`/empty-string
 * for the non-DM case, same convention as the server DTO. `lastSeq` is this device's locally-known
 * head for the campaign stream, used for `hello`/subscribe resumption (doc-03).
 */
export interface CampaignRow {
  id: string;
  name: string;
  system: string;
  role: MembershipRole;
  joinCode?: string;
  lastSeq: number;
  updatedAt: number;
}

/** The database name `HkDb` opens — an `InjectionToken` (not a plain constructor default) because
 * a bare `name = 'hk-db'` constructor parameter gives Angular's DI compiler no injection token to
 * resolve it from (`NG2003: No suitable injection token for parameter 'name'`) on a class the DI
 * system itself instantiates. Defaults to the app's single real database name — every production
 * call site (`inject(HkDb)`) gets exactly today's behavior, unaffected by this token's existence.
 * The override exists solely so a test harness that needs TWO genuinely separate on-disk (well,
 * fake-indexeddb) databases in the same process — simulating two independent devices sharing
 * nothing — can provide a second `HkDb` under a different name (via `{ provide: HkDb, useFactory:
 * () => new HkDb('other-name') }`, or `{ provide: HK_DB_NAME, useValue: 'other-name' }`) without
 * duplicating this class's schema (`sync-integration.spec.ts`). */
export const HK_DB_NAME = new InjectionToken<string>('HK_DB_NAME', { factory: () => 'hk-db' });

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
  campaigns!: EntityTable<CampaignRow, 'id'>;

  // The default here (also `HK_DB_NAME`'s own factory default) is for `dexie.db.spec.ts`'s direct
  // `new HkDb()` construction (bypassing Angular DI entirely) — a real DI-resolved construction
  // always supplies the token's value explicitly and never falls through to this default.
  //
  // Constructor-parameter injection (`@Inject`), not the `inject()` function the lint rule below
  // otherwise wants: `inject()` requires an active DI injection context, which `dexie.db.spec.ts`'s
  // direct `new HkDb()` construction (see above) deliberately does NOT have — a `super(inject(...))`
  // call would throw `NG0203` for that spec instead of falling through to this default.
  // eslint-disable-next-line @angular-eslint/prefer-inject -- see comment above
  constructor(@Inject(HK_DB_NAME) name = 'hk-db') {
    super(name);
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
    // Plan 10 Task 2: `campaigns` (a NEW table, so its index string must be listed) plus an
    // `.upgrade()` for the EXISTING `blobs` table's new required fields — `blobs`'s own index
    // string (`&hash`) is unchanged, so it's not relisted here (Dexie carries forward any table
    // this version's `stores()` doesn't mention). Campaign events themselves live in the
    // EXISTING `events` table under `stream: 'camp:<id>'` (same `[stream+seq]` index already
    // serves campaign reads) — no new events table.
    this.version(3)
      .stores({
        campaigns: '&id',
      })
      .upgrade(async (tx) => {
        // `pinned:true` for a hash referenced by any character's `portraitThumbHash` — the ONLY
        // portrait-related hash `CharacterRow` actually indexes (it stores no full-portrait or
        // token hash), so that's the only pin signal this migration can compute; every other
        // pre-existing blob (full portraits, tokens, icons — anything not a pinned thumb) defaults
        // `pinned: false`. Task 13 owns the real cache-management logic this field feeds.
        const pinnedHashes = new Set<string>();
        await tx
          .table<CharacterRow, string>('characters')
          .toCollection()
          .each((character) => {
            if (character.portraitThumbHash) pinnedHashes.add(character.portraitThumbHash);
          });

        const now = Date.now();
        await tx
          .table<BlobRow, string>('blobs')
          .toCollection()
          .modify((row) => {
            row.addedAt = now;
            row.lastUsedAt = now;
            row.origin = 'upload';
            row.pinned = pinnedHashes.has(row.hash);
          });
      });
  }
}
