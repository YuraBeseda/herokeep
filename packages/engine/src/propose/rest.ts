import type { ResourceRestored, RestTaken, SlotRestored } from '@hk/protocol';
import type { Sheet } from '../derive/sheet.ts';
import { type Diagnostic, error } from '../diagnostics.ts';
import { parseRollSpec } from '../dice/parse.ts';
import { ProposeError, type ProposedEvent } from './index.ts';

const mk = (type: string, payload: unknown): ProposedEvent => ({ type, v: 1, payload });

/**
 * The rest transaction (Task 6 contract, documented in reduce/handlers/casting.ts's header): one
 * `rest.taken {kind, hitDiceSpent?}` PLUS one `resource.restored {resourceId}` (the full-restore
 * form — no `count`) per active resource (`sheet.resources`, already only active `resource.define`
 * effects) whose `reset` matches — a short rest restores `'shortRest'`-reset resources only; a long
 * rest restores those AND `'longRest'`-reset ones (a long rest is a superset of a short one).
 * Exception: a resource with rolled `regain` dice gets `{resourceId, count: <rolled total>}` (below).
 *
 * Double-spend trap: this `hitDice` parameter only RECORDS dice as spent in the `rest.taken`
 * payload; it does not heal. `propose.spendHitDie` marks a die spent AND heals, in one event.
 * Canonical UI flow for a short rest: call `propose.spendHitDie` once per die the player rolls,
 * and do NOT also pass `hitDice` here — passing both double-spends the same dice. `hitDice`
 * exists only for bulk bookkeeping without healing (e.g. importing a character, or a DM
 * adjustment), not for the normal short-rest healing loop.
 *
 * Rolled regain (plan 13 task 6, ruling 7): a resource whose `regain` is set (an item's
 * `charges.regain` dice, e.g. Wand of Magic Missiles' `1d6+1`) is NOT fully restored. The CALLER
 * rolls its dice — the same split as `propose.spendHitDie`'s `rolled`: the engine never rolls — and
 * passes the total in `regainRolls[resourceId]`; it is recorded as `resource.restored.count`, so the
 * amount is data in the event and replay needs nothing but the log. The reducer's existing
 * `max(0, used − count)` floor caps the regain at max. A missing or impossible total (outside the
 * dice's min..max) refuses the whole rest (`'rest.regain-roll-missing'` / `'rest.regain-roll-invalid'`)
 * rather than silently falling back to a full restore. `regainRolls` entries for resources without
 * `regain` are ignored. Both trailing parameters are REQUIRED (pass `undefined` / `{}` explicitly)
 * so that every caller decides about rolled regains up front: a defaulted `{}` would turn the
 * all-or-nothing refusal into a runtime surprise the first time a charged item is on the sheet.
 */
export function rest(
  sheet: Sheet,
  kind: 'short' | 'long',
  hitDice: { classId: string; count: number }[] | undefined,
  regainRolls: Readonly<Record<string, number>>,
): ProposedEvent[] {
  const payload: RestTaken = { kind, ...(hitDice !== undefined ? { hitDiceSpent: hitDice } : {}) };
  const events: ProposedEvent[] = [mk('rest.taken', payload)];
  const problems: Diagnostic[] = [];
  for (const r of sheet.resources) {
    // Plan 12 task 6 fix: a LONG rest also restores `reset:'dawn'` resources (charged magic items) —
    // a long rest spans a dawn in ordinary play (v1 approximation). Short rest never touches them;
    // `reset:'never'` stays manual-only. Plan 13 task 6: items whose text regains a ROLLED amount
    // now carry `regain` and restore the caller-rolled total (see the doc comment); the rest
    // (`all`-regain items, feature resources) keep the full-restore form (no `count`).
    if (r.reset === 'shortRest' || (kind === 'long' && (r.reset === 'longRest' || r.reset === 'dawn'))) {
      if (r.regain === undefined) {
        events.push(mk('resource.restored', { resourceId: r.id } satisfies ResourceRestored));
        continue;
      }
      const rolled = regainRolls[r.id];
      const range = rollRange(r.regain);
      if (rolled === undefined) {
        problems.push(error('rest.regain-roll-missing', `No regain roll for "${r.id}"`, { entityId: r.id }));
      } else if (!Number.isInteger(rolled) || rolled < range.min || rolled > range.max) {
        problems.push(
          error('rest.regain-roll-invalid', `${rolled} is not a ${r.regain} total for "${r.id}"`, { entityId: r.id }),
        );
      } else if (rolled >= 1) {
        events.push(mk('resource.restored', { resourceId: r.id, count: rolled } satisfies ResourceRestored));
      }
    }
  }
  if (problems.length > 0) throw new ProposeError(problems);
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

/** The smallest and largest total a regain dice spec (`DiceSchema`: `NdS(+/-M)`) can produce. */
function rollRange(dice: string): { min: number; max: number } {
  const spec = parseRollSpec(dice);
  let min = spec.modifier;
  let max = spec.modifier;
  for (const g of spec.dice) {
    const kept = g.keep?.count ?? g.n;
    min += kept;
    max += kept * g.sides;
  }
  return { min, max };
}
