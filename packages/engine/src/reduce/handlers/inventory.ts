import {
  type CurrencyChanged,
  type ItemAdded,
  type ItemAttuned,
  type ItemEquipped,
  type ItemRemoved,
  type ItemUnattuned,
  type ItemUnequipped,
  type ItemUpdated,
  type OverrideApplied,
} from '@hk/protocol';
import { type Facts, type InventoryEntry, requireCreated } from '../facts.ts';
import type { Handler } from '../reducer.ts';

const DENOMINATIONS = ['cp', 'sp', 'ep', 'gp', 'pp'] as const;

/** Shared by equip/unequip/attune/unattune: all four act on an existing inventory entry. */
function requireInstance(f: Facts, instanceId: string): string | undefined {
  return f.inventory.some((i) => i.instanceId === instanceId) ? undefined : 'unknown-instance';
}

function setFlag(f: Facts, instanceId: string, patch: Partial<Pick<InventoryEntry, 'equipped' | 'attuned'>>): Facts {
  return { ...f, inventory: f.inventory.map((i) => (i.instanceId === instanceId ? { ...i, ...patch } : i)) };
}

export const HANDLERS: Record<string, Handler> = {
  'item.added@1': (f, e) => {
    const p = e.payload as ItemAdded;
    const skip = requireCreated(f);
    if (skip) return skip;
    if (f.inventory.some((i) => i.instanceId === p.instanceId)) return 'duplicate-instance';
    const entry: InventoryEntry = {
      instanceId: p.instanceId,
      qty: p.qty,
      equipped: false,
      attuned: false,
      // `itemId` is absent for a fully custom (homebrew) item — controller ruling: inventory
      // entries don't require a pack entity.
      ...(p.itemId !== undefined ? { itemId: p.itemId } : {}),
      ...(p.name !== undefined ? { name: p.name } : {}),
      ...(p.custom !== undefined ? { custom: p.custom } : {}),
    };
    return { ...f, inventory: [...f.inventory, entry] };
  },

  // No `qty` removes the entry outright; a `qty` decrements it, removing the entry once it
  // reaches <= 0 (never goes negative). An unknown instanceId is a silent no-op either way —
  // nothing to remove, same idiom as `note.removed@1` (handlers/identity.ts).
  'item.removed@1': (f, e) => {
    const p = e.payload as ItemRemoved;
    const skip = requireCreated(f);
    if (skip) return skip;
    if (p.qty === undefined) {
      return { ...f, inventory: f.inventory.filter((i) => i.instanceId !== p.instanceId) };
    }
    const qty = p.qty;
    const inventory = f.inventory
      .map((i): InventoryEntry => (i.instanceId === p.instanceId ? { ...i, qty: i.qty - qty } : i))
      .filter((i) => i.instanceId !== p.instanceId || i.qty > 0);
    return { ...f, inventory };
  },

  // `slot` is accepted per the protocol payload but intentionally not stored — `InventoryEntry`
  // has no slot field (same intentional-drop pattern as `condition.added`'s `until` in
  // handlers/vitals.ts); slot bookkeeping is derive/UI's concern, not the reducer's.
  'item.equipped@1': (f, e) => {
    const p = e.payload as ItemEquipped;
    const skip = requireCreated(f) ?? requireInstance(f, p.instanceId);
    if (skip) return skip;
    return setFlag(f, p.instanceId, { equipped: true });
  },

  'item.unequipped@1': (f, e) => {
    const p = e.payload as ItemUnequipped;
    const skip = requireCreated(f) ?? requireInstance(f, p.instanceId);
    if (skip) return skip;
    return setFlag(f, p.instanceId, { equipped: false });
  },

  // Attunement's max-of-3 limit is a UI-enforced proposal concern (doc-02), not a reducer
  // invariant — the reducer applies attune unconditionally once the instance exists.
  'item.attuned@1': (f, e) => {
    const p = e.payload as ItemAttuned;
    const skip = requireCreated(f) ?? requireInstance(f, p.instanceId);
    if (skip) return skip;
    return setFlag(f, p.instanceId, { attuned: true });
  },

  'item.unattuned@1': (f, e) => {
    const p = e.payload as ItemUnattuned;
    const skip = requireCreated(f) ?? requireInstance(f, p.instanceId);
    if (skip) return skip;
    return setFlag(f, p.instanceId, { attuned: false });
  },

  // Merges only the fields the payload provides (the `note.updated@1` idiom, handlers/identity.ts)
  // — an unknown instanceId is a silent no-op, not a skip.
  'item.updated@1': (f, e) => {
    const p = e.payload as ItemUpdated;
    const skip = requireCreated(f);
    if (skip) return skip;
    const inventory = f.inventory.map((i): InventoryEntry =>
      i.instanceId === p.instanceId
        ? {
            ...i,
            ...(p.name !== undefined ? { name: p.name } : {}),
            ...(p.notes !== undefined ? { notes: p.notes } : {}),
            ...(p.qty !== undefined ? { qty: p.qty } : {}),
          }
        : i,
    );
    return { ...f, inventory };
  },

  // Each denomination floors independently at 0 — a delta that would drive e.g. `sp` negative
  // clamps only `sp`, leaving the other four denominations' deltas unaffected.
  'currency.changed@1': (f, e) => {
    const p = e.payload as CurrencyChanged;
    const skip = requireCreated(f);
    if (skip) return skip;
    const currency = { ...f.currency };
    for (const denom of DENOMINATIONS) {
      const delta = p[denom];
      if (delta !== undefined) currency[denom] = Math.max(0, currency[denom] + delta);
    }
    return { ...f, currency };
  },

  // Always appends — a later override on the same `path` supersedes an earlier one only at
  // DERIVE time (which reads the log and picks the winner); the reducer's log keeps every entry.
  'override.applied@1': (f, e) => {
    const p = e.payload as OverrideApplied;
    const skip = requireCreated(f);
    if (skip) return skip;
    return { ...f, overrides: [...f.overrides, { path: p.path, value: p.value, reason: p.reason }] };
  },
};
