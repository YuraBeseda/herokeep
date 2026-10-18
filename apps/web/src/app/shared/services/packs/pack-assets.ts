import { AssetSchema, HKPACK_ASSET_DIR, type Asset, type Pack } from '@hk/protocol';
import { sniffImageMime } from '@shared/services/blob-transfer/image-mime-sniff';
import { sha256Hex } from '@shared/services/images/image-pipeline.service';
import {
  PackImportAssetHashMismatchError,
  PackImportAssetMimeMismatchError,
  PackImportAssetMissingError,
  PackImportAssetTooLargeError,
} from './pack-import.errors';

export type AssetKind = Asset['kind'];

export interface PackImportAsset {
  readonly bytes: Uint8Array;
  readonly kind: AssetKind;
  readonly mime: string;
}

/** The per-asset byte cap, read from the schema itself (fail-closed to 0 should it lose its max). */
export const PACK_ASSET_BYTE_CAP = AssetSchema.shape.size.maxValue ?? 0;

const HASH_PREFIX = 'sha256:';

/** The zip entry a pack asset lives at: `assets/<hash-hex>` — the same name in a `.hkpack` and in
 * a `.hero` bundle that carries the pack. */
export function packAssetEntry(hash: string): string {
  return `${HKPACK_ASSET_DIR}${hash.startsWith(HASH_PREFIX) ? hash.slice(HASH_PREFIX.length) : hash}`;
}

/**
 * Verifies every `assets[]` entry of `pack` against the unzipped `entries` (ADR-008 importer
 * safety, plan 15 ruling 2), shared by the `.hkpack` reader and the `.hero` reader: the
 * `assets/<hex>` entry must exist; its bytes must be ≤ the declared `size` and the `AssetSchema`
 * cap (checked BEFORE hashing); its magic bytes must be the declared webp/jpeg/png; its sha256 must
 * equal the declared hash. `oversized` names entries the unzip step skipped for exceeding the cap
 * (reported as too large rather than missing). Throws the matching `PackImportAsset*Error`.
 */
export async function verifyPackAssets(
  pack: Pack,
  entries: Readonly<Record<string, Uint8Array>>,
  oversized: ReadonlySet<string> = new Set(),
): Promise<Map<string, PackImportAsset>> {
  const out = new Map<string, PackImportAsset>();
  for (const asset of pack.assets) {
    if (out.has(asset.hash)) continue;
    const entry = packAssetEntry(asset.hash);
    if (oversized.has(entry)) {
      throw new PackImportAssetTooLargeError(
        asset.hash,
        PACK_ASSET_BYTE_CAP + 1,
        PACK_ASSET_BYTE_CAP,
      );
    }
    const bytes = entries[entry];
    if (!bytes) throw new PackImportAssetMissingError(asset.hash);
    const limit = Math.min(asset.size, PACK_ASSET_BYTE_CAP);
    if (bytes.byteLength > limit) {
      throw new PackImportAssetTooLargeError(asset.hash, bytes.byteLength, limit);
    }
    if (sniffImageMime(bytes) !== asset.mime) {
      throw new PackImportAssetMimeMismatchError(asset.hash, asset.mime);
    }
    if ((await sha256Hex(bytes)) !== asset.hash) {
      throw new PackImportAssetHashMismatchError(asset.hash);
    }
    out.set(asset.hash, { bytes, kind: asset.kind, mime: asset.mime });
  }
  return out;
}
