import { type Event, type EventReverted } from '@hk/protocol';
import { ENGINE_VERSION } from '../version.ts';
import { type Facts, type Snapshot, type SystemRules, emptyFacts } from './facts.ts';
import { HANDLERS as CASTING_HANDLERS } from './handlers/casting.ts';
import { HANDLERS as IDENTITY_HANDLERS } from './handlers/identity.ts';
import { HANDLERS as INVENTORY_HANDLERS } from './handlers/inventory.ts';
import { HANDLERS as LEVELING_HANDLERS } from './handlers/leveling.ts';
import { HANDLERS as VITALS_HANDLERS } from './handlers/vitals.ts';

/** Returns the next facts, or a string reason to skip the event. Must be pure. */
export type Handler = (facts: Facts, event: Event, ctx?: { rules?: SystemRules }) => Facts | string;

/**
 * One entry per `handlers/*.ts` file — each owns a slice of the event catalog and exports its
 * own `HANDLERS` map. Add new modules here as later tasks introduce them (leveling, hp, etc.);
 * `reduce-core.test.ts` asserts none of these maps collide on a key.
 */
const HANDLER_MODULES: Record<string, Handler>[] = [
  IDENTITY_HANDLERS,
  LEVELING_HANDLERS,
  VITALS_HANDLERS,
  CASTING_HANDLERS,
  INVENTORY_HANDLERS,
];

export const HANDLERS: Record<string, Handler> = HANDLER_MODULES.reduce<Record<string, Handler>>(
  (acc, mod) => ({ ...acc, ...mod }),
  {
    // The revert event itself always applies as a no-op — it never gets recorded as skipped,
    // even though its whole purpose is to make OTHER events skip. (A revert targeting itself
    // is not disallowed, but is meaningless: nothing re-checks an already-applied revert.)
    'event.reverted@1': (f) => f,
  },
);

/**
 * Committed (seq-assigned) events replay in strict seq order — the whole point of a
 * seq number is to give every replica the same total order regardless of the array
 * order events arrive in. Pending (not-yet-committed) events have no seq and apply
 * last, in the caller's given order. `Array#sort` is stable in modern engines, so
 * same-seq events (e.g. a duplicate delivery) keep their relative arrival order.
 */
function orderEvents(events: Event[]): Event[] {
  const committed = events.filter((e) => e.seq !== undefined).sort((a, b) => a.seq! - b.seq!);
  const pending = events.filter((e) => e.seq === undefined);
  return [...committed, ...pending];
}

/**
 * Design ruling 2: `event.reverted` targets are resolved by a pre-scan over the WHOLE input
 * array, before folding starts — not by looking backward during the fold. A revert can name a
 * target that comes earlier OR later in seq order than the revert itself; the pre-scan makes
 * both work identically, independent of fold order. Reverting by `txId` skips every event that
 * shares that transaction (the events' own envelope `txId`, not the revert's own).
 */
function preScanReverted(events: Event[]): { ids: Set<string>; txIds: Set<string> } {
  const ids = new Set<string>();
  const txIds = new Set<string>();
  for (const e of events) {
    if (e.type !== 'event.reverted' || e.v !== 1) continue;
    const p = e.payload as EventReverted;
    if (p.targetId !== undefined) ids.add(p.targetId);
    if (p.txId !== undefined) txIds.add(p.txId);
  }
  return { ids, txIds };
}

/**
 * A resumed snapshot's own rules win over a freshly-passed `rules` argument — the snapshot
 * reflects the pack version the character was actually reduced against. Exported standalone
 * (rather than inlined) so the precedence rule itself has a direct, focused test.
 */
export function effectiveRules(from: Snapshot | undefined, rules: SystemRules | undefined): SystemRules | undefined {
  return from?.rules ?? rules;
}

export function reduce(events: Event[], from?: Snapshot, rules?: SystemRules): Facts {
  const resumable = from?.engineVersion === ENGINE_VERSION;
  let facts: Facts = resumable ? structuredClone(from.facts) : emptyFacts(events[0]?.stream ?? '');
  const applied = new Set(facts.appliedEventIds);
  const startSeq = resumable ? from.seq : 0;
  const ctx = { rules: effectiveRules(from, rules) };
  const reverted = preScanReverted(events);

  for (const e of orderEvents(events)) {
    if (e.seq !== undefined && e.seq <= startSeq) continue;
    if (applied.has(e.id)) {
      facts = { ...facts, skipped: [...facts.skipped, { eventId: e.id, reason: 'duplicate' }] };
      continue;
    }
    applied.add(e.id);
    const isReverted = reverted.ids.has(e.id) || (e.txId !== undefined && reverted.txIds.has(e.txId));
    const handler = HANDLERS[`${e.type}@${e.v}`];
    const outcome: Facts | string = isReverted ? 'reverted' : handler ? handler(facts, e, ctx) : 'unknown-type';
    facts =
      typeof outcome === 'string'
        ? { ...facts, skipped: [...facts.skipped, { eventId: e.id, reason: outcome }] }
        : outcome;
    facts = {
      ...facts,
      lastSeq: e.seq !== undefined ? Math.max(facts.lastSeq, e.seq) : facts.lastSeq,
      appliedEventIds: [...facts.appliedEventIds, e.id],
    };
  }
  return facts;
}
