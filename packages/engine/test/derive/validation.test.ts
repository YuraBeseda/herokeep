import { parsePack } from '@hk/protocol';
import { describe, expect, it } from 'vitest';
import { createContentIndex } from '../../src/content/index.ts';
import { derive } from '../../src/derive/index.ts';
import { validateSelection } from '../../src/derive/validation.ts';
import { emptyFacts } from '../../src/reduce/facts.ts';
import { loadFixturePack } from '../support/fixtures.ts';

const valMiniRaw = {
  format: 1,
  id: 'val-mini',
  version: '1.0.0',
  kind: 'content',
  system: 'mini',
  name: 'Validation test content',
  entities: [
    {
      id: 'val-mini:feat/mighty',
      type: 'feat',
      name: 'Mighty',
      category: 'general',
      prerequisites: [{ ability: { str: { gte: 15 } } }],
    },
    {
      id: 'val-mini:class/tester',
      type: 'class',
      name: 'Tester',
      hitDie: 8,
      primaryAbility: ['str'],
      saves: ['str', 'con'],
      skillChoice: { from: ['athletics'], count: 1 },
      subclassLevel: 3,
      levels: [
        {
          level: 1,
          choices: [
            {
              id: 'val-mini:class/tester@1/gear',
              prompt: 'Gear',
              at: { kind: 'classLevel', class: 'tester', level: 1 },
              pick: { static: ['core-mini:item/longsword', 'core-mini:item/rapier', 'core-mini:item/shortbow'] },
              count: 2,
            },
            {
              id: 'val-mini:class/tester@1/feat',
              prompt: 'Feat',
              at: { kind: 'classLevel', class: 'tester', level: 1 },
              pick: { query: { type: 'feat' } },
              count: 1,
            },
          ],
        },
      ],
    },
    {
      id: 'val-mini:class/tester2',
      type: 'class',
      name: 'Tester Two',
      hitDie: 8,
      primaryAbility: ['str'],
      saves: ['str'],
      skillChoice: { from: ['athletics'], count: 0 },
      subclassLevel: 5,
      levels: [
        {
          level: 3,
          choices: [
            {
              id: 'val-mini:class/tester2@3/subclass',
              prompt: 'Subclass',
              at: { kind: 'classLevel', class: 'tester2', level: 3 },
              pick: { query: { type: 'subclass', classes: ['tester2'] } },
              count: 1,
            },
          ],
        },
      ],
    },
    {
      id: 'val-mini:subclass/tester-sub',
      type: 'subclass',
      name: 'Tester Sub',
      class: 'val-mini:class/tester2',
      levels: [{ level: 1 }],
    },
  ],
};

const parsedValMini = parsePack(valMiniRaw);
if (!parsedValMini.ok) throw new Error(JSON.stringify(parsedValMini.issues));

const index = createContentIndex([loadFixturePack('core-mini'), loadFixturePack('content-mini'), parsedValMini.pack]);
const baseFacts = () => emptyFacts('char:test');
const sheetFor = (facts: ReturnType<typeof baseFacts>) => derive(facts, index);

const fighter = 'core-mini:class/fighter';
const fightingStyleChoice = `${fighter}@1/fighting-style`;
const equipmentChoice = `${fighter}@1/equipment`;
const masteryChoice = `${fighter}@1/weapon-masteries`;
const skillsChoice = `${fighter}@1/skills`;
const gearChoice = 'val-mini:class/tester@1/gear';
const featChoice = 'val-mini:class/tester@1/feat';
const abilityScoresChoice = 'core-mini:system/mini@0/ability-scores';
const acolyteBonusChoice = 'core-mini:background/acolyte@0/ability-scores';
const subclassMismatchChoice = 'val-mini:class/tester2@3/subclass';

const codes = (issues: { code: string }[]) => issues.map((i) => i.code);

describe('validateSelection', () => {
  it('rejects an unknown choice id', () => {
    const facts = baseFacts();
    const sheet = sheetFor(facts);
    expect(codes(validateSelection(sheet, facts, index, 'core-mini:system/mini@0/nope', ['x']))).toEqual([
      'selection.unknownChoice',
    ]);
  });

  describe('static pick', () => {
    it('passes a valid in-list selection at the right count', () => {
      const facts = baseFacts();
      const sheet = sheetFor(facts);
      const issues = validateSelection(sheet, facts, index, gearChoice, [
        'core-mini:item/longsword',
        'core-mini:item/rapier',
      ]);
      expect(issues).toEqual([]);
    });

    it('fails when a selected id is not offered by the choice', () => {
      const facts = baseFacts();
      const sheet = sheetFor(facts);
      const issues = validateSelection(sheet, facts, index, gearChoice, [
        'core-mini:item/longsword',
        'core-mini:item/chain-mail',
      ]);
      expect(codes(issues)).toContain('selection.notOffered');
    });

    it('fails on a duplicate selection (unique)', () => {
      const facts = baseFacts();
      const sheet = sheetFor(facts);
      const issues = validateSelection(sheet, facts, index, gearChoice, [
        'core-mini:item/longsword',
        'core-mini:item/longsword',
      ]);
      expect(codes(issues)).toContain('selection.duplicate');
    });
  });

  describe('query pick', () => {
    it('passes an entity matching the query', () => {
      const facts = baseFacts();
      const sheet = sheetFor(facts);
      expect(validateSelection(sheet, facts, index, fightingStyleChoice, ['core-mini:feat/defense'])).toEqual([]);
    });

    it('fails an entity that does not match the query tags', () => {
      const facts = baseFacts();
      const sheet = sheetFor(facts);
      const issues = validateSelection(sheet, facts, index, fightingStyleChoice, ['core-mini:feat/alert']);
      expect(codes(issues)).toContain('selection.notOffered');
    });
  });

  describe('prerequisites', () => {
    it("passes a selected entity's prerequisites when the sheet satisfies them", () => {
      const facts = baseFacts();
      facts.decisions[abilityScoresChoice] = ['str:15', 'dex:10', 'con:10', 'int:10', 'wis:10', 'cha:10'];
      const sheet = sheetFor(facts);
      const issues = validateSelection(sheet, facts, index, featChoice, ['val-mini:feat/mighty']);
      expect(codes(issues)).not.toContain('selection.prerequisiteFailed');
    });

    it("fails when the selected entity's prerequisites are not met", () => {
      const facts = baseFacts();
      const sheet = sheetFor(facts); // str defaults to 10
      const issues = validateSelection(sheet, facts, index, featChoice, ['val-mini:feat/mighty']);
      expect(codes(issues)).toContain('selection.prerequisiteFailed');
    });
  });

  describe('subclass level (controller ruling)', () => {
    it('does not flag a subclass choice whose level matches the class subclassLevel', () => {
      const facts = baseFacts();
      facts.classes = [{ classId: fighter, level: 3 }];
      const sheet = sheetFor(facts);
      const issues = validateSelection(sheet, facts, index, `${fighter}@3/subclass`, ['core-mini:subclass/champion']);
      expect(codes(issues)).not.toContain('selection.subclassLevel');
    });

    it("flags a subclass choice whose declared level doesn't match the class's subclassLevel", () => {
      const facts = baseFacts();
      const sheet = sheetFor(facts);
      const issues = validateSelection(sheet, facts, index, subclassMismatchChoice, ['val-mini:subclass/tester-sub']);
      expect(codes(issues)).toContain('selection.subclassLevel');
    });
  });

  describe('abilities pick', () => {
    it('passes a selection matching the improve grammar', () => {
      const facts = baseFacts();
      const sheet = sheetFor(facts);
      expect(validateSelection(sheet, facts, index, acolyteBonusChoice, ['int:+2', 'wis:+1'])).toEqual([]);
    });

    it('fails a selection that does not match the improve grammar', () => {
      const facts = baseFacts();
      const sheet = sheetFor(facts);
      const issues = validateSelection(sheet, facts, index, acolyteBonusChoice, ['int:+1', 'wis:+1']);
      expect(codes(issues)).toContain('selection.abilityImproveShape');
    });
  });

  describe('abilityGeneration pick', () => {
    it('passes a standardArray selection matching the array exactly', () => {
      const facts = baseFacts();
      facts.decisionContexts[abilityScoresChoice] = { method: 'standardArray' };
      const sheet = sheetFor(facts);
      const issues = validateSelection(sheet, facts, index, abilityScoresChoice, [
        'str:15',
        'dex:14',
        'con:13',
        'int:12',
        'wis:10',
        'cha:8',
      ]);
      expect(issues).toEqual([]);
    });

    it('fails a standardArray selection with the wrong multiset', () => {
      const facts = baseFacts();
      facts.decisionContexts[abilityScoresChoice] = { method: 'standardArray' };
      const sheet = sheetFor(facts);
      const issues = validateSelection(sheet, facts, index, abilityScoresChoice, [
        'str:15',
        'dex:14',
        'con:13',
        'int:12',
        'wis:10',
        'cha:9',
      ]);
      expect(codes(issues)).toContain('selection.standardArrayMismatch');
    });

    it('fails a pointBuy selection that exceeds the budget', () => {
      const facts = baseFacts();
      facts.decisionContexts[abilityScoresChoice] = { method: 'pointBuy' };
      const sheet = sheetFor(facts);
      const issues = validateSelection(sheet, facts, index, abilityScoresChoice, [
        'str:15',
        'dex:15',
        'con:15',
        'int:15',
        'wis:15',
        'cha:8',
      ]);
      expect(codes(issues)).toContain('selection.pointBuyBudget');
    });

    it('passes a pointBuy selection within budget and range', () => {
      const facts = baseFacts();
      facts.decisionContexts[abilityScoresChoice] = { method: 'pointBuy' };
      const sheet = sheetFor(facts);
      const issues = validateSelection(sheet, facts, index, abilityScoresChoice, [
        'str:15',
        'dex:14',
        'con:13',
        'int:8',
        'wis:8',
        'cha:8',
      ]);
      expect(codes(issues)).not.toContain('selection.pointBuyBudget');
      expect(codes(issues)).not.toContain('selection.pointBuyRange');
    });
  });

  describe('literal pick', () => {
    it('passes any text at the right count', () => {
      const facts = baseFacts();
      const sheet = sheetFor(facts);
      expect(validateSelection(sheet, facts, index, masteryChoice, ['sap'])).toEqual([]);
    });

    it('fails at the wrong count', () => {
      const facts = baseFacts();
      const sheet = sheetFor(facts);
      const issues = validateSelection(sheet, facts, index, masteryChoice, []);
      expect(codes(issues)).toContain('selection.count');
    });
  });

  describe('equipmentOption pick', () => {
    it('accepts any bundle selection at the right count', () => {
      const facts = baseFacts();
      const sheet = sheetFor(facts);
      expect(validateSelection(sheet, facts, index, equipmentChoice, ['anything-goes'])).toEqual([]);
    });

    it('fails at the wrong count', () => {
      const facts = baseFacts();
      const sheet = sheetFor(facts);
      const issues = validateSelection(sheet, facts, index, equipmentChoice, []);
      expect(codes(issues)).toContain('selection.count');
    });
  });

  describe('R5 synthetic <classId>@1/skills', () => {
    it('passes a valid skill selection at the right count', () => {
      const facts = baseFacts();
      const sheet = sheetFor(facts);
      expect(validateSelection(sheet, facts, index, skillsChoice, ['athletics', 'perception'])).toEqual([]);
    });

    it('fails a skill not offered by the class', () => {
      const facts = baseFacts();
      const sheet = sheetFor(facts);
      const issues = validateSelection(sheet, facts, index, skillsChoice, ['athletics', 'swimming']);
      expect(codes(issues)).toContain('selection.notOffered');
    });

    it('fails at the wrong count', () => {
      const facts = baseFacts();
      const sheet = sheetFor(facts);
      const issues = validateSelection(sheet, facts, index, skillsChoice, ['athletics']);
      expect(codes(issues)).toContain('selection.count');
    });
  });
});
