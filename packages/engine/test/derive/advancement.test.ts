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
      { classId: fighter, toLevel: 2, steps: [], hpChoice: true },
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
      },
    ]);
  });

  it('lists only classes the character already has (no auto-multiclass entries)', () => {
    const facts = baseFacts();
    facts.classes = [{ classId: fighter, level: 1 }];
    facts.xp = 300;
    const sheet = derive(facts, index, rules());
    const advancements = pendingAdvancements(sheet, facts, index);
    expect(advancements).toHaveLength(1);
    expect(advancements[0]!.classId).toBe(fighter);
  });
});
