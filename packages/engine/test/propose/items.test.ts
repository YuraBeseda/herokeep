import { describe, expect, it } from 'vitest';
import type { InventoryEntry } from '../../src/reduce/facts.ts';
import { propose } from '../../src/propose/index.ts';
import { baseSheet, captureProposeError } from './support.ts';

type SheetInventoryEntry = InventoryEntry & { resolved: boolean; attunementAllowed?: boolean };

const entry = (over: Partial<SheetInventoryEntry>): SheetInventoryEntry => ({
  instanceId: 'i0',
  qty: 1,
  equipped: false,
  attuned: false,
  resolved: true,
  ...over,
});

describe('propose.equip', () => {
  it('equipped:true emits item.equipped{instanceId}', () => {
    expect(propose.equip(baseSheet(), 'i1', true)).toEqual([
      { type: 'item.equipped', v: 1, payload: { instanceId: 'i1' } },
    ]);
  });

  it('equipped:false emits item.unequipped{instanceId}', () => {
    expect(propose.equip(baseSheet(), 'i1', false)).toEqual([
      { type: 'item.unequipped', v: 1, payload: { instanceId: 'i1' } },
    ]);
  });
});

describe('propose.attune', () => {
  it('attuned:true under the cap emits item.attuned{instanceId}', () => {
    const sheet = baseSheet({ attunementMax: 3, inventory: [entry({ instanceId: 'i1', attuned: true })] });
    expect(propose.attune(sheet, 'i2', true)).toEqual([{ type: 'item.attuned', v: 1, payload: { instanceId: 'i2' } }]);
  });

  it('refuses with "attune.max" once attunementMax attuned items are already attuned', () => {
    const sheet = baseSheet({
      attunementMax: 3,
      inventory: [
        entry({ instanceId: 'i1', attuned: true }),
        entry({ instanceId: 'i2', attuned: true }),
        entry({ instanceId: 'i3', attuned: true }),
        entry({ instanceId: 'i4', attuned: false }),
      ],
    });
    const err = captureProposeError(() => propose.attune(sheet, 'i4', true));
    expect(err.diagnostics[0]?.code).toBe('attune.max');
  });

  it('re-attuning an already-attuned instance is a no-op allowed through even at the cap', () => {
    const sheet = baseSheet({
      attunementMax: 3,
      inventory: [
        entry({ instanceId: 'i1', attuned: true }),
        entry({ instanceId: 'i2', attuned: true }),
        entry({ instanceId: 'i3', attuned: true }),
      ],
    });
    expect(propose.attune(sheet, 'i1', true)).toEqual([{ type: 'item.attuned', v: 1, payload: { instanceId: 'i1' } }]);
  });

  it('attuned:false is always allowed, even at the cap', () => {
    const sheet = baseSheet({
      attunementMax: 3,
      inventory: [
        entry({ instanceId: 'i1', attuned: true }),
        entry({ instanceId: 'i2', attuned: true }),
        entry({ instanceId: 'i3', attuned: true }),
      ],
    });
    expect(propose.attune(sheet, 'i3', false)).toEqual([
      { type: 'item.unattuned', v: 1, payload: { instanceId: 'i3' } },
    ]);
  });

  // `item.attunement.by` enforcement (survey fact, phase 4 plan 11 task 4): `attunementAllowed` is
  // pre-resolved onto the inventory entry at derive time (derive/index.ts's
  // `attunementPredicateContext`) — propose only ever reads the boolean off `Sheet`, never a
  // `ContentIndex` (propose/index.ts's own header comment).
  it('refuses with "attune.by" when the entry\'s attunementAllowed is false', () => {
    const sheet = baseSheet({
      attunementMax: 3,
      inventory: [entry({ instanceId: 'i1', attuned: false, attunementAllowed: false })],
    });
    const err = captureProposeError(() => propose.attune(sheet, 'i1', true));
    expect(err.diagnostics[0]?.code).toBe('attune.by');
  });

  it('allows attuning when attunementAllowed is true', () => {
    const sheet = baseSheet({
      attunementMax: 3,
      inventory: [entry({ instanceId: 'i1', attuned: false, attunementAllowed: true })],
    });
    expect(propose.attune(sheet, 'i1', true)).toEqual([{ type: 'item.attuned', v: 1, payload: { instanceId: 'i1' } }]);
  });

  it('allows attuning when attunementAllowed is absent (no attunement.by on the item at all)', () => {
    const sheet = baseSheet({ attunementMax: 3, inventory: [entry({ instanceId: 'i1', attuned: false })] });
    expect(propose.attune(sheet, 'i1', true)).toEqual([{ type: 'item.attuned', v: 1, payload: { instanceId: 'i1' } }]);
  });

  it('un-attuning (attuned:false) is always allowed even when attunementAllowed is false', () => {
    const sheet = baseSheet({
      attunementMax: 3,
      inventory: [entry({ instanceId: 'i1', attuned: true, attunementAllowed: false })],
    });
    expect(propose.attune(sheet, 'i1', false)).toEqual([
      { type: 'item.unattuned', v: 1, payload: { instanceId: 'i1' } },
    ]);
  });

  it('the attunement.by refusal takes priority over the attune.max cap check', () => {
    const sheet = baseSheet({
      attunementMax: 3,
      inventory: [
        entry({ instanceId: 'i1', attuned: true }),
        entry({ instanceId: 'i2', attuned: true }),
        entry({ instanceId: 'i3', attuned: true }),
        entry({ instanceId: 'i4', attuned: false, attunementAllowed: false }),
      ],
    });
    const err = captureProposeError(() => propose.attune(sheet, 'i4', true));
    expect(err.diagnostics[0]?.code).toBe('attune.by'); // not 'attune.max', even though both conditions hold
  });
});

describe('propose.addItem', () => {
  it('a pack item with an explicit qty', () => {
    const events = propose.addItem(baseSheet(), { itemId: 'core-mini:item/rope', qty: 2 }, () => 'gen-1');
    expect(events).toEqual([
      { type: 'item.added', v: 1, payload: { instanceId: 'gen-1', itemId: 'core-mini:item/rope', qty: 2 } },
    ]);
  });

  it('a fully custom item defaults qty to 1 and omits itemId', () => {
    const events = propose.addItem(
      baseSheet(),
      { name: 'Homemade dagger', custom: { material: 'bone' } },
      () => 'gen-2',
    );
    expect(events).toEqual([
      {
        type: 'item.added',
        v: 1,
        payload: { instanceId: 'gen-2', qty: 1, name: 'Homemade dagger', custom: { material: 'bone' } },
      },
    ]);
  });

  it('calls newId() exactly once to source instanceId (keeps the engine UUID-free)', () => {
    let calls = 0;
    const newId = () => {
      calls++;
      return `gen-${calls}`;
    };
    propose.addItem(baseSheet(), { itemId: 'core-mini:item/rope' }, newId);
    expect(calls).toBe(1);
  });
});

describe('propose.currency', () => {
  it('forwards the given deltas as-is', () => {
    expect(propose.currency(baseSheet(), { gp: 5, sp: -2 })).toEqual([
      { type: 'currency.changed', v: 1, payload: { gp: 5, sp: -2 } },
    ]);
  });

  it('an empty delta object still emits an event with an empty payload', () => {
    expect(propose.currency(baseSheet(), {})).toEqual([{ type: 'currency.changed', v: 1, payload: {} }]);
  });
});
