import { inject, Injectable } from '@angular/core';
import { HkDb, type BlobRow } from './dexie.db';

/**
 * Content-addressed blob store (portraits, etc.); `hash` is the primary key, so `put` is
 * naturally idempotent — writing the same hash twice overwrites the content/meta fields with
 * (byte-identical) content, while PRESERVING that row's `addedAt`/`pinned`/`origin` (fix-round 1,
 * see `put`'s own doc) rather than resetting them. Nothing here ever deletes a row: plan 6
 * (images) shipped no reference-counting or sweep, so a blob no longer referenced by any
 * character (a replaced/removed portrait, a deleted character) simply accumulates rather than
 * being reclaimed. Refcount/sweep cleanup is backlogged post-1b.
 */
@Injectable({ providedIn: 'root' })
export class BlobsRepository {
  private readonly db = inject(HkDb);

  /** `meta` (plan-6 Task 8) is optional and purely additive — every existing call site (and this
   * file's own pre-Task-8 spec) keeps compiling and behaving unchanged without it; a caller that
   * writes a portrait/thumb/token blob passes `kind`/`width`/`height` so `BlobUrlPipe`/a future
   * by-kind lookup can tell the three apart.
   *
   * Plan-10 Task 2: `addedAt`/`lastUsedAt`/`pinned`/`origin` (doc-07 "Blob record") are now
   * REQUIRED on `BlobRow`. A NEW hash stamps sane defaults — `addedAt`/`lastUsedAt: now()`,
   * `pinned: false`, `origin: 'upload'` (the only origin any current caller produces; nothing
   * writes a peer/import/pack blob yet).
   *
   * Fix-round 1 (Task-2 review, [Important]): a re-`put` of an EXISTING hash PRESERVES its
   * `addedAt`/`pinned`/`origin` — only `lastUsedAt` (and the content/meta fields) advance. The
   * caller has no way to pass `pinned`/`origin` through `meta`, so re-stamping them on every
   * write would silently unpin/un-attribute a row on any re-upload of byte-identical content
   * (`ImagePipelineService.processPortrait` calls `put` unconditionally, no get-before-put
   * guard) — defeating the version(3) upgrade's pin signal before Task 13 ever reads it. This is
   * still FIELD preservation only, not cache-management logic (Task 13 owns eviction/LRU). */
  async put(
    hash: string,
    mime: string,
    bytes: Uint8Array,
    meta?: { kind?: BlobRow['kind']; width?: number; height?: number },
  ): Promise<void> {
    const now = Date.now();
    const existing = await this.db.blobs.get(hash);
    await this.db.blobs.put({
      hash,
      mime,
      bytes,
      size: bytes.byteLength,
      addedAt: existing?.addedAt ?? now,
      lastUsedAt: now,
      pinned: existing?.pinned ?? false,
      origin: existing?.origin ?? 'upload',
      ...meta,
    });
  }

  async get(hash: string): Promise<BlobRow | undefined> {
    return this.db.blobs.get(hash);
  }
}
