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

  /** [plan-10 Task 13] `BlobUrlPipe`'s own invalidation seam: a pure pipe's `transform()` is only
   * re-invoked when ITS OWN argument (the hash) changes — never when the underlying storage does
   * — so a hash that resolved to "not found" on a first look would otherwise stay blank forever
   * even after the blob-transfer service stores it moments later. `put()` calls every registered
   * listener with the hash it just wrote; a listener with no interest in that hash is expected to
   * ignore the call (see `BlobUrlPipe`'s own doc). */
  private readonly arrivalListeners = new Set<(hash: string) => void>();

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
   * `addedAt`/`pinned`/`origin` — only `lastUsedAt` (and the content/meta fields) advance. This
   * is still FIELD preservation only, not cache-management logic (Task 13 owns eviction/LRU).
   *
   * Plan-10 Task 13 fix-round 1 ([Important]): `meta.origin` lets a caller stamp a NEW row's
   * origin explicitly (`BlobTransferService.finishAssembly` passes `'peer'` for a
   * doc-07-verified, completed peer transfer — previously this parameter didn't exist at all, so
   * EVERY peer-received blob was silently mis-stamped `'upload'` by the `existing?.origin ??
   * 'upload'` fallback below). The re-put-preserves-origin rule above still wins over an explicit
   * `meta.origin` on an EXISTING row: `origin` is computed BEFORE `...meta` is spread (and
   * `meta.origin` is destructured out of the spread, below) specifically so a re-`put`'s own
   * `meta.origin` can never override an already-established origin — e.g. a portrait re-upload
   * (`origin: 'upload'`) landing on a hash that happens to collide with one this device already
   * has from a peer (`origin: 'peer'`) must not flip it back to `'upload'`. A NEW hash with no
   * `meta.origin` still defaults to `'upload'` (the only origin any pre-Task-13 caller ever
   * produced), unchanged. */
  async put(
    hash: string,
    mime: string,
    bytes: Uint8Array,
    meta?: { kind?: BlobRow['kind']; width?: number; height?: number; origin?: BlobRow['origin'] },
  ): Promise<void> {
    const now = Date.now();
    const existing = await this.db.blobs.get(hash);
    // `origin` is pulled out of `meta` separately (not left to the `...rest` spread below) so an
    // explicit `meta.origin` can win on a NEW row but can NEVER override an EXISTING row's own
    // preserved origin — see this method's own doc for why.
    const { origin: explicitOrigin, ...restMeta } = meta ?? {};
    await this.db.blobs.put({
      hash,
      mime,
      bytes,
      size: bytes.byteLength,
      addedAt: existing?.addedAt ?? now,
      lastUsedAt: now,
      pinned: existing?.pinned ?? false,
      origin: existing?.origin ?? explicitOrigin ?? 'upload',
      ...restMeta,
    });
    for (const cb of this.arrivalListeners) cb(hash);
  }

  async get(hash: string): Promise<BlobRow | undefined> {
    return this.db.blobs.get(hash);
  }

  /** [plan-10 Task 13] Registers `cb` to fire with the hash of EVERY successful `put()` (own
   * upload, peer transfer, import, pack — every `origin`). Returns an unsubscribe function. See
   * this class's own `arrivalListeners` doc for why this exists. */
  onArrival(cb: (hash: string) => void): () => void {
    this.arrivalListeners.add(cb);
    return () => this.arrivalListeners.delete(cb);
  }

  // --- plan-10 Task 13 additions (doc-07 §Cache management) -----------------------------------

  /** Bumps `lastUsedAt` to `now()` on a read-driven "used" (e.g. `BlobUrlPipe` displaying it, or a
   * holder serving it over the blob-transfer socket) WITHOUT touching any other field — the LRU
   * sweep's own recency signal (`blob-cache-policy.ts`'s `selectLruEvictions`). A no-op (never
   * throws) for a hash this device doesn't have.
   *
   * Deliberately a full get-then-`put()` rather than Dexie's own partial `Table.update()` — this
   * project's IndexedDB test backend (fake-indexeddb) was found to corrupt an existing row's
   * `bytes` (a `Uint8Array`) into a plain `{0: ..., 1: ..., ...}` object when `update()`'s
   * read-modify-write merge runs, even though only `lastUsedAt` was named in the patch (plan-10
   * Task 13, caught by `blob-transfer.service.spec.ts`'s own assembly test). A `get` + whole-row
   * `put()` sidesteps that merge path entirely and is correct in real IndexedDB regardless. */
  async touchLastUsed(hash: string): Promise<void> {
    const existing = await this.db.blobs.get(hash);
    if (!existing) return;
    await this.db.blobs.put({ ...existing, lastUsedAt: Date.now() });
  }

  /** Flips `pinned` on an existing row — `CacheManagerService.refreshPins()`'s own write primitive
   * (doc-07: "pinned for blobs referenced by own characters and the current campaign"). A no-op
   * (never throws) for a hash this device doesn't have — nothing to pin. Same get-then-`put()`
   * reasoning as `touchLastUsed` above. */
  async setPinned(hash: string, pinned: boolean): Promise<void> {
    const existing = await this.db.blobs.get(hash);
    if (!existing) return;
    await this.db.blobs.put({ ...existing, pinned });
  }

  /** Every row in the table — `CacheManagerService`'s own LRU/orphan sweeps need the full set to
   * decide what to evict; small enough in practice (a device's own cached images) that a plain
   * `toArray()` is fine, no paging. */
  async list(): Promise<BlobRow[]> {
    return this.db.blobs.toArray();
  }

  /** Deletes a row outright — the sweep's actual reclaim step. A no-op (never throws) for a hash
   * already absent. */
  async remove(hash: string): Promise<void> {
    await this.db.blobs.delete(hash);
  }
}
