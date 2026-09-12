import type { ContentIndex } from '../content/index.ts';
import type { Composition } from './composition.ts';

export interface ActionView {
  id: string;
  name: string;
  kind: string;
  description: string;
  resource?: string;
  source: string;
}

/**
 * Derives one `ActionView` per active `action.define` effect. Unlike this file's siblings, the
 * signature carries no `AbilitiesResult`/`Facts`: nothing in `ActionView` needs a formula evaluated
 * (`uses.count` is deliberately NOT surfaced here — out of this task's scope) or ability scores to
 * resolve, so `comp.effects` (composition's own effect list) is enough on its own — EXCEPT that a
 * `deferred` effect (composition.ts's layering note: one whose `when` needs ability scores) can't be
 * resolved without an `AbilitiesResult`, which this function doesn't receive. No 1b fixture defines a
 * score-gated `action.define`, so skipping deferred effects here (rather than including them
 * unresolved) never drops a real action; a future task can widen this signature if that changes.
 */
export function deriveActions(comp: Composition, index: ContentIndex): { actions: ActionView[] } {
  const actions: ActionView[] = [];
  for (const ae of comp.effects) {
    if (ae.deferred) continue;
    const eff = ae.effect;
    if (eff.type !== 'action.define') continue;
    // Defensive only: composition.ts guarantees `ae.source` is always one of its own active
    // entities (never a synthetic id), so this is always true in practice today.
    if (!index.has(ae.source)) continue;
    actions.push({
      id: eff.id,
      name: eff.name,
      kind: eff.kind,
      description: eff.description,
      resource: eff.resource,
      source: ae.feature ?? ae.source,
    });
  }
  actions.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { actions };
}
