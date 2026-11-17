import type { Event } from '@hk/protocol';
import { describe, expect, it } from 'vitest';
import type { SystemRules } from '../src/reduce/facts.ts';
import { reduce } from '../src/reduce/reducer.ts';

const stream = 'char:2b7a1f22-1111-4c9d-a8f2-0a1b2c3d4e5f';
const id = (n: number) => `018f6d2e-7b1a-7c3d-9e4f-${String(n).padStart(12, '0')}`;
const ev = (n: number, type: string, payload: unknown, v = 1): Event => ({
  id: id(n),
  stream,
  seq: n,
  ts: '2026-08-30T12:00:00.000Z',
  actor: { userId: 'u', deviceId: 'd', role: 'owner' },
  type,
  v,
  payload,
});
const created = ev(1, 'character.created', {
  name: 'Ivan',
  system: 'mini',
  corePack: { id: 'core-mini', version: '1.0.0' },
  engineVersion: '0.1.0',
  grammaticalGender: 'masculine',
});
const rules: SystemRules = {
  restRules: {
    shortRest: { allowHitDice: true },
    longRest: { hpToMax: true, restoreAllSlots: true, hitDiceRegainDivisor: 2, hitDiceRegainMin: 1, exhaustionReduce: 1 },
  },
  hpRules: { firstLevelMaxHitDie: true, averageRounding: 'up' },
};
const c = (n: string) => `core-mini:condition/${n}`;
const add = (n: number, name: string, duration?: unknown, extra: object = {}) =>
  ev(n, 'condition.added', { conditionId: c(name), ...(duration ? { duration } : {}), ...extra }, 2);

describe('condition durations', () => {
  it('stores duration, source and startedAtRound; v1 stays untouched', () => {
    const f = reduce([
      created,
      add(2, 'charmed', { kind: 'rounds', amount: 10 }, { source: 'Hold Person', startedAtRound: 4 }),
      ev(3, 'condition.added', { conditionId: c('prone') }),
    ]);
    expect(f.conditions).toEqual([
      {
        conditionId: c('charmed'),
        sinceEventId: id(2),
        source: 'Hold Person',
        duration: { kind: 'rounds', amount: 10 },
        startedAtRound: 4,
      },
      { conditionId: c('prone'), sinceEventId: id(3) },
    ]);
  });

  it('condition.updated replaces the duration; an absent condition is skipped', () => {
    const f = reduce([
      created,
      add(2, 'charmed', { kind: 'rounds', amount: 10 }),
      ev(3, 'condition.updated', { conditionId: c('charmed'), duration: { kind: 'untilRemoved' } }),
      ev(4, 'condition.updated', { conditionId: c('prone'), duration: { kind: 'untilRemoved' } }),
    ]);
    expect(f.conditions[0]?.duration).toEqual({ kind: 'untilRemoved' });
    expect(f.skipped).toEqual([{ eventId: id(4), reason: 'condition-not-present' }]);
  });

  const setup = [
    created,
    add(2, 'a', { kind: 'untilShortRest' }),
    add(3, 'b', { kind: 'untilLongRest' }),
    add(4, 'c', { kind: 'minutes', amount: 5 }),
    ev(5, 'condition.added', { conditionId: c('d') }),
  ];
  const names = (f: ReturnType<typeof reduce>) => f.conditions.map((x) => x.conditionId.split('/')[1]);

  it('a short rest drops only untilShortRest', () => {
    const f = reduce([...setup, ev(6, 'rest.taken', { kind: 'short' })], undefined, rules);
    expect(names(f)).toEqual(['b', 'c', 'd']);
  });
  it('a long rest drops untilShortRest and untilLongRest', () => {
    const f = reduce([...setup, ev(6, 'rest.taken', { kind: 'long' })], undefined, rules);
    expect(names(f)).toEqual(['c', 'd']);
  });
});
