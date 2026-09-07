import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildSprite } from './build-sprite';

const here = dirname(fileURLToPath(import.meta.url));
const MAP_PATH = join(here, '../../../packages/content/src/icons/icons-map.json');
const VENDOR_DIR = join(here, '../vendor/game-icons');
const COMMITTED_OUT_DIR = join(here, '../src/assets/icons');

function distinctSlugValues(): string[] {
  const map = JSON.parse(readFileSync(MAP_PATH, 'utf8')) as {
    categories: Record<string, string>;
    entities: Record<string, string>;
  };
  return [...new Set([...Object.values(map.categories), ...Object.values(map.entities)])];
}

describe('buildSprite', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'hk-sprite-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns an id for every distinct gi: value in the real icons map', () => {
    const result = buildSprite(MAP_PATH, VENDOR_DIR, tmpDir);
    const expectedIds = distinctSlugValues()
      .map((v) => `gi-${v.slice('gi:'.length)}`)
      .sort();
    expect([...result.ids].sort()).toEqual(expectedIds);
  });

  it('writes a parseable sprite.svg containing the fighter class symbol', () => {
    buildSprite(MAP_PATH, VENDOR_DIR, tmpDir);
    const svgText = readFileSync(join(tmpDir, 'sprite.svg'), 'utf8');
    expect(svgText).toContain('<symbol id="gi-crossed-swords"');

    const parsed = new DOMParser().parseFromString(svgText, 'image/svg+xml');
    expect(parsed.querySelector('parsererror')).toBeNull();
    expect(parsed.querySelector('symbol#gi-crossed-swords')).not.toBeNull();
  });

  it('writes a sorted, deduplicated authors.json', () => {
    const result = buildSprite(MAP_PATH, VENDOR_DIR, tmpDir);
    const authorsJson = JSON.parse(readFileSync(join(tmpDir, 'authors.json'), 'utf8')) as string[];
    expect(authorsJson).toEqual(result.authors);
    expect(authorsJson).toEqual([...new Set(authorsJson)].sort());
    expect(authorsJson.length).toBeGreaterThan(0);
  });

  it('throws listing every missing slug when the map references an unvendored icon', () => {
    const map = JSON.parse(readFileSync(MAP_PATH, 'utf8')) as {
      categories: Record<string, string>;
      entities: Record<string, string>;
    };
    map.categories['fallback'] = 'gi:definitely-missing';
    const brokenMapPath = join(tmpDir, 'icons-map.json');
    writeFileSync(brokenMapPath, JSON.stringify(map), 'utf8');

    expect(() => buildSprite(brokenMapPath, VENDOR_DIR, join(tmpDir, 'out'))).toThrow(
      /definitely-missing/,
    );
  });

  it('matches the committed sprite.svg and authors.json byte-for-byte (drift gate)', () => {
    buildSprite(MAP_PATH, VENDOR_DIR, tmpDir);
    const freshSprite = readFileSync(join(tmpDir, 'sprite.svg'));
    const committedSprite = readFileSync(join(COMMITTED_OUT_DIR, 'sprite.svg'));
    expect(freshSprite.equals(committedSprite)).toBe(true);

    const freshAuthors = readFileSync(join(tmpDir, 'authors.json'));
    const committedAuthors = readFileSync(join(COMMITTED_OUT_DIR, 'authors.json'));
    expect(freshAuthors.equals(committedAuthors)).toBe(true);
  });
});
