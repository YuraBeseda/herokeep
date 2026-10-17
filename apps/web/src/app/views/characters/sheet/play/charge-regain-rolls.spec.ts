import type { Sheet } from '@hk/engine';
import { rollChargeRegains } from './charge-regain-rolls';

type Resource = Sheet['resources'][number];

const res = (id: string, regain?: string): Resource => ({
  id,
  name: id,
  max: { value: 7, contributions: [] },
  used: 0,
  reset: 'dawn',
  display: 'number',
  source: 'x',
  ...(regain !== undefined ? { regain } : {}),
});

/** Scripted `[0,1)` draws, consumed in order (same contract as `cryptoRng`). */
const scripted = (fractions: number[]) => {
  let i = 0;
  return () => fractions[i++] ?? 0;
};

describe('rollChargeRegains (plan 13 task 6)', () => {
  it('rolls each regain-dice resource once and returns its total, keyed by resource id', () => {
    const resources = [res('item:a', '1d6+1'), res('item:b'), res('item:c', '1d3')];
    // 1d6: floor(0.5 * 6) + 1 = 4, +1 => 5; 1d3: floor(0.9 * 3) + 1 = 3.
    expect(rollChargeRegains({ resources } as Sheet, scripted([0.5, 0.9]))).toEqual({
      'item:a': 5,
      'item:c': 3,
    });
  });

  it('returns {} (and draws nothing) when no resource has regain dice', () => {
    const rng = vi.fn(() => 0);
    expect(rollChargeRegains({ resources: [res('item:b')] } as Sheet, rng)).toEqual({});
    expect(rng).not.toHaveBeenCalled();
  });
});
