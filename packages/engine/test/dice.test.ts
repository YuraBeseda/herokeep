import { describe, expect, it } from 'vitest';
import { DiceFormulaError, parseRollSpec } from '../src/dice/parse.ts';
import { roll } from '../src/dice/roll.ts';

/** A scripted rng: returns the given `[0,1)` fractions in order, then throws if over-consumed. */
function scripted(fractions: number[]): () => number {
  let i = 0;
  return () => {
    if (i >= fractions.length) throw new Error('scripted rng exhausted');
    return fractions[i++]!;
  };
}

/** A safe interior `[0,1)` fraction that `floor(u*sides)+1` maps back to `face`. */
const faceFrac = (face: number, sides: number) => (face - 1 + 0.5) / sides;

describe('parseRollSpec', () => {
  it('parses "4d6kh3": 4 six-sided dice, keep highest 3', () => {
    expect(parseRollSpec('4d6kh3')).toEqual({
      dice: [{ n: 4, sides: 6, keep: { mode: 'highest', count: 3 } }],
      modifier: 0,
    });
  });

  it('parses "2d20kl1": 2 d20s, keep lowest 1', () => {
    expect(parseRollSpec('2d20kl1')).toEqual({
      dice: [{ n: 2, sides: 20, keep: { mode: 'lowest', count: 1 } }],
      modifier: 0,
    });
  });

  it('parses "1d8+3": one d8 plus a flat +3 modifier', () => {
    expect(parseRollSpec('1d8+3')).toEqual({ dice: [{ n: 1, sides: 8 }], modifier: 3 });
  });

  it('parses "d20": an implicit count of 1', () => {
    expect(parseRollSpec('d20')).toEqual({ dice: [{ n: 1, sides: 20 }], modifier: 0 });
  });

  it('parses "d20 adv" with the advantage marker, no keep on the dice group itself', () => {
    expect(parseRollSpec('d20 adv')).toEqual({ dice: [{ n: 1, sides: 20 }], modifier: 0, advantage: 'adv' });
  });

  it('parses "d20 dis"', () => {
    expect(parseRollSpec('d20 dis')).toEqual({ dice: [{ n: 1, sides: 20 }], modifier: 0, advantage: 'dis' });
  });

  it('parses a negative flat modifier: "1d8-1"', () => {
    expect(parseRollSpec('1d8-1')).toEqual({ dice: [{ n: 1, sides: 8 }], modifier: -1 });
  });

  it('parses a bare flat number with no dice at all: "5"', () => {
    expect(parseRollSpec('5')).toEqual({ dice: [], modifier: 5 });
  });

  it.each([
    ['', 'empty'],
    ['   ', 'whitespace-only'],
    ['4d0', 'zero sides'],
    ['0d6', 'zero count'],
    ['4d6kh5', 'keep count exceeds dice count'],
    ['4d6kh0', 'zero keep count'],
    ['-4d6', 'negated dice term'],
    ['4d6xyz', 'garbage suffix'],
    ['banana', 'not dice notation at all'],
  ])('throws DiceFormulaError for %j (%s)', (text) => {
    expect(() => parseRollSpec(text)).toThrow(DiceFormulaError);
  });
});

describe('roll', () => {
  it('4d6kh3 with a scripted rng yielding faces [3,5,2,6] keeps [3,5,6] (drops the 2), total 14', () => {
    const spec = parseRollSpec('4d6kh3');
    const rng = scripted([faceFrac(3, 6), faceFrac(5, 6), faceFrac(2, 6), faceFrac(6, 6)]);
    const result = roll(spec, rng);

    expect(result.dice).toEqual([
      { sides: 6, value: 3, kept: true },
      { sides: 6, value: 5, kept: true },
      { sides: 6, value: 2, kept: false },
      { sides: 6, value: 6, kept: true },
    ]);
    expect(result.total).toBe(14);
  });

  it('1d8+3 with a scripted rng yielding face 5 totals 8', () => {
    const spec = parseRollSpec('1d8+3');
    const result = roll(spec, scripted([faceFrac(5, 8)]));
    expect(result.dice).toEqual([{ sides: 8, value: 5, kept: true }]);
    expect(result.total).toBe(8);
  });

  it('d20 adv rolls two d20s and keeps the higher one', () => {
    const spec = parseRollSpec('d20 adv');
    const result = roll(spec, scripted([faceFrac(11, 20), faceFrac(17, 20)]));
    expect(result.dice).toEqual([
      { sides: 20, value: 11, kept: false },
      { sides: 20, value: 17, kept: true },
    ]);
    expect(result.total).toBe(17);
  });

  it('d20 dis rolls two d20s and keeps the lower one', () => {
    const spec = parseRollSpec('d20 dis');
    const result = roll(spec, scripted([faceFrac(11, 20), faceFrac(17, 20)]));
    expect(result.dice).toEqual([
      { sides: 20, value: 11, kept: true },
      { sides: 20, value: 17, kept: false },
    ]);
    expect(result.total).toBe(11);
  });

  it('is deterministic: two identically-scripted rng runs over the same spec produce identical results', () => {
    const spec = parseRollSpec('2d20kl1+2');
    const script = () => scripted([faceFrac(14, 20), faceFrac(9, 20)]);
    expect(roll(spec, script())).toEqual(roll(spec, script()));
  });

  it('an explicit keep on the dice group wins over advantage (advantage does not double it)', () => {
    const spec = parseRollSpec('1d20kh1');
    const specWithAdvantage = { ...spec, advantage: 'adv' as const };
    const result = roll(specWithAdvantage, scripted([faceFrac(9, 20)]));
    expect(result.dice).toEqual([{ sides: 20, value: 9, kept: true }]);
  });
});
