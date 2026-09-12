import { describe, expect, it } from 'vitest';
import { createContentIndex } from '../../src/content/index.ts';
import { compose } from '../../src/derive/composition.ts';
import { deriveAbilities } from '../../src/derive/abilities.ts';
import { deriveDefense } from '../../src/derive/defense.ts';
import { emptyFacts } from '../../src/reduce/facts.ts';
import { loadFixturePack } from '../support/fixtures.ts';

const index = createContentIndex([loadFixturePack('core-mini'), loadFixturePack('content-mini')]);
const baseFacts = () => emptyFacts('char:test');

const withDex = (dex: number) => {
  const facts = baseFacts();
  facts.decisions['core-mini:system/mini@0/ability-scores'] = [
    'str:10',
    `dex:${dex}`,
    'con:10',
    'int:10',
    'wis:10',
    'cha:10',
  ];
  return facts;
};

describe('deriveDefense', () => {
  it('computes unarmored AC as 10 + dex mod', () => {
    const facts = withDex(16); // mod +3
    const comp = compose(facts, index);
    const abilities = deriveAbilities(facts, comp, index);
    const r = deriveDefense(abilities, comp, facts, index);

    expect(r.ac.value).toBe(13);
  });

  it('caps the dex bonus from equipped armor at the armor.dexCap', () => {
    const facts = withDex(18); // mod +4, capped to +2 by half-plate's dexCap
    facts.inventory = [
      { instanceId: 'i1', itemId: 'core-mini:item/half-plate', qty: 1, equipped: true, attuned: false },
    ];
    const comp = compose(facts, index);
    const abilities = deriveAbilities(facts, comp, index);
    const r = deriveDefense(abilities, comp, facts, index);

    // half-plate ac 15 + min(mod(dex)=4, dexCap=2) = 17
    expect(r.ac.value).toBe(17);
  });

  it('leaves the dex bonus uncapped when armor.dexCap is absent', () => {
    const facts = withDex(18); // mod +4
    facts.inventory = [
      { instanceId: 'i1', itemId: 'core-mini:item/chain-mail', qty: 1, equipped: true, attuned: false },
    ];
    const comp = compose(facts, index);
    const abilities = deriveAbilities(facts, comp, index);
    const r = deriveDefense(abilities, comp, facts, index);

    // chain-mail has no dexCap field -> uncapped: 16 + 4 = 20
    expect(r.ac.value).toBe(20);
  });

  it('stacks armor + shield ac.bonus on top of the winning AC formula', () => {
    const facts = withDex(14); // mod +2
    facts.inventory = [
      { instanceId: 'i1', itemId: 'core-mini:item/chain-mail', qty: 1, equipped: true, attuned: false },
      { instanceId: 'i2', itemId: 'core-mini:item/shield', qty: 1, equipped: true, attuned: false },
    ];
    const comp = compose(facts, index);
    const abilities = deriveAbilities(facts, comp, index);
    const r = deriveDefense(abilities, comp, facts, index);

    // max-of-formulas: max(10+2, 16+2) = 18; + shield ac.bonus 2 = 20
    expect(r.ac.value).toBe(20);
    expect(r.ac.contributions).toContainEqual(
      expect.objectContaining({ source: 'core-mini:item/shield', key: 'shield', amount: 2 }),
    );
  });

  it('does not stack two equipped shields (keeps the higher, not the sum)', () => {
    const facts = withDex(14); // mod +2
    facts.inventory = [
      { instanceId: 'i1', itemId: 'core-mini:item/shield', qty: 1, equipped: true, attuned: false },
      { instanceId: 'i2', itemId: 'core-mini:item/shield', qty: 1, equipped: true, attuned: false },
    ];
    const comp = compose(facts, index);
    const abilities = deriveAbilities(facts, comp, index);
    const r = deriveDefense(abilities, comp, facts, index);

    // base 10+2=12, plus a single (not doubled) shield bonus of 2 = 14
    expect(r.ac.value).toBe(14);
  });

  it('warns when the wearer is below the equipped heavy armor STR requirement', () => {
    const facts = withDex(10);
    facts.decisions['core-mini:system/mini@0/ability-scores'] = [
      'str:8', // chain-mail requires str 13
      'dex:10',
      'con:10',
      'int:10',
      'wis:10',
      'cha:10',
    ];
    facts.inventory = [
      { instanceId: 'i1', itemId: 'core-mini:item/chain-mail', qty: 1, equipped: true, attuned: false },
    ];
    const comp = compose(facts, index);
    const abilities = deriveAbilities(facts, comp, index);
    const r = deriveDefense(abilities, comp, facts, index);

    expect(r.issues).toContainEqual(
      expect.objectContaining({
        severity: 'warning',
        code: 'derive.armorStrength',
        entityId: 'core-mini:item/chain-mail',
      }),
    );
  });

  it('does not warn about STR when the wearer meets the requirement', () => {
    const facts = withDex(10);
    facts.decisions['core-mini:system/mini@0/ability-scores'] = [
      'str:13',
      'dex:10',
      'con:10',
      'int:10',
      'wis:10',
      'cha:10',
    ];
    facts.inventory = [
      { instanceId: 'i1', itemId: 'core-mini:item/chain-mail', qty: 1, equipped: true, attuned: false },
    ];
    const comp = compose(facts, index);
    const abilities = deriveAbilities(facts, comp, index);
    const r = deriveDefense(abilities, comp, facts, index);

    expect(r.issues.some((i) => i.code === 'derive.armorStrength')).toBe(false);
  });

  it('warns about stealth disadvantage when the equipped armor imposes it', () => {
    const facts = withDex(10);
    facts.inventory = [
      { instanceId: 'i1', itemId: 'core-mini:item/chain-mail', qty: 1, equipped: true, attuned: false },
    ];
    const comp = compose(facts, index);
    const abilities = deriveAbilities(facts, comp, index);
    const r = deriveDefense(abilities, comp, facts, index);

    expect(r.issues).toContainEqual(
      expect.objectContaining({
        severity: 'warning',
        code: 'derive.stealthDisadvantage',
        entityId: 'core-mini:item/chain-mail',
      }),
    );
  });

  it('does not warn about stealth disadvantage when unarmored', () => {
    const facts = withDex(10);
    const comp = compose(facts, index);
    const abilities = deriveAbilities(facts, comp, index);
    const r = deriveDefense(abilities, comp, facts, index);

    expect(r.issues.some((i) => i.code === 'derive.stealthDisadvantage')).toBe(false);
  });
});
