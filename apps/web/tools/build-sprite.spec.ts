import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { UI_ICONS } from '../src/app/ui/icons/vocabulary';
import { buildSprite, transformIconToSymbol } from './build-sprite';

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

  describe('ui vocabulary section', () => {
    it('emits one ui-<name> symbol per vocabulary entry, drawing its gi glyph', () => {
      const result = buildSprite(MAP_PATH, VENDOR_DIR, tmpDir, UI_ICONS);
      const svgText = readFileSync(join(tmpDir, 'sprite.svg'), 'utf8');
      const parsed = new DOMParser().parseFromString(svgText, 'image/svg+xml');
      expect(parsed.querySelector('parsererror')).toBeNull();
      for (const [name, entry] of Object.entries(UI_ICONS)) {
        expect(result.ids).toContain(`ui-${name}`);
        const symbol = parsed.querySelector(`symbol[id="ui-${name}"]`);
        expect(symbol, name).not.toBeNull();
        expect(symbol!.querySelector('use')!.getAttribute('href')).toBe(`#gi-${entry.gi}`);
        expect(parsed.querySelector(`symbol[id="gi-${entry.gi}"]`), entry.gi).not.toBeNull();
      }
    });

    it('wraps a badge source in a viewBox that starts at the origin', () => {
      buildSprite(MAP_PATH, VENDOR_DIR, tmpDir, UI_ICONS);
      const svgText = readFileSync(join(tmpDir, 'sprite.svg'), 'utf8');
      const parsed = new DOMParser().parseFromString(svgText, 'image/svg+xml');
      const size = (el: Element) => el.getAttribute('viewBox')!.split(' ').slice(2).join(' ');
      for (const [name, entry] of Object.entries(UI_ICONS)) {
        const wrapper = parsed.querySelector(`symbol[id="ui-${name}"]`)!;
        const source = parsed.querySelector(`symbol[id="gi-${entry.gi}"]`)!;
        expect(wrapper.getAttribute('viewBox')!.startsWith('0 0 '), name).toBe(true);
        expect(size(wrapper), name).toBe(size(source));
      }
      expect(parsed.querySelector('symbol[id="ui-settings"]')!.getAttribute('viewBox')).toBe(
        '0 0 216 216',
      );
    });

    it('keeps the gi: ids of the icons map when a ui section is added', () => {
      const withUi = buildSprite(MAP_PATH, VENDOR_DIR, tmpDir, UI_ICONS).ids;
      const without = buildSprite(MAP_PATH, VENDOR_DIR, join(tmpDir, 'plain')).ids;
      for (const id of without) expect(withUi).toContain(id);
    });

    it('strips the badge discs and keeps the 216-unit box for the disc-style glyphs', () => {
      buildSprite(MAP_PATH, VENDOR_DIR, tmpDir, UI_ICONS);
      const svgText = readFileSync(join(tmpDir, 'sprite.svg'), 'utf8');
      const parsed = new DOMParser().parseFromString(svgText, 'image/svg+xml');
      const plus = parsed.querySelector('symbol[id="gi-plus"]')!;
      expect(plus.getAttribute('viewBox')).toBe('20 20 216 216');
      expect(plus.querySelector('circle')).toBeNull();
      expect(plus.querySelector('path')).not.toBeNull();
    });

    it('throws when a ui entry names a glyph that is not vendored', () => {
      expect(() =>
        buildSprite(MAP_PATH, VENDOR_DIR, tmpDir, { nope: { gi: 'definitely-missing' } }),
      ).toThrow(/definitely-missing/);
    });
  });

  describe('currentColor inheritance', () => {
    const WHITE_FILL = /(?:fill|stroke)="(?:#fff|#ffffff|white)"/i;

    it('leaves no hard-coded white fill in any built symbol', () => {
      const result = buildSprite(MAP_PATH, VENDOR_DIR, tmpDir, UI_ICONS);
      const svgText = readFileSync(join(tmpDir, 'sprite.svg'), 'utf8');
      expect(svgText).not.toMatch(WHITE_FILL);
      expect(result.ids.length).toBe(216);
    });

    it('drops the white fill from a standard fixture and keeps the shape', () => {
      const fixture =
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path d="M0 0h512v512H0z"/><path fill="#fff" d="M1 2h3z"/></svg>';
      const symbol = transformIconToSymbol(fixture, 'fx');
      expect(symbol).toBe('<symbol id="gi-fx" viewBox="0 0 512 512"><path d="M1 2h3z"/></symbol>');
    });

    it('turns a badge fixture into a single-colour glyph on the 216 box (discs removed)', () => {
      const fixture =
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><circle cx="128" cy="128" r="128"/><circle stroke="#fff" stroke-width="18" cx="128" cy="128" r="101"/><path fill="#fff" d="M1 2h3z"/></svg>';
      const symbol = transformIconToSymbol(fixture, 'fx');
      expect(symbol).toBe(
        '<symbol id="gi-fx" viewBox="20 20 216 216"><path d="M1 2h3z"/></symbol>',
      );
      expect(symbol).not.toMatch(WHITE_FILL);
    });
  });

  it('matches the committed sprite.svg and authors.json byte-for-byte (drift gate)', () => {
    buildSprite(MAP_PATH, VENDOR_DIR, tmpDir, UI_ICONS);
    const freshSprite = readFileSync(join(tmpDir, 'sprite.svg'));
    const committedSprite = readFileSync(join(COMMITTED_OUT_DIR, 'sprite.svg'));
    expect(freshSprite.equals(committedSprite)).toBe(true);

    const freshAuthors = readFileSync(join(tmpDir, 'authors.json'));
    const committedAuthors = readFileSync(join(COMMITTED_OUT_DIR, 'authors.json'));
    expect(freshAuthors.equals(committedAuthors)).toBe(true);
  });
});
