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
 *
 * Double-spend trap: this `hitDice` parameter only RECORDS dice as spent in the `rest.taken`
 * payload; it does not heal. `propose.spendHitDie` marks a die spent AND heals, in one event.
 * Canonical UI flow for a short rest: call `propose.spendHitDie` once per die the player rolls,
 * and do NOT also pass `hitDice` here — passing both double-spends the same dice. `hitDice`
 * exists only for bulk bookkeeping without healing (e.g. importing a character, or a DM
 * adjustment), not for the normal short-rest healing loop.
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
