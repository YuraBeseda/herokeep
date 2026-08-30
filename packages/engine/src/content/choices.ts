import { type Choice, type Entity, parseChoiceId } from '@hk/protocol';
import type { ContentIndex } from './index.ts';

export function findChoice(index: ContentIndex, choiceId: string): { owner: Entity; choice: Choice } | undefined {
  const parsed = parseChoiceId(choiceId);
  if (!parsed) return undefined;
  const owner = index.get(parsed.entityId);
  if (!owner) return undefined;
  const direct = owner.choices.find((c) => c.id === choiceId);
  if (direct) return { owner, choice: direct };
  if (owner.type === 'class' || owner.type === 'subclass') {
    for (const row of owner.levels) {
      const found = row.choices.find((c) => c.id === choiceId);
      if (found) return { owner, choice: found };
    }
  }
  return undefined;
}
