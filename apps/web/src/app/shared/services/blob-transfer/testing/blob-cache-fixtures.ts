import { TestBed } from '@angular/core/testing';
import type { Event } from '@hk/protocol';
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

/** Plan 18: a character-stream `item.added` for a custom item whose icon is an uploaded blob. */
export function iconItemAddedEvent(stream: string, hash: string, n: number): Event {
  return {
    id: `00000000-0000-4000-8000-${String(900 + n).padStart(12, '0')}`,
    stream,
    ts: '2026-11-17T00:00:00.000Z',
    actor: { userId: 'usr_1', deviceId: 'dev_1' },
    type: 'item.added',
    v: 1,
    payload: {
      instanceId: `00000000-0000-4000-8000-${String(800 + n).padStart(12, '0')}`,
      qty: 1,
      name: 'Signet',
      custom: { icon: { kind: 'blob', hash } },
    },
  } as Event;
}
