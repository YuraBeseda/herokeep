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
 * Partitions committed (seq-assigned) events ahead of pending (not-yet-committed) ones,
 * preserving the caller's relative order within each group. Deliberately not a numeric
 * sort by seq: callers are expected to pass committed events already in commit order,
 * and a stable partition (rather than a resort) is what keeps skip semantics — e.g. a
 * decision recorded before its character.created is committed — reproducible from the
 * event log's own order.
 */
function orderEvents(events: Event[]): Event[] {
  const committed = events.filter((e) => e.seq !== undefined);
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
