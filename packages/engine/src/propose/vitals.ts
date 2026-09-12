import type {
  ConditionAdded,
  ConditionRemoved,
  DeathSaveRecorded,
  HitDiceSpent,
  HpChanged,
  InspirationChanged,
} from '@hk/protocol';
import type { Sheet } from '../derive/sheet.ts';
import { error } from '../diagnostics.ts';
import { ProposeError, type ProposedEvent } from './index.ts';

const mk = (type: string, payload: unknown): ProposedEvent => ({ type, v: 1, payload });

/**
 * R3 (the 'max' sentinel, facts.ts / reduce/handlers/vitals.ts): when the sheet's HP resolved
 * FROM the long-rest 'max' sentinel (`sheet.hp.currentWasMax`), a raw `hp.changed {damage|heal}`
 * sent to the reducer would skip with `'hp-unresolved'` — so `damage`/`heal` below prepend a
 * resolving `hp.changed {kind:'set', delta: sheet.hp.max.value}` first. `sheet.hp.current` is
 * already the resolved number either way (derive/hp.ts resolves the sentinel for display), so the
 * clamping math never needs to branch on this itself — only whether to emit the extra event does.
 */
function resolveMaxSentinel(sheet: Sheet): ProposedEvent[] {
  return sheet.hp.currentWasMax
    ? [mk('hp.changed', { delta: sheet.hp.max.value, kind: 'set' } satisfies HpChanged)]
    : [];
}

/** Damage clamps to reachable HP (current + temp) so the recorded delta matches what actually happened. */
export function damage(sheet: Sheet, amount: number, opts: { type?: string; source?: string } = {}): ProposedEvent[] {
  const resolve = resolveMaxSentinel(sheet);
  const reachable = Math.max(0, Math.min(amount, sheet.hp.current + sheet.hp.temp));
  const payload: HpChanged = {
    delta: -reachable,
    kind: 'damage',
    ...(opts.source !== undefined ? { source: opts.source } : {}),
    ...(opts.type !== undefined ? { damageType: opts.type } : {}),
  };
  return [...resolve, mk('hp.changed', payload)];
}

/** Heal clamps to the headroom below max — overhealing is what `tempHp` is for. */
export function heal(sheet: Sheet, amount: number): ProposedEvent[] {
  const resolve = resolveMaxSentinel(sheet);
  const reachable = Math.max(0, Math.min(amount, sheet.hp.max.value - sheet.hp.current));
  return [...resolve, mk('hp.changed', { delta: reachable, kind: 'heal' } satisfies HpChanged)];
}

/** `temp` never reads prior `current` (handlers/vitals.ts), so it needs no sentinel resolution. */
export function tempHp(_sheet: Sheet, amount: number): ProposedEvent[] {
  return [mk('hp.changed', { delta: Math.max(0, amount), kind: 'temp' } satisfies HpChanged)];
}

/** Refuses with `'hitdice.none-left'` once every hit die for `classId` is already spent. */
export function spendHitDie(sheet: Sheet, classId: string, rolled: number): ProposedEvent[] {
  const hd = sheet.hp.hitDice[classId];
  const remaining = hd ? hd.total - hd.spent : 0;
  if (remaining <= 0) {
    throw new ProposeError([error('hitdice.none-left', `No hit dice remain for "${classId}"`, { entityId: classId })]);
  }
  const conMod = sheet.abilities['con']?.mod ?? 0;
  const healed = Math.max(0, rolled + conMod);
  return [mk('hit_dice.spent', { classId, count: 1, healed } satisfies HitDiceSpent)];
}

export function deathSave(
  _sheet: Sheet,
  result: 'success' | 'failure' | 'critSuccess' | 'critFailure',
): ProposedEvent[] {
  return [mk('death_save.recorded', { result } satisfies DeathSaveRecorded)];
}

/** Replace-by-conditionId (handlers/vitals.ts): re-adding with a new `level` is how a level changes. */
export function condition(_sheet: Sheet, conditionId: string, add: boolean, level?: number): ProposedEvent[] {
  if (add) {
    return [mk('condition.added', { conditionId, ...(level !== undefined ? { level } : {}) } satisfies ConditionAdded)];
  }
  return [mk('condition.removed', { conditionId } satisfies ConditionRemoved)];
}

export function inspiration(_sheet: Sheet, value: boolean): ProposedEvent[] {
  return [mk('inspiration.changed', { value } satisfies InspirationChanged)];
}
