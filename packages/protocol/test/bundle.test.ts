import { describe, expect, it } from 'vitest';
import { parseHeroManifest } from '../src/bundle/manifest.ts';

const validManifest = {
  format: 1,
  kind: 'hero',
  characterId: 'char:2b7a1f22-1111-4c9d-a8f2-0a1b2c3d4e5f',
  name: 'Ivan',
  exportedAt: '2026-09-13T12:00:00.000Z',
  engineVersion: '0.1.0',
  appVersion: '0.1.0',
  pins: { 'srd-5e-2024': '0.1.0' },
  eventCount: 5,
  images: [
    { hash: `sha256:${'0'.repeat(64)}`, mime: 'image/webp', size: 1234, kind: 'portrait' },
    { hash: `sha256:${'1'.repeat(64)}`, mime: 'image/webp', size: 512, kind: 'thumb' },
  ],
};

describe('parseHeroManifest', () => {
  it('accepts a well-formed manifest, with or without images', () => {
    const withImages = parseHeroManifest(validManifest);
    expect(withImages.ok, JSON.stringify(withImages)).toBe(true);

    const withoutImages = parseHeroManifest({ ...validManifest, images: [] });
    expect(withoutImages.ok, JSON.stringify(withoutImages)).toBe(true);
  });

  it('rejects a wrong format number', () => {
    const result = parseHeroManifest({ ...validManifest, format: 2 });
    expect(result.ok).toBe(false);
  });

  it('rejects an unknown top-level key (strictObject)', () => {
    const result = parseHeroManifest({ ...validManifest, unexpectedField: true });
    expect(result.ok).toBe(false);
  });

  it('rejects a malformed ISO exportedAt', () => {
    const result = parseHeroManifest({ ...validManifest, exportedAt: '2026/09/13' });
    expect(result.ok).toBe(false);
  });

  it('rejects a bad images entry (missing kind, bad hash)', () => {
    const missingKind = parseHeroManifest({
      ...validManifest,
      images: [{ hash: `sha256:${'0'.repeat(64)}`, mime: 'image/webp', size: 1 }],
    });
    expect(missingKind.ok).toBe(false);

    const badHash = parseHeroManifest({
      ...validManifest,
      images: [{ hash: 'not-a-hash', mime: 'image/webp', size: 1, kind: 'portrait' }],
    });
    expect(badHash.ok).toBe(false);

    const badKind = parseHeroManifest({
      ...validManifest,
      images: [{ hash: `sha256:${'0'.repeat(64)}`, mime: 'image/webp', size: 1, kind: 'avatar' }],
    });
    expect(badKind.ok).toBe(false);
  });

  it('rejects a non-hero kind, a wrong-prefixed characterId, and a non-semver engineVersion', () => {
    expect(parseHeroManifest({ ...validManifest, kind: 'pack' }).ok).toBe(false);
    expect(parseHeroManifest({ ...validManifest, characterId: 'camp:2b7a1f22-1111-4c9d-a8f2-0a1b2c3d4e5f' }).ok).toBe(
      false,
    );
    expect(parseHeroManifest({ ...validManifest, engineVersion: 'v0.1' }).ok).toBe(false);
  });

  it('rejects a negative eventCount and a malformed pins map', () => {
    expect(parseHeroManifest({ ...validManifest, eventCount: -1 }).ok).toBe(false);
    expect(parseHeroManifest({ ...validManifest, pins: { 'srd-5e-2024': 'not-semver' } }).ok).toBe(false);
  });

  // Fix-wave review, Important/merge-blocker finding 1 (BINDING): doc-07 only ever stores
  // webp/jpeg/png (`ImagePipelineService`'s "Safety" note) — an SVG mime slipping through here
  // would be a stored-XSS primitive once `HeroReaderService` writes it to `BlobsRepository` and
  // `BlobUrlPipe` serves it back out as a same-origin `blob:` URL.
  it('rejects an image entry whose mime is not webp/jpeg/png (e.g. a smuggled SVG — a stored-XSS vector)', () => {
    const svgMime = parseHeroManifest({
      ...validManifest,
      images: [{ hash: `sha256:${'0'.repeat(64)}`, mime: 'image/svg+xml', size: 1, kind: 'portrait' }],
    });
    expect(svgMime.ok).toBe(false);

    const gifMime = parseHeroManifest({
      ...validManifest,
      images: [{ hash: `sha256:${'0'.repeat(64)}`, mime: 'image/gif', size: 1, kind: 'portrait' }],
    });
    expect(gifMime.ok).toBe(false);
  });

  // Plan 15 Task 1 (ruling 9): additive `packs?` — every non-core pinned pack carried in the
  // bundle as `packs/<id>@<version>.json`. `sha256` uses the same `sha256:<64hex>` form as
  // `images[].hash` (BlobHashSchema).
  describe('packs? (additive)', () => {
    const packEntry = {
      id: 'homebrew',
      version: '0.1.3',
      path: 'packs/homebrew@0.1.3.json',
      sha256: `sha256:${'a'.repeat(64)}`,
    };

    it('parses an old manifest without packs unchanged', () => {
      const result = parseHeroManifest(validManifest);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.manifest).toEqual(validManifest);
        expect('packs' in result.manifest).toBe(false);
      }
    });

    it('accepts packs entries (and an empty list)', () => {
      const withPacks = parseHeroManifest({ ...validManifest, packs: [packEntry] });
      expect(withPacks.ok, JSON.stringify(withPacks)).toBe(true);
      if (withPacks.ok) expect(withPacks.manifest.packs).toEqual([packEntry]);
      expect(parseHeroManifest({ ...validManifest, packs: [] }).ok).toBe(true);
    });

    it('rejects a bad sha256, a bare hex sha256, a bad id/version and an extra key', () => {
      const bad = (patch: Record<string, unknown>) =>
        parseHeroManifest({ ...validManifest, packs: [{ ...packEntry, ...patch }] }).ok;
      expect(bad({ sha256: 'not-a-hash' })).toBe(false);
      expect(bad({ sha256: 'a'.repeat(64) })).toBe(false);
      expect(bad({ id: 'Bad Id' })).toBe(false);
      expect(bad({ version: 'v1' })).toBe(false);
      expect(bad({ extra: true })).toBe(false);
    });
  });
});
