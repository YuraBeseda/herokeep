import type { SlotSpent, SpellCast } from '@hk/protocol';
import type { Sheet } from '../derive/sheet.ts';
import { error } from '../diagnostics.ts';
import { ProposeError, type ProposedEvent } from './index.ts';

const mk = (type: string, payload: unknown): ProposedEvent => ({ type, v: 1, payload });

/** The first `SpellcastingBlock.slots` entry at `level`, across every active caster block. */
function slotEntry(sheet: Sheet, level: number): { level: number; max: number; used: number } | undefined {
  for (const block of sheet.spellcasting) {
    const entry = block.slots.find((s) => s.level === level);
    if (entry) return entry;
  }
  return undefined;
}

/** Refuses with `'slot.none-left'` when no slot exists at `level`, or every one is already used. */
export function spendSlot(sheet: Sheet, level: number): ProposedEvent[] {
  const entry = slotEntry(sheet, level);
  if (!entry || entry.used >= entry.max) {
    throw new ProposeError([error('slot.none-left', `No level ${level} spell slots remain`)]);
  }
  return [mk('slot.spent', { level } satisfies SlotSpent)];
}

/**
 * Documented deviation from the brief's literal `opts` shape: the brief says `cast` "folds
 * `spell.cast` with concentration flag read from the spell entity" — but `Sheet` (this family's
 * only input besides `spellId`/`opts`) carries no per-spell entity data (`SpellcastingBlock` only
 * lists known/prepared spell IDs, never full entities — see derive/spellcasting.ts), and the
 * brief's own `cast` signature takes no `ContentIndex` either. Reading the spell entity is
 * therefore impossible from inside this function as literally specified. Resolution (same spirit
 * as the controller ruling's `attunementMax`/`currentWasMax` additions, but here a per-CALL value
 * can't be a `Sheet` field): `opts` gains one additive optional field, `concentration?: boolean`,
 * which the caller (the only layer that has BOTH the `Sheet` and the `ContentIndex`) supplies by
 * reading `spellEntity.concentration` itself. Omitting it behaves exactly as before: the reducer's
 * `spell.cast` handler already treats a missing `concentration` as "leave any existing
 * concentration untouched" (handlers/casting.ts).
 *
 * Slot consumption: consumes a slot at `opts.level` unless `opts.useSlot === false` (mirrors the
 * reducer's own default), refusing with `'slot.none-left'` under the same rule as `spendSlot`. A
 * cantrip (level 0) has no slot table entry at all, so the CALLER must pass `useSlot: false` for
 * one — this matches the reducer's own worked example ("slotUsed: false ... e.g. a cantrip").
 */
export function cast(
  sheet: Sheet,
  spellId: string,
  opts: { level: number; useSlot?: boolean; concentration?: boolean },
): ProposedEvent[] {
  const consumesSlot = opts.useSlot !== false;
  if (consumesSlot) {
    const entry = slotEntry(sheet, opts.level);
    if (!entry || entry.used >= entry.max) {
      throw new ProposeError([error('slot.none-left', `No level ${opts.level} spell slots remain`)]);
    }
  }
  const payload: SpellCast = {
    spellId,
    level: opts.level,
    ...(opts.useSlot !== undefined ? { slotUsed: opts.useSlot } : {}),
    ...(opts.concentration !== undefined ? { concentration: opts.concentration } : {}),
  };
  return [mk('spell.cast', payload)];
}
