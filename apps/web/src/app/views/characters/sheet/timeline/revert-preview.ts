import { derive, reduce } from '@hk/engine';
import type { ContentIndex, DeriveOverrides, Sheet, SystemRules } from '@hk/engine';
import type { Event } from '@hk/protocol';

/** One value the Revert confirm (board DL05) says will move, before and after. */
export interface RevertChange {
  readonly key: 'hp' | 'hpMax' | 'ac' | 'level';
  readonly before: number;
  readonly after: number;
}

export interface RevertPreviewInput {
  readonly events: readonly Event[];
  /** The same target the store revert would write: a whole transaction or a single event. */
  readonly target: { eventId?: string; txId?: string };
  readonly index: ContentIndex;
  readonly rules?: SystemRules;
  readonly overrides?: DeriveOverrides;
}

const valuesOf = (sheet: Sheet): Record<RevertChange['key'], number> => ({
  hp: sheet.hp.current,
  hpMax: sheet.hp.max.value,
  ac: sheet.ac.value,
  level: sheet.level,
});

/**
 * What a revert would change on the sheet, computed without writing anything: the current events
 * are reduced and derived, then reduced and derived again with the `event.reverted` the store
 * would append (same payload shape, envelope copied from the newest event so it sorts last), and
 * the headline values are compared. Pure: the engine is only called, never changed. Only values
 * that differ are returned, in a fixed order.
 */
export function revertPreview(input: RevertPreviewInput): RevertChange[] {
  const { events, target, index, rules, overrides } = input;
  const last = events.at(-1);
  if (!last) return [];
  const synthetic: Event = {
    ...last,
    id: '00000000-0000-4000-8000-000000000000',
    ...(last.seq !== undefined ? { seq: last.seq + 1 } : {}),
    type: 'event.reverted',
    v: 1,
    txId: undefined,
    payload: {
      ...(target.eventId !== undefined ? { targetId: target.eventId } : {}),
      ...(target.txId !== undefined ? { txId: target.txId } : {}),
    },
  };
  const before = valuesOf(derive(reduce([...events], undefined, rules), index, rules, overrides));
  const after = valuesOf(
    derive(reduce([...events, synthetic], undefined, rules), index, rules, overrides),
  );
  return (['hp', 'hpMax', 'ac', 'level'] as const)
    .filter((key) => before[key] !== after[key])
    .map((key) => ({ key, before: before[key], after: after[key] }));
}
