import type { ContentIndex } from '../content/index.ts';
import type { Diagnostic } from '../diagnostics.ts';
import { type FormulaContext, evalFormulaString } from '../formula/evaluate.ts';
import type { Facts } from '../reduce/facts.ts';
import type { AbilitiesResult } from './abilities.ts';
import type { Composition } from './composition.ts';
import { type Derived, ModifierTable } from './modifiers.ts';

export interface ResourceView {
  id: string;
  name: string;
  max: Derived<number>;
  used: number;
  reset: string;
  display: string;
  source: string;
}

interface ResourceMeta {
  name: string;
  reset: string;
  display: string;
  source: string;
}

/**
 * Derives one `ResourceView` per distinct `resource.define.id` seen among the fully resolved
 * (post-deferral) active effects. `max` is `resource.define.max` (always a formula string, per
 * `effects.ts`'s schema — unlike `ac.bonus`/`hp.bonus`'s `ValueSchema` int-or-formula) evaluated
 * against the formula context; routed through a `ModifierTable` (`sum-unique-key`, keyed by the
 * resource id) so two effects that (re-)declare the SAME resource id resolve to the higher one
 * rather than silently colliding — not exercised by any 1b fixture, but the same "highest wins"
 * shape as `hp.ts`/`defense.ts` use for their own stacking targets. The descriptive fields
 * (`name`/`reset`/`display`/`source`) are taken from the FIRST such effect encountered (in
 * `abilities.effects`'s own deterministic order), since only the numeric max is meant to stack.
 * `used` comes straight from `facts.resourcesUsed`.
 */
export function deriveResources(
  abilities: AbilitiesResult,
  comp: Composition,
  facts: Facts,
  index: ContentIndex,
): { resources: ResourceView[]; issues: Diagnostic[] } {
  const issues: Diagnostic[] = [];
  const table = new ModifierTable();
  const meta = new Map<string, ResourceMeta>();

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
    resource: () => 0,
  };
  const evalFormula = (f: string) => evalFormulaString(f, formulaCtx);

  for (const ae of abilities.effects) {
    const eff = ae.effect;
    if (eff.type !== 'resource.define') continue;
    table.add(`resource:${eff.id}`, {
      source: ae.source,
      feature: ae.feature,
      kind: 'resource.define',
      formula: eff.max,
      key: eff.id,
      policy: 'sum-unique-key',
    });
    if (!meta.has(eff.id)) {
      meta.set(eff.id, { name: eff.name, reset: eff.reset, display: eff.display, source: ae.feature ?? ae.source });
    }
  }

  const resources: ResourceView[] = [...meta.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([id, m]) => ({
      id,
      name: m.name,
      max: table.resolve(`resource:${id}`, 0, evalFormula),
      used: facts.resourcesUsed[id] ?? 0,
      reset: m.reset,
      display: m.display,
      source: m.source,
    }));

  return { resources, issues };
}
