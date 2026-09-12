import type { Choice, Entity } from '@hk/protocol';
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
