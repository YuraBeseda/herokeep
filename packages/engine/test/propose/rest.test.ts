import { describe, expect, it } from 'vitest';
import type { Sheet } from '../../src/derive/sheet.ts';
import type { SystemRules } from '../../src/reduce/facts.ts';
import { reduce } from '../../src/reduce/reducer.ts';
import { propose } from '../../src/propose/index.ts';
import { baseSheet, created, ev, wrapAll } from './support.ts';

const fighter = 'core-mini:class/fighter';
const warlock = 'core-mini:class/warlock';

/** A solo Warlock's spellcasting block (task 3's pact shape — see `casting.test.ts`'s own copy). */
const pactSheet = (overrides: Partial<{ level: number; count: number; used: number }> = {}): Sheet =>
  baseSheet({
    spellcasting: [
      {
        classId: warlock,
        ability: 'cha',
        dc: { value: 14, contributions: [] },
        attack: { value: 6, contributions: [] },
        slots: [],
        pact: { level: 3, count: 2, used: 1, ...overrides },
        preparation: 'prepared',
        prepared: [],
        known: [],
        ritual: false,
      },
    ],
  });

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

  it('dawn-reset resources (charged items): NOT restored by a short rest, restored to full by a long rest', () => {
    const dawnSheet = baseSheet({
      resources: [
        {
          id: 'item:11111111-1111-4111-8111-aaaaaaaaaaaa',
          name: 'Wand',
          max: { value: 7, contributions: [] },
          used: 4,
          reset: 'dawn',
          display: 'number',
          source: 'z',
        },
      ],
    });
    expect(propose.rest(dawnSheet, 'short')).toEqual([{ type: 'rest.taken', v: 1, payload: { kind: 'short' } }]);
    expect(propose.rest(dawnSheet, 'long')).toEqual([
      { type: 'rest.taken', v: 1, payload: { kind: 'long' } },
      { type: 'resource.restored', v: 1, payload: { resourceId: 'item:11111111-1111-4111-8111-aaaaaaaaaaaa' } },
    ]);
  });

  it("'never'-reset resources are never swept by either rest kind", () => {
    const s = baseSheet({
      resources: [
        {
          id: 'gem',
          name: 'Gem',
          max: { value: 5, contributions: [] },
          used: 1,
          reset: 'never',
          display: 'number',
          source: 'z',
        },
      ],
    });
    expect(propose.rest(s, 'long')).toEqual([{ type: 'rest.taken', v: 1, payload: { kind: 'long' } }]);
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

  // Task 11 (phase 4 plan 11) — the sanctioned pact-awareness addition to `propose/rest.ts`, vendored
  // `ClassFeature.json` pk `srd-2024_warlock_pact-magic`: "You regain all expended Pact Magic spell
  // slots when you finish a Short or Long Rest." Unlike every other resource in this file (gated by
  // `reset:'shortRest'`/`'longRest'`), Pact Magic restores on EITHER rest kind — so this is emitted
  // unconditionally, not folded into the `sheet.resources` loop above.
  describe('pact slot restoration', () => {
    it('short rest emits slot.restored{pact:true, count: pact.count} — the full-restore form, mirroring resource.restored', () => {
      expect(propose.rest(pactSheet(), 'short')).toEqual([
        { type: 'rest.taken', v: 1, payload: { kind: 'short' } },
        { type: 'slot.restored', v: 1, payload: { level: 3, pact: true, count: 2 } },
      ]);
    });

    it('long rest ALSO emits slot.restored{pact:true, count} — the same full-restore form as short rest', () => {
      expect(propose.rest(pactSheet(), 'long')).toEqual([
        { type: 'rest.taken', v: 1, payload: { kind: 'long' } },
        { type: 'slot.restored', v: 1, payload: { level: 3, pact: true, count: 2 } },
      ]);
    });

    it('a sheet with no pact lane (no Warlock) emits no slot.restored at all — unchanged from before this task', () => {
      expect(propose.rest(baseSheet(), 'short')).toEqual([{ type: 'rest.taken', v: 1, payload: { kind: 'short' } }]);
    });

    it('short-rest round-trip through the real reducer: facts.pactSlots.used fully resets to 0', () => {
      const setup = [created, ev(2, 'slot.spent', { level: 3, pact: true, count: 2 })];
      const rules = mkRules();
      const proposed = propose.rest(pactSheet(), 'short');
      const final = reduce([...setup, ...wrapAll(3, proposed)], undefined, rules);
      expect(final.pactSlots).toEqual({ used: 0 });
    });

    it('long-rest round-trip: facts.pactSlots.used resets to 0 ALONGSIDE the regular slotsUsed reset (restoreAllSlots)', () => {
      const setup = [
        created,
        ev(2, 'slot.spent', { level: 1 }),
        ev(3, 'slot.spent', { level: 3, pact: true, count: 2 }),
      ];
      const rules = mkRules();
      const proposed = propose.rest(pactSheet(), 'long');
      const final = reduce([...setup, ...wrapAll(4, proposed)], undefined, rules);
      expect(final.pactSlots).toEqual({ used: 0 });
      expect(final.slotsUsed).toEqual({});
    });

    it('regular slots stay long-rest-only, UNCHANGED by this task: a short rest never clears facts.slotsUsed', () => {
      const setup = [created, ev(2, 'slot.spent', { level: 1 })];
      const rules = mkRules();
      const proposed = propose.rest(pactSheet(), 'short');
      const final = reduce([...setup, ...wrapAll(3, proposed)], undefined, rules);
      expect(final.slotsUsed).toEqual({ 1: 1 });
    });
  });
});
