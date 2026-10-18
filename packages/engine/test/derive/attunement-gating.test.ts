import { describe, expect, it } from 'vitest';
import { createContentIndex } from '../../src/content/index.ts';
import { compose } from '../../src/derive/composition.ts';
import { derive } from '../../src/derive/index.ts';
import { emptyFacts, type InventoryEntry } from '../../src/reduce/facts.ts';
import { loadFixturePack } from '../support/fixtures.ts';

// Plan 14 task 3 (ruling 5, a correctness fix): an item whose `attunement.required` is true activates
// its effects/grants ONLY while the inventory entry is `attuned` — wearing it is not enough. An item
// that does not require attunement keeps the old `equipped || attuned` activation. Charges are not
// gated (plan 12): only effect/grant activation changes. Fixture items (core-mini):
// - ring-of-the-fighter: attunement.required (by: fighter), ac.bonus +1 keyed 'ring-of-the-fighter'
// - cloak-of-protection: no attunement, ac.bonus +1 keyed 'cloak'

const index = createContentIndex([loadFixturePack('core-mini'), loadFixturePack('content-mini')]);
const rules = { restRules: index.system().restRules, hpRules: index.system().hpRules };
const ring = 'core-mini:item/ring-of-the-fighter';
const cloak = 'core-mini:item/cloak-of-protection';

function facts(itemId: string, equipped: boolean, attuned: boolean) {
  const f = emptyFacts('char:test');
  f.classes = [{ classId: 'core-mini:class/fighter', level: 1 }];
  const entry: InventoryEntry = { instanceId: 'i1', itemId, qty: 1, equipped, attuned };
  f.inventory = [entry];
  return f;
}
const hasAcBonus = (key: string, f: ReturnType<typeof facts>) =>
  compose(f, index).effects.some((e) => e.effect.type === 'ac.bonus' && e.effect.key === key);

describe('attunement gating of item effects', () => {
  it('an attunement-required item that is equipped but NOT attuned contributes no effects', () => {
    const f = facts(ring, true, false);
    expect(compose(f, index).entities).not.toContain(ring);
    expect(hasAcBonus('ring-of-the-fighter', f)).toBe(false);
  });

  it('the same item, once attuned, is active (equipped or not)', () => {
    for (const equipped of [true, false]) {
      const f = facts(ring, equipped, true);
      expect(compose(f, index).entities).toContain(ring);
      expect(hasAcBonus('ring-of-the-fighter', f)).toBe(true);
    }
  });

  it('the sheet AC reflects the gate: +1 only once attuned', () => {
    const worn = derive(facts(ring, true, false), index, rules).ac.value;
    const attuned = derive(facts(ring, true, true), index, rules).ac.value;
    expect(attuned).toBe(worn + 1);
  });

  it('an item that does not require attunement still activates on equip alone', () => {
    const f = facts(cloak, true, false);
    expect(compose(f, index).entities).toContain(cloak);
    expect(hasAcBonus('cloak', f)).toBe(true);
  });

  it('an unequipped, unattuned item stays inactive either way', () => {
    expect(compose(facts(ring, false, false), index).entities).not.toContain(ring);
    expect(compose(facts(cloak, false, false), index).entities).not.toContain(cloak);
  });
});
