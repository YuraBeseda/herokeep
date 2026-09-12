import type { Event } from '@hk/protocol';
import { describe, expect, it } from 'vitest';
import { reduce } from '../src/reduce/reducer.ts';

const stream = 'char:2b7a1f22-1111-4c9d-a8f2-0a1b2c3d4e5f';
const id = (n: number) => `018f6d2e-7b1a-7c3d-9e4f-${String(n).padStart(12, '0')}`;
const ev = (n: number, type: string, payload: unknown, extra: Partial<Event> = {}): Event => ({
  id: id(n),
  stream,
  seq: n,
  ts: '2026-08-30T12:00:00.000Z',
  actor: { userId: 'u', deviceId: 'd', role: 'owner' },
  type,
  v: 1,
  payload,
  ...extra,
});

const created = ev(1, 'character.created', {
  name: 'Ivan',
  system: 'mini',
  corePack: { id: 'core-mini', version: '1.0.0' },
  engineVersion: '0.1.0',
  grammaticalGender: 'masculine',
});

const fighter = 'core-mini:class/fighter';
const wizard = 'core-mini:class/wizard';
const exhaustion = 'core-mini:condition/exhaustion';
const poisoned = 'core-mini:condition/poisoned';
const fireball = 'core-mini:spell/fireball';

describe('vitals handlers: not-created skip (guard table)', () => {
  const guarded: [type: string, payload: unknown][] = [
    ['hp.changed', { delta: -5, kind: 'damage' }],
    ['death_save.recorded', { result: 'success' }],
    ['stabilized', {}],
    ['hit_dice.spent', { classId: fighter, count: 1 }],
    ['hit_dice.regained', { classId: fighter, count: 1 }],
    ['condition.added', { conditionId: poisoned }],
    ['condition.removed', { conditionId: poisoned }],
    ['concentration.started', { spellId: fireball }],
    ['concentration.ended', {}],
    ['inspiration.changed', { value: true }],
  ];

  it.each(guarded)('%s is skipped with reason not-created before character.created', (type, payload) => {
    const f = reduce([ev(2, type, payload)]);
    expect(f.skipped).toEqual([{ eventId: id(2), reason: 'not-created' }]);
  });
});

describe('hp.changed', () => {
  it('damage hits temp first, remainder reduces current: 7 vs {current 10, temp 5} -> {current 8, temp 0}', () => {
    const setup = [
      ev(2, 'hp.changed', { delta: 10, kind: 'set' }),
      ev(3, 'hp.changed', { delta: 5, kind: 'temp' }),
      ev(4, 'hp.changed', { delta: -7, kind: 'damage' }),
    ];
    const f = reduce([created, ...setup]);
    expect(f.hp).toEqual({ current: 8, temp: 0 });
  });

  it('damage floors current at 0 when it exceeds current + temp', () => {
    const setup = [ev(2, 'hp.changed', { delta: 3, kind: 'set' }), ev(3, 'hp.changed', { delta: -10, kind: 'damage' })];
    const f = reduce([created, ...setup]);
    expect(f.hp).toEqual({ current: 0, temp: 0 });
  });

  it('heal adds to current', () => {
    const f = reduce([created, ev(2, 'hp.changed', { delta: 4, kind: 'heal' })]);
    expect(f.hp.current).toBe(4);
  });

  it('heal from 0 resets death saves', () => {
    const setup = [
      ev(2, 'death_save.recorded', { result: 'success' }),
      ev(3, 'death_save.recorded', { result: 'failure' }),
      ev(4, 'hp.changed', { delta: 5, kind: 'heal' }),
    ];
    const f = reduce([created, ...setup]);
    expect(f.deathSaves).toEqual({ successes: 0, failures: 0 });
    expect(f.hp.current).toBe(5);
  });

  it('heal while current is already nonzero does not reset death saves', () => {
    const setup = [
      ev(2, 'hp.changed', { delta: 10, kind: 'set' }),
      ev(3, 'death_save.recorded', { result: 'success' }),
      ev(4, 'hp.changed', { delta: 2, kind: 'heal' }),
    ];
    const f = reduce([created, ...setup]);
    expect(f.deathSaves).toEqual({ successes: 1, failures: 0 });
  });

  it('temp HP does not stack: temp 5 then temp 3 keeps 5', () => {
    const setup = [ev(2, 'hp.changed', { delta: 5, kind: 'temp' }), ev(3, 'hp.changed', { delta: 3, kind: 'temp' })];
    const f = reduce([created, ...setup]);
    expect(f.hp.temp).toBe(5);
  });

  it('temp HP replaces with a higher value: temp 3 then temp 5 becomes 5', () => {
    const setup = [ev(2, 'hp.changed', { delta: 3, kind: 'temp' }), ev(3, 'hp.changed', { delta: 5, kind: 'temp' })];
    const f = reduce([created, ...setup]);
    expect(f.hp.temp).toBe(5);
  });

  it('set overrides current directly regardless of prior value', () => {
    const setup = [ev(2, 'hp.changed', { delta: 10, kind: 'set' }), ev(3, 'hp.changed', { delta: 6, kind: 'set' })];
    const f = reduce([created, ...setup]);
    expect(f.hp.current).toBe(6);
  });
});

describe('death_save.recorded', () => {
  it('accumulates successes and failures independently', () => {
    const setup = [
      ev(2, 'death_save.recorded', { result: 'success' }),
      ev(3, 'death_save.recorded', { result: 'failure' }),
    ];
    const f = reduce([created, ...setup]);
    expect(f.deathSaves).toEqual({ successes: 1, failures: 1 });
  });

  it('3 successes marks stable and resets both counters', () => {
    const setup = [
      ev(2, 'death_save.recorded', { result: 'success' }),
      ev(3, 'death_save.recorded', { result: 'failure' }),
      ev(4, 'death_save.recorded', { result: 'success' }),
      ev(5, 'death_save.recorded', { result: 'success' }),
    ];
    const f = reduce([created, ...setup]);
    expect(f.deathSaves).toEqual({ successes: 0, failures: 0 });
  });

  it('failures cap at 3', () => {
    const setup = [
      ev(2, 'death_save.recorded', { result: 'failure' }),
      ev(3, 'death_save.recorded', { result: 'failure' }),
      ev(4, 'death_save.recorded', { result: 'failure' }),
      ev(5, 'death_save.recorded', { result: 'failure' }),
    ];
    const f = reduce([created, ...setup]);
    expect(f.deathSaves.failures).toBe(3);
  });

  it('critSuccess resets saves and sets current to 1', () => {
    const setup = [
      ev(2, 'death_save.recorded', { result: 'failure' }),
      ev(3, 'death_save.recorded', { result: 'critSuccess' }),
    ];
    const f = reduce([created, ...setup]);
    expect(f.deathSaves).toEqual({ successes: 0, failures: 0 });
    expect(f.hp.current).toBe(1);
  });

  it('critFailure counts 2 failures', () => {
    const f = reduce([created, ev(2, 'death_save.recorded', { result: 'critFailure' })]);
    expect(f.deathSaves.failures).toBe(2);
  });

  it('critFailure at 2 failures caps at 3, not 4', () => {
    const setup = [
      ev(2, 'death_save.recorded', { result: 'failure' }),
      ev(3, 'death_save.recorded', { result: 'failure' }),
      ev(4, 'death_save.recorded', { result: 'critFailure' }),
    ];
    const f = reduce([created, ...setup]);
    expect(f.deathSaves.failures).toBe(3);
  });
});

describe('stabilized', () => {
  it('resets both death save counters', () => {
    const setup = [
      ev(2, 'death_save.recorded', { result: 'success' }),
      ev(3, 'death_save.recorded', { result: 'failure' }),
      ev(4, 'stabilized', {}),
    ];
    const f = reduce([created, ...setup]);
    expect(f.deathSaves).toEqual({ successes: 0, failures: 0 });
  });
});

describe('hit_dice.spent / hit_dice.regained', () => {
  it('spent accumulates per class', () => {
    const setup = [
      ev(2, 'hit_dice.spent', { classId: fighter, count: 1 }),
      ev(3, 'hit_dice.spent', { classId: fighter, count: 1 }),
      ev(4, 'hit_dice.spent', { classId: wizard, count: 2 }),
    ];
    const f = reduce([created, ...setup]);
    expect(f.hitDiceSpent).toEqual({ [fighter]: 2, [wizard]: 2 });
  });

  it('spent with healed applies as a heal (current only, never temp), with the at-0 reset rule', () => {
    const setup = [
      ev(2, 'hp.changed', { delta: 5, kind: 'temp' }),
      ev(3, 'death_save.recorded', { result: 'failure' }),
      ev(4, 'hit_dice.spent', { classId: fighter, count: 1, healed: 4 }),
    ];
    const f = reduce([created, ...setup]);
    expect(f.hp).toEqual({ current: 4, temp: 5 });
    expect(f.deathSaves).toEqual({ successes: 0, failures: 0 });
  });

  it('regained reduces the per-class spent count, floored at 0', () => {
    const setup = [
      ev(2, 'hit_dice.spent', { classId: fighter, count: 2 }),
      ev(3, 'hit_dice.regained', { classId: fighter, count: 5 }),
    ];
    const f = reduce([created, ...setup]);
    expect(f.hitDiceSpent[fighter]).toBe(0);
  });

  it('regained with healed applies as a heal too', () => {
    const setup = [
      ev(2, 'hit_dice.spent', { classId: fighter, count: 1 }),
      ev(3, 'hit_dice.regained', { classId: fighter, count: 1, healed: 3 }),
    ];
    const f = reduce([created, ...setup]);
    expect(f.hp.current).toBe(3);
    expect(f.hitDiceSpent[fighter]).toBe(0);
  });
});

describe('condition.added / condition.removed', () => {
  it('adds a condition, stamping sinceEventId from the event id', () => {
    const addEv = ev(2, 'condition.added', { conditionId: poisoned, source: 'core-mini:trap/spikes' });
    const f = reduce([created, addEv]);
    expect(f.conditions).toEqual([{ conditionId: poisoned, source: 'core-mini:trap/spikes', sinceEventId: id(2) }]);
  });

  it('re-adding exhaustion with a new level replaces the existing entry', () => {
    const setup = [
      ev(2, 'condition.added', { conditionId: exhaustion, level: 1 }),
      ev(3, 'condition.added', { conditionId: exhaustion, level: 2 }),
    ];
    const f = reduce([created, ...setup]);
    expect(f.conditions).toEqual([{ conditionId: exhaustion, level: 2, sinceEventId: id(3) }]);
  });

  it('removes by conditionId, leaving other conditions untouched', () => {
    const setup = [
      ev(2, 'condition.added', { conditionId: exhaustion, level: 1 }),
      ev(3, 'condition.added', { conditionId: poisoned }),
      ev(4, 'condition.removed', { conditionId: poisoned }),
    ];
    const f = reduce([created, ...setup]);
    expect(f.conditions).toEqual([{ conditionId: exhaustion, level: 1, sinceEventId: id(2) }]);
  });
});

describe('concentration.started / concentration.ended', () => {
  it('started sets spellId and stamps sinceEventId', () => {
    const f = reduce([created, ev(2, 'concentration.started', { spellId: fireball })]);
    expect(f.concentration).toEqual({ spellId: fireball, sinceEventId: id(2) });
  });

  it('a second started replaces the prior concentration', () => {
    const setup = [
      ev(2, 'concentration.started', { spellId: fireball }),
      ev(3, 'concentration.started', { spellId: 'core-mini:spell/haste' }),
    ];
    const f = reduce([created, ...setup]);
    expect(f.concentration).toEqual({ spellId: 'core-mini:spell/haste', sinceEventId: id(3) });
  });

  it('ended clears concentration', () => {
    const setup = [ev(2, 'concentration.started', { spellId: fireball }), ev(3, 'concentration.ended', {})];
    const f = reduce([created, ...setup]);
    expect(f.concentration).toBeUndefined();
  });
});

describe('inspiration.changed', () => {
  it('sets the boolean', () => {
    const f = reduce([created, ev(2, 'inspiration.changed', { value: true })]);
    expect(f.inspiration).toBe(true);
  });

  it('can be cleared back to false', () => {
    const setup = [ev(2, 'inspiration.changed', { value: true }), ev(3, 'inspiration.changed', { value: false })];
    const f = reduce([created, ...setup]);
    expect(f.inspiration).toBe(false);
  });
});
