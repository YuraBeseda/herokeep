import type {
  CurrencyChanged,
  ItemAdded,
  ItemAttuned,
  ItemEquipped,
  ItemUnattuned,
  ItemUnequipped,
} from '@hk/protocol';
import type { Sheet } from '../derive/sheet.ts';
import { error } from '../diagnostics.ts';
import type { Facts } from '../reduce/facts.ts';
import { ProposeError, type ProposedEvent } from './index.ts';

const mk = (type: string, payload: unknown): ProposedEvent => ({ type, v: 1, payload });

export function equip(_sheet: Sheet, instanceId: string, equipped: boolean): ProposedEvent[] {
  return equipped
    ? [mk('item.equipped', { instanceId } satisfies ItemEquipped)]
    : [mk('item.unequipped', { instanceId } satisfies ItemUnequipped)];
}

/**
 * Refuses attuning (not un-attuning) with two independent checks, in order:
 *
 * 1. `'attune.by'` (phase 4, plan 11 task 4 — survey fact "item.attunement.by NOT enforced
 *    anywhere"): when the item declares an `attunement.by` predicate, `Sheet.inventory[].
 *    attunementAllowed` is that predicate PRE-RESOLVED at derive time (derive/index.ts's
 *    `attunementPredicateContext` — this function never touches a `ContentIndex`, per this file's
 *    own header comment). `attunementAllowed === false` refuses; `true` or absent (no
 *    `attunement.by` on the item at all) both proceed. Checked BEFORE the cap so a player always
 *    learns the REAL reason an attune is impossible for an item they could never wear anyway, not a
 *    misleading "you're out of slots".
 * 2. `'attune.max'` past `sheet.attunementMax` — the controller ruling's resolution for the
 *    reducer's deliberate permissiveness here (doc-02: the cap is a UI/proposer concern, not a
 *    reducer invariant).
 *
 * Re-attuning an already-attuned instance is always a no-op allowed through the cap (it doesn't
 * raise the attuned count) — but NOT through the `attune.by` check, which is a property of the item
 * itself, independent of the character's current attuned count.
 */
export function attune(sheet: Sheet, instanceId: string, attuned: boolean): ProposedEvent[] {
  if (!attuned) return [mk('item.unattuned', { instanceId } satisfies ItemUnattuned)];
  const entry = sheet.inventory.find((i) => i.instanceId === instanceId);
  if (entry?.attunementAllowed === false) {
    throw new ProposeError([error('attune.by', "This item's attunement requirement is not met")]);
  }
  const already = entry?.attuned ?? false;
  const attunedCount = sheet.inventory.filter((i) => i.attuned).length;
  if (!already && attunedCount >= sheet.attunementMax) {
    throw new ProposeError([error('attune.max', `Cannot attune more than ${sheet.attunementMax} items`)]);
  }
  return [mk('item.attuned', { instanceId } satisfies ItemAttuned)];
}

/** `newId` keeps the engine UUID-free (doc-02); `qty` defaults to 1 (`ItemAddedV1.qty` is required, min 1). */
export function addItem(
  _sheet: Sheet,
  item: { itemId?: string; qty?: number; name?: string; custom?: Record<string, unknown> },
  newId: () => string,
): ProposedEvent[] {
  const payload: ItemAdded = {
    instanceId: newId(),
    qty: item.qty ?? 1,
    ...(item.itemId !== undefined ? { itemId: item.itemId } : {}),
    ...(item.name !== undefined ? { name: item.name } : {}),
    ...(item.custom !== undefined ? { custom: item.custom } : {}),
  };
  return [mk('item.added', payload)];
}

export function currency(_sheet: Sheet, deltas: Partial<Facts['currency']>): ProposedEvent[] {
  return [mk('currency.changed', { ...deltas } satisfies CurrencyChanged)];
}
