import { parseEntityId } from '@hk/protocol';
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
 * `name`/`display`/`source` are taken from the FIRST such effect encountered (in
 * `abilities.effects`'s own deterministic order, i.e. composition's `source|feature|effect` sort),
 * since only the numeric max is meant to stack.
 *
 * `reset` is the one exception (plan 13 task 3, "reset override at level"): it is LAST-wins in that
 * same order, so a later-granted feature can re-declare a resource purely to change when it
 * refreshes (SRD Font of Inspiration: Bardic Inspiration regains on a Short Rest from bard level 5).
 * With a single define — every resource before task 3 — first and last coincide, so nothing else
 * moves; `max` stacking is untouched. Content that relies on an override must make the overriding
 * define sort after the original (pinned per use by a content test).
 * Plan 13 task 4: an inline `spell.grant.uses {count, per}` counts as a define of id = the spell's
 * slug (see the loop); the reference form `{resource}` defines nothing (`derive/free-casts.ts`).
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
    let def: { id: string; name: string; max: string; reset: string; display: string; kind: string };
    if (eff.type === 'resource.define') {
      def = { id: eff.id, name: eff.name, max: eff.max, reset: eff.reset, display: eff.display, kind: eff.type };
    } else if (eff.type === 'spell.grant' && eff.uses && 'count' in eff.uses) {
      // Plan 13 task 4: an INLINE `spell.grant.uses {count, per}` materializes its own counter, keyed by
      // the spell's slug (a slug, so `resource.spent` accepts it) and named after the spell — the same
      // table/meta path as a define, so a define of the same id merges with it instead of duplicating.
      // The reference form `{resource}` creates nothing here: it spends an existing resource.
      const spell = index.get(eff.spell);
      const id = parseEntityId(eff.spell)?.slug ?? eff.spell;
      def = { id, name: spell?.name ?? id, max: eff.uses.count, reset: eff.uses.per, display: 'pips', kind: eff.type };
    } else {
      continue;
    }
    table.add(`resource:${def.id}`, {
      source: ae.source,
      feature: ae.feature,
      kind: def.kind,
      formula: def.max,
      key: def.id,
      policy: 'sum-unique-key',
    });
    const first = meta.get(def.id);
    if (first === undefined) {
      meta.set(def.id, { name: def.name, reset: def.reset, display: def.display, source: ae.feature ?? ae.source });
    } else {
      first.reset = def.reset; // last define wins the reset; every other field stays first-wins
    }
  }

  // Ruling 3 (phase 4, plan 11 task 4 — "item charges = per-instance resources"): one ResourceView
  // per ACTIVE (equipped OR attuned — composition.ts:228's own activation gate, re-checked per
  // INSTANCE here rather than read off `comp.entities`, since `Composition.entities` is deduplicated
  // by entity id and would wrongly report a second, inactive instance of the same item type as
  // active) inventory item whose entity declares `charges`, keyed `item:<instanceId>` — never
  // `item:<itemId>`, so two instances of the same item type never collide. The key can never collide
  // with a `resource.define` id either: `item:` contains a colon, which no `SlugSchema` value (every
  // `resource.define.id` to date) can ever contain. Reuses the SAME `table`/`meta`/`resourcesUsed`
  // machinery as above — no new event, no new reducer path (`propose.rest` already iterates
  // `sheet.resources` generically by `reset`, so a `shortRest`/`longRest`-reset charged item is
  // auto-restored on rest with zero changes to `propose/rest.ts`).
  //
  // v1 semantics (documented, not a bug): the ResourceView DEFINITION only exists while the item is
  // active — unequip/un-attune it and it disappears from `sheet.resources` — but `facts.resourcesUsed`
  // for that key is untouched by derive (derive never writes facts) and simply isn't read while the
  // item is inactive, so the used-count survives and reappears correctly on re-equip. If the item is
  // removed from inventory entirely, its `resourcesUsed` entry has no consumer left to reference it
  // and lingers forever — acceptable for v1 (a few stray keys in a JSON blob, not a correctness bug);
  // an eventual orphan-sweep belongs with any future general facts-pruning backlog item, not this task.
  for (const item of facts.inventory) {
    if (!(item.equipped || item.attuned) || item.itemId === undefined) continue;
    const entity = index.get(item.itemId);
    if (entity?.type !== 'item' || !entity.charges) continue;
    const resourceId = `item:${item.instanceId}`;
    table.add(`resource:${resourceId}`, {
      source: item.itemId,
      kind: 'item.charges',
      formula: entity.charges.max,
      key: resourceId,
      policy: 'sum-unique-key',
    });
    // Never overwritten by a second instance: `resourceId` already embeds `instanceId`, so this key
    // is unique per loop iteration by construction (no "first one wins" ambiguity like the
    // `resource.define` loop above has to guard against for a genuinely re-declared shared id).
    meta.set(resourceId, {
      name: entity.name,
      reset: entity.charges.reset,
      // `ItemEntitySchema.charges` carries no `display` field (unlike `resource.define`'s effect
      // shape, which is authored per-feature) — 'number' is a reasonable engine-side default; T12
      // may special-case pips per item category later if that's wanted, this task doesn't invent one.
      display: 'number',
      source: item.itemId,
    });
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
