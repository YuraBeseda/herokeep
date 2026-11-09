import type { Choice, Predicate } from '@hk/protocol';
import type { ContentIndex } from '../content/index.ts';
import { constantPredicateContext, type PredicateContext } from '../predicate/context.ts';
import { evaluatePredicate } from '../predicate/evaluate.ts';
import type { Facts } from '../reduce/facts.ts';
import { offeredChoiceCount } from './choice-count.ts';
import { offeredRowChoices } from './choices.ts';
import { compose } from './composition.ts';
import type { ChoiceRequest, Sheet } from './sheet.ts';

export interface Advancement {
  classId: string;
  toLevel: number;
  steps: ChoiceRequest[];
  hpChoice: boolean;
  /**
   * Ruling 7 (phase 4, plan 11 task 2): the new entry variant — true when `classId` is NOT yet on
   * `sheet.classes` (a multiclass "take a brand-new class" offer, always at `toLevel: 1`); false
   * for the pre-existing "advance a class already on the sheet" entry. Mathematically redundant
   * with `toLevel === 1` (an already-taken class can never have `toLevel` less than 2), but kept as
   * its own explicit field so a consumer (T12's level-up UI) never has to know that implicit
   * invariant to tell the two variants apart — e.g. to label a step "Multiclass into X" vs "Level
   * up X".
   */
  isNewClass: boolean;
}

const byClassId = (a: Advancement, b: Advancement) => (a.classId < b.classId ? -1 : a.classId > b.classId ? 1 : 0);

/**
 * Phase 4 plan 11 task 7 finding: once a real content pack populates `system.multiclass.
 * prerequisites` for every class (the SRD pack now does — see doc-04), a character's own EXISTING
 * class can alphabetically sort AFTER a class they merely QUALIFY to multiclass into (e.g.
 * `srd-5e-2024:class/wizard`, already taken, sorts after `srd-5e-2024:class/barbarian`, a mere
 * new-class offer). A pure `byClassId` sort put the new-class offer first, which broke real
 * consumers of `pendingAdvancements()[0]` expecting their own class's normal level-up flow
 * (task-2-report.md's own carry anticipated MULTIPLE entries but not this specific ordering
 * collision — surfaced only once T7 populated real data on the real pack). Existing-class entries
 * (`isNewClass: false`) now sort before every new-class offer (`isNewClass: true`) regardless of id;
 * `byClassId` remains the tiebreak WITHIN each group, so nothing changes when only one group is
 * present (every pre-existing single-entry-per-group test/golden stays byte-identical).
 */
const byExistingFirstThenClassId = (a: Advancement, b: Advancement) =>
  a.isNewClass === b.isNewClass ? byClassId(a, b) : a.isNewClass ? 1 : -1;

/**
 * `steps` for one class's row at `toLevel` — shared by both the "level up" and "new class" branches.
 * Plan 14 task 1 (fix round 1): only the row's OFFERED choices (`offeredRowChoices`) — `initialClass`
 * is true only for the character's first class; a brand-new class is never the initial one.
 * Plan 16 ruling 10: counts are OFFERED counts (`offeredChoiceCount`), and a choice offered at 0 is
 * no step at all — both judged against the character AS OF the level being taken.
 */
const rowSteps = (
  classId: string,
  levels: { level: number; choices: Choice[] }[],
  toLevel: number,
  initialClass: boolean,
  facts: Facts,
  index: ContentIndex,
): ChoiceRequest[] => {
  const row = levels.find((r) => r.level === toLevel)?.choices ?? [];
  if (row.length === 0) return [];
  const after = afterLevelUp(facts, classId, toLevel, index);
  const comp = compose(after, index);
  return offeredRowChoices(row, initialClass, facts.decisions, { facts: after, comp, index }).map((c) => ({
    choiceId: c.id,
    ownerId: classId,
    count: offeredChoiceCount(c, after, comp, index),
  }));
};

/**
 * The character as of `classId` having reached `toLevel`: formula counts (plan 12 task 2) resolve
 * against it, and (plan 16 ruling 10) so does `choiceCountOverride`. The class keeps its position in
 * `classes` (order gained decides which class is "earlier" for the shared weapon-mastery cap); a
 * class not yet taken is appended last.
 */
function afterLevelUp(facts: Facts, classId: string, toLevel: number, index: ContentIndex): Facts {
  const isTarget = (ref: string) => (index.resolveClassRef(ref) ?? ref) === classId;
  const at = facts.classes.findIndex((c) => isTarget(c.classId));
  const classes =
    at === -1
      ? [...facts.classes, { classId, level: toLevel }]
      : facts.classes.flatMap((c, i) => (i === at ? [{ ...c, level: toLevel }] : isTarget(c.classId) ? [] : [c]));
  return { ...facts, classes };
}

/**
 * Best-effort `PredicateContext` for evaluating `system.multiclass.prerequisites[classRef]`
 * (ruling 7: "per-class ability minimums" — the 2024 SRD's multiclass prerequisite table is
 * ability-score-only). Built from the already-derived `Sheet` rather than recomposing a fresh
 * `Composition` — `abilityScore`/`classLevel`/`classIds`/`subclassIds` are wired for real;
 * everything else (`hasFeature`, `hasTag`, `armorCategory`, …) stays at `constantPredicateContext`'s
 * conservative defaults, since no real content's multiclass prerequisite references them.
 */
function multiclassPredicateContext(sheet: Sheet, index: ContentIndex): PredicateContext {
  return {
    ...constantPredicateContext(),
    level: sheet.level,
    abilityScore: (a) => sheet.abilities[a]?.score.value ?? 0,
    classLevel: (ref) => {
      const wanted = index.resolveClassRef(ref) ?? ref;
      return sheet.classes.find((c) => (index.resolveClassRef(c.classId) ?? c.classId) === wanted)?.level ?? 0;
    },
    classIds: () => sheet.classes.map((c) => c.classId),
    subclassIds: () => sheet.classes.map((c) => c.subclassId).filter((id): id is string => id !== undefined),
  };
}

/**
 * Which classes NOT yet on the sheet the character may start (`eligible`) and which it may not
 * (`unmet`), by `system.multiclass.prerequisites` — the 2024 SRD's both-direction rule (see
 * `pendingAdvancements`' doc): a class is eligible only when its own prerequisite holds AND every
 * already-taken class still meets its own. Only classes that exist as class entities appear; both
 * lists are in the prerequisite map's own order. Empty when the system carries no prerequisites.
 */
export function multiclassStanding(sheet: Sheet, index: ContentIndex): { eligible: string[]; unmet: string[] } {
  const standing = { eligible: [] as string[], unmet: [] as string[] };
  const prerequisites = index.system().multiclass?.prerequisites;
  if (!prerequisites) return standing;
  const taken = new Set(sheet.classes.map((c) => c.classId));
  const ctx = multiclassPredicateContext(sheet, index);
  const resolvedPrereqs = new Map<string, Predicate>();
  for (const [classRef, predicate] of Object.entries(prerequisites)) {
    resolvedPrereqs.set(index.resolveClassRef(classRef) ?? classRef, predicate);
  }
  // A taken class absent from the map bars nothing (compat).
  const currentClassesQualify = sheet.classes.every((c) => {
    const predicate = resolvedPrereqs.get(c.classId);
    return predicate === undefined || evaluatePredicate(predicate, ctx);
  });
  for (const [classId, predicate] of resolvedPrereqs) {
    if (taken.has(classId)) continue;
    if (index.get(classId)?.type !== 'class') continue;
    (currentClassesQualify && evaluatePredicate(predicate, ctx) ? standing.eligible : standing.unmet).push(classId);
  }
  return standing;
}

/**
 * Levels the character may take right now. 1b is XP-mode only (task-13-brief.md): for each class
 * already on the sheet, `toLevel = classLevels[classId] + 1` becomes available once
 * `facts.xp >= system.tables.xp[totalLevel]` (`xp[i]` = XP needed to BE level `i+1`). At creation
 * (`sheet.level === 0`) there is nothing to advance yet.
 *
 * Ruling 7 (phase 4, plan 11 task 2): additionally, once the system entity carries
 * `multiclass.prerequisites` (a per-classRef `Predicate` — DATA, populated by a content pack, T7),
 * every class the character does NOT already have is offered as a `toLevel: 1` / `isNewClass: true`
 * entry once its own prerequisite predicate holds against the character's current sheet (ability
 * scores, mainly) — AND (fix round 1) every ALREADY-TAKEN class's own prerequisite still holds too.
 * 2024 SRD (vendored, `packages/content/upstream/open5e-srd-2024/Rule.json`, pk
 * "srd-2024_multiclassing_prerequisties"), verbatim: "To qualify for a new class, you must have a
 * score of at least 13 in the primary ability of the new class and your current classes." Both
 * directions are required — the new class's own prerequisite is not enough on its own if a class
 * already on the sheet no longer meets ITS OWN prerequisite (scores can move after a class is
 * taken, e.g. an ASI down some other path is not modeled, but the check is re-evaluated fresh
 * regardless). If ANY already-taken class fails its own (documented) prerequisite, NO new-class
 * entries are offered at all that call. A system with no `multiclass.prerequisites` (every pack
 * before ruling 7, including the shared `core-mini`/`content-mini` test fixtures) preserves the
 * exact pre-ruling-7 behavior: only classes already on `sheet.classes` are ever listed. An
 * already-taken class with NO entry in the map (absent-data compat, same posture as
 * `multiclass.gains`'s own fallback) bars nothing — only classes that HAVE documented prerequisite
 * data are held to it.
 *
 * `steps` = the `ChoiceRequest`s the row at exactly `toLevel` asks (a class's subclass choice
 * "materializes at subclassLevel" simply because the pack places that `Choice` inside the row at
 * `level: subclassLevel` — no separate handling needed here). `hpChoice` is true whenever
 * `toLevel >= 2` (a NEW class's `toLevel` is always exactly 1, so `hpChoice` is correctly false
 * there too — level 1 never rolls hit dice, doc-02/leveling.ts's own rule).
 */
export function pendingAdvancements(sheet: Sheet, facts: Facts, index: ContentIndex): Advancement[] {
  if (sheet.level === 0) return [];
  const xpTable = index.system().tables.xp;
  const threshold = xpTable[sheet.level];
  if (threshold === undefined || facts.xp < threshold) return [];

  const advancements: Advancement[] = [];
  // Plan 14 task 1: the initial class is `facts.classes[0]` (order gained), as in `levelScopedChoices`.
  const resolve = (ref: string) => index.resolveClassRef(ref) ?? ref;
  const firstClassId = facts.classes[0] !== undefined ? resolve(facts.classes[0].classId) : undefined;
  for (const entry of sheet.classes) {
    const classEntity = index.get(entry.classId);
    if (classEntity?.type !== 'class') continue;
    const toLevel = entry.level + 1;
    const initialClass = resolve(entry.classId) === firstClassId;
    advancements.push({
      classId: entry.classId,
      toLevel,
      steps: rowSteps(entry.classId, classEntity.levels, toLevel, initialClass, facts, index),
      hpChoice: toLevel >= 2,
      isNewClass: false,
    });
  }

  for (const classId of multiclassStanding(sheet, index).eligible) {
    const classEntity = index.get(classId);
    if (classEntity?.type !== 'class') continue;
    advancements.push({
      classId,
      toLevel: 1,
      steps: rowSteps(classId, classEntity.levels, 1, false, facts, index),
      hpChoice: false,
      isNewClass: true,
    });
  }

  return advancements.sort(byExistingFirstThenClassId);
}
