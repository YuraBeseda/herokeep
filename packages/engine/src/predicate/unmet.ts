import type { Predicate } from '@hk/protocol';
import type { PredicateContext } from './context.ts';
import { evaluatePredicate } from './evaluate.ts';

/** The smallest failing sub-predicates: a failing `all` yields its failing children, a failing `any`
 * (which reads "one of …") or leaf yields itself. A passing predicate yields nothing. */
export function unmetPrerequisites(predicates: readonly Predicate[], ctx: PredicateContext): Predicate[] {
  return predicates.flatMap((p) => {
    if (evaluatePredicate(p, ctx)) return [];
    return 'all' in p ? unmetPrerequisites(p.all, ctx) : [p];
  });
}
