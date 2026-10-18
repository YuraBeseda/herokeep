import { createHash } from 'node:crypto';
import { AssetSchema, HKPACK_ASSET_DIR, HKPACK_LIMITS, HKPACK_PACK_ENTRY, PACK_LIMITS, type Pack } from '@hk/protocol';
import { unzipSync, zipSync, type Zippable } from 'fflate';

/**
 * `.hkpack` container helpers for `build --zip` and `validate <file.hkpack>` (plan 15 task 8; doc-04
 * §Distribution: a ZIP of the canonical `pack.json` plus one `assets/<hash-hex>` entry per
 * `assets[]` item). The reader mirrors the web importer (`hkpack-reader.service.ts`): the same
 * `HKPACK_LIMITS` caps enforced from the central directory BEFORE inflating, and the same entry
 * filter (only `pack.json` and `assets/<64-hex>` are read; anything else is counted, never read).
 */

/** Fixed entry timestamp: 1980-01-01 00:00, the DOS-time epoch. fflate encodes the mtime with LOCAL
 * getters, so the local-time constructor yields the same header bytes in every time zone. */
const ZIP_MTIME = new Date(1980, 0, 1, 0, 0, 0);
const HASH_PREFIX = 'sha256:';
const ASSET_ENTRY_RE = /^assets\/[0-9a-f]{64}$/;
/** The per-asset byte cap, read from the schema itself (same as the web importer). */
export const ASSET_BYTE_CAP = AssetSchema.shape.size.maxValue ?? 0;

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** `sha256:<hex>` → `assets/<hex>`. */
export function assetEntryName(hash: string): string {
  return `${HKPACK_ASSET_DIR}${hash.startsWith(HASH_PREFIX) ? hash.slice(HASH_PREFIX.length) : hash}`;
}

/**
 * Deterministic zip: entries in code-unit name order, every entry with the fixed 1980-01-01 mtime,
 * `os` 0 (MS-DOS), no external attributes, no extra field and no comment, deflate level 9. Two
 * calls with the same entries produce identical bytes.
 */
export function zipDeterministic(entries: Readonly<Record<string, Uint8Array>>): Uint8Array {
  const zippable: Zippable = {};
  for (const name of Object.keys(entries).sort()) {
    zippable[name] = [entries[name]!, { level: 9, mtime: ZIP_MTIME, os: 0, attrs: 0 }];
  }
  return zipSync(zippable);
}

/** A problem found while reading a `.hkpack`, as a diagnostic-style line. */
export interface HkpackIssue {
  code: string;
  where?: string;
  message: string;
}

export type ReadHkpackResult =
  | { ok: true; packText: string; files: Record<string, Uint8Array>; oversized: ReadonlySet<string> }
  | { ok: false; badZip: boolean; issue: HkpackIssue };

class CapError extends Error {
  readonly issue: HkpackIssue;
  constructor(issue: HkpackIssue) {
    super(issue.message);
    this.issue = issue;
  }
}

/**
 * Unzips only `pack.json` and `assets/<64-hex>`, enforcing the container caps from each entry's
 * central-directory sizes before it is inflated (a cap throws out of the filter, as in the web
 * reader, so a forged entry count never keeps the walk going). Assets over the per-asset cap are
 * skipped and reported in `oversized`.
 */
export function readHkpack(bytes: Uint8Array): ReadHkpackResult {
  if (bytes.byteLength > HKPACK_LIMITS.maxZipBytes) {
    return {
      ok: false,
      badZip: false,
      issue: {
        code: 'hkpack.zipBytes',
        message: `zip is ${bytes.byteLength} bytes (cap ${HKPACK_LIMITS.maxZipBytes})`,
      },
    };
  }
  let entries = 0;
  let assetBytesTotal = 0;
  const oversized = new Set<string>();
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, {
      filter: (info) => {
        entries++;
        if (entries > HKPACK_LIMITS.maxEntries) {
          throw new CapError({
            code: 'hkpack.entries',
            message: `more than ${HKPACK_LIMITS.maxEntries} zip entries`,
          });
        }
        if (info.name.endsWith('/')) return false;
        const declared = Math.max(info.size, info.originalSize);
        if (info.name === HKPACK_PACK_ENTRY) {
          if (declared > PACK_LIMITS.maxBytes) {
            throw new CapError({
              code: 'hkpack.packJsonBytes',
              where: HKPACK_PACK_ENTRY,
              message: `${declared} bytes (cap ${PACK_LIMITS.maxBytes})`,
            });
          }
          return true;
        }
        if (!ASSET_ENTRY_RE.test(info.name)) return false;
        assetBytesTotal += declared;
        if (assetBytesTotal > HKPACK_LIMITS.maxAssetBytesTotal) {
          throw new CapError({
            code: 'hkpack.assetBytesTotal',
            message: `more than ${HKPACK_LIMITS.maxAssetBytesTotal} uncompressed asset bytes`,
          });
        }
        if (declared > ASSET_BYTE_CAP) {
          oversized.add(info.name);
          return false;
        }
        return true;
      },
    });
  } catch (e) {
    if (e instanceof CapError) return { ok: false, badZip: false, issue: e.issue };
    return { ok: false, badZip: true, issue: { code: 'hkpack.badZip', message: (e as Error).message } };
  }
  const packBytes = files[HKPACK_PACK_ENTRY];
  if (!packBytes) {
    return {
      ok: false,
      badZip: false,
      issue: { code: 'hkpack.missingPackJson', message: `no ${HKPACK_PACK_ENTRY} entry` },
    };
  }
  if (packBytes.byteLength > PACK_LIMITS.maxBytes) {
    return {
      ok: false,
      badZip: false,
      issue: {
        code: 'hkpack.packJsonBytes',
        where: HKPACK_PACK_ENTRY,
        message: `${packBytes.byteLength} bytes (cap ${PACK_LIMITS.maxBytes})`,
      },
    };
  }
  return { ok: true, packText: Buffer.from(packBytes).toString('utf8'), files, oversized };
}

/**
 * Checks every `assets[]` entry against `entries` (keyed `assets/<hex>`): present, not over the
 * declared size or the per-asset cap, sha256 equal to the declared hash. Error issues only.
 */
export function checkPackAssets(
  pack: Pack,
  entries: Readonly<Record<string, Uint8Array>>,
  oversized: ReadonlySet<string> = new Set(),
): HkpackIssue[] {
  const issues: HkpackIssue[] = [];
  const seen = new Set<string>();
  for (const asset of pack.assets) {
    if (seen.has(asset.hash)) continue;
    seen.add(asset.hash);
    const name = assetEntryName(asset.hash);
    const bytes = entries[name];
    if (oversized.has(name)) {
      issues.push({ code: 'asset.size', where: asset.hash, message: `over the ${ASSET_BYTE_CAP}-byte asset cap` });
      continue;
    }
    if (!bytes) {
      issues.push({ code: 'asset.missing', where: asset.hash, message: `no ${name} for this assets[] entry` });
      continue;
    }
    const limit = Math.min(asset.size, ASSET_BYTE_CAP);
    if (bytes.byteLength > limit) {
      issues.push({
        code: 'asset.size',
        where: asset.hash,
        message: `${bytes.byteLength} bytes (declared/cap ${limit})`,
      });
      continue;
    }
    const actual = sha256Hex(bytes);
    if (`${HASH_PREFIX}${actual}` !== asset.hash) {
      issues.push({ code: 'asset.hash', where: asset.hash, message: `bytes hash to sha256:${actual}` });
    }
  }
  return issues;
}

export function formatIssue(severity: 'error' | 'warning', issue: HkpackIssue): string {
  return `${severity} ${issue.code}${issue.where ? ` [${issue.where}]` : ''}: ${issue.message}`;
}
