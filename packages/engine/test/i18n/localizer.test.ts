import { describe, expect, it } from 'vitest';
import { createContentIndex } from '../../src/content/index.ts';
import { createLocalizer } from '../../src/i18n/localizer.ts';
import { loadFixturePack } from '../support/fixtures.ts';

const index = createContentIndex([
  loadFixturePack('core-mini'),
  loadFixturePack('content-mini'),
  loadFixturePack('translation-mini'),
]);

describe('createLocalizer', () => {
  it('uses translation packs and reports fallback per field', () => {
    const ru = createLocalizer(index, 'ru');
    expect(ru.text('core-mini:spell/fireball', 'name')).toEqual({
      text: 'Огненный шар',
      locale: 'ru',
      isFallback: false,
    });
    expect(ru.text('core-mini:class/fighter', 'name').text).toBe('Воин');
    expect(ru.text('core-mini:class/fighter', 'description')).toEqual({ text: '', locale: 'en', isFallback: true });
    expect(ru.text('core-mini:feat/alert', 'name')).toEqual({ text: 'Alert', locale: 'en', isFallback: true });
  });

  it('uses inline i18n of the owning pack and resolves regional locales to the base language', () => {
    expect(createLocalizer(index, 'ru').name('homebrew-mini:species/catfolk')).toBe('Кошколюд');
    expect(createLocalizer(index, 'ru-UA').name('core-mini:spell/fireball')).toBe('Огненный шар');
    expect(createLocalizer(index, 'uk').name('core-mini:spell/fireball')).toBe('Fireball');
  });

  it('localizes choice prompts', () => {
    const ru = createLocalizer(index, 'ru');
    expect(ru.choicePrompt('core-mini:class/fighter@1/fighting-style').text).toBe('Боевой стиль');
    expect(ru.choicePrompt('core-mini:class/fighter@1/equipment')).toEqual({
      text: 'Starting equipment',
      locale: 'en',
      isFallback: true,
    });
  });

  it('is the identity for English', () => {
    const en = createLocalizer(index, 'en');
    expect(en.text('core-mini:spell/fireball', 'name')).toEqual({ text: 'Fireball', locale: 'en', isFallback: false });
  });
});
