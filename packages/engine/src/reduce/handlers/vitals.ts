import {
  type ConcentrationStarted,
  type ConditionAdded,
  type ConditionRemoved,
  type DeathSaveRecorded,
  type HitDiceRegained,
  type HitDiceSpent,
  type HpChanged,
  type InspirationChanged,
} from '@hk/protocol';
import { DEATH_SAVE_MAX, type ConditionEntry, type Facts, requireCreated } from '../facts.ts';
import type { Handler } from '../reducer.ts';

/**
 * Shared by `hp.changed {kind: 'heal'}`, `hit_dice.spent {healed}` and `hit_dice.regained
 * {healed}`: healing only ever touches `current` (never `temp`), and healing while `current`
 * was exactly 0 also resets the death-save counters. `current` may already be the long-rest
 * `'max'` sentinel (see `facts.ts`) — healing "full" is a no-op, and can't have been at 0.
 */
function healHp(f: Facts, magnitude: number): Pick<Facts, 'hp' | 'deathSaves'> {
  const current = f.hp.current;
  const wasZero = current === 0;
  return {
    hp: { ...f.hp, current: current === 'max' ? 'max' : current + magnitude },
    deathSaves: wasZero ? { successes: 0, failures: 0 } : f.deathSaves,
  };
}

export const HANDLERS: Record<string, Handler> = {
  'hp.changed@1': (f, e) => {
    const p = e.payload as HpChanged;
    const skip = requireCreated(f);
    if (skip) return skip;
    const current = f.hp.current;
    const magnitude = Math.abs(p.delta);
    switch (p.kind) {
      // `damage` and `heal` do arithmetic against the PRIOR `current` — there's no rules-free
      // way to do that math against the long-rest `'max'` sentinel (see `facts.ts`), so a raw
      // event of either kind skips instead. This only ever happens from a hand-written event:
      // `propose.damage` / `propose.heal` (T14) always resolve the sentinel to a number first,
      // typically via a leading `kind: 'set'` event in the same transaction (see below — `set`
      // and `temp` don't read the prior `current`, so they aren't blocked by this guard, and
      // `set` is exactly how the sentinel gets resolved back to a concrete number).
      case 'damage': {
        if (current === 'max') return 'hp-unresolved';
        const fromTemp = Math.min(f.hp.temp, magnitude);
        const fromCurrent = magnitude - fromTemp;
        return { ...f, hp: { ...f.hp, temp: f.hp.temp - fromTemp, current: Math.max(0, current - fromCurrent) } };
      }
      case 'heal':
        if (current === 'max') return 'hp-unresolved';
        return { ...f, ...healHp(f, magnitude) };
      case 'temp':
        return { ...f, hp: { ...f.hp, temp: Math.max(f.hp.temp, magnitude) } };
      case 'set':
        return { ...f, hp: { ...f.hp, current: p.delta } };
    }
  },

  'death_save.recorded@1': (f, e) => {
    const p = e.payload as DeathSaveRecorded;
    const skip = requireCreated(f);
    if (skip) return skip;
    switch (p.result) {
      case 'success': {
        const successes = Math.min(f.deathSaves.successes + 1, DEATH_SAVE_MAX);
        // DEATH_SAVE_MAX successes marks the character stable: reset both counters.
        return successes === DEATH_SAVE_MAX
          ? { ...f, deathSaves: { successes: 0, failures: 0 } }
          : { ...f, deathSaves: { ...f.deathSaves, successes } };
      }
      case 'failure':
        return {
          ...f,
          deathSaves: { ...f.deathSaves, failures: Math.min(f.deathSaves.failures + 1, DEATH_SAVE_MAX) },
        };
      case 'critSuccess':
        return { ...f, deathSaves: { successes: 0, failures: 0 }, hp: { ...f.hp, current: 1 } };
      case 'critFailure':
        return {
          ...f,
          deathSaves: { ...f.deathSaves, failures: Math.min(f.deathSaves.failures + 2, DEATH_SAVE_MAX) },
        };
    }
  },

  'stabilized@1': (f) => requireCreated(f) ?? { ...f, deathSaves: { successes: 0, failures: 0 } },

  'hit_dice.spent@1': (f, e) => {
    const p = e.payload as HitDiceSpent;
    const skip = requireCreated(f);
    if (skip) return skip;
    const hitDiceSpent = { ...f.hitDiceSpent, [p.classId]: (f.hitDiceSpent[p.classId] ?? 0) + p.count };
    return p.healed !== undefined ? { ...f, hitDiceSpent, ...healHp(f, p.healed) } : { ...f, hitDiceSpent };
  },

  'hit_dice.regained@1': (f, e) => {
    const p = e.payload as HitDiceRegained;
    const skip = requireCreated(f);
    if (skip) return skip;
    const spent = Math.max(0, (f.hitDiceSpent[p.classId] ?? 0) - p.count);
    const hitDiceSpent = { ...f.hitDiceSpent, [p.classId]: spent };
    return p.healed !== undefined ? { ...f, hitDiceSpent, ...healHp(f, p.healed) } : { ...f, hitDiceSpent };
  },

  // Replace-by-conditionId: re-adding e.g. exhaustion with a new `level` replaces the entry
  // rather than stacking a second one. The payload's `until` is intentionally not stored —
  // `ConditionEntry` has no such field; expiry is derive/UI's concern, not the reducer's.
  'condition.added@1': (f, e) => {
    const p = e.payload as ConditionAdded;
    const skip = requireCreated(f);
    if (skip) return skip;
    const entry: ConditionEntry = {
      conditionId: p.conditionId,
      sinceEventId: e.id,
      ...(p.source !== undefined ? { source: p.source } : {}),
      ...(p.level !== undefined ? { level: p.level } : {}),
    };
    return { ...f, conditions: [...f.conditions.filter((c) => c.conditionId !== p.conditionId), entry] };
  },

  'condition.removed@1': (f, e) => {
    const p = e.payload as ConditionRemoved;
    const skip = requireCreated(f);
    if (skip) return skip;
    return { ...f, conditions: f.conditions.filter((c) => c.conditionId !== p.conditionId) };
  },

  // A second `started` replaces the prior concentration — breaking concentration on the old
  // spell is the UI's proposal concern, not the reducer's.
  'concentration.started@1': (f, e) => {
    const p = e.payload as ConcentrationStarted;
    const skip = requireCreated(f);
    if (skip) return skip;
    if (p.spellId === undefined) return 'concentration-spell-required';
    return { ...f, concentration: { spellId: p.spellId, sinceEventId: e.id } };
  },

  'concentration.ended@1': (f) => {
    const skip = requireCreated(f);
    if (skip) return skip;
    const next = { ...f };
    delete next.concentration;
    return next;
  },

  'inspiration.changed@1': (f, e) => {
    const p = e.payload as InspirationChanged;
    return requireCreated(f) ?? { ...f, inspiration: p.value };
  },
};
