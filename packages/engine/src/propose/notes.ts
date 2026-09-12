import type { NoteAdded, NoteRemoved, NoteUpdated } from '@hk/protocol';
import type { ProposedEvent } from './index.ts';

const mk = (type: string, payload: unknown): ProposedEvent => ({ type, v: 1, payload });

const EVENT_TYPE = { added: 'note.added', updated: 'note.updated', removed: 'note.removed' } as const;

/** No `Sheet` input (unlike every other proposer) — notes are freeform, not derived state. */
export function note(
  op: 'added' | 'updated' | 'removed',
  entry: { id: string; title?: string; body?: string },
): ProposedEvent[] {
  const payload = {
    id: entry.id,
    ...(entry.title !== undefined ? { title: entry.title } : {}),
    ...(entry.body !== undefined ? { body: entry.body } : {}),
  } satisfies NoteAdded | NoteUpdated | NoteRemoved;
  return [mk(EVENT_TYPE[op], payload)];
}
