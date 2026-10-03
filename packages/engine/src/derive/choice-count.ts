import type { Choice } from '@hk/protocol';
import type { ContentIndex } from '../content/index.ts';
import { evalFormulaString, type FormulaContext } from '../formula/evaluate.ts';
import type { Facts } from '../reduce/facts.ts';

/**
 * A choice's effective pick count (plan 12 task 2). An int `Choice.count` is returned unchanged; a
 * formula-string count (e.g. fighter weapon masteries, growing with `classLevel(fighter)`) is
 * evaluated against the character's class levels. Choice requests are built from facts alone — before
 * composition and ability derivation exist — so the formula context is deliberately narrow: `level`,
 * `classLevel(...)` and `hitDie(...)` are live; `prof`/`mod`/`score`/`resource` evaluate to 0 and must
 * not be relied on in a count. The result is floored and clamped to at least 1 (a choice always asks
 * for something). Pack validation rejects any other symbol (`validateCountSymbols`, formula/validate.ts
 * — keep in sync). A formula that cannot be evaluated resolves to 1, mirroring the predicate-formula
 * posture (predicate/evaluate.ts: validation reports, derive never fails).
 */
export function resolveChoiceCount(
  choice: Pick<Choice, 'count'>,
  facts: Pick<Facts, 'classes'>,
  index: ContentIndex,
): number {
  if (typeof choice.count === 'number') return choice.count;
  const levels = new Map<string, number>();
  let total = 0;
  for (const entry of facts.classes) {
    const id = index.resolveClassRef(entry.classId) ?? entry.classId;
    levels.set(id, (levels.get(id) ?? 0) + entry.level);
    total += entry.level;
  }
  const ctx: FormulaContext = {
    level: total,
    prof: 0,
    classLevel: (ref) => levels.get(index.resolveClassRef(ref) ?? ref) ?? 0,
    mod: () => 0,
    score: () => 0,
    hitDie: (slug) => {
      const entity = index.get(index.resolveClassRef(slug) ?? slug);
      return entity?.type === 'class' ? entity.hitDie : 0;
    },
    resource: () => 0,
  };
  try {
    return Math.max(1, Math.floor(evalFormulaString(choice.count, ctx)));
  } catch {
    return 1;
  }
}

/**
 * True when a recorded decision no longer satisfies a GROWN formula count (the character gained a
 * level that raised it). Only formula counts re-offer: an int count keeps its historical behavior
 * (a decided choice is never re-asked), so no existing event log's outstanding list changes.
 */
export function decisionFallsShort(choice: Pick<Choice, 'count'>, recorded: readonly string[], count: number): boolean {
  return typeof choice.count === 'string' && recorded.length < count;
}
