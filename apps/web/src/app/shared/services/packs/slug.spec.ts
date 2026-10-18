import { SLUG_RE } from '@hk/protocol';
import { slugify, uniqueSlug } from './slug';

describe('slugify', () => {
  it('lowercases ASCII and joins words with single dashes', () => {
    expect(slugify('Flame Tongue Sword')).toBe('flame-tongue-sword');
    expect(slugify('  Ring  of   +1 Protection!! ')).toBe('ring-of-1-protection');
    expect(slugify('Bob’s_Axe')).toBe('bobs-axe');
  });

  it('strips Latin diacritics', () => {
    expect(slugify('Épée Légère')).toBe('epee-legere');
  });

  it('transliterates Russian Cyrillic', () => {
    expect(slugify('Огненный шар')).toBe('ognennyy-shar');
    expect(slugify('Щит Ёжика')).toBe('shchit-yozhika');
  });

  it('transliterates the Ukrainian letters', () => {
    expect(slugify('Їжак і ґанок')).toBe('yizhak-i-ganok');
    expect(slugify('Єдиноріг')).toBe('yedynorih');
    expect(slugify('П’ятий')).toBe('pyatyy');
  });

  it('returns an empty string when nothing slug-worthy remains', () => {
    expect(slugify('')).toBe('');
    expect(slugify('!!! ??? ***')).toBe('');
    expect(slugify('火の玉')).toBe('');
  });

  it('caps the slug at 64 characters without a trailing dash', () => {
    const slug = slugify(`${'a'.repeat(63)} bcd`);
    expect(slug.length).toBeLessThanOrEqual(64);
    expect(slug.endsWith('-')).toBe(false);
  });

  it('always yields a slug the protocol accepts (or an empty string)', () => {
    for (const name of ['Меч', 'x', '9 lives', '-dash-', 'Ü', 'Ґрунт']) {
      const slug = slugify(name);
      expect(slug === '' || SLUG_RE.test(slug)).toBe(true);
    }
  });
});

describe('uniqueSlug', () => {
  it('keeps a free base', () => {
    expect(uniqueSlug('fireball', new Set(), 'spell')).toBe('fireball');
  });

  it('appends -2, -3, … on collision', () => {
    expect(uniqueSlug('fireball', new Set(['fireball']), 'spell')).toBe('fireball-2');
    expect(uniqueSlug('fireball', new Set(['fireball', 'fireball-2']), 'spell')).toBe('fireball-3');
  });

  it('falls back to <type>-<n> for an empty base', () => {
    expect(uniqueSlug('', new Set(), 'item')).toBe('item-1');
    expect(uniqueSlug('', new Set(['item-1', 'item-2']), 'item')).toBe('item-3');
  });
});
