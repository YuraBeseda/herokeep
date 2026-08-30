import { describe, expect, it } from 'vitest';
import { loadGoldens, runGolden } from './support/golden.ts';

describe('golden characters', () => {
  for (const fx of loadGoldens()) {
    it(fx.name, () => {
      const { actual, expected } = runGolden(fx);
      expect(actual).toEqual(expected);
    });
  }
});
