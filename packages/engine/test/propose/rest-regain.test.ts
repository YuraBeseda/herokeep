import type { Event, Pack } from '@hk/protocol';
import { describe, expect, it } from 'vitest';
import { createContentIndex } from '../../src/content/index.ts';
import { derive } from '../../src/derive/index.ts';
import type { ResourceView } from '../../src/derive/resources.ts';
import type { SystemRules } from '../../src/reduce/facts.ts';
import { reduce } from '../../src/reduce/reducer.ts';
import { propose } from '../../src/propose/index.ts';
import { loadFixturePack } from '../support/fixtures.ts';
import { baseSheet, captureProposeError, created, ev, wrapAll } from './support.ts';

// Plan 13 task 6 (ruling 7 + controller rulings a/b/c): rolled rest-regain. An item whose
// `charges.regain` is dice (vendored MagicItem.json pk `srd-2024_wand-of-magic-missiles`: "This wand
// has 7 charges … The wand regains 1d6 + 1 expended charges daily at dawn") no longer restores in
// full on a long rest: the CALLER rolls (the hit-die precedent — the engine never rolls) and passes
// the total; `propose.rest` records it as `resource.restored.count`, so the amount is DATA in the
// event and replay needs nothing but the log (Review Focus 5). The reducer is unchanged — its
// existing `max(0, used − count)` floor is the "capped at max".

const wandId = 'core-mini:item/wand-of-sparks';
const instance = '44444444-4444-7444-8444-444444444441';
const key = `item:${instance}`;

/** core-mini with the wand re-shaped as a Wand of Magic Missiles (7 charges, regains 1d6+1 at dawn). */
function packWithRolledWand(): Pack {
  const pack = loadFixturePack('core-mini');
  return {
    ...pack,
    entities: pack.entities.map((e) =>
      e.id === wandId && e.type === 'item' ? { ...e, charges: { max: '7', reset: 'dawn', regain: '1d6+1' } } : e,
    ),
  };
}

const rules: SystemRules = {
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
};

const wandSetup = (spent: number): Event[] => [
  created,
  ev(2, 'item.added', { instanceId: instance, itemId: wandId, qty: 1 }),
  ev(3, 'item.equipped', { instanceId: instance }),
  ev(4, 'resource.spent', { resourceId: key, count: spent }),
];

const rolledWand = (overrides: Partial<ResourceView> = {}): ResourceView => ({
  id: key,
  name: 'Wand',
  max: { value: 7, contributions: [] },
  used: 6,
  reset: 'dawn',
  display: 'number',
  source: wandId,
  regain: '1d6+1',
  ...overrides,
});

describe('sheet resources: charges.regain', () => {
  it('carries the item regain dice onto its ResourceView', () => {
    const index = createContentIndex([packWithRolledWand()]);
    const sheet = derive(reduce(wandSetup(6), undefined, rules), index, rules);
    expect(sheet.resources).toEqual([expect.objectContaining({ id: key, used: 6, regain: '1d6+1' })]);
  });

  it('is ABSENT on a charged item without regain (the full-restore form)', () => {
    const index = createContentIndex([loadFixturePack('core-mini')]);
    const sheet = derive(reduce(wandSetup(1), undefined, rules), index, rules);
    expect(sheet.resources).toHaveLength(1);
    expect('regain' in sheet.resources[0]!).toBe(false);
  });
});

describe('propose.rest: rolled regain', () => {
  it('long rest records the caller-rolled total as resource.restored.count', () => {
    const sheet = baseSheet({ resources: [rolledWand()] });
    expect(propose.rest(sheet, 'long', undefined, { [key]: 4 })).toEqual([
      { type: 'rest.taken', v: 1, payload: { kind: 'long' } },
      { type: 'resource.restored', v: 1, payload: { resourceId: key, count: 4 } },
    ]);
  });

  it('a short rest never touches the dawn item and needs no roll', () => {
    const sheet = baseSheet({ resources: [rolledWand()] });
    expect(propose.rest(sheet, 'short', undefined, {})).toEqual([
      { type: 'rest.taken', v: 1, payload: { kind: 'short' } },
    ]);
  });

  it('refuses a long rest without a roll for a dice-regain resource (no silent full restore)', () => {
    const sheet = baseSheet({ resources: [rolledWand()] });
    const err = captureProposeError(() => propose.rest(sheet, 'long', undefined, {}));
    expect(err.diagnostics.map((d) => [d.code, d.entityId])).toEqual([['rest.regain-roll-missing', key]]);
  });

  it('refuses a total the regain dice cannot produce (1d6+1 spans 2..7)', () => {
    const sheet = baseSheet({ resources: [rolledWand()] });
    for (const bad of [1, 8, 2.5]) {
      const err = captureProposeError(() => propose.rest(sheet, 'long', undefined, { [key]: bad }));
      expect(err.diagnostics.map((d) => d.code)).toEqual(['rest.regain-roll-invalid']);
    }
  });

  it('accepts d3 regain dice (14 SRD items regain 1d3, e.g. Wand of Secrets): 1..3 only', () => {
    const sheet = baseSheet({ resources: [rolledWand({ max: { value: 3, contributions: [] }, regain: '1d3' })] });
    expect(propose.rest(sheet, 'long', undefined, { [key]: 3 }).at(-1)!.payload).toEqual({ resourceId: key, count: 3 });
    const err = captureProposeError(() => propose.rest(sheet, 'long', undefined, { [key]: 4 }));
    expect(err.diagnostics.map((d) => d.code)).toEqual(['rest.regain-roll-invalid']);
  });

  it('resources without regain keep the byte-identical full-restore event, even if a stray roll is passed', () => {
    const plain = rolledWand({ id: 'item:11111111-1111-4111-8111-aaaaaaaaaaaa' });
    delete plain.regain;
    const sheet = baseSheet({ resources: [plain] });
    expect(propose.rest(sheet, 'long', undefined, { [plain.id]: 5 })).toEqual([
      { type: 'rest.taken', v: 1, payload: { kind: 'long' } },
      { type: 'resource.restored', v: 1, payload: { resourceId: plain.id } },
    ]);
  });
});

describe('Review Focus 5: rolled regain replays from the event log alone', () => {
  it('the persisted tx reproduces the exact restored amount with no RNG, no sheet and no content', () => {
    const index = createContentIndex([packWithRolledWand()]);
    const setup = wandSetup(6);
    const sheet = derive(reduce(setup, undefined, rules), index, rules);
    const log = [...setup, ...wrapAll(5, propose.rest(sheet, 'long', undefined, { [key]: 4 }))];

    // A fresh replay over the stored log (JSON round-trip = what a device restores from sync):
    const replayed = reduce(JSON.parse(JSON.stringify(log)) as Event[], undefined, rules);
    expect(replayed.resourcesUsed[key]).toBe(2); // 6 spent − 4 rolled
    expect(reduce(log, undefined, rules)).toEqual(replayed); // deterministic: same log, same facts
    expect(derive(replayed, index, rules).resources[0]).toMatchObject({ id: key, used: 2, max: { value: 7 } });
  });

  it('the cap holds when the roll exceeds the expended charges (floors at 0 used, i.e. max charges)', () => {
    const index = createContentIndex([packWithRolledWand()]);
    const setup = wandSetup(2);
    const sheet = derive(reduce(setup, undefined, rules), index, rules);
    const log = [...setup, ...wrapAll(5, propose.rest(sheet, 'long', undefined, { [key]: 7 }))];
    expect(log.at(-1)!.payload).toEqual({ resourceId: key, count: 7 }); // the roll is recorded as rolled
    const replayed = reduce(log, undefined, rules);
    expect(replayed.resourcesUsed[key]).toBe(0);
    expect(derive(replayed, index, rules).resources[0]).toMatchObject({ used: 0, max: { value: 7 } });
  });

  it('legacy resource.restored events (with and without count) replay exactly as before', () => {
    const legacy: Event[] = [
      created,
      ev(2, 'resource.spent', { resourceId: 'second-wind', count: 3 }),
      ev(3, 'resource.spent', { resourceId: key, count: 5 }),
      ev(4, 'resource.restored', { resourceId: 'second-wind', count: 1 }),
      ev(5, 'resource.restored', { resourceId: key }),
      ev(6, 'resource.spent', { resourceId: key, count: 2 }),
      ev(7, 'resource.restored', { resourceId: key, count: 9 }),
    ];
    expect(reduce(legacy, undefined, rules).resourcesUsed).toEqual({ 'second-wind': 2, [key]: 0 });
  });
});
