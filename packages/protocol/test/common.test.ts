import { describe, expect, it } from 'vitest';
import { DiceOrFlatSchema, DiceSchema, FlatDiceSchema } from '../src/pack/common.ts';

describe('DiceSchema (ruling 6: unchanged)', () => {
  it('keeps parsing NdS(+/-M) strings byte-identically, including the legacy 0d4+1 hack', () => {
    for (const s of ['1d8', '2d6+3', '8d6', '1d4-1', '0d4+1']) {
      expect(DiceSchema.parse(s)).toBe(s);
    }
  });
});

describe('FlatDiceSchema (ruling 6: additive flat-amount variant)', () => {
  it('accepts a non-negative flat amount object', () => {
    expect(FlatDiceSchema.parse({ flat: 1 })).toEqual({ flat: 1 });
    expect(FlatDiceSchema.parse({ flat: 0 })).toEqual({ flat: 0 });
  });

  it('rejects negative amounts and unknown keys', () => {
    expect(FlatDiceSchema.safeParse({ flat: -1 }).success).toBe(false);
    expect(FlatDiceSchema.safeParse({ flat: 1, extra: true }).success).toBe(false);
    expect(FlatDiceSchema.safeParse('1').success).toBe(false);
  });
});

describe('DiceOrFlatSchema (ruling 6: the union new fields can opt into)', () => {
  it('accepts either the dice-string form or the flat-object form', () => {
    expect(DiceOrFlatSchema.safeParse('1d8').success).toBe(true);
    expect(DiceOrFlatSchema.safeParse({ flat: 1 }).success).toBe(true);
  });

  it('rejects shapes that are neither', () => {
    expect(DiceOrFlatSchema.safeParse('not-dice').success).toBe(false);
    expect(DiceOrFlatSchema.safeParse({ amount: 1 }).success).toBe(false);
  });
});
