import type { SystemEntity } from '@hk/protocol';
import type { ContentIndex } from '../content/index.ts';
import { type Diagnostic, warning } from '../diagnostics.ts';
import { type FormulaContext, evalFormulaString } from '../formula/evaluate.ts';
import type { Facts } from '../reduce/facts.ts';
import type { AbilitiesResult } from './abilities.ts';
import type { Composition } from './composition.ts';
import type { ResourceView } from './resources.ts';

export type EncumbranceMode = 'standard' | 'variant';
export type EncumbranceConfig = NonNullable<SystemEntity['encumbrance']>;

export interface Carry {
  mode: EncumbranceMode;
  capacity: number;
  load: number;
  state: 'normal' | 'encumbered' | 'heavilyEncumbered' | 'overloaded';
}

/**
 * Ruling 1 (phase 4, plan 11, task 5 — "encumbrance option"). Pure: given the resolved
 * `system.encumbrance` config (may be entirely absent — every pre-task-5 pack, or a real pack
 * before a content author supplies it), the requested `mode`, the character's already-summed
 * total carried `load`, and a formula evaluator, resolves the `Carry` block or a diagnostic when
 * the requested mode isn't authored. No `ContentIndex` needed — kept independently unit-testable
 * from `deriveEncumbrance`'s inventory-summing/formula-context wiring below.
 *
 * `standard` is a single hard cap — `state` is binary, `'normal'` or `'overloaded'` (`load` over
 * `capacity`; AT `capacity` exactly is still `'normal'`, an inclusive limit not an exceeded one).
 *
 * `variant` has its own hard `capacity` (same inclusive-limit semantics, `'overloaded'` beyond it —
 * this takes priority over every graded threshold, since it's the absolute ceiling) PLUS
 * `thresholds[]`, graded states applied with `load >= threshold.capacity` — sorted ascending by
 * resolved capacity here (authoring order in the pack doesn't matter) and the HIGHEST satisfied
 * threshold wins; below every threshold the state is `'normal'`.
 */
export function resolveCarryState(
  config: EncumbranceConfig | undefined,
  mode: EncumbranceMode,
  load: number,
  evalFormula: (f: string) => number,
): { carry?: Carry; issue?: Diagnostic } {
  if (mode === 'standard') {
    const standard = config?.standard;
    if (!standard) {
      return {
        issue: warning(
          'derive.encumbranceConfigMissing',
          'overrides.encumbrance requested "standard" but the system entity has no encumbrance.standard config',
        ),
      };
    }
    const capacity = evalFormula(standard.capacity);
    return { carry: { mode, capacity, load, state: load > capacity ? 'overloaded' : 'normal' } };
  }

  const variant = config?.variant;
  if (!variant) {
    return {
      issue: warning(
        'derive.encumbranceConfigMissing',
        'overrides.encumbrance requested "variant" but the system entity has no encumbrance.variant config',
      ),
    };
  }
  const capacity = evalFormula(variant.capacity);
  const thresholds = variant.thresholds
    .map((t) => ({ capacity: evalFormula(t.capacity), state: t.state }))
    .sort((a, b) => a.capacity - b.capacity);

  let state: Carry['state'] = 'normal';
  for (const t of thresholds) {
    if (load >= t.capacity) state = t.state;
  }
  if (load > capacity) state = 'overloaded';

  return { carry: { mode, capacity, load, state } };
}

/**
 * `derive()`-wired integration: computes total carried `load` from `facts.inventory` and evaluates
 * it against `index.system().encumbrance` via `resolveCarryState` above. Called from
 * `derive/index.ts` ONLY when `overrides.encumbrance` is `'standard'` or `'variant'` (never for
 * `'off'`/absent — that's the zero-computation default, enforced by the caller, not here).
 *
 * Load sourcing (doc-04 "Encumbrance"): EVERY inventory entry counts, regardless of
 * equipped/attuned state — unlike item charges/attunement (which only ever apply to an ACTIVE
 * instance), carrying capacity is about everything on a character's person. A resolved item reads
 * `entity.weight ?? 0` (a pre-existing `ItemEntitySchema` field, unrelated to this task); a fully
 * custom entry (no `itemId`, or one that doesn't resolve) reads `custom.weight` when it's a
 * `number`, else `0` — `custom` is a free-form bag with no schema-enforced `weight` key.
 * `item.container.capacityLb` (existing field) is deliberately NOT consumed here — container-based
 * effective-load reduction is out of this task's scope.
 */
export function deriveEncumbrance(
  mode: EncumbranceMode,
  abilities: AbilitiesResult,
  comp: Composition,
  facts: Facts,
  index: ContentIndex,
  resources: ResourceView[],
): { carry?: Carry; issues: Diagnostic[] } {
  const formulaCtx: FormulaContext = {
    level: comp.totalLevel,
    prof: abilities.prof,
    classLevel: (ref) => comp.classLevels[index.resolveClassRef(ref) ?? ref] ?? 0,
    mod: (ability) => abilities.abilities[ability]?.mod ?? 0,
    score: (ability) => abilities.abilities[ability]?.score.value ?? 0,
    hitDie: (slug) => {
      const classId = index.resolveClassRef(slug) ?? slug;
      const entity = index.get(classId);
      return entity?.type === 'class' ? entity.hitDie : 0;
    },
    resource: (slug) => resources.find((r) => r.id === slug)?.max.value ?? 0,
  };
  const evalFormula = (f: string) => evalFormulaString(f, formulaCtx);

  let load = 0;
  for (const item of facts.inventory) {
    const entity = item.itemId !== undefined ? index.get(item.itemId) : undefined;
    const customWeight = item.custom?.['weight'];
    const unitWeight =
      entity?.type === 'item' ? (entity.weight ?? 0) : typeof customWeight === 'number' ? customWeight : 0;
    load += unitWeight * item.qty;
  }

  const { carry, issue } = resolveCarryState(index.system().encumbrance, mode, load, evalFormula);
  return { carry, issues: issue ? [issue] : [] };
}
