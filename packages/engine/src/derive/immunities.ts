import type { ActiveEffect } from './composition.ts';

/** One condition the character is immune to, with every feature (else root source) granting it. */
export interface ConditionImmunity {
  condition: string;
  sources: string[];
}

/**
 * Plan 13 task 5 (ruling 9): the derive consumer for `condition.immunity`. Reads the fully resolved
 * (predicate-filtered) effect list, so a gated immunity (e.g. Aura of Courage's "not Incapacitated")
 * appears only while its `when` holds. Provenance is the declaring feature when there is one (the
 * root source otherwise). Display-only: nothing here, or anywhere, refuses applying the condition.
 */
export function deriveImmunities(effects: readonly ActiveEffect[]): ConditionImmunity[] {
  const byCondition = new Map<string, Set<string>>();
  for (const ae of effects) {
    if (ae.effect.type !== 'condition.immunity') continue;
    const source = ae.feature ?? ae.source;
    for (const condition of ae.effect.conditions) {
      const sources = byCondition.get(condition) ?? new Set<string>();
      sources.add(source);
      byCondition.set(condition, sources);
    }
  }
  return [...byCondition.keys()].sort().map((condition) => ({
    condition,
    sources: [...byCondition.get(condition)!].sort(),
  }));
}
