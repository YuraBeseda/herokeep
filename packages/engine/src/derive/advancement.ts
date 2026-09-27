import type { Predicate } from '@hk/protocol';
import type { ContentIndex } from '../content/index.ts';
import { constantPredicateContext, type PredicateContext } from '../predicate/context.ts';
import { evaluatePredicate } from '../predicate/evaluate.ts';
import type { Facts } from '../reduce/facts.ts';
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

/** `steps` for one class's row at `toLevel` — shared by both the "level up" and "new class" branches. */
const rowSteps = (
  classId: string,
  levels: { level: number; choices: { id: string; count: number }[] }[],
  toLevel: number,
): ChoiceRequest[] =>
  (levels.find((r) => r.level === toLevel)?.choices ?? []).map((c) => ({
    choiceId: c.id,
    ownerId: classId,
    count: c.count,
  }));

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
  for (const entry of sheet.classes) {
    const classEntity = index.get(entry.classId);
    if (classEntity?.type !== 'class') continue;
    const toLevel = entry.level + 1;
    advancements.push({
      classId: entry.classId,
      toLevel,
      steps: rowSteps(entry.classId, classEntity.levels, toLevel),
      hpChoice: toLevel >= 2,
      isNewClass: false,
    });
  }

  const prerequisites = index.system().multiclass?.prerequisites;
  if (prerequisites) {
    const taken = new Set(sheet.classes.map((c) => c.classId));
    const ctx = multiclassPredicateContext(sheet, index);
    const resolvedPrereqs = new Map<string, Predicate>();
    for (const [classRef, predicate] of Object.entries(prerequisites)) {
      resolvedPrereqs.set(index.resolveClassRef(classRef) ?? classRef, predicate);
    }

    // Both-direction check (2024 SRD, see this function's own doc): every already-taken class
    // must still meet ITS OWN prerequisite before ANY new class is offered. A taken class absent
    // from the map bars nothing (compat).
    const currentClassesQualify = sheet.classes.every((c) => {
      const predicate = resolvedPrereqs.get(c.classId);
      return predicate === undefined || evaluatePredicate(predicate, ctx);
    });

    if (currentClassesQualify) {
      for (const [classId, predicate] of resolvedPrereqs) {
        if (taken.has(classId)) continue;
        const classEntity = index.get(classId);
        if (classEntity?.type !== 'class') continue;
        if (!evaluatePredicate(predicate, ctx)) continue;
        advancements.push({
          classId,
          toLevel: 1,
          steps: rowSteps(classId, classEntity.levels, 1),
          hpChoice: false,
          isNewClass: true,
        });
      }
    }
  }

  return advancements.sort(byExistingFirstThenClassId);
}
