import { inject, Injectable } from '@angular/core';
import { HKPACK_PACK_ENTRY, type Pack } from '@hk/protocol';
import { BlobsRepository } from '../storage/blobs.repository';
import { canonicalJson } from './canonical-json';
import { packAssetEntry } from './pack-assets';

/** An asset blob of the pack is not on this device, so the archive would be one the reader refuses. */
export class HkpackAssetsMissingError extends Error {
  readonly code = 'packs.export-assets-missing';

  constructor(readonly packKey: string) {
    super(`HkpackWriter: an image of ${packKey} is not stored on this device`);
  }
}

/**
 * Builds a `.hkpack` archive for an installed pack: the canonical `pack.json` at the root plus one
 * `assets/<hash-hex>` entry per declared asset, the exact layout `HkpackReader` reads back. It only
 * BUILDS the archive; delivery (save picker, share sheet, download) is `deliverHeroBundle`'s job.
 * `fflate` is imported lazily, like the readers, so it stays out of the initial bundle.
 */
@Injectable({ providedIn: 'root' })
export class HkpackWriter {
  private readonly blobsRepository = inject(BlobsRepository);

  async export(pack: Pack): Promise<{ readonly blob: Blob; readonly fileName: string }> {
    const files: Record<string, Uint8Array> = {};
    for (const asset of pack.assets) {
      const row = await this.blobsRepository.get(asset.hash);
      if (!row) throw new HkpackAssetsMissingError(`${pack.id}@${pack.version}`);
      files[packAssetEntry(asset.hash)] = row.bytes;
    }
    const { strToU8, zipSync } = await import('fflate');
    files[HKPACK_PACK_ENTRY] = strToU8(canonicalJson(pack));
    const blob = new Blob([zipSync(files)], { type: 'application/zip' });
    return { blob, fileName: `${pack.id}-${pack.version}.hkpack` };
  }
}
