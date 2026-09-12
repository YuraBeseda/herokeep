import { describe, expect, it } from 'vitest';
import type { SystemRules } from '../../src/reduce/facts.ts';
import { reduce } from '../../src/reduce/reducer.ts';
import { propose } from '../../src/propose/index.ts';
import { baseSheet, created, ev, wrapAll } from './support.ts';

const fighter = 'core-mini:class/fighter';

const resourceSheet = () =>
  baseSheet({
    resources: [
      {
        id: 'second-wind',
        name: 'Second Wind',
        max: { value: 2, contributions: [] },
        used: 1,
        reset: 'shortRest',
        display: 'uses',
        source: 'x',
      },
      {
        id: 'channel-divinity',
        name: 'Channel Divinity',
        max: { value: 1, contributions: [] },
        used: 1,
        reset: 'longRest',
        display: 'uses',
        source: 'y',
      },
    ],
  });

const mkRules = (): SystemRules => ({
  restRules: {
    shortRest: { allowHitDice: true },
    longRest: {
      hpToMax: true,
      restoreAllSlots: true,
      hitDiceRegainDivisor: 2,
      hitDiceRegainMin: 1,
      exhaustionReduce: 1,
    },
  },
  hpRules: { firstLevelMaxHitDie: true, averageRounding: 'up' },
});

describe('propose.rest', () => {
  it('short rest: rest.taken{kind:"short"} plus resource.restored ONLY for shortRest-reset resources', () => {
    expect(propose.rest(resourceSheet(), 'short')).toEqual([
      { type: 'rest.taken', v: 1, payload: { kind: 'short' } },
      { type: 'resource.restored', v: 1, payload: { resourceId: 'second-wind' } },
    ]);
  });

  it('long rest: rest.taken{kind:"long"} plus resource.restored for BOTH shortRest and longRest resets', () => {
    expect(propose.rest(resourceSheet(), 'long')).toEqual([
      { type: 'rest.taken', v: 1, payload: { kind: 'long' } },
      { type: 'resource.restored', v: 1, payload: { resourceId: 'second-wind' } },
      { type: 'resource.restored', v: 1, payload: { resourceId: 'channel-divinity' } },
    ]);
  });

  it('forwards a given hitDice array as rest.taken.hitDiceSpent', () => {
    const events = propose.rest(baseSheet(), 'short', [{ classId: fighter, count: 1 }]);
    expect(events).toEqual([
      { type: 'rest.taken', v: 1, payload: { kind: 'short', hitDiceSpent: [{ classId: fighter, count: 1 }] } },
    ]);
  });

  it('omits hitDiceSpent entirely when no hitDice argument is given', () => {
    const events = propose.rest(baseSheet(), 'long');
    expect((events[0]!.payload as { hitDiceSpent?: unknown }).hitDiceSpent).toBeUndefined();
  });

  it('a sheet with no resources emits only rest.taken', () => {
    expect(propose.rest(baseSheet(), 'long')).toEqual([{ type: 'rest.taken', v: 1, payload: { kind: 'long' } }]);
  });

  it('long rest transaction round-trips through the real reducer: both resources reset to 0, slots clear, HP resolves to max', () => {
    const setup = [
      created,
      ev(2, 'resource.spent', { resourceId: 'second-wind', count: 2 }),
      ev(3, 'resource.spent', { resourceId: 'channel-divinity', count: 1 }),
      ev(4, 'slot.spent', { level: 1 }),
    ];
    const rules = mkRules();
    const proposed = propose.rest(resourceSheet(), 'long');
    const final = reduce([...setup, ...wrapAll(5, proposed)], undefined, rules);

    expect(final.resourcesUsed).toEqual({ 'second-wind': 0, 'channel-divinity': 0 });
    expect(final.slotsUsed).toEqual({});
    expect(final.hp.current).toBe('max');
  });

  it('short rest transaction round-trips: only the shortRest resource resets, the longRest one is untouched', () => {
    const setup = [
      created,
      ev(2, 'resource.spent', { resourceId: 'second-wind', count: 2 }),
      ev(3, 'resource.spent', { resourceId: 'channel-divinity', count: 1 }),
    ];
    const rules = mkRules();
    const proposed = propose.rest(resourceSheet(), 'short');
    const final = reduce([...setup, ...wrapAll(4, proposed)], undefined, rules);

    expect(final.resourcesUsed).toEqual({ 'second-wind': 0, 'channel-divinity': 1 });
  });
});
