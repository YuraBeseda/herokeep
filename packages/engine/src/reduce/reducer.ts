import { type CharacterCreated, type DecisionMade, type Event, type PackPinned } from '@hk/protocol';
import { ENGINE_VERSION } from '../version.ts';
import { type Facts, type Snapshot, emptyFacts } from './facts.ts';

/** Returns the next facts, or a string reason to skip the event. Must be pure. */
export type Handler = (facts: Facts, event: Event) => Facts | string;

const requireCreated = (f: Facts): string | undefined => (f.created ? undefined : 'not-created');

export const HANDLERS: Record<string, Handler> = {
  'character.created@1': (f, e) => {
    if (f.created) return 'already-created';
    const p = e.payload as CharacterCreated;
    return {
      ...f,
      created: true,
      name: p.name,
      system: p.system,
      grammaticalGender: p.grammaticalGender,
      createdWith: { engineVersion: p.engineVersion },
      pins: { ...f.pins, [p.corePack.id]: p.corePack.version },
    };
  },
  'pack.pinned@1': (f, e) => {
    const p = e.payload as PackPinned;
    return { ...f, pins: { ...f.pins, [p.packId]: p.version } };
  },
  'decision.made@1': (f, e) => {
    const p = e.payload as DecisionMade;
    return requireCreated(f) ?? { ...f, decisions: { ...f.decisions, [p.choiceId]: [...p.selection] } };
  },
};

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

export function reduce(events: Event[], from?: Snapshot): Facts {
  const resumable = from?.engineVersion === ENGINE_VERSION;
  let facts: Facts = resumable ? structuredClone(from.facts) : emptyFacts(events[0]?.stream ?? '');
  const applied = new Set(facts.appliedEventIds);
  const startSeq = resumable ? from.seq : 0;

  for (const e of orderEvents(events)) {
    if (e.seq !== undefined && e.seq <= startSeq) continue;
    if (applied.has(e.id)) {
      facts = { ...facts, skipped: [...facts.skipped, { eventId: e.id, reason: 'duplicate' }] };
      continue;
    }
    applied.add(e.id);
    const handler = HANDLERS[`${e.type}@${e.v}`];
    const outcome = handler ? handler(facts, e) : 'unknown-type';
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
