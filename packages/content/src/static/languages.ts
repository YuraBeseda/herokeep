import type { Entity } from '@hk/protocol';
import { languageId } from '../ids.ts';

const SOURCE = { book: 'SRD 5.2.1' };

interface LanguageSpec {
  slug: string;
  name: string;
  secret?: boolean;
}

/**
 * The SRD 5.2.1 Standard Languages table (Common plus the nine languages on the 1d12 roll table)
 * followed by the Rare Languages table. Druidic and Thieves' Cant are marked secret there.
 */
const LANGUAGES: LanguageSpec[] = [
  { slug: 'common', name: 'Common' },
  { slug: 'common-sign-language', name: 'Common Sign Language' },
  { slug: 'draconic', name: 'Draconic' },
  { slug: 'dwarvish', name: 'Dwarvish' },
  { slug: 'elvish', name: 'Elvish' },
  { slug: 'giant', name: 'Giant' },
  { slug: 'gnomish', name: 'Gnomish' },
  { slug: 'goblin', name: 'Goblin' },
  { slug: 'halfling', name: 'Halfling' },
  { slug: 'orc', name: 'Orc' },
  { slug: 'abyssal', name: 'Abyssal' },
  { slug: 'celestial', name: 'Celestial' },
  { slug: 'deep-speech', name: 'Deep Speech' },
  { slug: 'infernal', name: 'Infernal' },
  { slug: 'primordial', name: 'Primordial' },
  { slug: 'sylvan', name: 'Sylvan' },
  { slug: 'undercommon', name: 'Undercommon' },
  { slug: 'druidic', name: 'Druidic', secret: true },
  { slug: 'thieves-cant', name: "Thieves' Cant", secret: true },
];

/** The SRD 5.2.1 language list (standard + rare) as `language` entities. */
export function languageEntities(): Entity[] {
  return LANGUAGES.map((lang) => ({
    type: 'language',
    id: languageId(lang.slug),
    name: lang.name,
    tags: lang.secret ? ['secret'] : [],
    source: SOURCE,
    prerequisites: [],
    effects: [],
    grants: [],
    choices: [],
  }));
}
