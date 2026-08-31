import type { Pack } from '@hk/protocol';
import { describe, expect, it } from 'vitest';
import { createContentIndex } from '../../src/content/index.ts';
import { createLocalizer } from '../../src/i18n/localizer.ts';
import { loadFixturePack } from '../support/fixtures.ts';

describe('translation packs merge per field', () => {
  it("a later pack overriding one field keeps the earlier pack's other fields", () => {
    const core = loadFixturePack('core-mini');
    const ru = loadFixturePack('translation-mini'); // has spell/fireball {name, description}
    const patch: Pack = {
      ...ru,
      id: 'core-mini-ru-patch',
      version: '1.0.0',
      dependencies: [{ id: 'core-mini-ru', range: '^1' }],
      strings: { 'spell/fireball': { name: 'Огненный шар (испр.)' } },
    };
    const index = createContentIndex([core, ru, patch]);
    const loc = createLocalizer(index, 'ru');
    expect(loc.text('core-mini:spell/fireball', 'name').text).toBe('Огненный шар (испр.)');
    // the description from the EARLIER pack must survive:
    expect(loc.text('core-mini:spell/fireball', 'description')).toEqual({
      text: 'Яркая вспышка.',
      locale: 'ru',
      isFallback: false,
    });
  });
});
