import { type Choice, type Entity, type EntityQuery, type Predicate, parseChoiceId } from '@hk/protocol';
import { findChoice } from '../content/choices.ts';
import type { ContentIndex } from '../content/index.ts';
import { type Diagnostic, error } from '../diagnostics.ts';
import type { PredicateContext } from '../predicate/context.ts';
import { evaluatePredicate } from '../predicate/evaluate.ts';
import type { Facts } from '../reduce/facts.ts';
import { type Composition, compose, equippedArmor } from './composition.ts';
import type { Sheet } from './sheet.ts';

const ABILITY_DELTA_RE = /^([a-z]{3}):([+-]\d+)$/;
const ABILITY_SCORE_RE = /^([a-z]{3}):(\d{1,2})$/;

const IMPROVE_SHAPES: Record<string, number[]> = {
  '+1': [1],
  '+2': [2],
  '+2/+1': [2, 1],
  '+1/+1/+1': [1, 1, 1],
};

function checkPrerequisites(
  prerequisites: readonly Predicate[],
  ctx: PredicateContext,
  choiceId: string,
  entityId?: string,
): Diagnostic[] {
  const issues: Diagnostic[] = [];
  for (const p of prerequisites) {
    if (!evaluatePredicate(p, ctx)) {
      issues.push(
        error('selection.prerequisiteFailed', 'Prerequisites are not met', {
          path: choiceId,
          ...(entityId !== undefined ? { entityId } : {}),
        }),
      );
    }
  }
  return issues;
}

/** `Choice.unique` (default true): the selected value(s) may not repeat within this call, nor repeat a
 * value already recorded by another decision for the SAME (owner, slug) — e.g. a `repeatableAt` re-ask.
 * `unique: false` (e.g. a genuinely repeatable pick) skips this check entirely. */
function checkUnique(choice: Choice, choiceId: string, facts: Facts, selection: string[]): Diagnostic[] {
  if (!choice.unique) return [];
  const issues: Diagnostic[] = [];
  const parsed = parseChoiceId(choiceId);
  const prior = new Set<string>();
  if (parsed) {
    for (const [id, vals] of Object.entries(facts.decisions)) {
      if (id === choiceId) continue;
      const p = parseChoiceId(id);
      if (p?.entityId === parsed.entityId && p.slug === parsed.slug) for (const v of vals) prior.add(v);
    }
  }
  const seen = new Set<string>();
  for (const v of selection) {
    if (seen.has(v) || prior.has(v)) {
      issues.push(
        error('selection.duplicate', `"${v}" was already selected for this choice`, { path: choiceId, entityId: v }),
      );
    }
    seen.add(v);
  }
  return issues;
}

function validateStatic(
  ids: string[],
  choice: Choice,
  index: ContentIndex,
  choiceId: string,
  selection: string[],
): Diagnostic[] {
  const issues: Diagnostic[] = [];
  if (selection.length !== choice.count) {
    issues.push(
      error('selection.count', `Expected ${choice.count} selection(s), got ${selection.length}`, { path: choiceId }),
    );
  }
  for (const s of selection) {
    if (!index.has(s)) {
      issues.push(
        error('selection.unresolved', `"${s}" does not resolve to a pack entity`, { path: choiceId, entityId: s }),
      );
    } else if (!ids.includes(s)) {
      issues.push(
        error('selection.notOffered', `"${s}" is not offered by this choice`, { path: choiceId, entityId: s }),
      );
    }
  }
  return issues;
}

function validateQuery(
  pick: EntityQuery,
  index: ContentIndex,
  choice: Choice,
  choiceId: string,
  selection: string[],
): Diagnostic[] {
  const issues: Diagnostic[] = [];
  if (selection.length !== choice.count) {
    issues.push(
      error('selection.count', `Expected ${choice.count} selection(s), got ${selection.length}`, { path: choiceId }),
    );
  }
  const eligible = new Set(index.query(pick).map((e) => e.id));
  for (const s of selection) {
    if (!index.has(s)) {
      issues.push(
        error('selection.unresolved', `"${s}" does not resolve to a pack entity`, { path: choiceId, entityId: s }),
      );
    } else if (!eligible.has(s)) {
      issues.push(
        error('selection.notOffered', `"${s}" is not offered by this choice`, { path: choiceId, entityId: s }),
      );
    }
  }
  return issues;
}

/**
 * Controller ruling (task-13 subclass note): a `query`-pick choice selecting a `subclass` must
 * target a subclass whose owning class's `subclassLevel` matches the level this choice is asked
 * at — a mismatch is pack-authoring drift, surfaced here as `'selection.subclassLevel'`.
 */
function validateSubclassLevel(
  choice: Choice,
  index: ContentIndex,
  choiceId: string,
  selection: string[],
): Diagnostic[] {
  if (!('query' in choice.pick) || choice.pick.query.type !== 'subclass') return [];
  if (choice.at.kind !== 'classLevel') return [];
  const issues: Diagnostic[] = [];
  for (const s of selection) {
    const entity = index.get(s);
    if (entity?.type !== 'subclass') continue;
    const ownerClassId = index.resolveClassRef(entity.class) ?? entity.class;
    const ownerClass = index.get(ownerClassId);
    if (ownerClass?.type !== 'class') continue;
    if (ownerClass.subclassLevel !== choice.at.level) {
      issues.push(
        error(
          'selection.subclassLevel',
          `"${entity.name}" belongs to a class whose subclass level (${ownerClass.subclassLevel}) does not match this choice's level (${choice.at.level})`,
          { path: choiceId, entityId: s },
        ),
      );
    }
  }
  return issues;
}

function validateAbilitiesPick(
  pick: { count: number; max: number; improve: '+1' | '+2' | '+2/+1' | '+1/+1/+1' },
  owner: Entity,
  sheet: Sheet,
  index: ContentIndex,
  choiceId: string,
  selection: string[],
): Diagnostic[] {
  const issues: Diagnostic[] = [];
  if (selection.length !== pick.count) {
    issues.push(
      error('selection.count', `Expected ${pick.count} selection(s), got ${selection.length}`, { path: choiceId }),
    );
    return issues;
  }
  const abilityIds = new Set(index.system().abilities.map((a) => a.id));
  const parsed: { ability: string; delta: number }[] = [];
  for (const s of selection) {
    const m = ABILITY_DELTA_RE.exec(s);
    if (!m || !abilityIds.has(m[1]!)) {
      issues.push(error('selection.invalidEntry', `Invalid ability entry "${s}"`, { path: choiceId }));
      continue;
    }
    parsed.push({ ability: m[1]!, delta: Number(m[2]) });
  }
  if (issues.length > 0) return issues;

  // Some owners (backgrounds) restrict which abilities their choice may improve to their own
  // `abilityScores` list (SRD e.g. Soldier: str/dex/con only). Owners without such a list (the
  // ASI feat) stay unrestricted.
  if ('abilityScores' in owner) {
    const allowed = new Set<string>(owner.abilityScores);
    for (const p of parsed) {
      if (!allowed.has(p.ability)) {
        issues.push(
          error('selection.abilityNotAllowed', `"${p.ability}" is not an allowed ability for ${owner.id}`, {
            path: choiceId,
          }),
        );
      }
    }
    if (issues.length > 0) return issues;
  }

  const abilitiesUsed = new Set(parsed.map((p) => p.ability));
  if (abilitiesUsed.size !== parsed.length) {
    issues.push(
      error('selection.duplicateAbility', 'Each ability may only be improved once per choice', { path: choiceId }),
    );
    return issues;
  }

  const deltas = parsed.map((p) => p.delta).sort((a, b) => b - a);
  const want = IMPROVE_SHAPES[pick.improve]!;
  if (deltas.length !== want.length || !deltas.every((d, i) => d === want[i])) {
    issues.push(
      error('selection.abilityImproveShape', `Selection does not match the "${pick.improve}" grammar`, {
        path: choiceId,
      }),
    );
  }

  for (const p of parsed) {
    const current = sheet.abilities[p.ability]?.score.value ?? 10;
    if (current + p.delta > pick.max) {
      issues.push(
        error('selection.abilityMax', `"${p.ability}" would exceed the maximum of ${pick.max}`, { path: choiceId }),
      );
    }
  }
  return issues;
}

function validateAbilityGeneration(
  index: ContentIndex,
  facts: Facts,
  choiceId: string,
  selection: string[],
): Diagnostic[] {
  const issues: Diagnostic[] = [];
  const system = index.system();
  const abilityIds = new Set(system.abilities.map((a) => a.id));

  const parsed: { ability: string; value: number }[] = [];
  for (const s of selection) {
    const m = ABILITY_SCORE_RE.exec(s);
    if (!m || !abilityIds.has(m[1]!)) {
      issues.push(error('selection.invalidEntry', `Invalid ability-generation entry "${s}"`, { path: choiceId }));
      continue;
    }
    parsed.push({ ability: m[1]!, value: Number(m[2]) });
  }
  if (issues.length > 0) return issues;

  const seenAbilities = new Set(parsed.map((p) => p.ability));
  if (parsed.length !== system.abilities.length || seenAbilities.size !== system.abilities.length) {
    issues.push(
      error('selection.count', `Expected one score per ability (${system.abilities.length}), got ${selection.length}`, {
        path: choiceId,
      }),
    );
    return issues;
  }

  const gen = system.abilityGeneration;
  const values = parsed.map((p) => p.value).sort((a, b) => a - b);

  const matchesStandardArray = (): boolean => {
    const target = [...gen.standardArray].sort((a, b) => a - b);
    return values.length === target.length && values.every((v, i) => v === target[i]);
  };
  const pointBuyIssues = (): Diagnostic[] => {
    const local: Diagnostic[] = [];
    let total = 0;
    for (const p of parsed) {
      if (p.value < gen.pointBuy.min || p.value > gen.pointBuy.max) {
        local.push(
          error(
            'selection.pointBuyRange',
            `"${p.ability}" score ${p.value} is outside ${gen.pointBuy.min}-${gen.pointBuy.max}`,
            { path: choiceId },
          ),
        );
      }
      total += gen.pointBuy.costs[String(p.value)] ?? 0;
    }
    if (total > gen.pointBuy.budget) {
      local.push(
        error('selection.pointBuyBudget', `Point-buy total cost ${total} exceeds budget ${gen.pointBuy.budget}`, {
          path: choiceId,
        }),
      );
    }
    return local;
  };
  const matchesManual = (): boolean => parsed.every((p) => p.value >= gen.manual.min && p.value <= gen.manual.max);
  const matchesRoll = (): boolean => parsed.every((p) => p.value >= 3 && p.value <= 18);

  const method = facts.decisionContexts[choiceId]?.['method'];
  if (method === 'standardArray') {
    if (!matchesStandardArray())
      issues.push(
        error('selection.standardArrayMismatch', 'Selection does not match the standard array', { path: choiceId }),
      );
  } else if (method === 'pointBuy') {
    issues.push(...pointBuyIssues());
  } else if (method === 'manual') {
    if (!matchesManual())
      issues.push(
        error('selection.manualRange', `Scores must be within ${gen.manual.min}-${gen.manual.max}`, { path: choiceId }),
      );
  } else if (method === 'roll') {
    if (!matchesRoll())
      issues.push(error('selection.rollRange', 'Rolled scores must each be within 3-18', { path: choiceId }));
  } else {
    // No recorded generation method (facts.decisionContexts[choiceId].method): accept the
    // selection when it satisfies ANY method's rules, since we have no signal which was used.
    const ok = matchesStandardArray() || pointBuyIssues().length === 0 || matchesManual() || matchesRoll();
    if (!ok)
      issues.push(
        error('selection.abilityGenerationInvalid', 'Selection does not satisfy any ability-generation method', {
          path: choiceId,
        }),
      );
  }
  return issues;
}

function validateSkillsSelection(
  classEntity: Extract<Entity, { type: 'class' }>,
  choiceId: string,
  selection: string[],
): Diagnostic[] {
  const issues: Diagnostic[] = [];
  const { from, count } = classEntity.skillChoice;
  if (selection.length !== count) {
    issues.push(
      error('selection.count', `Expected ${count} selection(s), got ${selection.length}`, { path: choiceId }),
    );
  }
  const seen = new Set<string>();
  for (const s of selection) {
    if (!from.includes(s)) {
      issues.push(
        error('selection.notOffered', `"${s}" is not offered by ${classEntity.id}'s skill choice`, { path: choiceId }),
      );
    } else if (seen.has(s)) {
      issues.push(error('selection.duplicate', `"${s}" was selected more than once`, { path: choiceId }));
    }
    seen.add(s);
  }
  return issues;
}

/** Mirrors abilities.ts's own deferred-predicate context, but reads scores/proficiency straight off
 * the already-derived `sheet` (validateSelection's "CURRENT sheet") instead of recomputing them. */
function buildPredicateContext(sheet: Sheet, comp: Composition, facts: Facts, index: ContentIndex): PredicateContext {
  const activeSet = new Set(comp.entities);
  const { category: armorCategory, hasShield } = equippedArmor(facts, index);
  const abilityScore = (a: string) => sheet.abilities[a]?.score.value ?? 0;
  return {
    level: sheet.level,
    abilityScore,
    classLevel: (ref) => comp.classLevels[index.resolveClassRef(ref) ?? ref] ?? 0,
    hasFeature: (id) => activeSet.has(id),
    hasFeat: (id) => activeSet.has(id),
    hasSpell: (id) => comp.effects.some((e) => e.effect.type === 'spell.grant' && e.effect.spell === id),
    hasTag: (tag) => comp.effects.some((e) => e.effect.type === 'tag.grant' && e.effect.tag === tag),
    isProficient: (kind, target) =>
      kind === 'skill'
        ? (sheet.skills[target]?.proficiency ?? 'none') !== 'none'
        : kind === 'save'
          ? sheet.abilities[target]?.saveProficient === true
          : sheet.proficiencies.some((p) => p.kind === kind && p.target === target),
    armorCategory: () => armorCategory,
    hasShield: () => hasShield,
    speciesId: () => comp.entities.find((id) => index.get(id)?.type === 'species'),
    classIds: () => facts.classes.map((c) => index.resolveClassRef(c.classId) ?? c.classId),
    subclassIds: () => facts.classes.map((c) => c.subclassId).filter((id): id is string => id !== undefined),
    hasCondition: (id) => facts.conditions.some((c) => c.conditionId === id),
    isSpellcaster: () => sheet.spellcasting.length > 0,
    formula: {
      level: sheet.level,
      prof: sheet.prof,
      classLevel: (ref) => comp.classLevels[index.resolveClassRef(ref) ?? ref] ?? 0,
      mod: (a) => sheet.abilities[a]?.mod ?? 0,
      score: abilityScore,
      hitDie: (slug) => {
        const classId = index.resolveClassRef(slug) ?? slug;
        const e = index.get(classId);
        return e?.type === 'class' ? e.hitDie : 0;
      },
      resource: (slug) => sheet.resources.find((r) => r.id === slug)?.max.value ?? 0,
    },
  };
}

/**
 * Validates a proposed decision selection against its `Choice` (or, for the R5 synthetic
 * `<classId>@1/skills` decision, against the class's `skillChoice`), evaluated against the
 * CURRENT sheet/facts (i.e. before this selection is committed).
 */
export function validateSelection(
  sheet: Sheet,
  facts: Facts,
  index: ContentIndex,
  choiceId: string,
  selection: string[],
): Diagnostic[] {
  const parsedId = parseChoiceId(choiceId);
  if (parsedId?.slug === 'skills' && parsedId.level === 1) {
    const classId = index.resolveClassRef(parsedId.entityId) ?? parsedId.entityId;
    const classEntity = index.get(classId);
    if (classEntity?.type === 'class') return validateSkillsSelection(classEntity, choiceId, selection);
  }

  const found = findChoice(index, choiceId);
  if (!found) return [error('selection.unknownChoice', `Unknown choice "${choiceId}"`, { path: choiceId })];
  const { choice, owner } = found;

  const comp = compose(facts, index);
  const ctx = buildPredicateContext(sheet, comp, facts, index);

  const issues: Diagnostic[] = [...checkPrerequisites(choice.prerequisites, ctx, choiceId)];

  if ('static' in choice.pick) {
    issues.push(...validateStatic(choice.pick.static, choice, index, choiceId, selection));
    for (const s of selection) {
      const e = index.get(s);
      if (e) issues.push(...checkPrerequisites(e.prerequisites, ctx, choiceId, s));
    }
    issues.push(...checkUnique(choice, choiceId, facts, selection));
  } else if ('query' in choice.pick) {
    issues.push(...validateQuery(choice.pick.query, index, choice, choiceId, selection));
    issues.push(...validateSubclassLevel(choice, index, choiceId, selection));
    for (const s of selection) {
      const e = index.get(s);
      if (e) issues.push(...checkPrerequisites(e.prerequisites, ctx, choiceId, s));
    }
    issues.push(...checkUnique(choice, choiceId, facts, selection));
  } else if ('abilities' in choice.pick) {
    issues.push(...validateAbilitiesPick(choice.pick.abilities, owner, sheet, index, choiceId, selection));
  } else if ('abilityGeneration' in choice.pick) {
    issues.push(...validateAbilityGeneration(index, facts, choiceId, selection));
  } else if ('literal' in choice.pick) {
    if (selection.length !== choice.count) {
      issues.push(
        error('selection.count', `Expected ${choice.count} selection(s), got ${selection.length}`, { path: choiceId }),
      );
    }
    issues.push(...checkUnique(choice, choiceId, facts, selection));
  } else if ('equipmentOption' in choice.pick) {
    // Accept any (task-13-brief.md): the 1b UI is the only validator of which bundle was chosen.
    if (selection.length !== choice.count) {
      issues.push(
        error('selection.count', `Expected ${choice.count} selection(s), got ${selection.length}`, { path: choiceId }),
      );
    }
  }

  return issues;
}
