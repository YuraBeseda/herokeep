import { describe, expect, it } from 'vitest';
import { uuidv7 } from '../../src/core/ids.ts';

const UUID_V7_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('uuidv7', () => {
  it('produces a v7 UUID shape (version nibble 7, RFC 4122 variant)', () => {
    expect(uuidv7()).toMatch(UUID_V7_SHAPE);
  });

  it('produces unique ids across many calls', () => {
    const ids = new Set(Array.from({ length: 200 }, () => uuidv7()));
    expect(ids.size).toBe(200);
  });

  it('sorts lexicographically in call order (monotonic ordering)', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 20; i++) {
      ids.push(uuidv7());
      // Force distinguishable millisecond timestamps so ordering isn't just tie-broken by chance
      // random bits within the same millisecond.
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    const sorted = [...ids].sort();
    expect(ids).toEqual(sorted);
  });
});
