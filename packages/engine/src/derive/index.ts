import type { ContentIndex } from '../content/index.ts';
import { classSkillPick, findChoice } from '../content/choices.ts';
import { type Diagnostic, warning } from '../diagnostics.ts';
import { type FormulaContext, evalFormulaString } from '../formula/evaluate.ts';
import type { PredicateContext } from '../predicate/context.ts';
import { evaluatePredicate } from '../predicate/evaluate.ts';
import type { Facts, SystemRules } from '../reduce/facts.ts';
import { deriveAbilities } from './abilities.ts';
import type { AbilitiesResult } from './abilities.ts';
import { deriveActions } from './actions.ts';
import { deriveAttacks } from './attacks.ts';
import { byChoiceId, creationChoices, levelScopedChoices, selectedEntityChoices } from './choices.ts';
import { type Composition, compose, equippedArmor, occurrenceKey } from './composition.ts';
import { deriveDefense } from './defense.ts';
import { deriveEncumbrance } from './encumbrance.ts';
import { deriveHp } from './hp.ts';
import { ModifierTable } from './modifiers.ts';
import type { DeriveOverrides } from './overrides.ts';
import { type ResourceView, deriveResources } from './resources.ts';
import type { ChoiceRequest, Sheet } from './sheet.ts';
import { deriveSpellcasting } from './spellcasting.ts';

export * from './sheet.ts';
export * from './advancement.ts';
export { resolveChoiceCount } from './choice-count.ts';
export * from './validation.ts';
export * from './overrides.ts';
export * from './encumbrance.ts';

/** `{amount}` for a plain int, `{formula}` for a formula string — mirrors every other derive/*.ts helper. */
const amountOrFormula = (v: number | string): { amount?: number; formula?: string } =>
  typeof v === 'number' ? { amount: v } : { formula: v };

/** True for a decision id that legitimately has no backing `Choice` entity (R5, task-13-brief.md;
 * plan 12 final wave W1's `@1/multiclass-skills` bonus pick). */
function isSyntheticDecision(choiceId: string, index: ContentIndex): boolean {
  return classSkillPick(choiceId, index) !== undefined;
}

export function outstandingChoices(facts: Facts, index: ContentIndex): ChoiceRequest[] {
  const creation = creationChoices(facts, index);
  const leveled = levelScopedChoices(facts, index);
  const asked = new Set([...creation.requests, ...leveled.requests].map((r) => r.choiceId));
  const selected = selectedEntityChoices(facts, index, asked);
  return [...creation.requests, ...leveled.requests, ...selected.requests].sort(byChoiceId);
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
      key: occurrenceKey(ae, eff.key),
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

  // Ruling 7 (phase 4, plan 11 task 2): `facts.classes[]` order (order gained) decides which entry
  // is "first" — the FIRST class always contributes its full armor/weapon proficiency list; any
  // LATER class (index > 0) contributes only its `multiclass.gains` list (the SRD multiclass
  // table: e.g. a later-class Fighter grants light/medium armor + shields + martial weapons, never
  // heavy armor). Compat: a class with no `multiclass`/`gains` data at all (old/fixture packs that
  // predate this ruling) falls back to its FULL list even as a later class, so untouched content
  // keeps granting exactly what it always granted.
  facts.classes.forEach((c, i) => {
    const classId = index.resolveClassRef(c.classId) ?? c.classId;
    const classEntity = index.get(classId);
    if (classEntity?.type !== 'class') return;
    const gains = i > 0 ? classEntity.multiclass?.gains : undefined;
    const armorTraining = gains ? gains.armorTraining : classEntity.armorTraining;
    const weaponProficiencies = gains ? gains.weaponProficiencies : classEntity.weaponProficiencies;
    for (const slug of armorTraining) add('armor', slug, 'proficient', classId);
    for (const slug of weaponProficiencies) add('weapon', slug, 'proficient', classId);
  });

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
 * `item.attunement.by` enforcement (survey fact, phase 4 plan 11 task 4): a full `PredicateContext`
 * built from the derive-time locals already computed by the time `derive()` builds `inventory`
 * (`abilities`, `comp`, `facts`, `index`, `proficiencies`, plus `resources`/`sheet.resources` for
 * formula's `resource()` — the MOST complete of this file's own predicate contexts, since every
 * other domain has already derived by this point). This is the file's 4th independent
 * "build a PredicateContext from whatever's on hand at this derive stage" helper — matching the
 * SAME established, undeduplicated pattern `composition.ts`'s own internal `ctx`, `abilities.ts`'s
 * `deferredCtx`, and `advancement.ts`'s `multiclassPredicateContext` each already use (each call site
 * has different data available, so each builds its own rather than forcing a shared, lowest-common-
 * denominator signature) — not a new anti-pattern introduced by this task.
 */
function attunementPredicateContext(
  abilities: AbilitiesResult,
  comp: Composition,
  facts: Facts,
  index: ContentIndex,
  proficiencies: Sheet['proficiencies'],
  resources: ResourceView[],
  isSpellcaster: boolean,
): PredicateContext {
  const activeSet = new Set(comp.entities);
  const { category: armorCategory, hasShield } = equippedArmor(facts, index);
  const abilityScore = (a: string) => abilities.abilities[a]?.score.value ?? 0;
  return {
    level: comp.totalLevel,
    abilityScore,
    classLevel: (ref) => comp.classLevels[index.resolveClassRef(ref) ?? ref] ?? 0,
    hasFeature: (id) => activeSet.has(id),
    hasFeat: (id) => activeSet.has(id),
    hasSpell: (id) => comp.effects.some((e) => e.effect.type === 'spell.grant' && e.effect.spell === id),
    hasTag: (tag) => comp.effects.some((e) => e.effect.type === 'tag.grant' && e.effect.tag === tag),
    isProficient: (kind, target) =>
      kind === 'skill'
        ? (abilities.skills[target]?.proficiency ?? 'none') !== 'none'
        : kind === 'save'
          ? abilities.abilities[target]?.saveProficient === true
          : proficiencies.some((p) => p.kind === kind && p.target === target),
    armorCategory: () => armorCategory,
    hasShield: () => hasShield,
    speciesId: () => comp.entities.find((id) => index.get(id)?.type === 'species'),
    classIds: () => facts.classes.map((c) => index.resolveClassRef(c.classId) ?? c.classId),
    subclassIds: () => facts.classes.map((c) => c.subclassId).filter((id): id is string => id !== undefined),
    hasCondition: (id) => facts.conditions.some((c) => c.conditionId === id),
    isSpellcaster: () => isSpellcaster,
    formula: {
      level: comp.totalLevel,
      prof: abilities.prof,
      classLevel: (ref) => comp.classLevels[index.resolveClassRef(ref) ?? ref] ?? 0,
      mod: (a) => abilities.abilities[a]?.mod ?? 0,
      score: abilityScore,
      hitDie: (slug) => {
        const classId = index.resolveClassRef(slug) ?? slug;
        const e = index.get(classId);
        return e?.type === 'class' ? e.hitDie : 0;
      },
      resource: (slug) => resources.find((r) => r.id === slug)?.max.value ?? 0,
    },
  };
}

/**
 * Derives the FULL `Sheet` (task-13-brief.md — the integration task over tasks 8-12's per-domain
 * modules). `rules` is optional for compatibility: without it, `deriveHp` prices every level as
 * average and pushes a `'derive.noSystemRules'` warning (R-pf2).
 *
 * Ruling 1 (phase 4, plan 11 task 4 — "house-rule overrides into derive"): `overrides` is optional
 * and trailing (4th parameter) so every existing 2-arg/3-arg call site (apps/web's character.store,
 * the foreign-character-session path, the goldens harness, every test in this package) keeps
 * compiling and behaving byte-identically without passing it — the engine itself never computes an
 * override value, it only applies one the caller already hands in (see `derive/overrides.ts`).
 */
export function derive(facts: Facts, index: ContentIndex, rules?: SystemRules, overrides?: DeriveOverrides): Sheet {
  const issues: Diagnostic[] = [];
  for (const choiceId of Object.keys(facts.decisions).sort()) {
    if (!findChoice(index, choiceId) && !isSyntheticDecision(choiceId, index))
      issues.push(warning('decision.unknownChoice', `Decision for unknown choice "${choiceId}"`));
  }

  const creation = creationChoices(facts, index);
  const leveled = levelScopedChoices(facts, index);
  issues.push(...creation.issues, ...leveled.issues);
  const askedChoiceIds = new Set([...creation.requests, ...leveled.requests].map((r) => r.choiceId));
  const selected = selectedEntityChoices(facts, index, askedChoiceIds);
  issues.push(...selected.issues);

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

  // Ruling 1 (phase 4, plan 11 task 5 — "encumbrance option"): computed ONLY when the caller opts
  // in via `overrides.encumbrance` — 'off' (the default, including `overrides` omitted entirely)
  // is zero computation, so every pre-task-5 call site/golden stays byte-identical.
  let carry: Sheet['carry'];
  if (overrides?.encumbrance !== undefined && overrides.encumbrance !== 'off') {
    const encumbrance = deriveEncumbrance(overrides.encumbrance, abilities, comp, facts, index, resources.resources);
    issues.push(...encumbrance.issues);
    carry = encumbrance.carry;
  }

  const initiative = deriveInitiative(comp, abilities, resources.resources, index);
  const proficiencies = deriveProficiencies(facts, abilities, index);

  // `item.attunement.by` (survey fact, phase 4 plan 11 task 4): built once per `derive()` call
  // (lazily — only if at least one item actually declares `attunement.by`, since every predicate
  // evaluation is a getter-driven closure that reads live off the same already-computed locals) and
  // reused per item below.
  let attunementCtx: PredicateContext | undefined;
  const isSpellcaster = spellcasting.blocks.length > 0;

  const inventory = facts.inventory.map((item) => {
    const entity = item.itemId !== undefined ? index.get(item.itemId) : undefined;
    const resolved = item.itemId === undefined || entity !== undefined;
    if (!resolved) {
      issues.push(
        warning('derive.unresolvedItem', `Inventory item "${item.itemId}" does not resolve to a pack entity`, {
          entityId: item.itemId,
        }),
      );
    }
    const attunementBy = entity?.type === 'item' ? entity.attunement?.by : undefined;
    if (!attunementBy) return { ...item, resolved };
    attunementCtx ??= attunementPredicateContext(
      abilities,
      comp,
      facts,
      index,
      proficiencies,
      resources.resources,
      isSpellcaster,
    );
    return { ...item, resolved, attunementAllowed: evaluatePredicate(attunementBy, attunementCtx) };
  });

  const classes = facts.classes.map((c) => {
    const classId = index.resolveClassRef(c.classId) ?? c.classId;
    return { classId, level: c.level, ...(c.subclassId !== undefined ? { subclassId: c.subclassId } : {}) };
  });

  // Ruling 1 (phase 4, plan 11 tasks 4 + 5): one merged `overridesProvenance`, built from whichever
  // override fields were actually supplied THIS call — `encumbrance: 'off'` does NOT count (that's
  // the non-house-rule default, same as omitting the field entirely), matching `carry`'s own gate
  // above. Present on `Sheet` only when at least one key was set (T4's existing exact-key-list
  // sheet.test.ts assertion and every prior golden stay unaffected when neither is supplied).
  const overridesProvenance: NonNullable<Sheet['overridesProvenance']> = {};
  if (overrides?.attunementMax !== undefined) overridesProvenance.attunementMax = 'house rule';
  if (overrides?.encumbrance !== undefined && overrides.encumbrance !== 'off')
    overridesProvenance.encumbrance = 'house rule';
  const hasOverridesProvenance = Object.keys(overridesProvenance).length > 0;

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
    ...(attacks.masteryCount !== undefined ? { masteryCount: attacks.masteryCount } : {}),
    spellcasting: spellcasting.blocks,
    ...(spellcasting.concentration ? { concentration: spellcasting.concentration } : {}),
    resources: resources.resources,
    actions: actions.actions,
    proficiencies,
    inventory,
    ...(carry ? { carry } : {}),
    attunementMax: overrides?.attunementMax ?? index.system().attunementMax,
    ...(hasOverridesProvenance ? { overridesProvenance } : {}),
    currency: { ...facts.currency },
    inspiration: facts.inspiration,
    conditions: hp.conditions,
    xp: facts.xp,
    grammaticalGender: facts.grammaticalGender,
    outstandingChoices: [...creation.requests, ...leveled.requests, ...selected.requests].sort(byChoiceId),
    issues,
  };
}
