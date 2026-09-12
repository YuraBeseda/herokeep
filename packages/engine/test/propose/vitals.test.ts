import { describe, expect, it } from 'vitest';
import { ENGINE_VERSION } from '../../src/version.ts';
import { reduce } from '../../src/reduce/reducer.ts';
import { emptyFacts } from '../../src/reduce/facts.ts';
import { propose } from '../../src/propose/index.ts';
import { baseSheet, captureProposeError, created, ev, wrapAll } from './support.ts';

const fighter = 'core-mini:class/fighter';

describe('propose.damage', () => {
  it('emits a single hp.changed{kind:"damage"} with a NEGATIVE delta', () => {
    const sheet = baseSheet({ hp: { ...baseSheet().hp, current: 15, temp: 3 } });
    expect(propose.damage(sheet, 5)).toEqual([{ type: 'hp.changed', v: 1, payload: { delta: -5, kind: 'damage' } }]);
  });

  it('forwards opts.source/opts.type as source/damageType', () => {
    const sheet = baseSheet({ hp: { ...baseSheet().hp, current: 15, temp: 0 } });
    expect(propose.damage(sheet, 5, { source: 'core-mini:trap/spikes', type: 'fire' })).toEqual([
      {
        type: 'hp.changed',
        v: 1,
        payload: { delta: -5, kind: 'damage', source: 'core-mini:trap/spikes', damageType: 'fire' },
      },
    ]);
  });

  it('clamps the recorded delta to reachable HP (current + temp), not the raw requested amount', () => {
    const sheet = baseSheet({ hp: { ...baseSheet().hp, current: 2, temp: 1 } });
    expect(propose.damage(sheet, 10)).toEqual([{ type: 'hp.changed', v: 1, payload: { delta: -3, kind: 'damage' } }]);
  });

  it("R3: against a sheet whose current resolved from the 'max' sentinel, emits a resolving set THEN the damage event", () => {
    const sheet = baseSheet({
      hp: { ...baseSheet().hp, max: { value: 20, contributions: [] }, current: 20, temp: 0, currentWasMax: true },
    });
    expect(propose.damage(sheet, 5)).toEqual([
      { type: 'hp.changed', v: 1, payload: { delta: 20, kind: 'set' } },
      { type: 'hp.changed', v: 1, payload: { delta: -5, kind: 'damage' } },
    ]);
  });
});

describe('propose.heal', () => {
  it('emits a single hp.changed{kind:"heal"} with a POSITIVE delta', () => {
    const sheet = baseSheet({ hp: { ...baseSheet().hp, current: 10, max: { value: 20, contributions: [] } } });
    expect(propose.heal(sheet, 5)).toEqual([{ type: 'hp.changed', v: 1, payload: { delta: 5, kind: 'heal' } }]);
  });

  it('clamps the recorded delta to the headroom below max', () => {
    const sheet = baseSheet({ hp: { ...baseSheet().hp, current: 18, max: { value: 20, contributions: [] } } });
    expect(propose.heal(sheet, 10)).toEqual([{ type: 'hp.changed', v: 1, payload: { delta: 2, kind: 'heal' } }]);
  });

  it("R3: against a sheet whose current resolved from the 'max' sentinel, emits a resolving set first", () => {
    const sheet = baseSheet({
      hp: { ...baseSheet().hp, max: { value: 20, contributions: [] }, current: 20, temp: 0, currentWasMax: true },
    });
    expect(propose.heal(sheet, 5)).toEqual([
      { type: 'hp.changed', v: 1, payload: { delta: 20, kind: 'set' } },
      { type: 'hp.changed', v: 1, payload: { delta: 0, kind: 'heal' } },
    ]);
  });
});

describe('propose.tempHp', () => {
  it('emits a positive delta as-is (the reducer itself takes the higher of prior/new)', () => {
    const sheet = baseSheet();
    expect(propose.tempHp(sheet, 5)).toEqual([{ type: 'hp.changed', v: 1, payload: { delta: 5, kind: 'temp' } }]);
  });

  it('floors a negative amount at 0', () => {
    const sheet = baseSheet();
    expect(propose.tempHp(sheet, -3)).toEqual([{ type: 'hp.changed', v: 1, payload: { delta: 0, kind: 'temp' } }]);
  });
});

describe('propose.spendHitDie', () => {
  it('emits hit_dice.spent{count:1, healed: rolled + con.mod}', () => {
    const sheet = baseSheet({
      abilities: {
        con: {
          score: { value: 14, contributions: [] },
          mod: 2,
          save: { value: 2, contributions: [] },
          saveProficient: false,
        },
      },
      hp: { ...baseSheet().hp, hitDice: { [fighter]: { die: 10, total: 2, spent: 0 } } },
    });
    expect(propose.spendHitDie(sheet, fighter, 6)).toEqual([
      { type: 'hit_dice.spent', v: 1, payload: { classId: fighter, count: 1, healed: 8 } },
    ]);
  });

  it('floors healed at 0 when a low roll plus a negative con mod would go negative', () => {
    const sheet = baseSheet({
      abilities: {
        con: {
          score: { value: 6, contributions: [] },
          mod: -3,
          save: { value: -3, contributions: [] },
          saveProficient: false,
        },
      },
      hp: { ...baseSheet().hp, hitDice: { [fighter]: { die: 10, total: 2, spent: 0 } } },
    });
    expect(propose.spendHitDie(sheet, fighter, 2)).toEqual([
      { type: 'hit_dice.spent', v: 1, payload: { classId: fighter, count: 1, healed: 0 } },
    ]);
  });

  it('refuses with "hitdice.none-left" once every hit die is spent', () => {
    const sheet = baseSheet({ hp: { ...baseSheet().hp, hitDice: { [fighter]: { die: 10, total: 2, spent: 2 } } } });
    const err = captureProposeError(() => propose.spendHitDie(sheet, fighter, 6));
    expect(err.diagnostics[0]?.code).toBe('hitdice.none-left');
  });

  it('refuses for a class with no hit dice entry at all', () => {
    const sheet = baseSheet({ hp: { ...baseSheet().hp, hitDice: {} } });
    const err = captureProposeError(() => propose.spendHitDie(sheet, fighter, 6));
    expect(err.diagnostics[0]?.code).toBe('hitdice.none-left');
  });
});

describe('propose.deathSave', () => {
  it('emits death_save.recorded{result}', () => {
    expect(propose.deathSave(baseSheet(), 'critFailure')).toEqual([
      { type: 'death_save.recorded', v: 1, payload: { result: 'critFailure' } },
    ]);
  });
});

describe('propose.condition', () => {
  it('add:true with a level emits condition.added{conditionId, level}', () => {
    const events = propose.condition(baseSheet(), 'core-mini:condition/exhaustion', true, 2);
    expect(events).toEqual([
      { type: 'condition.added', v: 1, payload: { conditionId: 'core-mini:condition/exhaustion', level: 2 } },
    ]);
  });

  it('add:true with no level omits the level key entirely', () => {
    const events = propose.condition(baseSheet(), 'core-mini:condition/poisoned', true);
    expect(events).toEqual([
      { type: 'condition.added', v: 1, payload: { conditionId: 'core-mini:condition/poisoned' } },
    ]);
  });

  it('add:false emits condition.removed{conditionId}', () => {
    const events = propose.condition(baseSheet(), 'core-mini:condition/poisoned', false);
    expect(events).toEqual([
      { type: 'condition.removed', v: 1, payload: { conditionId: 'core-mini:condition/poisoned' } },
    ]);
  });
});

describe('propose.inspiration', () => {
  it('emits inspiration.changed{value}', () => {
    expect(propose.inspiration(baseSheet(), true)).toEqual([
      { type: 'inspiration.changed', v: 1, payload: { value: true } },
    ]);
  });
});

describe('propose.damage / propose.heal: signed-delta round trip through the real reducer (T5 arbiter)', () => {
  it('damage hits temp first, then current: {current:15,temp:3} damage 5 -> {current:13,temp:0}', () => {
    const setup = [
      created,
      ev(2, 'hp.changed', { delta: 15, kind: 'set' }),
      ev(3, 'hp.changed', { delta: 3, kind: 'temp' }),
    ];
    const facts = reduce(setup);
    const sheet = baseSheet({ hp: { ...baseSheet().hp, current: facts.hp.current as number, temp: facts.hp.temp } });
    const proposed = propose.damage(sheet, 5);
    const final = reduce([...setup, ...wrapAll(4, proposed)]);
    expect(final.hp).toEqual({ current: 13, temp: 0 });
  });

  it('heal round trip: current 4, heal 10 (headroom to max 20) -> current 14', () => {
    const setup = [created, ev(2, 'hp.changed', { delta: 4, kind: 'set' })];
    const facts = reduce(setup);
    const sheet = baseSheet({
      hp: { ...baseSheet().hp, current: facts.hp.current as number, max: { value: 20, contributions: [] } },
    });
    const proposed = propose.heal(sheet, 10);
    const final = reduce([...setup, ...wrapAll(3, proposed)]);
    expect(final.hp.current).toBe(14);
  });

  it("damage against a real 'max'-sentinel snapshot resolves it then applies damage: max 20, damage 5 -> current 15", () => {
    const from = {
      seq: 1,
      facts: {
        ...emptyFacts('char:2b7a1f22-1111-4c9d-a8f2-0a1b2c3d4e5f'),
        created: true,
        hp: { current: 'max' as const, temp: 0 },
      },
      engineVersion: ENGINE_VERSION,
    };
    const sheet = baseSheet({
      hp: { ...baseSheet().hp, max: { value: 20, contributions: [] }, current: 20, temp: 0, currentWasMax: true },
    });
    const proposed = propose.damage(sheet, 5);
    const final = reduce(wrapAll(2, proposed), from);
    expect(final.hp).toEqual({ current: 15, temp: 0 });
    expect(final.skipped).toEqual([]); // both events applied; no hp-unresolved skip
  });
});
