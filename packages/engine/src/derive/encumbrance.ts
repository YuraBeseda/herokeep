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
 * Fix round 1 (task 5 review, Important): guards a weight value against NaN/±Infinity/negative
 * before it ever reaches the `load` sum or a threshold comparison. Genuinely load-bearing for the
 * `custom.weight` path — `ItemAddedV1.custom: z.record(z.string().max(64), z.unknown())` validates
 * only the KEY, never the value, so a client can put literally anything there (`NaN`/`Infinity`
 * poison the whole character's `load` — every `load >= threshold.capacity` / `load > capacity`
 * comparison against a `NaN` load is `false`, so a poisoned character would silently show
 * `'normal'` no matter how much they're carrying; a negative weight would silently offset every
 * OTHER item's weight too). Applied to the resolved-`entity.weight` path as well, defense-in-depth
 * — `ItemEntitySchema.weight: z.number().min(0)` already rejects NaN/Infinity/negative at pack-parse
 * time (verified directly: `z.number().min(0).safeParse(NaN | Infinity | -1)` all fail), so that
 * path is not actually reachable with a bad value today, but the guard is cheap and keeps both
 * paths uniform / resilient to a future schema relaxation.
 *
 * A legally huge FINITE positive weight (e.g. a homebrew "boulder" at `custom.weight: 1_000_000`)
 * is NOT clamped — only non-finite/negative values are rejected — and produces a correct
 * `'overloaded'` `load`/state (tested); ordinary `+`/`*`/comparison on IEEE-754 doubles stays exact
 * well past any weight a real inventory could plausibly reach, only overflowing to `Infinity`
 * itself past ~1.8e308, far beyond anything this schema or a sane game world would produce — not
 * additionally guarded against here.
 */
function sanitizeWeight(w: unknown): number {
  return typeof w === 'number' && Number.isFinite(w) && w >= 0 ? w : 0;
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
 * `entity.weight` (a pre-existing `ItemEntitySchema` field, unrelated to this task); a fully custom
 * entry (no `itemId`, or one that doesn't resolve) reads `custom.weight` — `custom` is a free-form
 * bag with no schema-enforced `weight` key. Both paths run through `sanitizeWeight` above (absent/
 * non-numeric/NaN/Infinity/negative all become `0`). `item.container.capacityLb` (existing field)
 * is deliberately NOT consumed here — container-based effective-load reduction is out of this
 * task's scope.
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
    const unitWeight = sanitizeWeight(entity?.type === 'item' ? entity.weight : item.custom?.['weight']);
    load += unitWeight * item.qty;
  }

  const { carry, issue } = resolveCarryState(index.system().encumbrance, mode, load, evalFormula);
  return { carry, issues: issue ? [issue] : [] };
}
