import { describe, expect, it } from 'vitest';
import { DiceSchema, RegainDiceSchema } from '../src/pack/common.ts';
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

  it('accepts a d3 regain (14 vendored items regain 1d3, e.g. wand-of-secrets, ring-of-evasion)', () => {
    const r = EntitySchema.safeParse(wand({ max: '3', reset: 'dawn', regain: '1d3' }));
    expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
  });

  it('RegainDiceSchema = DiceSchema plus d3 only; DiceSchema itself still refuses d3', () => {
    expect(RegainDiceSchema.safeParse('1d3').success).toBe(true);
    expect(DiceSchema.safeParse('1d3').success).toBe(false);
    for (const ok of ['1d4', '2d8+4', '4d6+2', '1d100-1']) {
      expect([ok, RegainDiceSchema.safeParse(ok).success]).toEqual([ok, DiceSchema.safeParse(ok).success]);
    }
    for (const bad of ['1d5', '1d2', 'd3', '1d3+', 'all']) expect(RegainDiceSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects a non-dice regain', () => {
    expect(EntitySchema.safeParse(wand({ max: '7', reset: 'dawn', regain: 'all' })).success).toBe(false);
    expect(EntitySchema.safeParse(wand({ max: '7', reset: 'dawn', regain: '2' })).success).toBe(false);
  });

  it("rejects a regain on a reset:'never' item", () => {
    expect(EntitySchema.safeParse(wand({ max: '12', reset: 'never', regain: '1d6' })).success).toBe(false);
  });
});
