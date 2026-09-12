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
import { type ConditionEntry, type Facts, requireCreated } from '../facts.ts';
import type { Handler } from '../reducer.ts';

/**
 * Shared by `hp.changed {kind: 'heal'}`, `hit_dice.spent {healed}` and `hit_dice.regained
 * {healed}`: healing only ever touches `current` (never `temp`), and healing while `current`
 * was exactly 0 also resets the death-save counters.
 */
function healHp(f: Facts, magnitude: number): Pick<Facts, 'hp' | 'deathSaves'> {
  const wasZero = f.hp.current === 0;
  return {
    hp: { ...f.hp, current: f.hp.current + magnitude },
    deathSaves: wasZero ? { successes: 0, failures: 0 } : f.deathSaves,
  };
}

export const HANDLERS: Record<string, Handler> = {
  'hp.changed@1': (f, e) => {
    const p = e.payload as HpChanged;
    const skip = requireCreated(f);
    if (skip) return skip;
    const magnitude = Math.abs(p.delta);
    switch (p.kind) {
      case 'damage': {
        const fromTemp = Math.min(f.hp.temp, magnitude);
        const fromCurrent = magnitude - fromTemp;
        return { ...f, hp: { ...f.hp, temp: f.hp.temp - fromTemp, current: Math.max(0, f.hp.current - fromCurrent) } };
      }
      case 'heal':
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
        const successes = Math.min(f.deathSaves.successes + 1, 3);
        // 3 successes marks the character stable: reset both counters.
        return successes === 3
          ? { ...f, deathSaves: { successes: 0, failures: 0 } }
          : { ...f, deathSaves: { ...f.deathSaves, successes } };
      }
      case 'failure':
        return { ...f, deathSaves: { ...f.deathSaves, failures: Math.min(f.deathSaves.failures + 1, 3) } };
      case 'critSuccess':
        return { ...f, deathSaves: { successes: 0, failures: 0 }, hp: { ...f.hp, current: 1 } };
      case 'critFailure':
        return { ...f, deathSaves: { ...f.deathSaves, failures: Math.min(f.deathSaves.failures + 2, 3) } };
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
  // rather than stacking a second one.
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
