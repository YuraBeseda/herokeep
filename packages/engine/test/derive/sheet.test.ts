import { describe, expect, it } from 'vitest';
import { createContentIndex } from '../../src/content/index.ts';
import { derive, outstandingChoices } from '../../src/derive/index.ts';
import { emptyFacts } from '../../src/reduce/facts.ts';
import { loadFixturePack } from '../support/fixtures.ts';

const index = createContentIndex([loadFixturePack('core-mini'), loadFixturePack('content-mini')]);
const baseFacts = () => emptyFacts('char:test');
const rules = () => ({ restRules: index.system().restRules, hpRules: index.system().hpRules });

const fighter = 'core-mini:class/fighter';
const champion = 'core-mini:subclass/champion';

describe('derive: Sheet assembly', () => {
  it('computes initiative as dex mod + initiative.bonus effects', () => {
    const facts = baseFacts();
    facts.decisions['core-mini:system/mini@0/ability-scores'] = [
      'str:10',
      'dex:14',
      'con:10',
      'int:10',
      'wis:10',
      'cha:10',
    ];
    facts.decisions['core-mini:system/mini@0/background'] = ['core-mini:background/acolyte']; // originFeat = alert: initiative.bonus 'prof'
    facts.classes = [{ classId: fighter, level: 2 }]; // prof at level 2 = 2
    const sheet = derive(facts, index, rules());

    // mod(14) = 2, prof = 2 (alert's `value: 'prof'` formula), +2 flat (content-mini's override
    // grants every fighter `homebrew-mini:feature/cat-reflexes`, which has its own flat +2).
    expect(sheet.initiative.value).toBe(6);
    expect(sheet.initiative.contributions).toContainEqual(
      expect.objectContaining({ source: 'core-mini:background/acolyte', kind: 'initiative.bonus', formula: 'prof' }),
    );
  });

  it('unions armor/weapon proficiencies from class fields, with sources', () => {
    const facts = baseFacts();
    facts.classes = [{ classId: fighter, level: 1 }];
    const sheet = derive(facts, index, rules());

    expect(sheet.proficiencies).toContainEqual({
      kind: 'armor',
      target: 'heavy',
      level: 'proficient',
      sources: [fighter],
    });
    expect(sheet.proficiencies).toContainEqual({
      kind: 'weapon',
      target: 'martial',
      level: 'proficient',
      sources: [fighter],
    });
  });

  it('flags an inventory entry whose itemId no longer resolves, with resolved:false and a warning', () => {
    const facts = baseFacts();
    facts.inventory = [
      { instanceId: 'i1', itemId: 'core-mini:item/longsword', qty: 1, equipped: false, attuned: false },
      { instanceId: 'i2', itemId: 'core-mini:item/does-not-exist', qty: 1, equipped: false, attuned: false },
      { instanceId: 'i3', qty: 1, equipped: false, attuned: false, custom: { name: 'Homemade dagger' } },
    ];
    const sheet = derive(facts, index, rules());

    expect(sheet.inventory.find((i) => i.instanceId === 'i1')?.resolved).toBe(true);
    expect(sheet.inventory.find((i) => i.instanceId === 'i2')?.resolved).toBe(false);
    expect(sheet.inventory.find((i) => i.instanceId === 'i3')?.resolved).toBe(true); // no itemId: not "unresolved"
    expect(sheet.issues).toContainEqual(
      expect.objectContaining({
        severity: 'warning',
        code: 'derive.unresolvedItem',
        entityId: 'core-mini:item/does-not-exist',
      }),
    );
  });

  const decideCreationChoices = (facts: ReturnType<typeof baseFacts>) => {
    facts.decisions['core-mini:system/mini@0/ability-scores'] = [
      'str:10',
      'dex:10',
      'con:10',
      'int:10',
      'wis:10',
      'cha:10',
    ];
    facts.decisions['core-mini:system/mini@0/species'] = ['core-mini:species/elf']; // no own creation choice
    facts.decisions['core-mini:system/mini@0/background'] = ['core-mini:background/acolyte'];
    facts.decisions['core-mini:background/acolyte@0/ability-scores'] = ['int:+2', 'wis:+1'];
  };

  it('extends outstandingChoices with level-scoped class-row choices and the R5 synthetic skills choice', () => {
    const facts = baseFacts();
    decideCreationChoices(facts);
    facts.classes = [{ classId: fighter, level: 2 }];
    const sheet = derive(facts, index, rules());

    // level-1 row choices (fighting-style, equipment, weapon-masteries) + the synthetic skills
    // decision, but NOT the level-3 subclass choice (2 < 3).
    expect(sheet.outstandingChoices.map((c) => c.choiceId)).toEqual(
      [
        'core-mini:class/fighter@1/equipment',
        'core-mini:class/fighter@1/fighting-style',
        'core-mini:class/fighter@1/skills',
        'core-mini:class/fighter@1/weapon-masteries',
      ].sort(),
    );
    expect(sheet.outstandingChoices.find((c) => c.choiceId === `${fighter}@1/skills`)).toEqual({
      choiceId: `${fighter}@1/skills`,
      ownerId: fighter,
      count: 2,
    });

    // matches the standalone outstandingChoices(facts, index) helper too.
    expect(outstandingChoices(facts, index).map((c) => c.choiceId)).toEqual(
      sheet.outstandingChoices.map((c) => c.choiceId),
    );
  });

  it('does not re-ask a level-scoped choice once it has a decision, and surfaces the level-3 subclass choice once level >= 3', () => {
    const facts = baseFacts();
    decideCreationChoices(facts);
    facts.classes = [{ classId: fighter, level: 3, subclassId: champion }];
    facts.decisions[`${fighter}@1/fighting-style`] = ['core-mini:feat/defense'];
    facts.decisions[`${fighter}@1/equipment`] = ['bundle-0'];
    facts.decisions[`${fighter}@1/weapon-masteries`] = ['sap'];
    facts.decisions[`${fighter}@1/skills`] = ['athletics', 'perception'];
    const sheet = derive(facts, index, rules());

    expect(sheet.outstandingChoices.map((c) => c.choiceId)).toEqual([`${fighter}@3/subclass`]);
  });

  it('never emits decision.unknownChoice for the synthetic <classId>@1/skills decision', () => {
    const facts = baseFacts();
    facts.classes = [{ classId: fighter, level: 1 }];
    facts.decisions[`${fighter}@1/skills`] = ['athletics', 'perception'];
    const sheet = derive(facts, index, rules());

    expect(sheet.issues.map((i) => i.code)).not.toContain('decision.unknownChoice');
  });

  it('derives without `rules` and still produces an HP max, with the noSystemRules warning', () => {
    const facts = baseFacts();
    facts.classes = [{ classId: fighter, level: 1 }];
    const sheet = derive(facts, index);

    expect(sheet.hp.max.value).toBeGreaterThan(0);
    expect(sheet.issues).toContainEqual(expect.objectContaining({ severity: 'warning', code: 'derive.noSystemRules' }));
  });

  it('assembles a full mini-character (catfolk fighter, level 2): every Sheet key present and JSON-round-trippable', () => {
    const facts = baseFacts();
    facts.name = 'Rin';
    facts.decisions['core-mini:system/mini@0/species'] = ['homebrew-mini:species/catfolk'];
    facts.decisions['homebrew-mini:species/catfolk@0/whisker-style'] = ['fancy'];
    facts.decisions['core-mini:system/mini@0/background'] = ['core-mini:background/acolyte'];
    facts.decisions['core-mini:background/acolyte@0/ability-scores'] = ['int:+2', 'wis:+1'];
    facts.decisions['core-mini:system/mini@0/ability-scores'] = [
      'str:15',
      'dex:14',
      'con:13',
      'int:10',
      'wis:12',
      'cha:8',
    ];
    facts.classes = [{ classId: fighter, level: 2 }];
    facts.decisions[`${fighter}@1/fighting-style`] = ['core-mini:feat/defense'];
    facts.decisions[`${fighter}@1/equipment`] = ['bundle-0'];
    facts.decisions[`${fighter}@1/weapon-masteries`] = ['core-mini:item/longsword'];
    facts.decisions[`${fighter}@1/skills`] = ['athletics', 'perception'];
    facts.inventory = [
      { instanceId: 'i1', itemId: 'core-mini:item/chain-mail', qty: 1, equipped: true, attuned: false },
      { instanceId: 'i2', itemId: 'core-mini:item/longsword', qty: 1, equipped: true, attuned: false },
      { instanceId: 'i3', itemId: 'core-mini:item/shield', qty: 1, equipped: true, attuned: false },
      { instanceId: 'i4', itemId: 'core-mini:item/does-not-exist', qty: 1, equipped: false, attuned: false },
    ];
    facts.xp = 300;

    const sheet = derive(facts, index, rules());

    expect(Object.keys(sheet).sort()).toEqual(
      [
        'name',
        'system',
        'level',
        'classes',
        'pins',
        'abilities',
        'prof',
        'skills',
        'passivePerception',
        'speed',
        'senses',
        'languages',
        'ac',
        'hp',
        'initiative',
        'attacks',
        'attacksPerAction',
        'spellcasting',
        'resources',
        'actions',
        'proficiencies',
        'inventory',
        'attunementMax',
        'currency',
        'inspiration',
        'conditions',
        'xp',
        'grammaticalGender',
        'outstandingChoices',
        'issues',
      ].sort(),
    );
    expect(JSON.parse(JSON.stringify(sheet))).toEqual(sheet);

    expect(sheet.level).toBe(2);
    expect(sheet.attunementMax).toBe(3); // core-mini:system/mini's attunementMax
    expect(sheet.classes).toEqual([{ classId: fighter, level: 2 }]);
    expect(sheet.ac.value).toBe(21); // 16 (chain mail) + 2 (dex, uncapped) + 2 (shield) + 1 (defense, armor worn)
    expect(sheet.attacks).toHaveLength(1);
    expect(sheet.attacks[0]).toMatchObject({ itemId: 'core-mini:item/longsword', mastery: 'sap' });
    expect(sheet.inventory.find((i) => i.instanceId === 'i4')?.resolved).toBe(false);
  });
});
