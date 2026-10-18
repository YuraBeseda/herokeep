/**
 * `.hkpack` container (plan 15 / phase 4 slice 5, design rulings 1 and 2; doc-04 §Distribution):
 * a ZIP with the pack's canonical `pack.json` at the root plus one `assets/<hash-hex>` entry per
 * `assets[]` item (`<hash-hex>` = the 64-hex part of `sha256:<hex>`). There is no separate manifest
 * file — `pack.json` IS the manifest. A bare `pack.json` file is importable through the same
 * pipeline minus the unzip step.
 *
 * The container caps below are this plan's choice (OWNER-FLAG: ADR-008 caps each asset at 400 KiB
 * via `AssetSchema` and the pack JSON via `PACK_LIMITS.maxBytes`, but sets no container totals):
 * `pack.json` + at most 2000 assets, at most 64 MiB of uncompressed asset bytes, and a zip file of
 * at most 72 MiB.
 */
export const HKPACK_PACK_ENTRY = 'pack.json';
export const HKPACK_ASSET_DIR = 'assets/';
export const HKPACK_LIMITS = {
  maxEntries: 2001,
  maxAssetBytesTotal: 64 * 1024 * 1024,
  maxZipBytes: 72 * 1024 * 1024,
} as const;
