import { describe, expect, it } from 'vitest';
import { createContentIndex } from '../../src/content/index.ts';
import { pendingAdvancements } from '../../src/derive/advancement.ts';
import { derive } from '../../src/derive/index.ts';
import { emptyFacts } from '../../src/reduce/facts.ts';
import { loadFixturePack } from '../support/fixtures.ts';

const index = createContentIndex([loadFixturePack('core-mini'), loadFixturePack('content-mini')]);
const baseFacts = () => emptyFacts('char:test');
const rules = () => ({ restRules: index.system().restRules, hpRules: index.system().hpRules });

const fighter = 'core-mini:class/fighter';

describe('pendingAdvancements', () => {
  it('is empty at creation (level 0), regardless of xp', () => {
    const facts = baseFacts();
    facts.xp = 999999;
    const sheet = derive(facts, index, rules());
    expect(pendingAdvancements(sheet, facts, index)).toEqual([]);
  });

  it('is absent one xp below the threshold for the next level', () => {
    const facts = baseFacts();
    facts.classes = [{ classId: fighter, level: 1 }];
    facts.xp = 299; // core-mini xp table: xp[1] = 300
    const sheet = derive(facts, index, rules());
    expect(pendingAdvancements(sheet, facts, index)).toEqual([]);
  });

  it('is present exactly at the xp threshold, with hpChoice true and empty steps (fighter level-2 row has no choices)', () => {
    const facts = baseFacts();
    facts.classes = [{ classId: fighter, level: 1 }];
    facts.xp = 300;
    const sheet = derive(facts, index, rules());
    expect(pendingAdvancements(sheet, facts, index)).toEqual([
      { classId: fighter, toLevel: 2, steps: [], hpChoice: true, isNewClass: false },
    ]);
  });

  it("materializes the subclass choice in `steps` once toLevel reaches the class's subclassLevel", () => {
    const facts = baseFacts();
    facts.classes = [{ classId: fighter, level: 2 }];
    facts.xp = 900; // xp[2] = 900
    const sheet = derive(facts, index, rules());
    expect(pendingAdvancements(sheet, facts, index)).toEqual([
      {
        classId: fighter,
        toLevel: 3,
        steps: [{ choiceId: `${fighter}@3/subclass`, ownerId: fighter, count: 1 }],
        hpChoice: true,
        isNewClass: false,
      },
    ]);
  });

  it('lists only classes the character already has when the system declares no multiclass.prerequisites (content-mini/core-mini compat: no auto-multiclass entries)', () => {
    const facts = baseFacts();
    facts.classes = [{ classId: fighter, level: 1 }];
    facts.xp = 300;
    const sheet = derive(facts, index, rules());
    const advancements = pendingAdvancements(sheet, facts, index);
    expect(advancements).toHaveLength(1);
    expect(advancements[0]!.classId).toBe(fighter);
    expect(advancements[0]!.isNewClass).toBe(false);
  });
});

describe('pendingAdvancements: ruling 7 — new-class (multiclass) offers gated by system.multiclass.prerequisites', () => {
  const mcIndex = createContentIndex([loadFixturePack('core-mini'), loadFixturePack('multiclass-mini')]);
  const mcRules = () => ({ restRules: mcIndex.system().restRules, hpRules: mcIndex.system().hpRules });
  const wizard = 'multiclass-mini:class/wizard';
  const druid = 'core-mini:class/druid';

  const withScores = (int: number, wis: number) => {
    const facts = emptyFacts('char:test');
    facts.decisions['core-mini:system/mini@0/ability-scores'] = [
      'str:10',
      'dex:10',
      'con:10',
      `int:${int}`,
      `wis:${wis}`,
      'cha:10',
    ];
    facts.classes = [{ classId: fighter, level: 1 }];
    facts.xp = 300; // meets the fighter 1->2 threshold too
    return facts;
  };

  it('offers a new class (wizard) once its ability-score prerequisite (int >= 13) is met, alongside the existing fighter level-up entry', () => {
    const facts = withScores(15, 8); // int 15 meets wizard; wis 8 fails druid
    const sheet = derive(facts, mcIndex, mcRules());
    const advancements = pendingAdvancements(sheet, facts, mcIndex);

    expect(advancements).toEqual([
      { classId: fighter, toLevel: 2, steps: [], hpChoice: true, isNewClass: false },
      { classId: wizard, toLevel: 1, steps: [], hpChoice: false, isNewClass: true },
    ]);
  });

  it('omits a candidate class whose ability-score prerequisite is not met (wis 8 fails druid)', () => {
    const facts = withScores(15, 8);
    const sheet = derive(facts, mcIndex, mcRules());
    const advancements = pendingAdvancements(sheet, facts, mcIndex);
    expect(advancements.some((a) => a.classId === druid)).toBe(false);
  });

  it('never re-offers a class the character already has, even though it also appears in system.multiclass.prerequisites', () => {
    const facts = withScores(8, 8); // fails every OTHER class's prerequisite
    const sheet = derive(facts, mcIndex, mcRules());
    const advancements = pendingAdvancements(sheet, facts, mcIndex);
    // Fighter's own prerequisite (str >= 13) is irrelevant here — it's excluded for being already taken.
    expect(advancements).toEqual([{ classId: fighter, toLevel: 2, steps: [], hpChoice: true, isNewClass: false }]);
  });
});
