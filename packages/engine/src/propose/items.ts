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
 * Refuses attuning (not un-attuning) past `sheet.attunementMax` with `'attune.max'` — the
 * controller ruling's resolution for the reducer's deliberate permissiveness here (doc-02: the
 * cap is a UI/proposer concern, not a reducer invariant). Re-attuning an already-attuned instance
 * is always a no-op allowed through (it doesn't raise the attuned count).
 */
export function attune(sheet: Sheet, instanceId: string, attuned: boolean): ProposedEvent[] {
  if (!attuned) return [mk('item.unattuned', { instanceId } satisfies ItemUnattuned)];
  const already = sheet.inventory.find((i) => i.instanceId === instanceId)?.attuned ?? false;
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
