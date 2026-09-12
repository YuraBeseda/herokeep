import type { RollSpec } from './parse.ts';

export interface RollResult {
  spec: RollSpec;
  dice: { sides: number; value: number; kept: boolean }[];
  total: number;
}

/** Indices of the top `count` values (by `mode`), ties broken by roll order (earliest wins). */
function selectKept(values: number[], mode: 'highest' | 'lowest', count: number): Set<number> {
  const order = values
    .map((_, i) => i)
    .sort((a, b) => {
      const diff = mode === 'highest' ? values[b]! - values[a]! : values[a]! - values[b]!;
      return diff !== 0 ? diff : a - b;
    });
  return new Set(order.slice(0, count));
}

/**
 * Rolls a `RollSpec` against an injected `rng` — REQUIRED (doc-05 § Dice): the engine stays free of
 * `Math.random`/any global RNG; the web layer wraps `crypto.getRandomValues`, normalized to `[0, 1)`
 * (the same contract `Math.random()` itself follows), which is what `rng()` is expected to return
 * here. One die's face is `floor(rng() * sides) + 1`.
 *
 * `spec.advantage` ('adv'/'dis') only affects a dice GROUP that doesn't already carry its own
 * explicit `keep` (an explicit `khX`/`klX` already encodes the caller's intended keep behavior, so
 * advantage doesn't further modify it): that group rolls `n * 2` dice instead of `n`, then keeps
 * the highest/lowest `n` of them — e.g. `d20 adv` (`{n:1, sides:20}`, no `keep`) rolls two d20s and
 * keeps the higher one.
 */
export function roll(spec: RollSpec, rng: () => number): RollResult {
  const dice: RollResult['dice'] = [];
  let keptSum = 0;

  for (const group of spec.dice) {
    const useAdvantage = group.keep === undefined && (spec.advantage === 'adv' || spec.advantage === 'dis');
    const rollCount = useAdvantage ? group.n * 2 : group.n;

    const values: number[] = [];
    for (let i = 0; i < rollCount; i++) values.push(Math.floor(rng() * group.sides) + 1);

    let kept: Set<number> | undefined;
    if (group.keep) {
      kept = selectKept(values, group.keep.mode, group.keep.count);
    } else if (useAdvantage) {
      kept = selectKept(values, spec.advantage === 'adv' ? 'highest' : 'lowest', group.n);
    }

    values.forEach((value, i) => {
      const isKept = kept ? kept.has(i) : true;
      dice.push({ sides: group.sides, value, kept: isKept });
      if (isKept) keptSum += value;
    });
  }

  return { spec, dice, total: keptSum + spec.modifier };
}
