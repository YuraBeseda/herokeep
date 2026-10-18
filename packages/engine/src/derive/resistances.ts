import type { ActiveEffect } from './composition.ts';

/** One damage type the character has Resistance to, with every feature (else root source) granting it. */
export interface DamageResistance {
  type: string;
  sources: string[];
}

/**
 * Plan 14 task 3: the derive consumer for `damage.resistance` (first real consumer: Cloak of
 * Arachnida's Poison Resistance). Reads the fully resolved (predicate-filtered) effect list, so a
 * gated resistance appears only while its `when` holds, and an item's only while it is active (an
 * attunement-required item only while attuned). Provenance is the declaring feature when there is
 * one (the root source otherwise). Display-only, like `deriveImmunities`: nothing here halves damage.
 */
export function deriveResistances(effects: readonly ActiveEffect[]): DamageResistance[] {
  const byType = new Map<string, Set<string>>();
  for (const ae of effects) {
    if (ae.effect.type !== 'damage.resistance') continue;
    const source = ae.feature ?? ae.source;
    for (const type of ae.effect.types) {
      const sources = byType.get(type) ?? new Set<string>();
      sources.add(source);
      byType.set(type, sources);
    }
  }
  return [...byType.keys()].sort().map((type) => ({ type, sources: [...byType.get(type)!].sort() }));
}
