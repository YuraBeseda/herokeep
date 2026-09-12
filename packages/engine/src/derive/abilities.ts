import type { BackgroundEntity, ClassEntity, SpeciesEntity } from '@hk/protocol';
import { findChoice } from '../content/choices.ts';
import type { ContentIndex } from '../content/index.ts';
import { type Diagnostic, warning } from '../diagnostics.ts';
import { type FormulaContext, evalFormulaString } from '../formula/evaluate.ts';
import type { PredicateContext } from '../predicate/context.ts';
import { evaluatePredicate } from '../predicate/evaluate.ts';
import type { Facts } from '../reduce/facts.ts';
import { type ActiveEffect, type Composition, equippedArmor } from './composition.ts';
import { type Derived, ModifierTable } from './modifiers.ts';
import { type ProficiencyLevel, proficiencyAmount, proficiencyBonus, proficiencyLevel } from './proficiency.ts';

export interface AbilityBlock {
  score: Derived<number>;
  mod: number;
  save: Derived<number>;
  saveProficient: boolean;
}

export interface AbilitiesResult {
  /** Keyed by `system.abilities` ids. */
  abilities: Record<string, AbilityBlock>;
  /** `proficiency[totalLevel - 1]`, clamped to the table's bounds. */
  prof: number;
  /** Keyed by `system.skills` ids. */
  skills: Record<string, { total: Derived<number>; proficiency: ProficiencyLevel }>;
  /** `10 + perception's total` (0 when the system declares no `perception` skill). */
  passivePerception: number;
  /** Keyed by speed mode (`walk`, `fly`, …); `walk` is always present, base from the species. */
  speed: Record<string, Derived<number>>;
  senses: { sense: string; range: number; sources: string[] }[];
  languages: { id: string; sources: string[] }[];
  /** `comp.effects` with failing deferred predicates dropped (composition.ts's layering note). */
  effects: ActiveEffect[];
  issues: Diagnostic[];
}

const ABILITY_ENTRY_RE = /^([a-z]{3}):([+-]?\d+)$/;

/**
 * Parses one `<abilityId>:<n>` selection entry. Binding format DEFINED here (per task-9-brief.md):
 * the system's `abilityGeneration` choice stores six of these as absolute scores (`'str:15'`); an
 * `abilities`-pick choice (e.g. a background's ability-score improvement) stores them as signed
 * deltas (`'int:+2'`) — same shape, different interpretation by the caller.
 */
function parseAbilityEntry(sel: string): { ability: string; value: number } | undefined {
  const m = ABILITY_ENTRY_RE.exec(sel);
  if (!m) return undefined;
  return { ability: m[1]!, value: Number(m[2]) };
}

const idsSorted = (items: { id: string }[]): string[] =>
  items.map((i) => i.id).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

/** `{amount}` for a plain int, `{formula}` for a formula string — both legal for `ValueSchema` effects. */
const amountOrFormula = (v: number | string): { amount?: number; formula?: string } =>
  typeof v === 'number' ? { amount: v } : { formula: v };

/**
 * Derives ability scores, proficiency bonus, saves, skills, speed, senses and languages from a
 * `Composition`. Also performs the ONE global re-evaluation of `ActiveEffect.deferred` predicates
 * that composition.ts's layering note assigns to this step: now that ability scores exist, every
 * deferred predicate is evaluated against a full `PredicateContext` and dropped on failure.
 *
 * Ordering note (binding for this function, documented since the brief under-specifies it): scores
 * and save/skill PROFICIENCY (union membership, not totals) are computed from non-deferred sources
 * only — a deferred predicate needs scores to evaluate, so nothing deferred can feed back into
 * computing those same scores without an iterative fixpoint. The 1b content scope has no deferred
 * `ability.*` or `proficiency.grant` effect, so this single pass is exact for every fixture. Skill
 * and save TOTALS' `*.bonus` contributions, speed, senses and languages are computed from the fully
 * resolved (post-deferral) effect list, since none of those feed a deferred predicate's evaluation.
 */
export function deriveAbilities(facts: Facts, comp: Composition, index: ContentIndex): AbilitiesResult {
  const issues: Diagnostic[] = [];
  const system = index.system();
  const abilityIds = idsSorted(system.abilities);
  const activeSet = new Set(comp.entities);
  const nonDeferred = comp.effects.filter((e) => !e.deferred);
  const table = new ModifierTable();

  // ---- Base scores + `abilities`-pick bonuses (system's ability-scores decision, and any other
  // choice using the `abilities` pick form — a background's ability-score improvement today,
  // generically any future one) -------------------------------------------------------------------
  const baseScores = new Map<string, number>(abilityIds.map((id) => [id, 10]));
  let baseSelection: string[] | undefined;
  const bonusSources: { ownerId: string; selection: string[] }[] = [];
  for (const choiceId of Object.keys(facts.decisions).sort()) {
    const found = findChoice(index, choiceId);
    if (!found) continue;
    if ('abilityGeneration' in found.choice.pick) baseSelection = facts.decisions[choiceId];
    else if ('abilities' in found.choice.pick) {
      bonusSources.push({ ownerId: found.owner.id, selection: facts.decisions[choiceId] ?? [] });
    }
  }

  const applyAbilityEntry = (sel: string, onValid: (ability: string, value: number) => void) => {
    const parsed = parseAbilityEntry(sel);
    if (!parsed) {
      issues.push(warning('derive.abilityScoreInvalid', `Invalid ability score selection "${sel}"`));
      return;
    }
    if (!baseScores.has(parsed.ability)) {
      issues.push(warning('derive.unknownAbility', `Unknown ability "${parsed.ability}" in selection "${sel}"`));
      return;
    }
    onValid(parsed.ability, parsed.value);
  };

  for (const sel of baseSelection ?? []) applyAbilityEntry(sel, (ability, value) => baseScores.set(ability, value));
  for (const { ownerId, selection } of bonusSources) {
    for (const sel of selection) {
      applyAbilityEntry(sel, (ability, value) =>
        table.add(`score.${ability}`, {
          source: ownerId,
          kind: 'ability.bonus',
          amount: value,
          policy: 'sum-unique-key',
        }),
      );
    }
  }
  for (const ae of nonDeferred) {
    const eff = ae.effect;
    if (eff.type === 'ability.bonus') {
      table.add(`score.${eff.ability}`, {
        source: ae.source,
        feature: ae.feature,
        kind: 'ability.bonus',
        amount: eff.value,
        key: eff.key,
        policy: 'sum-unique-key',
      });
    } else if (eff.type === 'ability.set') {
      table.add(`score.${eff.ability}`, {
        source: ae.source,
        feature: ae.feature,
        kind: 'ability.set',
        amount: eff.value,
        key: eff.key,
        policy: 'set-if-higher',
      });
    } else if (eff.type === 'ability.max') {
      table.add(`score.${eff.ability}`, {
        source: ae.source,
        feature: ae.feature,
        kind: 'ability.max',
        amount: eff.value,
        key: eff.key,
        policy: 'cap',
      });
    }
  }

  const scores = new Map<string, Derived<number>>();
  const mods = new Map<string, number>();
  for (const id of abilityIds) {
    const d = table.resolve(`score.${id}`, baseScores.get(id)!, () => 0);
    scores.set(id, d);
    mods.set(id, Math.floor((d.value - 10) / 2));
  }

  // ---- Proficiency bonus --------------------------------------------------------------------
  const prof = proficiencyBonus(system, comp.totalLevel);

  // ---- Save & skill PROFICIENCY (union membership) from non-deferred sources ------------------
  const firstClass = facts.classes[0];
  let firstClassEntity: ClassEntity | undefined;
  if (firstClass) {
    const e = index.get(index.resolveClassRef(firstClass.classId) ?? firstClass.classId);
    if (e?.type === 'class') firstClassEntity = e;
  }
  if (firstClassEntity) {
    for (const abilityId of firstClassEntity.saves) {
      table.add(`save.${abilityId}`, { source: firstClassEntity.id, kind: 'proficient', policy: 'union' });
    }
  }

  const backgroundEntities = comp.entities
    .map((id) => index.get(id))
    .filter((e): e is BackgroundEntity => e?.type === 'background');
  for (const bg of backgroundEntities) {
    for (const slug of bg.skillProficiencies) {
      table.add(`skill.${slug}`, { source: bg.id, kind: 'proficient', policy: 'union' });
    }
  }

  // A class's `skillChoice` isn't (yet) modeled as a real `Choice` entity — DEFINING the binding
  // convention here (mirrors the ability-scores decision, also defined by this task): the decision
  // for class `C`'s starting skill proficiencies lives at `<C>@1/skills`, selection = chosen slugs.
  for (const c of facts.classes) {
    const classId = index.resolveClassRef(c.classId) ?? c.classId;
    const classEntity = index.get(classId);
    if (classEntity?.type !== 'class') continue;
    for (const slug of facts.decisions[`${classId}@1/skills`] ?? []) {
      if (!classEntity.skillChoice.from.includes(slug)) {
        issues.push(warning('derive.unknownSkill', `"${slug}" is not offered by ${classId}'s skill choice`));
        continue;
      }
      table.add(`skill.${slug}`, { source: classEntity.id, kind: 'proficient', policy: 'union' });
    }
  }

  for (const ae of nonDeferred) {
    const eff = ae.effect;
    if (eff.type !== 'proficiency.grant') continue;
    if (eff.kind === 'save') {
      table.add(`save.${eff.target}`, { source: ae.source, feature: ae.feature, kind: eff.level, policy: 'union' });
    } else if (eff.kind === 'skill') {
      table.add(`skill.${eff.target}`, { source: ae.source, feature: ae.feature, kind: eff.level, policy: 'union' });
    }
  }

  // ---- Re-evaluate deferred effects now that scores (and proficiency) are known ------------------
  const { category: armorCategory, hasShield } = equippedArmor(facts, index);
  const formulaCtx: FormulaContext = {
    level: comp.totalLevel,
    prof,
    classLevel: (ref) => comp.classLevels[index.resolveClassRef(ref) ?? ref] ?? 0,
    mod: (ability) => mods.get(ability) ?? 0,
    score: (ability) => scores.get(ability)?.value ?? 0,
    hitDie: () => 0,
    resource: () => 0,
  };
  const deferredCtx: PredicateContext = {
    level: comp.totalLevel,
    abilityScore: (a) => scores.get(a)?.value ?? 0,
    classLevel: (ref) => comp.classLevels[index.resolveClassRef(ref) ?? ref] ?? 0,
    hasFeature: (id) => activeSet.has(id),
    hasFeat: (id) => activeSet.has(id),
    hasSpell: (id) => nonDeferred.some((e) => e.effect.type === 'spell.grant' && e.effect.spell === id),
    hasTag: (tag) => nonDeferred.some((e) => e.effect.type === 'tag.grant' && e.effect.tag === tag),
    isProficient: (kind, target) =>
      kind === 'skill'
        ? proficiencyLevel(table, `skill.${target}`) !== 'none'
        : kind === 'save'
          ? proficiencyLevel(table, `save.${target}`) !== 'none'
          : false,
    armorCategory: () => armorCategory,
    hasShield: () => hasShield,
    speciesId: () => comp.entities.find((id) => index.get(id)?.type === 'species'),
    classIds: () => facts.classes.map((c) => index.resolveClassRef(c.classId) ?? c.classId),
    subclassIds: () => facts.classes.map((c) => c.subclassId).filter((id): id is string => id !== undefined),
    hasCondition: (id) => facts.conditions.some((c) => c.conditionId === id),
    isSpellcaster: () => nonDeferred.some((e) => e.effect.type === 'spellcasting.define'),
    formula: formulaCtx,
  };
  const resolvedEffects = comp.effects.filter((e) => !e.deferred || evaluatePredicate(e.effect.when!, deferredCtx));
  const evalFormula = (f: string) => evalFormulaString(f, formulaCtx);

  // ---- Saves ----------------------------------------------------------------------------------
  for (const ae of resolvedEffects) {
    const eff = ae.effect;
    if (eff.type !== 'save.bonus') continue;
    for (const t of eff.target ? [eff.target] : system.saves) {
      table.add(`saveTotal.${t}`, {
        source: ae.source,
        feature: ae.feature,
        kind: 'save.bonus',
        ...amountOrFormula(eff.value),
        key: eff.key,
        policy: 'sum-unique-key',
      });
    }
  }

  const abilities: Record<string, AbilityBlock> = {};
  for (const id of abilityIds) {
    const mod = mods.get(id)!;
    const saveProficient = system.saves.includes(id) && proficiencyLevel(table, `save.${id}`) !== 'none';
    abilities[id] = {
      score: scores.get(id)!,
      mod,
      save: table.resolve(`saveTotal.${id}`, mod + (saveProficient ? prof : 0), evalFormula),
      saveProficient,
    };
  }

  // ---- Skills ---------------------------------------------------------------------------------
  for (const ae of resolvedEffects) {
    const eff = ae.effect;
    if (eff.type !== 'skill.bonus') continue;
    for (const t of eff.target ? [eff.target] : system.skills.map((s) => s.id)) {
      table.add(`skillTotal.${t}`, {
        source: ae.source,
        feature: ae.feature,
        kind: 'skill.bonus',
        ...amountOrFormula(eff.value),
        key: eff.key,
        policy: 'sum-unique-key',
      });
    }
  }

  const skills: AbilitiesResult['skills'] = {};
  for (const skillId of idsSorted(system.skills)) {
    const skillDef = system.skills.find((s) => s.id === skillId)!;
    const level = proficiencyLevel(table, `skill.${skillId}`);
    const base = (mods.get(skillDef.ability) ?? 0) + proficiencyAmount(level, prof);
    skills[skillId] = { total: table.resolve(`skillTotal.${skillId}`, base, evalFormula), proficiency: level };
  }
  const passivePerception = 10 + (skills['perception']?.total.value ?? 0);

  // ---- Speed ----------------------------------------------------------------------------------
  const speciesEntity = comp.entities.map((id) => index.get(id)).find((e): e is SpeciesEntity => e?.type === 'species');
  const speedModes = new Set<string>(['walk']);
  for (const ae of resolvedEffects) {
    const eff = ae.effect;
    if (eff.type === 'speed.set' || eff.type === 'speed.bonus') speedModes.add(eff.mode);
  }
  for (const ae of resolvedEffects) {
    const eff = ae.effect;
    if (eff.type === 'speed.set') {
      table.add(`speed.${eff.mode}`, {
        source: ae.source,
        feature: ae.feature,
        kind: 'speed.set',
        amount: eff.value,
        key: eff.key,
        policy: 'set-if-higher',
      });
    } else if (eff.type === 'speed.bonus') {
      table.add(`speed.${eff.mode}`, {
        source: ae.source,
        feature: ae.feature,
        kind: 'speed.bonus',
        amount: eff.value,
        key: eff.key,
        policy: 'sum-unique-key',
      });
    }
  }
  const speed: Record<string, Derived<number>> = {};
  for (const mode of [...speedModes].sort()) {
    const base = mode === 'walk' ? (speciesEntity?.speed ?? 0) : 0;
    speed[mode] = table.resolve(`speed.${mode}`, base, evalFormula);
  }

  // ---- Senses (union; same sense granted twice keeps the higher range, unions sources) ----------
  const senseMap = new Map<string, { range: number; sources: Set<string> }>();
  for (const ae of resolvedEffects) {
    const eff = ae.effect;
    if (eff.type !== 'sense.grant') continue;
    const cur = senseMap.get(eff.sense);
    if (!cur) senseMap.set(eff.sense, { range: eff.range, sources: new Set([ae.source]) });
    else {
      cur.sources.add(ae.source);
      if (eff.range > cur.range) cur.range = eff.range;
    }
  }
  const senses = [...senseMap.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([sense, v]) => ({ sense, range: v.range, sources: [...v.sources].sort() }));

  // ---- Languages (union) ------------------------------------------------------------------------
  const langTable = new ModifierTable();
  for (const ae of resolvedEffects) {
    const eff = ae.effect;
    if (eff.type !== 'language.grant') continue;
    langTable.add('languages', {
      source: ae.source,
      feature: ae.feature,
      kind: 'language.grant',
      key: eff.language,
      policy: 'union',
    });
  }
  const langSet = langTable.resolveSet('languages');
  const languages = langSet.values.map((id) => ({ id, sources: langSet.sources[id] ?? [] }));

  return { abilities, prof, skills, passivePerception, speed, senses, languages, effects: resolvedEffects, issues };
}
