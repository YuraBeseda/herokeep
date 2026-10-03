import type { RestTaken, SlotRestored } from '@hk/protocol';
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
    // Plan 12 task 6 fix: a LONG rest also restores `reset:'dawn'` resources (charged magic items) —
    // a long rest spans a dawn in ordinary play (v1 approximation). Short rest never touches them;
    // `reset:'never'` stays manual-only. CONSTRAINT: items whose text regains a ROLLED amount
    // ("regains 1d6 + 1 expended charges") get a FULL restore here — a generous approximation
    // pending dice integration in rest flows.
    if (r.reset === 'shortRest' || (kind === 'long' && (r.reset === 'longRest' || r.reset === 'dawn'))) {
      events.push(mk('resource.restored', { resourceId: r.id }));
    }
  }
  // Task 11 (phase 4 plan 11) — the sanctioned pact-awareness addition. Vendored `ClassFeature.json`
  // pk `srd-2024_warlock_pact-magic`: "You regain all expended Pact Magic spell slots when you
  // finish a Short or Long Rest." Unlike every `sheet.resources` entry above (gated by its own
  // `reset:'shortRest'`/`'longRest'` field) and unlike every REGULAR spellcasting slot progression
  // (which `reduce/handlers/casting.ts`'s `rest.taken@1` handler only clears on a LONG rest, via
  // `restRules.longRest.restoreAllSlots` — UNCHANGED by this task, verified by this file's own
  // test suite), Pact Magic restores on EITHER rest kind — so this is emitted unconditionally on
  // `kind`, not folded into the loop above. Emitted as the explicit full-restore form
  // (`count: block.pact.count`, never omitted) — task 3's own `slot.restored@1` handler treats a
  // MISSING `count` as "subtract 1" (unlike `resource.restored`'s missing-`count` full-restore
  // convention documented above), so the full pact max must be passed explicitly to floor `used` at
  // 0 regardless of how much was actually expended. Reuses task 3's already pact-aware
  // `slot.restored@1` handler verbatim — no reducer change, matching this task's sanctioned scope
  // (only `propose/casting.ts` and `propose/rest.ts`; see task-11-brief.md).
  for (const block of sheet.spellcasting) {
    if (block.pact) {
      events.push(
        mk('slot.restored', { level: block.pact.level, pact: true, count: block.pact.count } satisfies SlotRestored),
      );
    }
  }
  return events;
}
