import { TestBed } from '@angular/core/testing';
import { HkDb, type BlobRow } from '@shared/services/storage/dexie.db';

// Test-only helper (not a spec file itself), shared by the cache-sweep specs: plan 15's
// `cache-manager.service.spec.ts` and plan 16's pack-asset relay case in
// `blob-transfer.service.spec.ts`. The caller's `TestBed` must already provide a real
// (fake-indexeddb-backed) `HkDb`.

/** Writes a blob row DIRECTLY via Dexie (not `BlobsRepository.put`, which derives `size` from the
 * REAL byte length) so a test can exercise cap arithmetic against a large `size` (e.g. near
 * `CACHE_CAP_MIN_BYTES`) without actually allocating that many bytes — `CacheManagerService`'s cap
 * logic only ever reads the stored `size` NUMBER, never re-measures `bytes`. */
export async function putBlob(
  hash: string,
  size: number,
  pinned = false,
  lastUsedAt?: number,
  origin: BlobRow['origin'] = 'upload',
): Promise<void> {
  const db = TestBed.inject(HkDb);
  const now = Date.now();
  await db.blobs.put({
    hash,
    mime: 'image/webp',
    bytes: new Uint8Array(1),
    size,
    addedAt: now,
    lastUsedAt: lastUsedAt ?? now,
    pinned,
    origin,
  });
}
