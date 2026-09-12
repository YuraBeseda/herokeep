import { parseChoiceId } from '@hk/protocol';
import type { ContentIndex } from '../content/index.ts';
import { findChoice } from '../content/choices.ts';
import { type Diagnostic, warning } from '../diagnostics.ts';
import { type FormulaContext, evalFormulaString } from '../formula/evaluate.ts';
import type { Facts, SystemRules } from '../reduce/facts.ts';
import { deriveAbilities } from './abilities.ts';
import type { AbilitiesResult } from './abilities.ts';
import { deriveActions } from './actions.ts';
import { deriveAttacks } from './attacks.ts';
import { byChoiceId, creationChoices, levelScopedChoices } from './choices.ts';
import { type Composition, compose } from './composition.ts';
import { deriveDefense } from './defense.ts';
import { deriveHp } from './hp.ts';
import { ModifierTable } from './modifiers.ts';
import { deriveResources } from './resources.ts';
import type { ChoiceRequest, Sheet } from './sheet.ts';
import { deriveSpellcasting } from './spellcasting.ts';

export * from './sheet.ts';
export * from './advancement.ts';
export * from './validation.ts';

/** `{amount}` for a plain int, `{formula}` for a formula string — mirrors every other derive/*.ts helper. */
const amountOrFormula = (v: number | string): { amount?: number; formula?: string } =>
  typeof v === 'number' ? { amount: v } : { formula: v };

/** True for a decision id that legitimately has no backing `Choice` entity (R5, task-13-brief.md). */
function isSyntheticDecision(choiceId: string, index: ContentIndex): boolean {
  const parsed = parseChoiceId(choiceId);
  if (parsed?.slug !== 'skills' || parsed.level !== 1) return false;
  const classId = index.resolveClassRef(parsed.entityId) ?? parsed.entityId;
  return index.get(classId)?.type === 'class';
}

export function outstandingChoices(facts: Facts, index: ContentIndex): ChoiceRequest[] {
  const creation = creationChoices(facts, index);
  const leveled = levelScopedChoices(facts, index);
  return [...creation.requests, ...leveled.requests].sort(byChoiceId);
}

function deriveInitiative(
  comp: Composition,
  abilities: AbilitiesResult,
  resources: { id: string; max: { value: number } }[],
  index: ContentIndex,
): Sheet['initiative'] {
  const table = new ModifierTable();
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
  for (const ae of abilities.effects) {
    const eff = ae.effect;
    if (eff.type !== 'initiative.bonus') continue;
    table.add('initiative', {
      source: ae.source,
      feature: ae.feature,
      kind: 'initiative.bonus',
      ...amountOrFormula(eff.value),
      key: eff.key,
      policy: 'sum-unique-key',
    });
  }
  return table.resolve('initiative', abilities.abilities['dex']?.mod ?? 0, evalFormula);
}

/**
 * Union (by `kind`+`target`) of armor/weapon/tool/language proficiency (controller ruling,
 * task-13-brief.md): task 9's `deriveAbilities` deliberately only tracks save/skill proficiency,
 * and task 11's `deriveAttacks` assembled weapon proficiency locally for its own toHit math — this
 * assembles the character-facing LIST from the same two sources (a class's own `armorTraining` /
 * `weaponProficiencies` fields, and any `proficiency.grant` effect of kind armor/weapon/tool/
 * language from the fully resolved, post-deferral effect list).
 */
function deriveProficiencies(facts: Facts, abilities: AbilitiesResult, index: ContentIndex): Sheet['proficiencies'] {
  const RANK: Record<string, number> = { expertise: 3, proficient: 2, half: 1 };
  const merged = new Map<string, { kind: string; target: string; level: string; sources: Set<string> }>();

  const add = (kind: string, target: string, level: string, source: string) => {
    const key = `${kind}:${target}`;
    const cur = merged.get(key);
    if (!cur) {
      merged.set(key, { kind, target, level, sources: new Set([source]) });
      return;
    }
    cur.sources.add(source);
    if ((RANK[level] ?? 0) > (RANK[cur.level] ?? 0)) cur.level = level;
  };

  for (const c of facts.classes) {
    const classId = index.resolveClassRef(c.classId) ?? c.classId;
    const classEntity = index.get(classId);
    if (classEntity?.type !== 'class') continue;
    for (const slug of classEntity.armorTraining) add('armor', slug, 'proficient', classId);
    for (const slug of classEntity.weaponProficiencies) add('weapon', slug, 'proficient', classId);
  }

  for (const ae of abilities.effects) {
    const eff = ae.effect;
    if (eff.type !== 'proficiency.grant' || eff.kind === 'save' || eff.kind === 'skill') continue;
    add(eff.kind, eff.target, eff.level, ae.source);
  }

  return [...merged.values()]
    .map((p) => ({ kind: p.kind, target: p.target, level: p.level, sources: [...p.sources].sort() }))
    .sort((a, b) =>
      a.kind === b.kind ? (a.target < b.target ? -1 : a.target > b.target ? 1 : 0) : a.kind < b.kind ? -1 : 1,
    );
}

/**
 * Derives the FULL `Sheet` (task-13-brief.md — the integration task over tasks 8-12's per-domain
 * modules). `rules` is optional for compatibility: without it, `deriveHp` prices every level as
 * average and pushes a `'derive.noSystemRules'` warning (R-pf2).
 */
export function derive(facts: Facts, index: ContentIndex, rules?: SystemRules): Sheet {
  const issues: Diagnostic[] = [];
  for (const choiceId of Object.keys(facts.decisions).sort()) {
    if (!findChoice(index, choiceId) && !isSyntheticDecision(choiceId, index))
      issues.push(warning('decision.unknownChoice', `Decision for unknown choice "${choiceId}"`));
  }

  const creation = creationChoices(facts, index);
  const leveled = levelScopedChoices(facts, index);
  issues.push(...creation.issues, ...leveled.issues);

  const comp = compose(facts, index);
  issues.push(...comp.issues);

  const abilities = deriveAbilities(facts, comp, index);
  issues.push(...abilities.issues);
  const defense = deriveDefense(abilities, comp, facts, index);
  issues.push(...defense.issues);
  const hp = deriveHp(abilities, comp, facts, index, rules);
  issues.push(...hp.issues);
  const attacks = deriveAttacks(abilities, comp, facts, index);
  issues.push(...attacks.issues);
  const spellcasting = deriveSpellcasting(abilities, comp, facts, index);
  issues.push(...spellcasting.issues);
  const resources = deriveResources(abilities, comp, facts, index);
  issues.push(...resources.issues);
  const actions = deriveActions(comp, index);

  const initiative = deriveInitiative(comp, abilities, resources.resources, index);
  const proficiencies = deriveProficiencies(facts, abilities, index);

  const inventory = facts.inventory.map((item) => {
    const resolved = item.itemId === undefined || index.has(item.itemId);
    if (!resolved) {
      issues.push(
        warning('derive.unresolvedItem', `Inventory item "${item.itemId}" does not resolve to a pack entity`, {
          entityId: item.itemId,
        }),
      );
    }
    return { ...item, resolved };
  });

  const classes = facts.classes.map((c) => {
    const classId = index.resolveClassRef(c.classId) ?? c.classId;
    return { classId, level: c.level, ...(c.subclassId !== undefined ? { subclassId: c.subclassId } : {}) };
  });

  return {
    name: facts.name,
    system: facts.system,
    level: comp.totalLevel,
    classes,
    pins: { ...facts.pins },
    abilities: abilities.abilities,
    prof: abilities.prof,
    skills: abilities.skills,
    passivePerception: abilities.passivePerception,
    speed: abilities.speed,
    senses: abilities.senses,
    languages: abilities.languages,
    ac: defense.ac,
    hp,
    initiative,
    attacks: attacks.attacks,
    attacksPerAction: attacks.attacksPerAction,
    spellcasting: spellcasting.blocks,
    resources: resources.resources,
    actions: actions.actions,
    proficiencies,
    inventory,
    attunementMax: index.system().attunementMax,
    currency: { ...facts.currency },
    inspiration: facts.inspiration,
    conditions: hp.conditions,
    xp: facts.xp,
    grammaticalGender: facts.grammaticalGender,
    outstandingChoices: [...creation.requests, ...leveled.requests].sort(byChoiceId),
    issues,
  };
}
