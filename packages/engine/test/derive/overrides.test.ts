import { describe, expect, it } from 'vitest';
import { createContentIndex } from '../../src/content/index.ts';
import { derive } from '../../src/derive/index.ts';
import { emptyFacts } from '../../src/reduce/facts.ts';
import { loadFixturePack } from '../support/fixtures.ts';

const index = createContentIndex([loadFixturePack('core-mini'), loadFixturePack('content-mini')]);
const baseFacts = () => emptyFacts('char:test');
const rules = () => ({ restRules: index.system().restRules, hpRules: index.system().hpRules });

const fighter = 'core-mini:class/fighter';
const ringOfTheFighter = 'core-mini:item/ring-of-the-fighter'; // attunement.by: { class: fighter }
const orbOfTheMind = 'core-mini:item/orb-of-the-mind'; // attunement.by: { spellcaster: true }
const longsword = 'core-mini:item/longsword'; // no `attunement` field at all

/** Ruling 1 (phase 4, plan 11 task 4 — "house-rule overrides into derive"). */
describe('derive: overrides.attunementMax', () => {
  it('with no overrides, uses system.attunementMax and sets no provenance', () => {
    const sheet = derive(baseFacts(), index, rules());

    expect(sheet.attunementMax).toBe(3); // core-mini:system/mini's own attunementMax
    expect(sheet.overridesProvenance).toBeUndefined();
    expect('overridesProvenance' in sheet).toBe(false); // truly absent, not an explicit undefined key
  });

  it('overrides.attunementMax replaces the pack value and sets provenance "house rule"', () => {
    const sheet = derive(baseFacts(), index, rules(), { attunementMax: 5 });

    expect(sheet.attunementMax).toBe(5);
    expect(sheet.overridesProvenance).toEqual({ attunementMax: 'house rule' });
  });

  it('every existing derive(facts, index) / derive(facts, index, rules) call site still compiles and behaves unchanged (overrides is optional and trailing)', () => {
    const twoArg = derive(baseFacts(), index);
    const threeArg = derive(baseFacts(), index, rules());
    expect(twoArg.attunementMax).toBe(3);
    expect(threeArg.attunementMax).toBe(3);
    expect(twoArg.overridesProvenance).toBeUndefined();
    expect(threeArg.overridesProvenance).toBeUndefined();
  });

  it('overrides works with `rules` explicitly omitted (undefined) in the 3rd position', () => {
    const sheet = derive(baseFacts(), index, undefined, { attunementMax: 7 });
    expect(sheet.attunementMax).toBe(7);
    expect(sheet.overridesProvenance).toEqual({ attunementMax: 'house rule' });
  });
});

/**
 * `item.attunement.by` enforcement (survey fact, phase 4 plan 11 task 4): pre-resolved onto
 * `Sheet.inventory[].attunementAllowed` at derive time (see `derive/index.ts`'s
 * `attunementPredicateContext`) so `propose.attune` — which per `propose/index.ts`'s own header
 * comment never touches a `ContentIndex` — can refuse without needing one.
 */
describe('derive: Sheet.inventory[].attunementAllowed (item.attunement.by)', () => {
  it("true when the character satisfies the item's attunement.by predicate", () => {
    const facts = baseFacts();
    facts.classes = [{ classId: fighter, level: 1 }];
    facts.inventory = [{ instanceId: 'i1', itemId: ringOfTheFighter, qty: 1, equipped: false, attuned: false }];
    const sheet = derive(facts, index, rules());

    expect(sheet.inventory.find((i) => i.instanceId === 'i1')?.attunementAllowed).toBe(true);
  });

  it('false when the character does NOT satisfy the predicate (no fighter class)', () => {
    const facts = baseFacts();
    facts.classes = []; // not a fighter
    facts.inventory = [{ instanceId: 'i1', itemId: ringOfTheFighter, qty: 1, equipped: false, attuned: false }];
    const sheet = derive(facts, index, rules());

    expect(sheet.inventory.find((i) => i.instanceId === 'i1')?.attunementAllowed).toBe(false);
  });

  it('absent (not merely undefined-valued) for an item with no attunement.by at all', () => {
    const facts = baseFacts();
    facts.inventory = [{ instanceId: 'i1', itemId: longsword, qty: 1, equipped: false, attuned: false }];
    const sheet = derive(facts, index, rules());

    const entry = sheet.inventory.find((i) => i.instanceId === 'i1')!;
    expect('attunementAllowed' in entry).toBe(false);
  });

  it('absent for an inventory entry with no itemId (fully custom item)', () => {
    const facts = baseFacts();
    facts.inventory = [{ instanceId: 'i1', qty: 1, equipped: false, attuned: false, name: 'Homemade dagger' }];
    const sheet = derive(facts, index, rules());

    const entry = sheet.inventory.find((i) => i.instanceId === 'i1')!;
    expect('attunementAllowed' in entry).toBe(false);
  });

  it('false for a { spellcaster: true } predicate on a non-caster Fighter build (a second predicate shape, not just class)', () => {
    const facts = baseFacts();
    facts.classes = [{ classId: fighter, level: 1 }]; // Fighter, no spellcasting.define effect anywhere
    facts.inventory = [{ instanceId: 'i1', itemId: orbOfTheMind, qty: 1, equipped: false, attuned: false }];
    const sheet = derive(facts, index, rules());

    expect(sheet.inventory.find((i) => i.instanceId === 'i1')?.attunementAllowed).toBe(false);
  });

  it('evaluates REGARDLESS of the current equipped/attuned state (attuning is what is being proposed)', () => {
    const facts = baseFacts();
    facts.classes = [{ classId: fighter, level: 1 }];
    facts.inventory = [{ instanceId: 'i1', itemId: ringOfTheFighter, qty: 1, equipped: false, attuned: false }];
    const sheet = derive(facts, index, rules());

    expect(sheet.inventory.find((i) => i.instanceId === 'i1')?.attunementAllowed).toBe(true);
  });
});
