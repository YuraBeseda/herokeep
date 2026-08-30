// Intl.Collator is permitted only in i18n/search.ts (docs/02-architecture/05-rules-engine.md)
import type { EntityType } from '@hk/protocol';
import type { ContentIndex } from '../content/index.ts';
import type { Localizer } from './localizer.ts';
import { normalizeSearchText } from './normalize.ts';

export interface SearchHit {
  id: string;
  type: EntityType;
  name: string;
  score: number;
}

export interface SearchOptions {
  types?: EntityType[];
  limit?: number;
}

export interface SearchIndex {
  query(text: string, opts?: SearchOptions): SearchHit[];
}

interface Entry {
  id: string;
  type: EntityType;
  name: string;
  local: string;
  english: string;
}

function matchScore(words: string[], target: string): number {
  if (target === words.join(' ')) return 100;
  const targetWords = target.split(' ');
  if (words.every((w) => targetWords.some((t) => t.startsWith(w)))) return 80;
  if (words.every((w) => target.includes(w))) return 60;
  return 0;
}

export function createSearchIndex(index: ContentIndex, localizer: Localizer): SearchIndex {
  const collator = new Intl.Collator(localizer.locale, { sensitivity: 'base', numeric: true });
  const entries: Entry[] = [];
  for (const type of [
    'spell',
    'item',
    'feat',
    'feature',
    'species',
    'background',
    'class',
    'subclass',
    'condition',
    'skill',
    'language',
    'tool',
    'rule',
    'table',
  ] as EntityType[]) {
    for (const e of index.byType(type)) {
      const name = localizer.name(e.id);
      entries.push({ id: e.id, type, name, local: normalizeSearchText(name), english: normalizeSearchText(e.name) });
    }
  }

  return {
    query(text, opts = {}) {
      const q = normalizeSearchText(text);
      if (q === '') return [];
      const words = q.split(' ');
      const types = opts.types ? new Set<EntityType>(opts.types) : undefined;
      const hits: SearchHit[] = [];
      for (const en of entries) {
        if (types && !types.has(en.type)) continue;
        const local = matchScore(words, en.local);
        const english = matchScore(words, en.english);
        const score = Math.max(local > 0 ? local + 5 : 0, english);
        if (score > 0) hits.push({ id: en.id, type: en.type, name: en.name, score });
      }
      hits.sort((a, b) => b.score - a.score || collator.compare(a.name, b.name) || (a.id < b.id ? -1 : 1));
      return opts.limit !== undefined ? hits.slice(0, opts.limit) : hits;
    },
  };
}
