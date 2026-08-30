import { describe, expect, it } from 'vitest';
import { createContentIndex } from '../../src/content/index.ts';
import { createLocalizer } from '../../src/i18n/localizer.ts';
import { normalizeSearchText } from '../../src/i18n/normalize.ts';
import { createSearchIndex } from '../../src/i18n/search.ts';
import { loadFixturePack } from '../support/fixtures.ts';

const index = createContentIndex([
  loadFixturePack('core-mini'),
  loadFixturePack('content-mini'),
  loadFixturePack('translation-mini'),
]);

describe('normalizeSearchText', () => {
  it('folds case, marks, yo and apostrophes', () => {
    const input1 =
      String.fromCharCode(32, 32) +
      'Ёлка' +
      String.fromCharCode(32, 32) +
      'Résumé' +
      String.fromCharCode(32, 32, 8216) +
      'x' +
      String.fromCharCode(8217, 32);
    const expected1 = 'елка resume ' + String.fromCharCode(39) + 'x' + String.fromCharCode(39);
    expect(normalizeSearchText(input1)).toBe(expected1);
    expect(normalizeSearchText('Ґанок')).toBe('ґанок');
  });
});

describe('createSearchIndex', () => {
  const ru = createSearchIndex(index, createLocalizer(index, 'ru'));
  const en = createSearchIndex(index, createLocalizer(index, 'en'));
  const ids = (hits: { id: string }[]) => hits.map((h) => h.id);

  it('finds by localized and by English name', () => {
    for (const q of ['fireball', 'Огненный', 'огненн', 'шар', 'fire ball', 'FIRE']) {
      expect(ids(ru.query(q)), q).toContain('core-mini:spell/fireball');
    }
    expect(ids(en.query('огненный'))).toEqual([]);
  });

  it('ranks exact > prefix > substring and filters by type', () => {
    expect(ids(en.query('fighter', { types: ['class'] }))).toEqual(['core-mini:class/fighter']);
    expect(ids(en.query('e', { types: ['species'] }))).toEqual(['core-mini:species/elf']);
    const hits = en.query('a', { types: ['feat'] });
    expect(hits.map((h) => h.name)).toEqual(['Alert', 'Archery']);
    expect(en.query('a', { limit: 1 })).toHaveLength(1);
  });

  it('returns nothing for empty or whitespace queries', () => {
    expect(en.query('   ')).toEqual([]);
  });
});
