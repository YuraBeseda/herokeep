import { describe, expect, it } from 'vitest';
import { EntitySchema } from '../src/pack/entity.ts';

// Plan 13 task 6 (ruling 7, controller-approved additive touch): `item.charges.regain` — the dice
// an item regains when its reset fires ("regains 1d6 + 1 expended charges daily at dawn"). Absent =
// the pre-existing full-restore behavior. Dice only (`DiceSchema`); refused on `reset:'never'`,
// since a resource that never resets can never regain anything.

const wand = (charges: unknown) => ({
  id: 'srd-5e-2024:item/wand-of-magic-missiles',
  type: 'item',
  name: 'Wand of Magic Missiles',
  category: 'magic',
  charges,
});

describe('item charges.regain', () => {
  it('accepts a dice regain on a resetting item', () => {
    const r = EntitySchema.safeParse(wand({ max: '7', reset: 'dawn', regain: '1d6+1' }));
    expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
  });

  it('still accepts charges without regain (the full-restore form, unchanged)', () => {
    expect(EntitySchema.safeParse(wand({ max: '3', reset: 'dawn' })).success).toBe(true);
  });

  it('rejects a non-dice regain', () => {
    expect(EntitySchema.safeParse(wand({ max: '7', reset: 'dawn', regain: 'all' })).success).toBe(false);
    expect(EntitySchema.safeParse(wand({ max: '7', reset: 'dawn', regain: '2' })).success).toBe(false);
  });

  it("rejects a regain on a reset:'never' item", () => {
    expect(EntitySchema.safeParse(wand({ max: '12', reset: 'never', regain: '1d6' })).success).toBe(false);
  });
});
