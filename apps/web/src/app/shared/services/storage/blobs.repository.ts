import { inject, Injectable } from '@angular/core';
import { HkDb, type BlobRow } from './dexie.db';

/**
 * Content-addressed blob store (portraits, etc.); `hash` is the primary key, so `put` is
 * naturally idempotent — writing the same hash twice just overwrites with (byte-identical)
 * content. Deleting a blob no longer referenced by any character is deferred to plan 6 (images).
 */
@Injectable({ providedIn: 'root' })
export class BlobsRepository {
  private readonly db = inject(HkDb);

  async put(hash: string, mime: string, bytes: Uint8Array): Promise<void> {
    await this.db.blobs.put({ hash, mime, bytes, size: bytes.byteLength });
  }

  async get(hash: string): Promise<BlobRow | undefined> {
    return this.db.blobs.get(hash);
  }
}
