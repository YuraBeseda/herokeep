import type { Choice, ChoiceAt, Entity } from '@hk/protocol';
import type { ContentIndex } from '../content/index.ts';
import { type Diagnostic, warning } from '../diagnostics.ts';
import type { Facts } from '../reduce/facts.ts';
import type { ChoiceRequest } from './sheet.ts';

export const byChoiceId = (a: ChoiceRequest, b: ChoiceRequest) =>
  a.choiceId < b.choiceId ? -1 : a.choiceId > b.choiceId ? 1 : 0;

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
    .filter((c) => facts.decisions[c.id] === undefined)
    .map((c) => ({ choiceId: c.id, ownerId: owners.get(c)!.id, count: c.count }))
    .sort(byChoiceId);
  return { requests, issues };
}

/**
 * Level-scoped choices (doc-05: "for each active entity and each class level ≤ current: choices
 * whose `at` matches and that have no (valid) decision"), restricted per task-13-brief.md to what
 * 1b's content scope actually declares: each class's (and, once chosen, its subclass's) own
 * `ClassLevelRow.choices`, gated `row.level <= facts.classes[i].level`, PLUS the synthetic
 * `<classId>@1/skills` decision (R5) that has no backing `Choice` entity at all. The creation-slot
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
        if (facts.decisions[c.id] === undefined) requests.push({ choiceId: c.id, ownerId, count: c.count });
      }
    }
  };

  for (const entry of facts.classes) {
    const classId = index.resolveClassRef(entry.classId) ?? entry.classId;
    const classEntity = index.get(classId);
    if (classEntity?.type !== 'class') continue;
    collectRows(classEntity, classId, entry.level);

    const skillsId = skillsChoiceId(classId);
    if (classEntity.skillChoice.count > 0 && facts.decisions[skillsId] === undefined) {
      requests.push({ choiceId: skillsId, ownerId: classId, count: classEntity.skillChoice.count });
    }

    if (entry.subclassId !== undefined) {
      const subclassEntity = index.get(entry.subclassId);
      if (subclassEntity?.type === 'subclass') collectRows(subclassEntity, entry.subclassId, entry.level);
    }
  }

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

  for (const selection of Object.values(facts.decisions)) {
    for (const selectedId of selection) {
      const chosen = index.get(selectedId);
      if (!chosen || (chosen.type !== 'feat' && chosen.type !== 'feature')) continue;
      for (const c of chosen.choices) {
        if (alreadyAsked.has(c.id) || seen.has(c.id) || facts.decisions[c.id] !== undefined) continue;
        if (!atIsSurfaced(c.at, facts, index)) continue;
        seen.add(c.id);
        requests.push({ choiceId: c.id, ownerId: chosen.id, count: c.count });
      }
    }
  }

  return { requests: requests.sort(byChoiceId), issues: [] };
}
