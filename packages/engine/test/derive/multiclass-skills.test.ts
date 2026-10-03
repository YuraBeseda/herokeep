import { describe, expect, it } from 'vitest';
import { classSkillPick, multiclassSkillsChoiceId } from '../../src/content/choices.ts';
import { createContentIndex } from '../../src/content/index.ts';
import { derive, outstandingChoices } from '../../src/derive/index.ts';
import { validateSelection } from '../../src/derive/validation.ts';
import { emptyFacts } from '../../src/reduce/facts.ts';
import { loadFixturePack } from '../support/fixtures.ts';
import { loadDistPack } from '../support/golden.ts';

/**
 * Plan 12 final wave W1: `multiclass.gains.skillChoiceCount` → a bonus skill pick on multiclass entry.
 * The vendored rule (`srd-2024_multiclassing_proficiencies`): "When you gain your first level in a
 * class other than your initial class, you gain only some of the new class's starting proficiencies"
 * — so the pick draws from the new class's OWN starting-skill list (`skillChoice.from`), `gains
 * .skillChoiceCount` of them, and the class's full creation-time `<class>@1/skills` pick is reserved
 * for the INITIAL class. Exercised on the real SRD pack (bard / rogue carry `skillChoiceCount: 1`,
 * barbarian `0`).
 */
const srd = createContentIndex([loadDistPack('srd-5e-2024')]);
const rules = () => ({ restRules: srd.system().restRules, hpRules: srd.system().hpRules });

const FIGHTER = 'srd-5e-2024:class/fighter';
const BARD = 'srd-5e-2024:class/bard';
const ROGUE = 'srd-5e-2024:class/rogue';
const BARBARIAN = 'srd-5e-2024:class/barbarian';

const factsWith = (classes: { classId: string; level: number }[]) => {
  const facts = emptyFacts('char:test');
  facts.decisions['srd-5e-2024:system/5e-2024@0/ability-scores'] = [
    'str:15',
    'dex:13',
    'con:14',
    'int:10',
    'wis:12',
    'cha:13',
  ];
  facts.classes = classes;
  return facts;
};

const ids = (facts: ReturnType<typeof factsWith>) => outstandingChoices(facts, srd).map((r) => r.choiceId);

describe('multiclass bonus skill pick (W1)', () => {
  it('the choice id is the class-level-1 `multiclass-skills` slug, distinct from `<class>@1/skills`', () => {
    expect(multiclassSkillsChoiceId(BARD)).toBe(`${BARD}@1/multiclass-skills`);
    expect(multiclassSkillsChoiceId(BARD)).not.toBe(`${BARD}@1/skills`);
  });

  it("fighter → bard: offers ONE pick from bard's list (gains.skillChoiceCount), and no longer bard's full 3-skill creation pick", () => {
    const facts = factsWith([
      { classId: FIGHTER, level: 1 },
      { classId: BARD, level: 1 },
    ]);
    const requests = outstandingChoices(facts, srd);
    expect(requests).toContainEqual({ choiceId: `${BARD}@1/multiclass-skills`, ownerId: BARD, count: 1 });
    expect(requests.map((r) => r.choiceId)).not.toContain(`${BARD}@1/skills`);
    // The initial class keeps its own full creation pick.
    expect(requests).toContainEqual({ choiceId: `${FIGHTER}@1/skills`, ownerId: FIGHTER, count: 2 });
  });

  it('fighter → barbarian (skillChoiceCount 0): no skill pick of either shape for the new class', () => {
    const list = ids(
      factsWith([
        { classId: FIGHTER, level: 1 },
        { classId: BARBARIAN, level: 1 },
      ]),
    );
    expect(list).not.toContain(`${BARBARIAN}@1/skills`);
    expect(list).not.toContain(`${BARBARIAN}@1/multiclass-skills`);
  });

  it('a single-class bard (initial class) is never offered the multiclass pick', () => {
    const list = ids(factsWith([{ classId: BARD, level: 2 }]));
    expect(list).toContain(`${BARD}@1/skills`);
    expect(list).not.toContain(`${BARD}@1/multiclass-skills`);
  });

  it('the pick lands as a proficiency, clears the outstanding entry, and is not reported as an unknown choice', () => {
    const facts = factsWith([
      { classId: FIGHTER, level: 1 },
      { classId: BARD, level: 1 },
    ]);
    facts.decisions[`${BARD}@1/multiclass-skills`] = ['arcana'];
    const sheet = derive(facts, srd, rules());
    expect(sheet.skills['arcana']?.proficiency).toBe('proficient');
    expect(sheet.outstandingChoices.map((r) => r.choiceId)).not.toContain(`${BARD}@1/multiclass-skills`);
    expect(sheet.issues.map((i) => i.code)).not.toContain('decision.unknownChoice');
  });

  it("a recorded pick outside the class's own list grants nothing (warning), mirroring `<class>@1/skills`", () => {
    const facts = factsWith([
      { classId: FIGHTER, level: 1 },
      { classId: ROGUE, level: 1 },
    ]);
    facts.decisions[`${ROGUE}@1/multiclass-skills`] = ['arcana']; // not on the rogue list
    const sheet = derive(facts, srd, rules());
    expect(sheet.skills['arcana']?.proficiency).toBe('none');
    expect(sheet.issues.map((i) => i.code)).toContain('derive.unknownSkill');
  });

  it('validateSelection checks the multiclass pick against the class list and gains count', () => {
    const facts = factsWith([
      { classId: FIGHTER, level: 1 },
      { classId: ROGUE, level: 1 },
    ]);
    const sheet = derive(facts, srd, rules());
    const id = `${ROGUE}@1/multiclass-skills`;
    expect(validateSelection(sheet, facts, srd, id, ['stealth'])).toEqual([]);
    const codes = (sel: string[]) => validateSelection(sheet, facts, srd, id, sel).map((d) => d.code);
    expect(codes(['stealth', 'acrobatics'])).toContain('selection.count');
    expect(codes(['arcana'])).toContain('selection.notOffered');
  });

  it('classSkillPick resolves both synthetic shapes to the class list with the right count', () => {
    expect(classSkillPick(`${BARD}@1/skills`, srd)).toMatchObject({ classId: BARD, count: 3 });
    expect(classSkillPick(`${BARD}@1/multiclass-skills`, srd)).toMatchObject({ classId: BARD, count: 1 });
    expect(classSkillPick(`${BARD}@1/multiclass-skills`, srd)?.from).toContain('arcana');
    expect(classSkillPick(`${BARD}@2/skills`, srd)).toBeUndefined();
    expect(classSkillPick(`${BARD}@1/weapon-masteries`, srd)).toBeUndefined();
  });
});

describe('multiclass skill pick — compat with classes carrying no `multiclass.gains`', () => {
  // Ruling 7's compat clause (derive/index.ts `deriveProficiencies`): a later class with no
  // `multiclass`/`gains` data keeps behaving exactly as before — here, its full `@1/skills` pick.
  const mini = createContentIndex([loadFixturePack('core-mini')]);
  it('a later fixture class without gains data still gets its full `<class>@1/skills` pick', () => {
    const facts = emptyFacts('char:test');
    facts.classes = [
      { classId: 'core-mini:class/fighter', level: 1 },
      { classId: 'core-mini:class/druid', level: 1 },
    ];
    const list = outstandingChoices(facts, mini).map((r) => r.choiceId);
    expect(list).toContain('core-mini:class/druid@1/skills');
    expect(list).not.toContain('core-mini:class/druid@1/multiclass-skills');
  });
});
