import { describe, expect, it } from 'vitest';
import type { Predicate } from '@hk/protocol';
import { constantPredicateContext } from '../../src/predicate/context.ts';
import { unmetPrerequisites } from '../../src/predicate/unmet.ts';

const ctx = {
  ...constantPredicateContext(),
  level: 3,
  abilityScore: (a: string) => (a === 'str' ? 12 : a === 'dex' ? 14 : 10),
};
const str13: Predicate = { ability: { str: { gte: 13 } } };
const dex13: Predicate = { ability: { dex: { gte: 13 } } };

describe('unmetPrerequisites', () => {
  it('names a failing leaf', () => expect(unmetPrerequisites([str13], ctx)).toEqual([str13]));
  it('is empty when everything passes', () => expect(unmetPrerequisites([dex13], ctx)).toEqual([]));
  it('an all yields its failing children only', () =>
    expect(unmetPrerequisites([{ all: [dex13, str13] }], ctx)).toEqual([str13]));
  it('an any with both failing yields the any itself', () => {
    const any: Predicate = { any: [str13, { ability: { con: { gte: 15 } } }] };
    expect(unmetPrerequisites([any], ctx)).toEqual([any]);
  });
  it('a level gate on a level-3 character yields the level leaf', () => {
    const lvl: Predicate = { level: { gte: 4 } };
    expect(unmetPrerequisites([lvl], ctx)).toEqual([lvl]);
  });
});
