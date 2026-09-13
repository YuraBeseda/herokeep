import { inject, Injectable } from '@angular/core';
import { HkDb, type BlobRow } from './dexie.db';

/**
 * Content-addressed blob store (portraits, etc.); `hash` is the primary key, so `put` is
 * naturally idempotent — writing the same hash twice just overwrites with (byte-identical)
 * content. Nothing here ever deletes a row: plan 6 (images) shipped no reference-counting or
 * sweep, so a blob no longer referenced by any character (a replaced/removed portrait, a deleted
 * character) simply accumulates rather than being reclaimed. Refcount/sweep cleanup is backlogged
 * post-1b.
 */
@Injectable({ providedIn: 'root' })
export class BlobsRepository {
  private readonly db = inject(HkDb);

  /** `meta` (plan-6 Task 8) is optional and purely additive — every existing call site (and this
   * file's own pre-Task-8 spec) keeps compiling and behaving unchanged without it; a caller that
   * writes a portrait/thumb/token blob passes `kind`/`width`/`height` so `BlobUrlPipe`/a future
   * by-kind lookup can tell the three apart. */
  async put(
    hash: string,
    mime: string,
    bytes: Uint8Array,
    meta?: { kind?: BlobRow['kind']; width?: number; height?: number },
  ): Promise<void> {
    await this.db.blobs.put({ hash, mime, bytes, size: bytes.byteLength, ...meta });
  }

  async get(hash: string): Promise<BlobRow | undefined> {
    return this.db.blobs.get(hash);
  }
}
