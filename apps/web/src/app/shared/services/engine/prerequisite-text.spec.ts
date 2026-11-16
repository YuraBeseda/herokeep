import type { Predicate } from '@hk/protocol';
import charactersEn from '../../../../assets/i18n/characters/en.json';
import { prerequisiteReason, prerequisiteText } from './prerequisite-text';

// A tiny ICU-less formatter over the real en.json strings: {name} substitution only.
const gate = charactersEn.wizard.picker.gate as Record<string, string>;
const t = (key: string, params: Record<string, unknown> = {}): string =>
  (gate[key.split('.').pop()!] ?? key).replace(/\{(\w+)\}/g, (_, k: string) => String(params[k]));
const names: Record<string, string> = { str: 'Strength', dex: 'Dexterity', 'p:class/fighter': 'Fighter' };
const name = (id: string) => names[id] ?? id;

const str13: Predicate = { ability: { str: { gte: 13 } } };
const dex13: Predicate = { ability: { dex: { gte: 13 } } };

describe('prerequisiteText', () => {
  it.each<[string, Predicate[], string]>([
    ['ability gte', [str13], 'Strength 13+'],
    ['ability lte', [{ ability: { str: { lte: 8 } } }], 'Strength 8 or less'],
    ['ability eq', [{ ability: { str: { eq: 10 } } }], 'Strength 10'],
    ['level', [{ level: { gte: 4 } }], 'Character level 4+'],
    ['class level', [{ classLevel: { 'p:class/fighter': { gte: 3 } } }], 'Fighter level 3+'],
    ['spellcaster', [{ spellcaster: true }], 'Ability to cast spells'],
    ['any', [{ any: [str13, dex13] }], 'One of: Strength 13+ or Dexterity 13+'],
    ['several', [str13, { level: { gte: 4 } }], 'Strength 13+, Character level 4+'],
  ])('%s', (_n, unmet, text) => expect(prerequisiteText(unmet, t, name)).toBe(text));

  it('falls back to the generic text for an unsupported kind', () => {
    expect(prerequisiteText([{ hasFeat: 'x' }], t, name)).toBe('Prerequisites not met');
    expect(prerequisiteReason([{ hasFeat: 'x' }], t, name)).toBe('Prerequisites not met');
  });

  it('the reason reads "Requires …"', () => expect(prerequisiteReason([str13], t, name)).toBe('Requires Strength 13+'));
});
