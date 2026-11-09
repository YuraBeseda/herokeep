import { normalizeSearchText } from '@hk/engine';
import type { SearchHit } from '@hk/engine';
import type { EntityType } from '@hk/protocol';

/**
 * Library result ranking (spec §4.5, board LB01): a typed query ranks
 *
 * 1. an EXACT name match,
 * 2. then names that START with the query (the closest to what was typed first: shorter names
 *    before longer ones, so "fire" opens with Fireball ahead of Fire Bolt),
 * 3. then WORD matches (every query word begins some word of the name, so "fire" finds "Wall of
 *    Fire" and "Alchemist's Fire"),
 * 4. then anything else the search index matched (a substring inside a word).
 *
 * The match itself is the content index's own `SearchIndex.query`; this only re-orders its hits,
 * so what is found never changes. The name is tried in the active language and in the entity's
 * English name (a translated pack may leave a name in English), whichever ranks better.
 */

/** The tiers, best first. */
export const RANK_TIER = { exact: 0, prefix: 1, word: 2, other: 3 } as const;
type Tier = (typeof RANK_TIER)[keyof typeof RANK_TIER];

function tierOf(words: readonly string[], whole: string, name: string): Tier {
  if (name === whole) return RANK_TIER.exact;
  if (name.startsWith(whole)) return RANK_TIER.prefix;
  const nameWords = name.split(' ');
  if (words.every((word) => nameWords.some((candidate) => candidate.startsWith(word)))) {
    return RANK_TIER.word;
  }
  return RANK_TIER.other;
}

export interface RankedHit extends SearchHit {
  readonly tier: Tier;
}

/**
 * Re-orders `hits` for `query`. `englishName` resolves an entity id to its English name (the
 * pack's own `name`); `collator` breaks the remaining ties in the active language.
 */
export function rankLibraryHits(
  hits: readonly SearchHit[],
  query: string,
  englishName: (id: string) => string | undefined,
  collator: Intl.Collator,
): RankedHit[] {
  const whole = normalizeSearchText(query);
  if (whole === '') return [];
  const words = whole.split(' ');

  const decorated = hits.map((hit) => {
    const local = normalizeSearchText(hit.name);
    const english = normalizeSearchText(englishName(hit.id) ?? hit.name);
    const localTier = tierOf(words, whole, local);
    const englishTier = tierOf(words, whole, english);
    // The name that earned the tier is the one whose length counts.
    const length = localTier <= englishTier ? local.length : english.length;
    return { hit: { ...hit, tier: Math.min(localTier, englishTier) as Tier }, length };
  });

  decorated.sort(
    (a, b) =>
      a.hit.tier - b.hit.tier ||
      a.length - b.length ||
      b.hit.score - a.hit.score ||
      collator.compare(a.hit.name, b.hit.name) ||
      (a.hit.id < b.hit.id ? -1 : 1),
  );
  return decorated.map((entry) => entry.hit);
}

/** How many of `hits` there are of each entity type; types with none are absent. */
export function countByType(
  hits: readonly { readonly type: EntityType }[],
): Map<EntityType, number> {
  const counts = new Map<EntityType, number>();
  for (const hit of hits) counts.set(hit.type, (counts.get(hit.type) ?? 0) + 1);
  return counts;
}
