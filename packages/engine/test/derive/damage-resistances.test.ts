import { describe, expect, it } from 'vitest';
import { createContentIndex } from '../../src/content/index.ts';
import type { ActiveEffect } from '../../src/derive/composition.ts';
import { derive } from '../../src/derive/index.ts';
import { deriveResistances } from '../../src/derive/resistances.ts';
import { emptyFacts } from '../../src/reduce/facts.ts';
import { loadFixturePack } from '../support/fixtures.ts';

// Plan 14 task 3: `damage.resistance` gets its first derive consumer — `sheet.resistances`, one row
// per damage type with its provenance (the declaring feature, else the root source), sorted by type.
// Same shape and posture as plan 13's `sheet.immunities`: display-only, and ABSENT when empty so no
// pre-existing golden/sheet assertion moves. First real consumer: Cloak of Arachnida (poison).

const ae = (types: string[], source: string, feature?: string): ActiveEffect => ({
  effect: { type: 'damage.resistance', types },
  source,
  ...(feature ? { feature } : {}),
});

describe('deriveResistances', () => {
  it('lists each resisted damage type once, sorted, with sorted unique sources', () => {
    expect(
      deriveResistances([
        ae(['poison', 'cold'], 'x:item/b'),
        ae(['cold'], 'x:species/a', 'x:feature/one'),
        ae(['cold'], 'x:item/b'),
      ]),
    ).toEqual([
      { type: 'cold', sources: ['x:feature/one', 'x:item/b'] },
      { type: 'poison', sources: ['x:item/b'] },
    ]);
  });

  it('ignores every other effect type', () => {
    expect(
      deriveResistances([{ effect: { type: 'damage.immunity', types: ['fire'] }, source: 'x:species/b' }]),
    ).toEqual([]);
  });
});

describe('sheet.resistances', () => {
  const index = createContentIndex([loadFixturePack('core-mini')]);
  const ring = 'core-mini:item/ring-of-warmth'; // no attunement; damage.resistance cold

  it('is absent when the character resists nothing', () => {
    expect('resistances' in derive(emptyFacts('char:t'), index)).toBe(false);
  });

  it('lists an active item resistance with the item as its source', () => {
    const facts = emptyFacts('char:t');
    facts.inventory = [{ instanceId: 'i1', itemId: ring, qty: 1, equipped: true, attuned: false }];
    expect(derive(facts, index).resistances).toEqual([{ type: 'cold', sources: [ring] }]);
  });
});
