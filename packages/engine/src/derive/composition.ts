import type { Effect, Entity, FeatureGrant, Predicate } from '@hk/protocol';
import type { ContentIndex } from '../content/index.ts';
import { type Diagnostic, warning } from '../diagnostics.ts';
import { type ArmorCategory, constantPredicateContext, type PredicateContext } from '../predicate/context.ts';
import { evaluatePredicate } from '../predicate/evaluate.ts';
import type { Facts } from '../reduce/facts.ts';

/** Grant chains deeper than this are cut off with a diagnostic (mirrors content/deps.ts's dependency-depth cap). */
const MAX_GRANT_DEPTH = 8;

export interface ActiveEffect {
  /** The protocol effect object. */
  effect: Effect;
  /**
   * The root active entity that contributed this effect: a creation-slot pick (species, background),
   * a class/subclass, a feat/feature chosen via a decision, or an equipped/attuned item. Never a
   * synthetic id — always one of `Composition.entities`.
   */
  source: string;
  /**
   * The feature entity that directly declares this effect, when it isn't the root itself (i.e. the
   * effect was reached through one or more `grants[]` hops from `source`). Undefined when the root
   * entity declares the effect directly on itself.
   */
  feature?: string;
  /**
   * True when the effect's `when` predicate needs ability scores or a formula to evaluate, which are
   * not available yet during composition (scores derive AFTER composition — see the layering note in
   * task-8-brief.md). Such effects are included as-is, unevaluated; a later derive step re-evaluates
   * `effect.when` once scores exist and drops the effect if it fails.
   */
  deferred?: boolean;
}

export interface Composition {
  /** Active entity ids: species, background, classes, subclasses, feats, features, equipped items… */
  entities: string[];
  /** All effects of active entities whose `when` predicate holds (or is deferred — see `ActiveEffect.deferred`). */
  effects: ActiveEffect[];
  /** classId (resolved to its canonical entity id) -> character's level in that class. */
  classLevels: Record<string, number>;
  totalLevel: number;
  issues: Diagnostic[];
}

/** A predicate "needs scores" when it (recursively) contains an `ability` or `formula` form. */
function needsScores(p: Predicate): boolean {
  if ('all' in p) return p.all.some(needsScores);
  if ('any' in p) return p.any.some(needsScores);
  if ('not' in p) return needsScores(p.not);
  if ('ability' in p) return true;
  if ('formula' in p) return true;
  return false;
}

const unresolvedEntity = (id: string): Diagnostic =>
  warning('derive.unresolvedEntity', `Unresolved entity "${id}"`, { entityId: id });

/**
 * Armor category / shield presence come from currently-EQUIPPED inventory items (not merely
 * attuned ones — attunement alone doesn't mean the item is worn). If more than one armor piece
 * is (invalidly) equipped at once, the first one found wins.
 *
 * Exported (not just `compose`-internal) so later derive steps that need to rebuild a
 * `PredicateContext` of their own (e.g. `derive/abilities.ts`'s deferred-predicate re-evaluation)
 * reuse this logic instead of forking it.
 */
export function equippedArmor(facts: Facts, index: ContentIndex): { category: ArmorCategory; hasShield: boolean } {
  let category: ArmorCategory = 'none';
  let hasShield = false;
  for (const item of facts.inventory) {
    if (!item.equipped || item.itemId === undefined) continue;
    const entity = index.get(item.itemId);
    if (entity?.type !== 'item') continue;
    if (entity.armor && category === 'none') category = entity.armor.category;
    if (entity.category === 'shield') hasShield = true;
  }
  return { category, hasShield };
}

/**
 * Computes which entities are ACTIVE for a character and which of their effects apply.
 *
 * Roots (see task-8-brief.md's "Composition algorithm"): the system's creation-slot decisions
 * (species, background), `facts.classes` (class + subclass), every other decision selection that
 * resolves to a feat/feature entity, and equipped/attuned inventory items. From each root, `grants[]`
 * is walked recursively (class/subclass `levels[]` rows are an additional grant source, gated on
 * `row.level <= classLevels[classId]`, and a background's `originFeat` is an additional implicit
 * grant, root = the background); a grant activates its feature only while its own `when` predicate
 * holds (score-free predicates only — see `ActiveEffect.deferred`).
 */
export function compose(facts: Facts, index: ContentIndex): Composition {
  const issues: Diagnostic[] = [];
  const classLevels: Record<string, number> = {};
  let totalLevel = 0;
  for (const c of facts.classes) {
    const id = index.resolveClassRef(c.classId) ?? c.classId;
    classLevels[id] = (classLevels[id] ?? 0) + c.level;
    totalLevel += c.level;
  }

  const { category: equippedArmorCategory, hasShield: equippedHasShield } = equippedArmor(facts, index);

  const activeIds = new Set<string>();
  const activeTags = new Set<string>();
  let sawSpellcaster = false;
  const effects: ActiveEffect[] = [];

  const ctx: PredicateContext = {
    ...constantPredicateContext(),
    level: totalLevel,
    classLevel: (ref) => classLevels[index.resolveClassRef(ref) ?? ref] ?? 0,
    hasFeature: (id) => activeIds.has(id),
    hasFeat: (id) => activeIds.has(id),
    hasTag: (t) => activeTags.has(t),
    classIds: () => facts.classes.map((c) => index.resolveClassRef(c.classId) ?? c.classId),
    subclassIds: () => facts.classes.map((c) => c.subclassId).filter((id): id is string => id !== undefined),
    hasCondition: (id) => facts.conditions.some((cond) => cond.conditionId === id),
    isSpellcaster: () => sawSpellcaster,
    armorCategory: () => equippedArmorCategory,
    hasShield: () => equippedHasShield,
  };

  const collectEffects = (entity: Entity, source: string, feature: string | undefined) => {
    for (const eff of entity.effects) {
      if (eff.when) {
        if (needsScores(eff.when)) {
          effects.push({ effect: eff, source, feature, deferred: true });
          continue;
        }
        if (!evaluatePredicate(eff.when, ctx)) continue;
      }
      effects.push({ effect: eff, source, feature });
      if (eff.type === 'tag.grant') activeTags.add(eff.tag);
      if (eff.type === 'spellcasting.define') sawSpellcaster = true;
    }
  };

  const activateGranted = (featureId: string, rootId: string, depth: number) => {
    if (activeIds.has(featureId)) return;
    if (depth > MAX_GRANT_DEPTH) {
      issues.push(
        warning('derive.grantDepth', `Grant depth exceeds ${MAX_GRANT_DEPTH} at "${featureId}"`, {
          entityId: featureId,
        }),
      );
      return;
    }
    const entity = index.get(featureId);
    if (!entity) {
      issues.push(unresolvedEntity(featureId));
      return;
    }
    activeIds.add(featureId);
    collectEffects(entity, rootId, featureId);
    walkGrants(entity.grants, rootId, depth + 1);
  };

  function walkGrants(grants: FeatureGrant[], rootId: string, depth: number) {
    for (const g of grants) {
      if (g.when) {
        if (needsScores(g.when)) {
          // Out of the 1b content scope (no score-gated grants in fixtures): we cannot yet know
          // whether this grant would activate, so it stays inactive — but say so, rather than
          // silently dropping it, matching the file's warn-don't-throw diagnostics philosophy.
          issues.push(
            warning(
              'derive.grantDeferred',
              `Grant to "${g.feature}" needs ability scores, unavailable during composition`,
              {
                entityId: g.feature,
              },
            ),
          );
          continue;
        }
        if (!evaluatePredicate(g.when, ctx)) continue;
      }
      activateGranted(g.feature, rootId, depth);
    }
  }

  const activateRoot = (id: string) => {
    if (activeIds.has(id)) return;
    const entity = index.get(id);
    if (!entity) {
      issues.push(unresolvedEntity(id));
      return;
    }
    activeIds.add(id);
    collectEffects(entity, id, undefined);
    walkGrants(entity.grants, id, 1);
    if (entity.type === 'class') {
      const gateLevel = classLevels[id] ?? 0;
      for (const row of entity.levels) if (row.level <= gateLevel) walkGrants(row.grants, id, 1);
    } else if (entity.type === 'subclass') {
      const ownerId = index.resolveClassRef(entity.class) ?? entity.class;
      const gateLevel = classLevels[ownerId] ?? 0;
      for (const row of entity.levels) if (row.level <= gateLevel) walkGrants(row.grants, id, 1);
    } else if (entity.type === 'background') {
      activateGranted(entity.originFeat, id, 1);
    }
  };

  const system = index.system();
  const creationSlotChoiceIds = new Set(
    system.compositionSlots.filter((s) => s.at === 'creation').map((s) => `${system.id}@0/${s.id}`),
  );

  for (const choiceId of Object.keys(facts.decisions).sort()) {
    const selections = facts.decisions[choiceId] ?? [];
    if (creationSlotChoiceIds.has(choiceId)) {
      for (const sel of selections) activateRoot(sel);
      continue;
    }
    for (const sel of selections) {
      const e = index.get(sel);
      if (e && (e.type === 'feat' || e.type === 'feature')) activateRoot(sel);
    }
  }

  for (const c of facts.classes) {
    activateRoot(index.resolveClassRef(c.classId) ?? c.classId);
    if (c.subclassId !== undefined) activateRoot(c.subclassId);
  }

  for (const item of facts.inventory) {
    if (!(item.equipped || item.attuned) || item.itemId === undefined) continue;
    activateRoot(item.itemId);
  }

  effects.sort((a, b) => {
    const ka = `${a.source}|${a.feature ?? ''}|${JSON.stringify(a.effect)}`;
    const kb = `${b.source}|${b.feature ?? ''}|${JSON.stringify(b.effect)}`;
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });

  return { entities: [...activeIds].sort(), effects, classLevels, totalLevel, issues };
}
