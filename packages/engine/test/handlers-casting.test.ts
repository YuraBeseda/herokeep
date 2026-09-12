import type { Event } from '@hk/protocol';
import { describe, expect, it } from 'vitest';
import { type SystemRules } from '../src/reduce/facts.ts';
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
const fireball = 'core-mini:spell/fireball';
const haste = 'core-mini:spell/haste';
const secondWind = 'second-wind';

const mkRules = (overrides: Partial<SystemRules['restRules']['longRest']> = {}, allowHitDice = true): SystemRules => ({
  restRules: {
    shortRest: { allowHitDice },
    longRest: {
      hpToMax: true,
      restoreAllSlots: true,
      hitDiceRegainDivisor: 2,
      hitDiceRegainMin: 1,
      exhaustionReduce: 1,
      ...overrides,
    },
  },
  hpRules: { firstLevelMaxHitDie: true, averageRounding: 'up' },
});

describe('casting handlers: not-created skip (guard table)', () => {
  const guarded: [type: string, payload: unknown][] = [
    ['slot.spent', { level: 1 }],
    ['slot.restored', { level: 1 }],
    ['resource.spent', { resourceId: secondWind }],
    ['resource.restored', { resourceId: secondWind }],
    ['spell.prepared', { spellId: fireball, classId: wizard }],
    ['spell.unprepared', { spellId: fireball, classId: wizard }],
    ['spell.learned', { spellId: fireball, classId: wizard, source: 'levelUp' }],
    ['spell.forgotten', { spellId: fireball, classId: wizard, source: 'levelUp' }],
    ['spell.cast', { spellId: fireball, level: 3 }],
    ['rest.taken', { kind: 'short' }],
  ];

  it.each(guarded)('%s is skipped with reason not-created before character.created', (type, payload) => {
    const f = reduce([ev(2, type, payload)]);
    expect(f.skipped).toEqual([{ eventId: id(2), reason: 'not-created' }]);
  });
});

describe('slot.spent / slot.restored', () => {
  it('spent accumulates per level, defaulting count to 1', () => {
    const setup = [
      ev(2, 'slot.spent', { level: 3 }),
      ev(3, 'slot.spent', { level: 3 }),
      ev(4, 'slot.spent', { level: 1, count: 2 }),
    ];
    const f = reduce([created, ...setup]);
    expect(f.slotsUsed).toEqual({ 3: 2, 1: 2 });
  });

  it('the pact field is accepted but ignored — pact and non-pact spends of the same level accumulate together', () => {
    const setup = [ev(2, 'slot.spent', { level: 2, pact: true }), ev(3, 'slot.spent', { level: 2, pact: false })];
    const f = reduce([created, ...setup]);
    expect(f.slotsUsed).toEqual({ 2: 2 });
  });

  it('restored subtracts (default count 1), floored at 0 — it does NOT reset to 0', () => {
    const setup = [
      ev(2, 'slot.spent', { level: 2, count: 2 }),
      ev(3, 'slot.restored', { level: 2 }),
      ev(4, 'slot.restored', { level: 2, count: 5 }),
    ];
    const f = reduce([created, ...setup]);
    expect(f.slotsUsed[2]).toBe(0);
  });

  it('restoring a level never spent floors at 0 rather than going negative', () => {
    const f = reduce([created, ev(2, 'slot.restored', { level: 4 })]);
    expect(f.slotsUsed[4]).toBe(0);
  });
});

describe('resource.spent / resource.restored', () => {
  it('spent accumulates per resource, defaulting count to 1', () => {
    const setup = [
      ev(2, 'resource.spent', { resourceId: secondWind }),
      ev(3, 'resource.spent', { resourceId: secondWind, count: 2 }),
    ];
    const f = reduce([created, ...setup]);
    expect(f.resourcesUsed).toEqual({ [secondWind]: 3 });
  });

  it('restored WITH a count subtracts, floored at 0 (not a full reset)', () => {
    const setup = [
      ev(2, 'resource.spent', { resourceId: secondWind, count: 3 }),
      ev(3, 'resource.restored', { resourceId: secondWind, count: 1 }),
    ];
    const f = reduce([created, ...setup]);
    expect(f.resourcesUsed[secondWind]).toBe(2);
  });

  it('restored with NO count fully resets that resource to 0, regardless of how much was spent', () => {
    const setup = [
      ev(2, 'resource.spent', { resourceId: secondWind, count: 5 }),
      ev(3, 'resource.restored', { resourceId: secondWind }),
    ];
    const f = reduce([created, ...setup]);
    expect(f.resourcesUsed[secondWind]).toBe(0);
  });
});

describe('spell.prepared / spell.unprepared', () => {
  it('prepares a spell under its classId', () => {
    const f = reduce([created, ev(2, 'spell.prepared', { spellId: fireball, classId: wizard })]);
    expect(f.preparedSpells).toEqual({ [wizard]: [fireball] });
  });

  it('preparing the same spell twice does not duplicate it (set semantics)', () => {
    const setup = [
      ev(2, 'spell.prepared', { spellId: fireball, classId: wizard }),
      ev(3, 'spell.prepared', { spellId: fireball, classId: wizard }),
    ];
    const f = reduce([created, ...setup]);
    expect(f.preparedSpells[wizard]).toEqual([fireball]);
  });

  it('unprepared removes the spell; other prepared spells and classes are untouched', () => {
    const setup = [
      ev(2, 'spell.prepared', { spellId: fireball, classId: wizard }),
      ev(3, 'spell.prepared', { spellId: haste, classId: wizard }),
      ev(4, 'spell.unprepared', { spellId: fireball, classId: wizard }),
    ];
    const f = reduce([created, ...setup]);
    expect(f.preparedSpells[wizard]).toEqual([haste]);
  });
});

describe('spell.learned / spell.forgotten', () => {
  it('learns a spell under its classId', () => {
    const f = reduce([created, ev(2, 'spell.learned', { spellId: fireball, classId: wizard, source: 'levelUp' })]);
    expect(f.knownSpells).toEqual({ [wizard]: [fireball] });
  });

  it('learning the same spell twice does not duplicate it (set semantics)', () => {
    const setup = [
      ev(2, 'spell.learned', { spellId: fireball, classId: wizard, source: 'levelUp' }),
      ev(3, 'spell.learned', { spellId: fireball, classId: wizard, source: 'scroll' }),
    ];
    const f = reduce([created, ...setup]);
    expect(f.knownSpells[wizard]).toEqual([fireball]);
  });

  it('forgotten removes the spell', () => {
    const setup = [
      ev(2, 'spell.learned', { spellId: fireball, classId: wizard, source: 'levelUp' }),
      ev(3, 'spell.forgotten', { spellId: fireball, classId: wizard, source: 'levelUp' }),
    ];
    const f = reduce([created, ...setup]);
    expect(f.knownSpells[wizard]).toEqual([]);
  });
});

describe('spell.cast: folding to slots and concentration', () => {
  it('defaults to consuming a slot at the cast level when slotUsed is omitted', () => {
    const f = reduce([created, ev(2, 'spell.cast', { spellId: fireball, level: 3 })]);
    expect(f.slotsUsed).toEqual({ 3: 1 });
  });

  it('slotUsed: false does not touch slotsUsed (e.g. a cantrip)', () => {
    const f = reduce([created, ev(2, 'spell.cast', { spellId: fireball, level: 0, slotUsed: false })]);
    expect(f.slotsUsed).toEqual({});
  });

  it('slotUsed: true explicitly also consumes a slot', () => {
    const f = reduce([created, ev(2, 'spell.cast', { spellId: fireball, level: 3, slotUsed: true })]);
    expect(f.slotsUsed).toEqual({ 3: 1 });
  });

  it('concentration: true sets concentration to the cast spell, stamped with the event id', () => {
    const f = reduce([created, ev(2, 'spell.cast', { spellId: fireball, level: 3, concentration: true })]);
    expect(f.concentration).toEqual({ spellId: fireball, sinceEventId: id(2) });
  });

  it('concentration omitted leaves any existing concentration untouched', () => {
    const setup = [
      ev(2, 'concentration.started', { spellId: haste }),
      ev(3, 'spell.cast', { spellId: fireball, level: 3 }),
    ];
    const f = reduce([created, ...setup]);
    expect(f.concentration).toEqual({ spellId: haste, sinceEventId: id(2) });
  });
});

describe('rest.taken: no-system-rules skip', () => {
  it('skips long rest with reason no-system-rules when ctx.rules is absent', () => {
    const f = reduce([created, ev(2, 'rest.taken', { kind: 'long' })]);
    expect(f.skipped).toEqual([{ eventId: id(2), reason: 'no-system-rules' }]);
  });

  it('skips short rest with reason no-system-rules when ctx.rules is absent', () => {
    const f = reduce([created, ev(2, 'rest.taken', { kind: 'short' })]);
    expect(f.skipped).toEqual([{ eventId: id(2), reason: 'no-system-rules' }]);
  });
});

describe('rest.taken: long rest full effects (worked example)', () => {
  it('clears slots, drops temp HP, reduces exhaustion, regains hit dice, and resolves HP to max', () => {
    const rules = mkRules();
    const setup = [
      ev(2, 'level.gained', { classId: fighter, level: 1 }),
      ev(3, 'level.gained', { classId: fighter, level: 2 }),
      ev(4, 'level.gained', { classId: fighter, level: 3 }),
      ev(5, 'level.gained', { classId: fighter, level: 4 }),
      ev(6, 'level.gained', { classId: fighter, level: 5 }),
      ev(7, 'hit_dice.spent', { classId: fighter, count: 4 }),
      ev(8, 'slot.spent', { level: 1, count: 2 }),
      ev(9, 'hp.changed', { delta: 10, kind: 'temp' }),
      ev(10, 'condition.added', { conditionId: exhaustion, level: 3 }),
      ev(11, 'rest.taken', { kind: 'long' }),
    ];
    const f = reduce([created, ...setup], undefined, rules);
    expect(f.slotsUsed).toEqual({});
    expect(f.hp.temp).toBe(0);
    expect(f.hp.current).toBe('max');
    expect(f.conditions).toEqual([{ conditionId: exhaustion, level: 2, sinceEventId: id(10) }]);
    expect(f.hitDiceSpent[fighter]).toBe(2); // floor(5/2)=2 regained: 4 spent -> 2 spent
  });

  it('removes an exhaustion condition once its level drops to 0', () => {
    const rules = mkRules({ exhaustionReduce: 1 });
    const setup = [
      ev(2, 'condition.added', { conditionId: exhaustion, level: 1 }),
      ev(3, 'rest.taken', { kind: 'long' }),
    ];
    const f = reduce([created, ...setup], undefined, rules);
    expect(f.conditions).toEqual([]);
  });

  it('honors restoreAllSlots: false by leaving slotsUsed untouched', () => {
    const rules = mkRules({ restoreAllSlots: false });
    const setup = [ev(2, 'slot.spent', { level: 1 }), ev(3, 'rest.taken', { kind: 'long' })];
    const f = reduce([created, ...setup], undefined, rules);
    expect(f.slotsUsed).toEqual({ 1: 1 });
  });

  it('honors hpToMax: false by leaving hp.current untouched', () => {
    const rules = mkRules({ hpToMax: false });
    const setup = [ev(2, 'hp.changed', { delta: 7, kind: 'set' }), ev(3, 'rest.taken', { kind: 'long' })];
    const f = reduce([created, ...setup], undefined, rules);
    expect(f.hp.current).toBe(7);
  });

  it("long rest does NOT touch resourcesUsed — that is the proposer transaction's job (T14)", () => {
    const rules = mkRules();
    const setup = [
      ev(2, 'resource.spent', { resourceId: secondWind, count: 2 }),
      ev(3, 'rest.taken', { kind: 'long' }),
    ];
    const f = reduce([created, ...setup], undefined, rules);
    expect(f.resourcesUsed).toEqual({ [secondWind]: 2 });
  });
});

describe('rest.taken: short rest minimal effects', () => {
  it('marks only the payload hitDiceSpent entries as spent when allowHitDice is true', () => {
    const rules = mkRules({}, true);
    const setup = [ev(2, 'rest.taken', { kind: 'short', hitDiceSpent: [{ classId: fighter, count: 2 }] })];
    const f = reduce([created, ...setup], undefined, rules);
    expect(f.hitDiceSpent).toEqual({ [fighter]: 2 });
  });

  it('does nothing when allowHitDice is false, even with hitDiceSpent in the payload', () => {
    const rules = mkRules({}, false);
    const setup = [ev(2, 'rest.taken', { kind: 'short', hitDiceSpent: [{ classId: fighter, count: 2 }] })];
    const f = reduce([created, ...setup], undefined, rules);
    expect(f.hitDiceSpent).toEqual({});
  });

  it('short rest does not clear slots, reset temp HP, or resolve HP to max', () => {
    const rules = mkRules({}, true);
    const setup = [
      ev(2, 'slot.spent', { level: 1 }),
      ev(3, 'hp.changed', { delta: 5, kind: 'temp' }),
      ev(4, 'rest.taken', { kind: 'short' }),
    ];
    const f = reduce([created, ...setup], undefined, rules);
    expect(f.slotsUsed).toEqual({ 1: 1 });
    expect(f.hp.temp).toBe(5);
    expect(f.hp.current).not.toBe('max');
  });
});
