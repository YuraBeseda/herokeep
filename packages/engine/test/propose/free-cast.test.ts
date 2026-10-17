import { describe, expect, it } from 'vitest';
import type { Sheet } from '../../src/derive/sheet.ts';
import { propose } from '../../src/propose/index.ts';
import { reduce } from '../../src/reduce/reducer.ts';
import { baseSheet, captureProposeError, created, wrapAll } from './support.ts';

// Plan 13 task 4 — the free-cast lane (`spell.grant.uses`, surfaced as `sheet.freeCasts`).
// Review Focus 3: "Free-cast lane must not double-spend: casting Hunter's Mark via the free lane
// consumes the counter and NO slot; via a slot lane consumes the slot and NOT the counter." Plus: an
// empty counter refuses the lane, and a free cast happens at the entry's own (base) level only.

const ranger = 'core-mini:class/ranger';
const mark = 'core-mini:spell/hunters-mark';
const other = 'core-mini:spell/other';

const rangerSheet = (used = 0, max = 2): Sheet =>
  baseSheet({
    spellcasting: [
      {
        classId: ranger,
        ability: 'wis',
        dc: { value: 13, contributions: [] },
        attack: { value: 5, contributions: [] },
        slots: [
          { level: 1, max: 2, used: 0 },
          { level: 2, max: 1, used: 0 },
        ],
        preparation: 'prepared',
        prepared: [mark],
        alwaysPrepared: [mark],
        known: [],
        ritual: false,
      },
    ],
    resources: [
      {
        id: 'favored-enemy',
        name: 'Favored Enemy',
        max: { value: max, contributions: [] },
        used,
        reset: 'longRest',
        display: 'pips',
        source: 'core-mini:feature/favored-enemy',
      },
    ],
    freeCasts: [{ spellId: mark, resourceId: 'favored-enemy', level: 1 }],
  });

const codes = (fn: () => unknown) => captureProposeError(fn).diagnostics.map((d) => d.code);

describe('propose.cast — free-cast lane (Review Focus 3)', () => {
  it('the free lane drafts spell.cast{slotUsed:false} at the entry level plus resource.spent for the counter', () => {
    expect(propose.cast(rangerSheet(), mark, { level: 1, concentration: true, freeResource: 'favored-enemy' })).toEqual(
      [
        { type: 'spell.cast', v: 1, payload: { spellId: mark, level: 1, slotUsed: false, concentration: true } },
        { type: 'resource.spent', v: 1, payload: { resourceId: 'favored-enemy' } },
      ],
    );
  });

  it('free lane through the real reducer: the counter is spent and NO slot is', () => {
    const proposed = propose.cast(rangerSheet(), mark, {
      level: 1,
      concentration: false,
      freeResource: 'favored-enemy',
    });
    const facts = reduce([created, ...wrapAll(2, proposed)]);
    expect(facts.resourcesUsed).toEqual({ 'favored-enemy': 1 });
    expect(facts.slotsUsed).toEqual({});
    expect(facts.pactSlots).toEqual({ used: 0 });
  });

  it('slot lane through the real reducer: the slot is spent and NOT the counter (same sheet, free cast on offer)', () => {
    const proposed = propose.cast(rangerSheet(), mark, { level: 1, concentration: false });
    expect(proposed).toEqual([{ type: 'spell.cast', v: 1, payload: { spellId: mark, level: 1 } }]);
    const facts = reduce([created, ...wrapAll(2, proposed)]);
    expect(facts.slotsUsed).toEqual({ 1: 1 });
    expect(facts.resourcesUsed).toEqual({});
  });

  it('an upcast through a slot lane also leaves the counter alone', () => {
    const facts = reduce([
      created,
      ...wrapAll(2, propose.cast(rangerSheet(), mark, { level: 2, concentration: false })),
    ]);
    expect(facts.slotsUsed).toEqual({ 2: 1 });
    expect(facts.resourcesUsed).toEqual({});
  });

  it('an empty counter refuses the free lane with resource.none-left (no events)', () => {
    expect(
      codes(() =>
        propose.cast(rangerSheet(2, 2), mark, { level: 1, concentration: false, freeResource: 'favored-enemy' }),
      ),
    ).toEqual(['resource.none-left']);
    // ...while the slot lane is still open.
    expect(propose.cast(rangerSheet(2, 2), mark, { level: 1, concentration: false })).toHaveLength(1);
  });

  it('refuses spell.free-cast-unavailable for a spell or resource with no matching free cast', () => {
    expect(
      codes(() =>
        propose.cast(rangerSheet(), other, { level: 1, concentration: false, freeResource: 'favored-enemy' }),
      ),
    ).toEqual(['spell.free-cast-unavailable']);
    expect(
      codes(() => propose.cast(rangerSheet(), mark, { level: 1, concentration: false, freeResource: 'wild-shape' })),
    ).toEqual(['spell.free-cast-unavailable']);
  });

  it('no upcast: a free cast at any level other than the entry level is refused', () => {
    expect(
      codes(() => propose.cast(rangerSheet(), mark, { level: 2, concentration: false, freeResource: 'favored-enemy' })),
    ).toEqual(['spell.free-cast-unavailable']);
  });

  it('contradictory lanes are refused: free + pact, free + useSlot:true', () => {
    expect(
      codes(() =>
        propose.cast(rangerSheet(), mark, {
          level: 1,
          concentration: false,
          freeResource: 'favored-enemy',
          pact: true,
        }),
      ),
    ).toEqual(['spell.free-cast-unavailable']);
    expect(
      codes(() =>
        propose.cast(rangerSheet(), mark, {
          level: 1,
          concentration: false,
          freeResource: 'favored-enemy',
          useSlot: true,
        }),
      ),
    ).toEqual(['spell.free-cast-unavailable']);
  });

  it('a sheet with no freeCasts at all refuses the free lane', () => {
    const rest = rangerSheet();
    delete rest.freeCasts;
    expect(
      codes(() => propose.cast(rest, mark, { level: 1, concentration: false, freeResource: 'favored-enemy' })),
    ).toEqual(['spell.free-cast-unavailable']);
  });
});
