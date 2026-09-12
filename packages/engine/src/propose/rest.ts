import type { RestTaken } from '@hk/protocol';
import type { Sheet } from '../derive/sheet.ts';
import type { ProposedEvent } from './index.ts';

const mk = (type: string, payload: unknown): ProposedEvent => ({ type, v: 1, payload });

/**
 * The rest transaction (Task 6 contract, documented in reduce/handlers/casting.ts's header): one
 * `rest.taken {kind, hitDiceSpent?}` PLUS one `resource.restored {resourceId}` (the full-restore
 * form — no `count`) per active resource (`sheet.resources`, already only active `resource.define`
 * effects) whose `reset` matches — a short rest restores `'shortRest'`-reset resources only; a long
 * rest restores those AND `'longRest'`-reset ones (a long rest is a superset of a short one).
 */
export function rest(
  sheet: Sheet,
  kind: 'short' | 'long',
  hitDice?: { classId: string; count: number }[],
): ProposedEvent[] {
  const payload: RestTaken = { kind, ...(hitDice !== undefined ? { hitDiceSpent: hitDice } : {}) };
  const events: ProposedEvent[] = [mk('rest.taken', payload)];
  for (const r of sheet.resources) {
    if (r.reset === 'shortRest' || (kind === 'long' && r.reset === 'longRest')) {
      events.push(mk('resource.restored', { resourceId: r.id }));
    }
  }
  return events;
}
