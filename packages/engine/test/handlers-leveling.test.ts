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

describe('leveling handlers: not-created skip (guard table)', () => {
  const guarded: [type: string, payload: unknown][] = [
    ['level.gained', { classId: fighter, level: 1 }],
    ['xp.awarded', { amount: 100 }],
  ];

  it.each(guarded)('%s is skipped with reason not-created before character.created', (type, payload) => {
    const f = reduce([ev(2, type, payload)]);
    expect(f.skipped).toEqual([{ eventId: id(2), reason: 'not-created' }]);
  });
});

describe('level.gained', () => {
  it('fighter 1 -> 2 happy path: level advances and the numeric hp roll is ledgered', () => {
    const level1 = ev(2, 'level.gained', { classId: fighter, level: 1 });
    const level2 = ev(3, 'level.gained', { classId: fighter, level: 2, hpRoll: 5 });
    const f = reduce([created, level1, level2]);
    expect(f.classes).toEqual([{ classId: fighter, level: 2 }]);
    expect(f.hpRolls).toEqual({ [fighter]: [5] });
    expect(f.skipped).toEqual([]);
  });

  it('an "average" hp roll is ledgered the same way as a numeric roll', () => {
    const level1 = ev(2, 'level.gained', { classId: fighter, level: 1 });
    const level2 = ev(3, 'level.gained', { classId: fighter, level: 2, hpRoll: 'average' });
    const f = reduce([created, level1, level2]);
    expect(f.hpRolls).toEqual({ [fighter]: ['average'] });
  });

  it('level 1 never records an hp roll, even if one is sent (firstLevelMaxHitDie is derive-side)', () => {
    const level1 = ev(2, 'level.gained', { classId: fighter, level: 1, hpRoll: 8 });
    const f = reduce([created, level1]);
    expect(f.classes).toEqual([{ classId: fighter, level: 1 }]);
    expect(f.hpRolls).toEqual({});
  });

  it('skips with level-not-next when the gained level does not immediately follow the current one', () => {
    const level1 = ev(2, 'level.gained', { classId: fighter, level: 1 });
    const level3 = ev(3, 'level.gained', { classId: fighter, level: 3 });
    const f = reduce([created, level1, level3]);
    expect(f.classes).toEqual([{ classId: fighter, level: 1 }]);
    expect(f.skipped).toEqual([{ eventId: level3.id, reason: 'level-not-next' }]);
  });

  it('first gain must be level 1: gaining level 2 with no prior class entry is level-not-next', () => {
    const level2 = ev(2, 'level.gained', { classId: fighter, level: 2 });
    const f = reduce([created, level2]);
    expect(f.classes).toEqual([]);
    expect(f.skipped).toEqual([{ eventId: level2.id, reason: 'level-not-next' }]);
  });

  it('a second class starts at level 1 and appends its own entry (multiclass data is allowed)', () => {
    const fighter1 = ev(2, 'level.gained', { classId: fighter, level: 1 });
    const wizard1 = ev(3, 'level.gained', { classId: wizard, level: 1 });
    const f = reduce([created, fighter1, wizard1]);
    expect(f.classes).toEqual([
      { classId: fighter, level: 1 },
      { classId: wizard, level: 1 },
    ]);
    expect(f.skipped).toEqual([]);
  });

  it('records subclassId on the class entry and keeps it once set on a later, subclass-less gain', () => {
    const level1 = ev(2, 'level.gained', { classId: fighter, level: 1, subclassId: 'core-mini:subclass/champion' });
    const level2 = ev(3, 'level.gained', { classId: fighter, level: 2 });
    const f = reduce([created, level1, level2]);
    expect(f.classes).toEqual([{ classId: fighter, level: 2, subclassId: 'core-mini:subclass/champion' }]);
  });
});

describe('xp.awarded', () => {
  it('adds the amount to xp', () => {
    const f = reduce([created, ev(2, 'xp.awarded', { amount: 300 })]);
    expect(f.xp).toBe(300);
  });

  it('accumulates across multiple awards', () => {
    const f = reduce([created, ev(2, 'xp.awarded', { amount: 300 }), ev(3, 'xp.awarded', { amount: 50 })]);
    expect(f.xp).toBe(350);
  });

  it('floors at 0: a negative correction cannot drive xp below zero', () => {
    const f = reduce([created, ev(2, 'xp.awarded', { amount: 100 }), ev(3, 'xp.awarded', { amount: -500 })]);
    expect(f.xp).toBe(0);
  });
});

describe('decision.made (relocated to leveling.ts) / decision.cleared context round-trip', () => {
  const choiceId = 'core-mini:class/fighter@1/fighting-style';

  it('decision.made stores the selection and, when present, the context for the timeline', () => {
    const decided = ev(2, 'decision.made', {
      choiceId,
      selection: ['core-mini:feat/defense'],
      context: { method: 'standardArray', scores: [15, 14, 13, 12, 10, 8] },
    });
    const f = reduce([created, decided]);
    expect(f.decisions[choiceId]).toEqual(['core-mini:feat/defense']);
    expect(f.decisionContexts[choiceId]).toEqual({
      method: 'standardArray',
      scores: [15, 14, 13, 12, 10, 8],
    });
  });

  it('decision.made without a context leaves decisionContexts untouched', () => {
    const decided = ev(2, 'decision.made', { choiceId, selection: ['x'] });
    const f = reduce([created, decided]);
    expect(f.decisionContexts).toEqual({});
  });

  it('decision.cleared deletes both the decision and its context', () => {
    const decided = ev(2, 'decision.made', { choiceId, selection: ['x'], context: { a: 1 } });
    const cleared = ev(3, 'decision.cleared', { choiceId });
    const f = reduce([created, decided, cleared]);
    expect(f.decisions[choiceId]).toBeUndefined();
    expect(f.decisionContexts[choiceId]).toBeUndefined();
  });
});
