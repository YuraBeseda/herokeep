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

const sword = '018f6d2e-7b1a-7c3d-9e4f-aaaaaaaaaaa1';
const shield = '018f6d2e-7b1a-7c3d-9e4f-aaaaaaaaaaa2';
const ring = '018f6d2e-7b1a-7c3d-9e4f-aaaaaaaaaaa3';
const ghost = '018f6d2e-7b1a-7c3d-9e4f-000000000ff'; // never added
const longsword = 'core-mini:item/longsword';

describe('inventory/currency/override handlers: not-created skip (guard table)', () => {
  const guarded: [type: string, payload: unknown][] = [
    ['item.added', { instanceId: sword, itemId: longsword, qty: 1 }],
    ['item.removed', { instanceId: sword }],
    ['item.equipped', { instanceId: sword }],
    ['item.unequipped', { instanceId: sword }],
    ['item.attuned', { instanceId: sword }],
    ['item.unattuned', { instanceId: sword }],
    ['item.updated', { instanceId: sword, name: 'x' }],
    ['currency.changed', { gp: 1 }],
    ['override.applied', { path: 'x', value: 1, reason: 'r' }],
  ];

  it.each(guarded)('%s is skipped with reason not-created before character.created', (type, payload) => {
    const f = reduce([ev(2, type, payload)]);
    expect(f.skipped).toEqual([{ eventId: id(2), reason: 'not-created' }]);
  });
});

describe('item.added', () => {
  it('appends an InventoryEntry defaulting equipped/attuned to false', () => {
    const f = reduce([created, ev(2, 'item.added', { instanceId: sword, itemId: longsword, qty: 1 })]);
    expect(f.inventory).toEqual([{ instanceId: sword, itemId: longsword, qty: 1, equipped: false, attuned: false }]);
  });

  it('accepts a fully custom item with no itemId, keeping name and custom data', () => {
    const f = reduce([
      created,
      ev(2, 'item.added', { instanceId: sword, qty: 2, name: 'Grandpa’s Cane', custom: { magic: true } }),
    ]);
    expect(f.inventory).toEqual([
      { instanceId: sword, qty: 2, equipped: false, attuned: false, name: 'Grandpa’s Cane', custom: { magic: true } },
    ]);
  });

  it('a duplicate instanceId skips with reason duplicate-instance, leaving inventory untouched', () => {
    const setup = [
      ev(2, 'item.added', { instanceId: sword, itemId: longsword, qty: 1 }),
      ev(3, 'item.added', { instanceId: sword, itemId: longsword, qty: 5 }),
    ];
    const f = reduce([created, ...setup]);
    expect(f.inventory).toEqual([{ instanceId: sword, itemId: longsword, qty: 1, equipped: false, attuned: false }]);
    expect(f.skipped).toEqual([{ eventId: id(3), reason: 'duplicate-instance' }]);
  });
});

describe('item.removed', () => {
  it('with no qty removes the entry outright', () => {
    const setup = [
      ev(2, 'item.added', { instanceId: sword, itemId: longsword, qty: 1 }),
      ev(3, 'item.added', { instanceId: shield, itemId: 'core-mini:item/shield', qty: 1 }),
      ev(4, 'item.removed', { instanceId: sword }),
    ];
    const f = reduce([created, ...setup]);
    expect(f.inventory.map((i) => i.instanceId)).toEqual([shield]);
  });

  it('with qty decrements, keeping the entry above 0', () => {
    const setup = [
      ev(2, 'item.added', { instanceId: sword, qty: 5 }),
      ev(3, 'item.removed', { instanceId: sword, qty: 2 }),
    ];
    const f = reduce([created, ...setup]);
    expect(f.inventory).toEqual([{ instanceId: sword, qty: 3, equipped: false, attuned: false }]);
  });

  it('decrementing to exactly 0 removes the entry', () => {
    const setup = [
      ev(2, 'item.added', { instanceId: sword, qty: 3 }),
      ev(3, 'item.removed', { instanceId: sword, qty: 3 }),
    ];
    const f = reduce([created, ...setup]);
    expect(f.inventory).toEqual([]);
  });

  it('decrementing past 0 also removes the entry (does not go negative)', () => {
    const setup = [
      ev(2, 'item.added', { instanceId: sword, qty: 2 }),
      ev(3, 'item.removed', { instanceId: sword, qty: 9 }),
    ];
    const f = reduce([created, ...setup]);
    expect(f.inventory).toEqual([]);
  });

  it('an unknown instanceId is a no-op, whether or not qty is given', () => {
    const setup = [ev(2, 'item.added', { instanceId: sword, qty: 1 })];
    const noQty = reduce([created, ...setup, ev(3, 'item.removed', { instanceId: ghost })]);
    expect(noQty.inventory).toEqual([{ instanceId: sword, qty: 1, equipped: false, attuned: false }]);
    const withQty = reduce([created, ...setup, ev(3, 'item.removed', { instanceId: ghost, qty: 1 })]);
    expect(withQty.inventory).toEqual([{ instanceId: sword, qty: 1, equipped: false, attuned: false }]);
  });
});

describe('item.equipped / item.unequipped', () => {
  it('equipped flips the flag true', () => {
    const setup = [ev(2, 'item.added', { instanceId: sword, qty: 1 }), ev(3, 'item.equipped', { instanceId: sword })];
    const f = reduce([created, ...setup]);
    expect(f.inventory[0]!.equipped).toBe(true);
  });

  it('accepts a slot but does not store it on the entry', () => {
    const setup = [
      ev(2, 'item.added', { instanceId: sword, qty: 1 }),
      ev(3, 'item.equipped', { instanceId: sword, slot: 'main-hand' }),
    ];
    const f = reduce([created, ...setup]);
    expect(f.inventory).toEqual([{ instanceId: sword, qty: 1, equipped: true, attuned: false }]);
  });

  it('unequipped flips the flag back false', () => {
    const setup = [
      ev(2, 'item.added', { instanceId: sword, qty: 1 }),
      ev(3, 'item.equipped', { instanceId: sword }),
      ev(4, 'item.unequipped', { instanceId: sword }),
    ];
    const f = reduce([created, ...setup]);
    expect(f.inventory[0]!.equipped).toBe(false);
  });

  it('equipped on an unknown instance skips with reason unknown-instance', () => {
    const f = reduce([created, ev(2, 'item.equipped', { instanceId: ghost })]);
    expect(f.skipped).toEqual([{ eventId: id(2), reason: 'unknown-instance' }]);
  });

  it('unequipped on an unknown instance skips with reason unknown-instance', () => {
    const f = reduce([created, ev(2, 'item.unequipped', { instanceId: ghost })]);
    expect(f.skipped).toEqual([{ eventId: id(2), reason: 'unknown-instance' }]);
  });
});

describe('item.attuned / item.unattuned', () => {
  it('attuned flips the flag true', () => {
    const setup = [ev(2, 'item.added', { instanceId: ring, qty: 1 }), ev(3, 'item.attuned', { instanceId: ring })];
    const f = reduce([created, ...setup]);
    expect(f.inventory[0]!.attuned).toBe(true);
  });

  it('unattuned flips the flag back false', () => {
    const setup = [
      ev(2, 'item.added', { instanceId: ring, qty: 1 }),
      ev(3, 'item.attuned', { instanceId: ring }),
      ev(4, 'item.unattuned', { instanceId: ring }),
    ];
    const f = reduce([created, ...setup]);
    expect(f.inventory[0]!.attuned).toBe(false);
  });

  it('does NOT enforce the max-3 attunement limit — a 4th attune still succeeds, no skips', () => {
    const ring2 = '018f6d2e-7b1a-7c3d-9e4f-aaaaaaaaaaa4';
    const ring3 = '018f6d2e-7b1a-7c3d-9e4f-aaaaaaaaaaa5';
    const ring4 = '018f6d2e-7b1a-7c3d-9e4f-aaaaaaaaaaa6';
    const setup = [
      ev(2, 'item.added', { instanceId: ring, qty: 1 }),
      ev(3, 'item.added', { instanceId: ring2, qty: 1 }),
      ev(4, 'item.added', { instanceId: ring3, qty: 1 }),
      ev(5, 'item.added', { instanceId: ring4, qty: 1 }),
      ev(6, 'item.attuned', { instanceId: ring }),
      ev(7, 'item.attuned', { instanceId: ring2 }),
      ev(8, 'item.attuned', { instanceId: ring3 }),
      ev(9, 'item.attuned', { instanceId: ring4 }),
    ];
    const f = reduce([created, ...setup]);
    expect(f.inventory.filter((i) => i.attuned)).toHaveLength(4);
    expect(f.skipped).toEqual([]);
  });

  it('attuned on an unknown instance skips with reason unknown-instance', () => {
    const f = reduce([created, ev(2, 'item.attuned', { instanceId: ghost })]);
    expect(f.skipped).toEqual([{ eventId: id(2), reason: 'unknown-instance' }]);
  });

  it('unattuned on an unknown instance skips with reason unknown-instance', () => {
    const f = reduce([created, ev(2, 'item.unattuned', { instanceId: ghost })]);
    expect(f.skipped).toEqual([{ eventId: id(2), reason: 'unknown-instance' }]);
  });
});

describe('item.updated', () => {
  it('merges only the provided fields, leaving others untouched', () => {
    const setup = [
      ev(2, 'item.added', { instanceId: sword, itemId: longsword, qty: 1, name: 'Old Name' }),
      ev(3, 'item.updated', { instanceId: sword, notes: 'chipped blade' }),
    ];
    const f = reduce([created, ...setup]);
    expect(f.inventory).toEqual([
      {
        instanceId: sword,
        itemId: longsword,
        qty: 1,
        equipped: false,
        attuned: false,
        name: 'Old Name',
        notes: 'chipped blade',
      },
    ]);
  });

  it('updates name and qty together', () => {
    const setup = [
      ev(2, 'item.added', { instanceId: sword, qty: 1 }),
      ev(3, 'item.updated', { instanceId: sword, name: 'Renamed', qty: 4 }),
    ];
    const f = reduce([created, ...setup]);
    expect(f.inventory[0]).toMatchObject({ name: 'Renamed', qty: 4 });
  });

  it('an unknown instanceId is a no-op (same idiom as note.updated)', () => {
    const setup = [ev(2, 'item.added', { instanceId: sword, qty: 1 })];
    const f = reduce([created, ...setup, ev(3, 'item.updated', { instanceId: ghost, name: 'nope' })]);
    expect(f.inventory).toEqual([{ instanceId: sword, qty: 1, equipped: false, attuned: false }]);
  });
});

describe('currency.changed', () => {
  it('applies positive deltas per denomination', () => {
    const f = reduce([created, ev(2, 'currency.changed', { gp: 10, sp: 5 })]);
    expect(f.currency).toEqual({ cp: 0, sp: 5, ep: 0, gp: 10, pp: 0 });
  });

  it('applies negative deltas, subtracting', () => {
    const setup = [ev(2, 'currency.changed', { gp: 10 }), ev(3, 'currency.changed', { gp: -3 })];
    const f = reduce([created, ...setup]);
    expect(f.currency.gp).toBe(7);
  });

  it('floors each denomination at 0 independently', () => {
    const setup = [ev(2, 'currency.changed', { gp: 5, sp: 2 }), ev(3, 'currency.changed', { gp: -100, sp: -1 })];
    const f = reduce([created, ...setup]);
    expect(f.currency).toEqual({ cp: 0, sp: 1, ep: 0, gp: 0, pp: 0 });
  });

  it('omitted denominations are left untouched', () => {
    const setup = [ev(2, 'currency.changed', { pp: 2 }), ev(3, 'currency.changed', { gp: 3 })];
    const f = reduce([created, ...setup]);
    expect(f.currency).toEqual({ cp: 0, sp: 0, ep: 0, gp: 3, pp: 2 });
  });
});

describe('override.applied', () => {
  it('appends to Facts.overrides', () => {
    const f = reduce([created, ev(2, 'override.applied', { path: 'hp.max', value: 42, reason: 'homebrew feat' })]);
    expect(f.overrides).toEqual([{ path: 'hp.max', value: 42, reason: 'homebrew feat' }]);
  });

  it('a later override on the same path is appended, not merged or deduped — the log keeps all', () => {
    const setup = [
      ev(2, 'override.applied', { path: 'hp.max', value: 40, reason: 'first' }),
      ev(3, 'override.applied', { path: 'hp.max', value: 45, reason: 'second' }),
    ];
    const f = reduce([created, ...setup]);
    expect(f.overrides).toEqual([
      { path: 'hp.max', value: 40, reason: 'first' },
      { path: 'hp.max', value: 45, reason: 'second' },
    ]);
  });

  it('preserves insertion order across different paths', () => {
    const setup = [
      ev(2, 'override.applied', { path: 'ac', value: 18, reason: 'a' }),
      ev(3, 'override.applied', { path: 'hp.max', value: 40, reason: 'b' }),
      ev(4, 'override.applied', { path: 'speed', value: 35, reason: 'c' }),
    ];
    const f = reduce([created, ...setup]);
    expect(f.overrides.map((o) => o.path)).toEqual(['ac', 'hp.max', 'speed']);
  });
});
