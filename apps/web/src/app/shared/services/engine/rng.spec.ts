import { cryptoRng } from './rng';

describe('cryptoRng', () => {
  it('returns a float in [0, 1) over 100 draws', () => {
    for (let i = 0; i < 100; i++) {
      const value = cryptoRng();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});
