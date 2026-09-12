import { describe, expect, it } from 'vitest';
import { createContentIndex } from '../../src/content/index.ts';
import { deriveAbilities } from '../../src/derive/abilities.ts';
import { deriveAttacks } from '../../src/derive/attacks.ts';
import { compose } from '../../src/derive/composition.ts';
import { emptyFacts } from '../../src/reduce/facts.ts';
import { loadFixturePack } from '../support/fixtures.ts';

const index = createContentIndex([loadFixturePack('core-mini'), loadFixturePack('content-mini')]);
const baseFacts = () => emptyFacts('char:test');

const withAbilities = (overrides: Partial<Record<'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha', number>>) => {
  const facts = baseFacts();
  const scores = { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10, ...overrides };
  facts.decisions['core-mini:system/mini@0/ability-scores'] = (['str', 'dex', 'con', 'int', 'wis', 'cha'] as const).map(
    (a) => `${a}:${scores[a]}`,
  );
  return facts;
};

const deriveAll = (facts: ReturnType<typeof baseFacts>) => {
  const comp = compose(facts, index);
  const abilities = deriveAbilities(facts, comp, index);
  return { comp, abilities, result: deriveAttacks(abilities, comp, facts, index) };
};

describe('deriveAttacks', () => {
  it('derives toHit and damage bonus for a proficient str melee weapon', () => {
    const facts = withAbilities({ str: 16 }); // mod +3
    facts.classes = [{ classId: 'core-mini:class/fighter', level: 1 }]; // prof +2, proficient (martial)
    facts.inventory = [
      { instanceId: 'i1', itemId: 'core-mini:item/longsword', qty: 1, equipped: true, attuned: false },
    ];
    const { result } = deriveAll(facts);

    expect(result.attacks).toHaveLength(1);
    const row = result.attacks[0]!;
    expect(row.ability).toBe('str');
    expect(row.toHit.value).toBe(5); // 3 (mod) + 2 (prof)
    expect(row.damage.bonus.value).toBe(3);
    expect(row.damage.dice).toBe('1d8');
    expect(row.damage.type).toBe('slashing');
    expect(row.itemId).toBe('core-mini:item/longsword');
    expect(row.name).toBe('core-mini:item/longsword');
    expect(row.instanceId).toBe('i1');
    expect(row.properties).toEqual(['versatile']);
  });

  it('picks dex over str for a finesse weapon when dex is higher', () => {
    const facts = withAbilities({ str: 10, dex: 16 }); // dex mod +3 beats str mod 0
    facts.classes = [{ classId: 'core-mini:class/fighter', level: 1 }];
    facts.inventory = [{ instanceId: 'i1', itemId: 'core-mini:item/rapier', qty: 1, equipped: true, attuned: false }];
    const { result } = deriveAll(facts);

    expect(result.attacks[0]!.ability).toBe('dex');
    expect(result.attacks[0]!.toHit.value).toBe(5); // 3 + 2
  });

  it('keeps str for a finesse weapon when str is higher than dex', () => {
    const facts = withAbilities({ str: 16, dex: 10 });
    facts.classes = [{ classId: 'core-mini:class/fighter', level: 1 }];
    facts.inventory = [{ instanceId: 'i1', itemId: 'core-mini:item/rapier', qty: 1, equipped: true, attuned: false }];
    const { result } = deriveAll(facts);

    expect(result.attacks[0]!.ability).toBe('str');
    expect(result.attacks[0]!.toHit.value).toBe(5); // 3 + 2
  });

  it('always uses dex for a ranged weapon, even when str is higher', () => {
    const facts = withAbilities({ str: 18, dex: 12 }); // str mod +4, dex mod +1
    facts.classes = [{ classId: 'core-mini:class/fighter', level: 1 }];
    facts.inventory = [{ instanceId: 'i1', itemId: 'core-mini:item/shortbow', qty: 1, equipped: true, attuned: false }];
    const { result } = deriveAll(facts);

    expect(result.attacks[0]!.ability).toBe('dex');
    expect(result.attacks[0]!.toHit.value).toBe(3); // 1 + 2
  });

  it('drops the proficiency bonus for a weapon the character has no proficiency with', () => {
    const facts = withAbilities({ str: 16 }); // mod +3
    // no classes at all -> no weapon proficiency of any kind
    facts.inventory = [
      { instanceId: 'i1', itemId: 'core-mini:item/longsword', qty: 1, equipped: true, attuned: false },
    ];
    const { result } = deriveAll(facts);

    expect(result.attacks[0]!.toHit.value).toBe(3); // mod only, no +prof
  });

  it('applies an Archery-style attack.bonus filtered to ranged only to the ranged row', () => {
    const facts = withAbilities({ str: 14, dex: 14 }); // both mod +2
    facts.classes = [{ classId: 'core-mini:class/fighter', level: 1 }];
    facts.decisions['core-mini:class/fighter@1/fighting-style'] = ['core-mini:feat/archery'];
    facts.inventory = [
      { instanceId: 'i1', itemId: 'core-mini:item/longsword', qty: 1, equipped: true, attuned: false },
      { instanceId: 'i2', itemId: 'core-mini:item/shortbow', qty: 1, equipped: true, attuned: false },
    ];
    const { result } = deriveAll(facts);

    const melee = result.attacks.find((a) => a.itemId === 'core-mini:item/longsword')!;
    const ranged = result.attacks.find((a) => a.itemId === 'core-mini:item/shortbow')!;
    expect(melee.toHit.value).toBe(4); // 2 + 2, archery's ranged-only bonus does not apply
    expect(ranged.toHit.value).toBe(6); // 2 + 2 + 2 (archery)
  });

  it('sets attacksPerAction from the highest extraAttack.set count, default 1', () => {
    const facts1 = withAbilities({});
    facts1.classes = [{ classId: 'core-mini:class/fighter', level: 1 }];
    expect(deriveAll(facts1).result.attacksPerAction).toBe(1);

    const facts5 = withAbilities({});
    facts5.classes = [{ classId: 'core-mini:class/fighter', level: 5 }]; // grants Extra Attack (count 2)
    expect(deriveAll(facts5).result.attacksPerAction).toBe(2);
  });

  it('surfaces mastery only once both the mastery.grant effect and the mastery decision select the weapon', () => {
    const facts = withAbilities({ str: 16 });
    facts.classes = [{ classId: 'core-mini:class/fighter', level: 1 }]; // fighter's own effects grant mastery.grant
    facts.inventory = [
      { instanceId: 'i1', itemId: 'core-mini:item/longsword', qty: 1, equipped: true, attuned: false },
    ];

    const { result: noDecision } = deriveAll(facts);
    expect(noDecision.attacks[0]!.mastery).toBeUndefined(); // grant present, but nothing chosen yet

    facts.decisions['core-mini:class/fighter@1/weapon-masteries'] = ['core-mini:item/longsword'];
    const { result: withDecision } = deriveAll(facts);
    expect(withDecision.attacks[0]!.mastery).toBe('sap'); // longsword's mastery property, now surfaced
  });

  it('never surfaces mastery without an active mastery.grant effect', () => {
    const facts = withAbilities({ str: 16 });
    // no classes -> no mastery.grant effect, even though the weapon itself has a mastery property
    facts.inventory = [
      { instanceId: 'i1', itemId: 'core-mini:item/longsword', qty: 1, equipped: true, attuned: false },
    ];
    const { result } = deriveAll(facts);

    expect(result.attacks[0]!.mastery).toBeUndefined();
  });

  it('produces no attack row for an equipped custom item with no itemId', () => {
    const facts = withAbilities({});
    facts.inventory = [{ instanceId: 'i1', qty: 1, equipped: true, attuned: false, name: 'Homemade club' }];
    const { result } = deriveAll(facts);

    expect(result.attacks).toEqual([]);
    expect(result.issues).toEqual([]);
  });

  it('produces no attack row for an equipped non-weapon item', () => {
    const facts = withAbilities({});
    facts.inventory = [
      { instanceId: 'i1', itemId: 'core-mini:item/chain-mail', qty: 1, equipped: true, attuned: false },
    ];
    const { result } = deriveAll(facts);

    expect(result.attacks).toEqual([]);
  });

  it('produces no attack row for an unequipped weapon', () => {
    const facts = withAbilities({});
    facts.inventory = [
      { instanceId: 'i1', itemId: 'core-mini:item/longsword', qty: 1, equipped: false, attuned: false },
    ];
    const { result } = deriveAll(facts);

    expect(result.attacks).toEqual([]);
  });

  it('is deterministic across repeated derivations of the same facts', () => {
    const facts = withAbilities({ str: 16, dex: 14 });
    facts.classes = [{ classId: 'core-mini:class/fighter', level: 1 }];
    facts.inventory = [
      { instanceId: 'i1', itemId: 'core-mini:item/longsword', qty: 1, equipped: true, attuned: false },
      { instanceId: 'i2', itemId: 'core-mini:item/rapier', qty: 1, equipped: true, attuned: false },
    ];
    const r1 = deriveAll(facts).result;
    const r2 = deriveAll(facts).result;

    expect(r1).toEqual(r2);
  });
});
