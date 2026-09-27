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

describe('pendingAdvancements: ruling 7 — new-class (multiclass) offers gated by system.multiclass.prerequisites, both directions (2024 SRD)', () => {
  const mcIndex = createContentIndex([loadFixturePack('core-mini'), loadFixturePack('multiclass-mini')]);
  const mcRules = () => ({ restRules: mcIndex.system().restRules, hpRules: mcIndex.system().hpRules });
  const wizard = 'multiclass-mini:class/wizard';
  const druid = 'core-mini:class/druid';

  // multiclass-mini.json's system.multiclass.prerequisites map has entries ONLY for fighter
  // (str >= 13) and wizard (int >= 13) — druid has none, on purpose (absent-entry compat cases
  // below need a real class that's genuinely undocumented, not merely failing).
  const withScores = (str: number, int: number) => {
    const facts = emptyFacts('char:test');
    facts.decisions['core-mini:system/mini@0/ability-scores'] = [
      `str:${str}`,
      'dex:10',
      'con:10',
      `int:${int}`,
      'wis:10',
      'cha:10',
    ];
    facts.classes = [{ classId: fighter, level: 1 }];
    facts.xp = 300; // meets the fighter 1->2 threshold too
    return facts;
  };

  it('bars ALL new-class offers when an already-taken class (fighter) no longer meets its OWN prerequisite (str 10 < 13) — SRD: "...and your current classes"', () => {
    // Wizard's own prerequisite (int >= 13) is met here, but must not matter: fighter (already on
    // the sheet) fails its own str>=13, so the new-class pass must not run at all.
    const facts = withScores(10, 15);
    const sheet = derive(facts, mcIndex, mcRules());
    const advancements = pendingAdvancements(sheet, facts, mcIndex);
    expect(advancements).toEqual([{ classId: fighter, toLevel: 2, steps: [], hpChoice: true, isNewClass: false }]);
  });

  it("offers a new class (wizard) once BOTH directions hold: the new class's own prerequisite (int >= 13) AND the already-taken class's own prerequisite (fighter str >= 13)", () => {
    const facts = withScores(13, 15);
    const sheet = derive(facts, mcIndex, mcRules());
    const advancements = pendingAdvancements(sheet, facts, mcIndex);

    expect(advancements).toEqual([
      { classId: fighter, toLevel: 2, steps: [], hpChoice: true, isNewClass: false },
      { classId: wizard, toLevel: 1, steps: [], hpChoice: false, isNewClass: true },
    ]);
  });

  it("omits a candidate class whose OWN ability-score prerequisite is not met (wizard's int 8 fails), independently of the already-taken-class check passing", () => {
    const facts = withScores(13, 8); // fighter passes its own (str 13); wizard's own (int>=13) fails
    const sheet = derive(facts, mcIndex, mcRules());
    const advancements = pendingAdvancements(sheet, facts, mcIndex);
    expect(advancements.some((a) => a.classId === wizard)).toBe(false);
  });

  it('never re-offers a class the character already has, even when it passes its own prerequisite and appears in system.multiclass.prerequisites', () => {
    const facts = withScores(13, 8); // fighter passes its own; wizard fails its own (nothing new to offer)
    const sheet = derive(facts, mcIndex, mcRules());
    const advancements = pendingAdvancements(sheet, facts, mcIndex);
    expect(advancements.filter((a) => a.classId === fighter)).toHaveLength(1);
    expect(advancements).toEqual([{ classId: fighter, toLevel: 2, steps: [], hpChoice: true, isNewClass: false }]);
  });

  it('an already-taken class with NO entry in system.multiclass.prerequisites (druid) bars nothing — absent-data compat', () => {
    const facts = emptyFacts('char:test');
    facts.decisions['core-mini:system/mini@0/ability-scores'] = [
      'str:8',
      'dex:10',
      'con:10',
      'int:15',
      'wis:8',
      'cha:10',
    ];
    facts.classes = [{ classId: druid, level: 1 }]; // druid has no multiclass.prerequisites entry
    facts.xp = 300;
    const sheet = derive(facts, mcIndex, mcRules());
    const advancements = pendingAdvancements(sheet, facts, mcIndex);
    // Wizard's own prerequisite (int >= 13) is met, and druid (the only taken class) has no entry
    // to fail — so wizard is still offered despite druid's own str/wis being unrelatedly low.
    expect(advancements.some((a) => a.classId === wizard && a.isNewClass)).toBe(true);
  });

  it('sorts existing-class advancements before new-class offers, even when alphabetical id order would put a new class first', () => {
    // Phase 4 plan 11 task 7 finding: once a real content pack populates `system.multiclass.
    // prerequisites` for every class (as the SRD pack now does), a character's own EXISTING class
    // can alphabetically sort AFTER a class they merely QUALIFY to multiclass into — here,
    // `multiclass-mini:class/wizard` (existing) sorts after `core-mini:class/fighter` (a new-class
    // offer). A pure `byClassId` sort would put the new-class offer FIRST, which broke real
    // consumers that pick `pendingAdvancements()[0]` expecting their own class's normal level-up
    // (apps/web's `LevelUpState`, surfaced by the real SRD pack's own multiclass-eligible fixture
    // character). Existing-class entries must sort before new-class entries regardless of id.
    const facts = emptyFacts('char:test');
    facts.decisions['core-mini:system/mini@0/ability-scores'] = [
      'str:15',
      'dex:10',
      'con:10',
      'int:15',
      'wis:10',
      'cha:10',
    ];
    facts.classes = [{ classId: wizard, level: 1 }]; // 'multiclass-mini:...' sorts AFTER 'core-mini:...'
    facts.xp = 300;
    const sheet = derive(facts, mcIndex, mcRules());
    const advancements = pendingAdvancements(sheet, facts, mcIndex);
    expect(advancements.map((a) => ({ classId: a.classId, isNewClass: a.isNewClass }))).toEqual([
      { classId: wizard, isNewClass: false },
      { classId: fighter, isNewClass: true },
    ]);
  });
});
