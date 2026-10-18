/**
 * Plan 15 (phase 4 slice 5) Task 1, design rulings 1/2 — the `.hkpack` container constants: a ZIP
 * with `pack.json` at the root plus `assets/<hash-hex>` entries, capped at 2001 entries, 64 MiB of
 * uncompressed asset bytes, and a 72 MiB zip file. Exported from the protocol barrel so the web
 * importer and pack-tools share ONE definition.
 */
import { describe, expect, it } from 'vitest';
import { HKPACK_ASSET_DIR, HKPACK_LIMITS, HKPACK_PACK_ENTRY } from '../src/index.ts';

describe('.hkpack container constants', () => {
  it('names the root pack entry and the asset directory', () => {
    expect(HKPACK_PACK_ENTRY).toBe('pack.json');
    expect(HKPACK_ASSET_DIR).toBe('assets/');
  });

  it('caps entries, total asset bytes and zip size (ruling 2)', () => {
    expect(HKPACK_LIMITS).toEqual({
      maxEntries: 2001,
      maxAssetBytesTotal: 64 * 1024 * 1024,
      maxZipBytes: 72 * 1024 * 1024,
    });
  });
});
