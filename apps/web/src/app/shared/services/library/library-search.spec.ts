import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createContentIndex, createLocalizer, createSearchIndex } from '@hk/engine';
import type { SearchHit } from '@hk/engine';
import { PACK_ID, PACK_VERSION } from '@hk/content/version';
import { parsePack, type EntityType, type Pack } from '@hk/protocol';
import { countByType, highlightSegments, rankLibraryHits, RANK_TIER } from './library-search';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..', '..', '..', '..', '..');

function readPack(path: string): Pack {
  const raw: unknown = JSON.parse(readFileSync(path, 'utf8'));
  const result = parsePack(raw);
  if (!result.ok) throw new Error(result.issues.map((i) => i.message).join('; '));
  return result.pack;
}

const corePack = readPack(
  join(repoRoot, 'packages/content/dist/packs', PACK_ID, PACK_VERSION, 'pack.json'),
);

const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });

function hit(id: string, name: string, type: EntityType = 'spell', score = 85): SearchHit {
  return { id, type, name, score };
}

const noEnglish = (): undefined => undefined;

describe('rankLibraryHits', () => {
  it('ranks exact, then prefix, then word, then substring matches', () => {
    const hits = [
      hit('a', 'Bonfire'), // substring only
      hit('b', 'Wall of Fire'), // word
      hit('c', 'Fire Shield'), // prefix
      hit('d', 'Fire'), // exact
    ];
    const ranked = rankLibraryHits(hits, 'fire', noEnglish, collator);
    expect(ranked.map((r) => r.name)).toEqual(['Fire', 'Fire Shield', 'Wall of Fire', 'Bonfire']);
    expect(ranked.map((r) => r.tier)).toEqual([
      RANK_TIER.exact,
      RANK_TIER.prefix,
      RANK_TIER.word,
      RANK_TIER.other,
    ]);
  });

  it('puts the shortest prefix match first, so the closest name to the query leads', () => {
    const ranked = rankLibraryHits(
      [hit('a', 'Fire Bolt'), hit('b', 'Fireball'), hit('c', 'Fire Storm')],
      'fire',
      noEnglish,
      collator,
    );
    expect(ranked.map((r) => r.name)).toEqual(['Fireball', 'Fire Bolt', 'Fire Storm']);
  });

  it('ignores case, diacritics and the ё/е difference when ranking', () => {
    const ranked = rankLibraryHits(
      [hit('a', 'Огненная стена'), hit('b', 'Огненный шар'), hit('c', 'Ёж')],
      'ЕЖ',
      noEnglish,
      collator,
    );
    expect(ranked[0]?.name).toBe('Ёж');
    expect(ranked[0]?.tier).toBe(RANK_TIER.exact);
  });

  it('ranks by the better of the active-language name and the English name', () => {
    const english = (id: string): string | undefined => (id === 'ball' ? 'Fireball' : undefined);
    const ranked = rankLibraryHits(
      [hit('x', 'Стена огня'), hit('ball', 'Огненный шар')],
      'fireball',
      english,
      collator,
    );
    expect(ranked[0]?.id).toBe('ball');
    expect(ranked[0]?.tier).toBe(RANK_TIER.exact);
  });

  it('never adds or drops a hit, and an empty query ranks nothing', () => {
    const hits = [hit('a', 'Fire Bolt'), hit('b', 'Bonfire')];
    expect(rankLibraryHits(hits, 'fire', noEnglish, collator)).toHaveLength(2);
    expect(rankLibraryHits(hits, '   ', noEnglish, collator)).toEqual([]);
  });

  it('breaks full ties by search score, then by name', () => {
    const ranked = rankLibraryHits(
      [hit('a', 'Fire Bolt', 'spell', 80), hit('b', 'Fire Bold', 'spell', 85)],
      'fire bo',
      noEnglish,
      collator,
    );
    expect(ranked.map((r) => r.id)).toEqual(['b', 'a']);
  });

  it('with the real pack, "fire" opens with Fireball, then the other Fire spells', () => {
    const index = createContentIndex([corePack]);
    const localizer = createLocalizer(index, 'en');
    const hits = createSearchIndex(index, localizer).query('fire');
    const ranked = rankLibraryHits(hits, 'fire', (id) => index.get(id)?.name, collator);

    expect(ranked[0]?.id).toBe('srd-5e-2024:spell/fireball');
    const names = ranked.map((r) => r.name);
    expect(names.indexOf('Fire Bolt')).toBeLessThan(names.indexOf('Wall of Fire'));
    expect(ranked).toHaveLength(hits.length);
  });
});

describe('countByType', () => {
  it('counts hits per entity type and leaves out types with none', () => {
    const counts = countByType([
      hit('a', 'A', 'spell'),
      hit('b', 'B', 'spell'),
      hit('c', 'C', 'item'),
    ]);
    expect(counts.get('spell')).toBe(2);
    expect(counts.get('item')).toBe(1);
    expect(counts.has('class')).toBe(false);
  });
});

describe('highlightSegments', () => {
  it('marks every query word in the name, ignoring case, and the runs join back to the name', () => {
    const segments = highlightSegments('Wall of Fire', 'FIRE wall');
    expect(segments).toEqual([
      { text: 'Wall', hit: true },
      { text: ' of ', hit: false },
      { text: 'Fire', hit: true },
    ]);
    expect(segments.map((s) => s.text).join('')).toBe('Wall of Fire');
  });

  it('works on a localized name', () => {
    expect(highlightSegments('Огненный шар', 'огнен')).toEqual([
      { text: 'Огнен', hit: true },
      { text: 'ный шар', hit: false },
    ]);
  });

  it('treats regex characters in the query as plain text and leaves a non-match whole', () => {
    expect(highlightSegments("Alchemist's Fire", '(')).toEqual([
      { text: "Alchemist's Fire", hit: false },
    ]);
    expect(highlightSegments('Fire Bolt', '   ')).toEqual([{ text: 'Fire Bolt', hit: false }]);
  });
});
