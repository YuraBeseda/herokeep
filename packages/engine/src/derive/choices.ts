import type { Choice, Entity } from '@hk/protocol';
import type { ContentIndex } from '../content/index.ts';
import { type Diagnostic, warning } from '../diagnostics.ts';
import type { Facts } from '../reduce/facts.ts';
import type { ChoiceRequest } from './sheet.ts';

const byChoiceId = (a: ChoiceRequest, b: ChoiceRequest) =>
  a.choiceId < b.choiceId ? -1 : a.choiceId > b.choiceId ? 1 : 0;

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
