import { describe, expect, it } from 'vitest';
import { createContentIndex } from '../../src/content/index.ts';
import type { ActiveEffect } from '../../src/derive/composition.ts';
import { deriveImmunities } from '../../src/derive/immunities.ts';
import { derive } from '../../src/derive/index.ts';
import { emptyFacts } from '../../src/reduce/facts.ts';
import { loadFixturePack } from '../support/fixtures.ts';

// Plan 13 task 5 (ruling 9): `condition.immunity` gets a derive consumer — `sheet.immunities`, one
// row per condition with its provenance (the declaring feature, else the root source), sorted by
// condition id. Display-only: nothing gates applying a condition. ABSENT from the sheet when empty
// so every pre-existing golden/sheet assertion is unaffected.

const ae = (conditions: string[], source: string, feature?: string): ActiveEffect => ({
  effect: { type: 'condition.immunity', conditions },
  source,
  ...(feature ? { feature } : {}),
});

describe('deriveImmunities', () => {
  it('lists each immune condition once, sorted, with sorted unique sources', () => {
    expect(
      deriveImmunities([
        ae(['x:condition/frightened', 'x:condition/charmed'], 'x:class/a', 'x:feature/one'),
        ae(['x:condition/charmed'], 'x:species/b'),
        ae(['x:condition/charmed'], 'x:class/a', 'x:feature/one'),
      ]),
    ).toEqual([
      { condition: 'x:condition/charmed', sources: ['x:feature/one', 'x:species/b'] },
      { condition: 'x:condition/frightened', sources: ['x:feature/one'] },
    ]);
  });

  it('ignores every other effect type', () => {
    expect(deriveImmunities([{ effect: { type: 'damage.immunity', types: ['fire'] }, source: 'x:species/b' }])).toEqual(
      [],
    );
  });
});

describe('sheet.immunities', () => {
  it('is absent when the character has no condition immunity', () => {
    const index = createContentIndex([loadFixturePack('core-mini')]);
    expect('immunities' in derive(emptyFacts('char:t'), index)).toBe(false);
  });
});
