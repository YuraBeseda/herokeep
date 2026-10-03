import type { Choice, ChoiceAt, Entity } from '@hk/protocol';
import { multiclassSkillsChoiceId, occurrenceChoiceId } from '../content/choices.ts';
import type { ContentIndex } from '../content/index.ts';
import { type Diagnostic, warning } from '../diagnostics.ts';
import type { Facts } from '../reduce/facts.ts';
import { decisionFallsShort, resolveChoiceCount } from './choice-count.ts';
import type { ChoiceRequest } from './sheet.ts';

export const byChoiceId = (a: ChoiceRequest, b: ChoiceRequest) =>
  a.choiceId < b.choiceId ? -1 : a.choiceId > b.choiceId ? 1 : 0;

/**
 * A choice is outstanding while it has no recorded decision — or, for a formula-count choice only
 * (plan 12 task 2), while its recorded decision is shorter than the count the character's current
 * levels now resolve to (the count grew; the same choice id is re-offered with the larger count).
 */
function isUnanswered(facts: Facts, choice: Choice, id: string, count: number): boolean {
  const recorded = facts.decisions[id];
  return recorded === undefined || decisionFallsShort(choice, recorded, count);
}

/** The row-gated synthetic id for a class's starting-skill decision (R5, task-13-brief.md controller ruling). */
export const skillsChoiceId = (classId: string): string => `${classId}@1/skills`;

export function creationChoices(
  facts: Facts,
  index: ContentIndex,
): { requests: ChoiceRequest[]; issues: Diagnostic[] } {
  const issues: Diagnostic[] = [];
  const system = index.system();
  const asked: Choice[] = [];
  const owners = new Map<Choice, Entity>();
  const push = (owner: Entity, c: Choice) => {
    asked.push(c);
    owners.set(c, owner);
  };

  for (const c of system.choices) if (c.at.kind === 'creation') push(system, c);
  for (const slot of system.compositionSlots) {
    if (slot.at !== 'creation') continue;
    const id = `${system.id}@0/${slot.id}`;
    if (!system.choices.some((c) => c.id === id)) {
      issues.push(
        warning('system.slotChoiceMissing', `System declares slot "${slot.id}" but no choice "${id}"`, {
          entityId: system.id,
        }),
      );
      continue;
    }
    for (const chosenId of facts.decisions[id] ?? []) {
      const chosen = index.get(chosenId);
      if (!chosen) continue; // reported by validation elsewhere
      for (const c of chosen.choices) if (c.at.kind === 'creation') push(chosen, c);
    }
  }

  const requests = asked
    .map((c) => ({ c, count: resolveChoiceCount(c, facts, index) }))
    .filter(({ c, count }) => isUnanswered(facts, c, c.id, count))
    .map(({ c, count }) => ({ choiceId: c.id, ownerId: owners.get(c)!.id, count }))
    .sort(byChoiceId);
  return { requests, issues };
}

/**
 * Level-scoped choices (doc-05: "for each active entity and each class level ≤ current: choices
 * whose `at` matches and that have no (valid) decision"), restricted per task-13-brief.md to what
 * 1b's content scope actually declares: each class's (and, once chosen, its subclass's) own
 * `ClassLevelRow.choices`, gated `row.level <= facts.classes[i].level`, PLUS the synthetic
 * `<classId>@1/skills` decision (R5) that has no backing `Choice` entity at all (for a LATER class
 * carrying `multiclass.gains`, the `<classId>@1/multiclass-skills` bonus pick instead). The creation-slot
 * logic in `creationChoices` above is untouched — this is purely additive.
 */
export function levelScopedChoices(
  facts: Facts,
  index: ContentIndex,
): { requests: ChoiceRequest[]; issues: Diagnostic[] } {
  const issues: Diagnostic[] = [];
  const requests: ChoiceRequest[] = [];

  const collectRows = (owner: Extract<Entity, { type: 'class' | 'subclass' }>, ownerId: string, gateLevel: number) => {
    for (const row of owner.levels) {
      if (row.level > gateLevel) continue;
      for (const c of row.choices) {
        const count = resolveChoiceCount(c, facts, index);
        if (isUnanswered(facts, c, c.id, count)) requests.push({ choiceId: c.id, ownerId, count });
      }
    }
  };

  facts.classes.forEach((entry, i) => {
    const classId = index.resolveClassRef(entry.classId) ?? entry.classId;
    const classEntity = index.get(classId);
    if (classEntity?.type !== 'class') return;
    collectRows(classEntity, classId, entry.level);

    // Plan 12 final wave W1 (ruling 7's first-vs-later split, as `deriveProficiencies`): the INITIAL
    // class asks its full starting-skill pick; a LATER class asks only its `multiclass.gains
    // .skillChoiceCount` bonus pick from the same list, under its own id. Compat: a later class with
    // no `multiclass.gains` data at all keeps its full `@1/skills` pick, exactly as before.
    const gains = i > 0 ? classEntity.multiclass?.gains : undefined;
    const [skillsId, count] = gains
      ? [multiclassSkillsChoiceId(classId), gains.skillChoiceCount]
      : [skillsChoiceId(classId), classEntity.skillChoice.count];
    if (count > 0 && facts.decisions[skillsId] === undefined) {
      requests.push({ choiceId: skillsId, ownerId: classId, count });
    }

    if (entry.subclassId !== undefined) {
      const subclassEntity = index.get(entry.subclassId);
      if (subclassEntity?.type === 'subclass') collectRows(subclassEntity, entry.subclassId, entry.level);
    }
  });

  return { requests: requests.sort(byChoiceId), issues };
}

/** True when `at`'s gate is satisfied by the character's current state (task 1, plan-5 ledger). */
function atIsSurfaced(at: ChoiceAt, facts: Facts, index: ContentIndex): boolean {
  switch (at.kind) {
    case 'creation':
      return facts.created;
    case 'level':
      return facts.classes.some((entry) => entry.level >= at.level);
    case 'classLevel': {
      const wanted = index.resolveClassRef(at.class) ?? at.class;
      return facts.classes.some(
        (entry) => (index.resolveClassRef(entry.classId) ?? entry.classId) === wanted && entry.level >= at.level,
      );
    }
  }
}

/**
 * Third `outstandingChoices` source (task-1-brief.md, phase 1b plan 5 ledger): every entity
 * selected in ANY decision (`facts.decisions`' selection arrays), when that entity resolves to a
 * `feat` or `feature` (the only entity types 1b's content scope selects this way whose OWN
 * `choices` are worth surfacing — a species/background's choices are already covered by
 * `creationChoices`, which walks composition-slot selections directly), has its own undecided
 * `choices` surfaced once their `at` gate matches the character's current state.
 *
 * Recursion depth 1 BY DESIGN: this only reads `facts.decisions` — a flat, already-recorded
 * history — and surfaces the DIRECTLY selected entity's OWN choices; it does not simulate what a
 * further, not-yet-made decision on one of those surfaced choices might itself go on to select. If
 * a surfaced choice is later decided and its selection is itself a feat/feature, THAT entity's own
 * choices become visible the next time `outstandingChoices`/`derive` runs (once the decision
 * actually lands in `facts.decisions`) — there is no unbounded recursion inside a single call.
 */
export function selectedEntityChoices(
  facts: Facts,
  index: ContentIndex,
  alreadyAsked: ReadonlySet<string>,
): { requests: ChoiceRequest[]; issues: Diagnostic[] } {
  const requests: ChoiceRequest[] = [];
  const seen = new Set<string>();
  // Plan 11 final wave F1: acquisitions counted per entity — the n-th selection of the same
  // feat/feature asks its nested choices under `occurrenceChoiceId(c.id, n)` (n = 1 is the
  // authored id, unchanged). Only the COUNT matters (occurrences are interchangeable slots), so
  // the result is independent of decision insertion order.
  const acquisitions = new Map<string, number>();

  for (const selection of Object.values(facts.decisions)) {
    for (const selectedId of selection) {
      const chosen = index.get(selectedId);
      if (!chosen || (chosen.type !== 'feat' && chosen.type !== 'feature')) continue;
      const occurrence = (acquisitions.get(chosen.id) ?? 0) + 1;
      acquisitions.set(chosen.id, occurrence);
      for (const c of chosen.choices) {
        const id = occurrenceChoiceId(c.id, occurrence);
        if (alreadyAsked.has(id) || seen.has(id)) continue;
        const count = resolveChoiceCount(c, facts, index);
        if (!isUnanswered(facts, c, id, count)) continue;
        if (!atIsSurfaced(c.at, facts, index)) continue;
        seen.add(id);
        requests.push({ choiceId: id, ownerId: chosen.id, count });
      }
    }
  }

  return { requests: requests.sort(byChoiceId), issues: [] };
}
