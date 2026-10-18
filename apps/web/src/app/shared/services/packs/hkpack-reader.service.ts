import { inject, Injectable } from '@angular/core';
import { validatePack, type Diagnostic } from '@hk/engine';
import {
  AssetSchema,
  formatIssues,
  HKPACK_ASSET_DIR,
  HKPACK_LIMITS,
  HKPACK_PACK_ENTRY,
  PACK_LIMITS,
  parsePack,
  type Asset,
  type EntityType,
  type Pack,
} from '@hk/protocol';
import { sniffImageMime } from '@shared/services/blob-transfer/image-mime-sniff';
import { sha256Hex } from '@shared/services/images/image-pipeline.service';
import { PackStore } from '@shared/stores/pack.store';
import { canonicalJson } from './canonical-json';
import {
  PackImportAssetHashMismatchError,
  PackImportAssetMimeMismatchError,
  PackImportAssetMissingError,
  PackImportAssetTooLargeError,
  PackImportBadSchemaError,
  PackImportBadZipError,
  PackImportConflictError,
  PackImportInvalidError,
  PackImportMissingPackJsonError,
  PackImportTooLargeError,
} from './pack-import.errors';

export type AssetKind = Asset['kind'];

export interface PackImportAsset {
  readonly bytes: Uint8Array;
  readonly kind: AssetKind;
  readonly mime: string;
}

/** Everything the trust screen shows and `PackStore.importContent` stores. Built only after every
 * check below passed; `assets` is keyed by the `sha256:<hex>` hash. */
export interface PackImportPreview {
  readonly pack: Pack;
  readonly canonicalJson: string;
  readonly assets: Map<string, PackImportAsset>;
  /** Non-error `validatePack` diagnostics (errors refuse the import). */
  readonly diagnostics: Diagnostic[];
  readonly summary: {
    entityCounts: Partial<Record<EntityType, number>>;
    overrides: string[];
    assetCount: number;
    assetBytes: number;
    dependencies: { id: string; range: string }[];
  };
  /** The same `id@version` is already installed with identical canonical JSON — installing is a
   * no-op. */
  readonly alreadyInstalled: boolean;
}

// The per-asset cap comes from the schema itself (fail-closed to 0 should it ever lose its max).
const ASSET_BYTE_CAP = AssetSchema.shape.size.maxValue ?? 0;
const ASSET_ENTRY_RE = /^assets\/[0-9a-f]{64}$/;
const HASH_PREFIX = 'sha256:';

/** What the unzip step kept, plus every cap it saw exceeded while scanning the central
 * directory (the filter cannot throw cleanly through fflate, so it records and skips). */
interface UnzipScan {
  readonly files: Record<string, Uint8Array>;
  readonly oversizedAssets: ReadonlySet<string>;
}

/**
 * `.hkpack` / bare `pack.json` reader (plan 15, design rulings 1 and 2; ADR-008 importer safety).
 * `read()` VALIDATES and returns a preview; it stores NOTHING — `PackStore.importContent` writes,
 * after the user confirms the trust screen.
 *
 * Container detection is by file name: a name ending in `.json` (case-insensitive) is a bare
 * `pack.json`; anything else is unzipped as a `.hkpack`, so corrupt bytes in a `.hkpack` are a
 * bad zip, never a JSON error. A bare `pack.json` cannot carry assets, so one that lists any is
 * refused as `asset-missing`.
 *
 * Check order (ruling 2, fail fast): caps (file size) → unzip (entry-count / pack.json-size /
 * total-asset-bytes caps are enforced against the central directory BEFORE inflating, so a zip
 * bomb never decompresses) → `pack.json` present → JSON + `parsePack` (strict schema) + kind
 * `content` → `validatePack(pack, [core, ...installed content])` (errors refuse, warnings ride on
 * the preview) → assets (present, ≤ declared size and the `AssetSchema` cap, magic bytes match the
 * declared mime, sha256 matches) → `id@version` conflict / already-installed.
 *
 * `fflate` is imported lazily (same as the `.hero` reader) so it stays out of the initial bundle.
 */
@Injectable({ providedIn: 'root' })
export class HkpackReader {
  private readonly packStore = inject(PackStore);

  async read(file: File): Promise<PackImportPreview> {
    const core = this.packStore.corePack();
    if (!core) throw new Error('HkpackReader.read: PackStore.init() has not loaded the core pack');

    const isBareJson = file.name.toLowerCase().endsWith('.json');
    let packText: string;
    let zip: Record<string, Uint8Array> = {};
    let oversizedAssets: ReadonlySet<string> = new Set();
    if (isBareJson) {
      if (file.size > PACK_LIMITS.maxBytes) {
        throw new PackImportTooLargeError('pack-json-bytes', file.size, PACK_LIMITS.maxBytes);
      }
      packText = await file.text();
    } else {
      if (file.size > HKPACK_LIMITS.maxZipBytes) {
        throw new PackImportTooLargeError('zip-bytes', file.size, HKPACK_LIMITS.maxZipBytes);
      }
      const scan = await this.unzip(new Uint8Array(await file.arrayBuffer()));
      zip = scan.files;
      oversizedAssets = scan.oversizedAssets;
      const packBytes = zip[HKPACK_PACK_ENTRY];
      if (!packBytes) throw new PackImportMissingPackJsonError();
      const { strFromU8 } = await import('fflate');
      packText = strFromU8(packBytes);
    }

    const pack = this.parse(packText);

    const installedContent = this.packStore.installedContent();
    const diagnostics = validatePack(pack, [core, ...installedContent]);
    const errors = diagnostics.filter((d) => d.severity === 'error');
    if (errors.length > 0) throw new PackImportInvalidError(errors);

    const assets = await this.readAssets(pack, zip, oversizedAssets);

    const canonical = canonicalJson(pack);
    const key = `${pack.id}@${pack.version}`;
    if (pack.id === core.id) throw new PackImportConflictError(key);
    const existing = [...installedContent, ...this.packStore.translationPacks()].find(
      (p) => p.id === pack.id && p.version === pack.version,
    );
    if (existing && canonicalJson(existing) !== canonical) throw new PackImportConflictError(key);

    return {
      pack,
      canonicalJson: canonical,
      assets,
      diagnostics: diagnostics.filter((d) => d.severity !== 'error'),
      summary: {
        entityCounts: countEntities(pack),
        overrides: pack.overrides.map((o) => o.target),
        assetCount: assets.size,
        assetBytes: [...assets.values()].reduce((sum, a) => sum + a.bytes.byteLength, 0),
        dependencies: pack.dependencies.map((d) => ({ id: d.id, range: d.range })),
      },
      alreadyInstalled: existing !== undefined,
    };
  }

  /** Unzips only `pack.json` and `assets/<64-hex>` entries, enforcing the container caps from
   * each entry's central-directory sizes before it is inflated (fflate sizes an inflated entry's
   * buffer from its declared `originalSize`, so the declared size bounds memory; a stored entry
   * is bounded by the zip's own size, which was capped already). Actual byte lengths are checked
   * again after unzip by the asset/pack.json checks. */
  private async unzip(bytes: Uint8Array): Promise<UnzipScan> {
    const { unzipSync } = await import('fflate');
    let entries = 0;
    let assetBytesTotal = 0;
    let overLimit: PackImportTooLargeError | undefined;
    const oversizedAssets = new Set<string>();
    let files: Record<string, Uint8Array>;
    try {
      files = unzipSync(bytes, {
        filter: (info) => {
          if (info.name.endsWith('/')) return false; // directory entry, no content
          entries++;
          if (overLimit) return false;
          if (entries > HKPACK_LIMITS.maxEntries) {
            overLimit = new PackImportTooLargeError('entries', entries, HKPACK_LIMITS.maxEntries);
            return false;
          }
          const declared = Math.max(info.size, info.originalSize);
          if (info.name === HKPACK_PACK_ENTRY) {
            if (declared > PACK_LIMITS.maxBytes) {
              overLimit = new PackImportTooLargeError(
                'pack-json-bytes',
                declared,
                PACK_LIMITS.maxBytes,
              );
              return false;
            }
            return true;
          }
          if (!ASSET_ENTRY_RE.test(info.name)) return false; // unknown entry: counted, never read
          assetBytesTotal += declared;
          if (assetBytesTotal > HKPACK_LIMITS.maxAssetBytesTotal) {
            overLimit = new PackImportTooLargeError(
              'asset-bytes-total',
              assetBytesTotal,
              HKPACK_LIMITS.maxAssetBytesTotal,
            );
            return false;
          }
          if (declared > ASSET_BYTE_CAP) {
            oversizedAssets.add(info.name);
            return false;
          }
          return true;
        },
      });
    } catch (cause) {
      throw new PackImportBadZipError(cause);
    }
    if (overLimit) throw overLimit;
    const packJson = files[HKPACK_PACK_ENTRY];
    if (packJson && packJson.byteLength > PACK_LIMITS.maxBytes) {
      throw new PackImportTooLargeError(
        'pack-json-bytes',
        packJson.byteLength,
        PACK_LIMITS.maxBytes,
      );
    }
    return { files, oversizedAssets };
  }

  private parse(text: string): Pack {
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      throw new PackImportBadSchemaError([`${HKPACK_PACK_ENTRY}: not valid JSON`]);
    }
    const result = parsePack(raw);
    if (!result.ok) throw new PackImportBadSchemaError(formatIssues(result.issues));
    if (result.pack.kind !== 'content') {
      throw new PackImportBadSchemaError([
        `kind: only content packs can be imported (got "${result.pack.kind}")`,
      ]);
    }
    return result.pack;
  }

  /** Every `assets[]` entry must have its `assets/<hex>` zip entry; bytes ≤ the declared `size`
   * (and the `AssetSchema` cap — checked BEFORE hashing, like the `.hero` reader); magic bytes
   * must be the declared webp/jpeg/png; sha256 must equal the declared hash. */
  private async readAssets(
    pack: Pack,
    zip: Record<string, Uint8Array>,
    oversized: ReadonlySet<string>,
  ): Promise<Map<string, PackImportAsset>> {
    const out = new Map<string, PackImportAsset>();
    for (const asset of pack.assets) {
      if (out.has(asset.hash)) continue;
      const entry = `${HKPACK_ASSET_DIR}${asset.hash.slice(HASH_PREFIX.length)}`;
      if (oversized.has(entry)) {
        throw new PackImportAssetTooLargeError(asset.hash, ASSET_BYTE_CAP + 1, ASSET_BYTE_CAP);
      }
      const bytes = zip[entry];
      if (!bytes) throw new PackImportAssetMissingError(asset.hash);
      const limit = Math.min(asset.size, ASSET_BYTE_CAP);
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
}

function countEntities(pack: Pack): Partial<Record<EntityType, number>> {
  const counts: Partial<Record<EntityType, number>> = {};
  for (const entity of pack.entities) counts[entity.type] = (counts[entity.type] ?? 0) + 1;
  return counts;
}
