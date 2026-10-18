import type { Choice, Pack } from '@hk/protocol';
import { describe, expect, it } from 'vitest';
import { createContentIndex } from '../../src/content/index.ts';
import { validatePack } from '../../src/content/validate.ts';
import { pendingAdvancements } from '../../src/derive/advancement.ts';
import { derive, outstandingChoices } from '../../src/derive/index.ts';
import { emptyFacts } from '../../src/reduce/facts.ts';
import { loadFixturePack } from '../support/fixtures.ts';

/**
 * Plan 14 task 1: "initial class" as a STRUCTURAL choice property. A class-row choice
 * (`at.kind === 'classLevel'`) may carry `scope`:
 * - `'initial'` — offered only while its owning class is `facts.classes[0]` (the class gained first);
 * - `'later'`   — offered only while its owning class is NOT `facts.classes[0]`;
 * - absent      — offered either way (every pre-task choice, unchanged).
 * The synthetic `@1/skills` / `@1/multiclass-skills` split (plan 12 W1, slug-based) stays as the
 * fallback mechanism for the class skill picks. `multiclass.gains.toolProficiencies` lets a LATER
 * class contribute tool proficiencies (`kind: 'tool'` rows) the way `gains` already narrows its
 * armor/weapons. Exercised over a synthetic mini pack (core-mini + multiclass-mini, patched).
 */

const FIGHTER = 'core-mini:class/fighter';
const DRUID = 'core-mini:class/druid';
const WIZARD = 'multiclass-mini:class/wizard';

const scoped = (classSlug: string, owner: string, slug: string, scope?: 'initial' | 'later', level = 1): Choice => ({
  id: `${owner}@${level}/${slug}`,
  prompt: slug,
  at: { kind: 'classLevel', class: classSlug, level },
  pick: { literal: 'text' },
  count: 1,
  unique: true,
  repeatableAt: [],
  prerequisites: [],
  ...(scope ? { scope } : {}),
});

function packs(): Pack[] {
  const core = structuredClone(loadFixturePack('core-mini'));
  const mc = structuredClone(loadFixturePack('multiclass-mini'));
  const druid = core.entities.find((e) => e.id === DRUID);
  if (druid?.type !== 'class') throw new Error('fixture drift');
  druid.levels[0]!.choices.push(
    scoped('druid', DRUID, 'only-initial', 'initial'),
    scoped('druid', DRUID, 'only-later', 'later'),
    scoped('druid', DRUID, 'either'),
  );
  // Fix round 1: the same trio on a new level-2 row, for level-up advancement steps (core-mini's
  // XP table stops at level 5, so the row must be reachable by a two-class character below that).
  if (druid.levels[1]?.level !== 5) throw new Error('fixture drift');
  druid.levels.splice(1, 0, {
    level: 2,
    grants: [],
    choices: [
      scoped('druid', DRUID, 'only-initial', 'initial', 2),
      scoped('druid', DRUID, 'only-later', 'later', 2),
      scoped('druid', DRUID, 'either', undefined, 2),
    ],
  });
  const wizard = mc.entities.find((e) => e.id === WIZARD);
  if (wizard?.type !== 'class' || !wizard.multiclass) throw new Error('fixture drift');
  wizard.multiclass.gains = { ...wizard.multiclass.gains, skillChoiceCount: 1, toolProficiencies: ['thieves-tools'] };
  return [core, mc];
}

const index = createContentIndex(packs());

const factsWith = (classes: { classId: string; level: number }[]) => {
  const facts = emptyFacts('char:test');
  facts.decisions['core-mini:system/mini@0/ability-scores'] = [
    'str:13',
    'dex:13',
    'con:13',
    'int:13',
    'wis:13',
    'cha:13',
  ];
  facts.classes = classes;
  return facts;
};
const offered = (classes: { classId: string; level: number }[]) =>
  outstandingChoices(factsWith(classes), index).map((r) => r.choiceId);

describe('class-choice scope (plan 14 task 1)', () => {
  it("'initial' is offered only while the owning class is the first class; absent scope always", () => {
    const solo = offered([{ classId: DRUID, level: 1 }]);
    expect(solo).toContain(`${DRUID}@1/only-initial`);
    expect(solo).toContain(`${DRUID}@1/either`);
    expect(solo).not.toContain(`${DRUID}@1/only-later`);
  });

  it("'later' is offered only while the owning class is NOT the first class; absent scope always", () => {
    const later = offered([
      { classId: FIGHTER, level: 1 },
      { classId: DRUID, level: 1 },
    ]);
    expect(later).toContain(`${DRUID}@1/only-later`);
    expect(later).toContain(`${DRUID}@1/either`);
    expect(later).not.toContain(`${DRUID}@1/only-initial`);
  });

  it('a recorded decision on an out-of-scope choice is still a known choice (no unknownChoice warning)', () => {
    const facts = factsWith([
      { classId: FIGHTER, level: 1 },
      { classId: DRUID, level: 1 },
    ]);
    facts.decisions[`${DRUID}@1/only-initial`] = ['legacy answer'];
    expect(derive(facts, index).issues.map((i) => i.code)).not.toContain('decision.unknownChoice');
  });

  it('slug fallback (no scope on the synthetic skill picks): the initial class asks @1/skills, a later class with gains asks @1/multiclass-skills', () => {
    const solo = outstandingChoices(factsWith([{ classId: WIZARD, level: 1 }]), index);
    expect(solo).toContainEqual({ choiceId: `${WIZARD}@1/skills`, ownerId: WIZARD, count: 1 });
    expect(solo.map((r) => r.choiceId)).not.toContain(`${WIZARD}@1/multiclass-skills`);

    const later = outstandingChoices(
      factsWith([
        { classId: FIGHTER, level: 1 },
        { classId: WIZARD, level: 1 },
      ]),
      index,
    );
    expect(later).toContainEqual({ choiceId: `${WIZARD}@1/multiclass-skills`, ownerId: WIZARD, count: 1 });
    expect(later.map((r) => r.choiceId)).not.toContain(`${WIZARD}@1/skills`);
    // Compat: a later class with no multiclass data at all keeps its full @1/skills pick.
    const legacy = offered([
      { classId: FIGHTER, level: 1 },
      { classId: DRUID, level: 1 },
    ]);
    expect(legacy).toContain(`${DRUID}@1/skills`);
  });
});

describe('multiclass.gains.toolProficiencies (plan 14 task 1)', () => {
  const tools = (classes: { classId: string; level: number }[]) =>
    derive(factsWith(classes), index).proficiencies.filter((p) => p.kind === 'tool');

  it('a LATER class contributes its gains.toolProficiencies as kind tool rows', () => {
    expect(
      tools([
        { classId: FIGHTER, level: 1 },
        { classId: WIZARD, level: 1 },
      ]),
    ).toEqual([{ kind: 'tool', target: 'thieves-tools', level: 'proficient', sources: [WIZARD] }]);
  });

  it('the INITIAL class contributes its own toolProficiencies, never its gains list', () => {
    expect(tools([{ classId: WIZARD, level: 1 }])).toEqual([]);
  });
});

describe('pack validation: scope only on class-row choices (plan 14 task 1)', () => {
  const core = loadFixturePack('core-mini');

  it('a scope on a non-classLevel choice is a choice.scopeOnNonClassChoice error', () => {
    const pack = structuredClone(core);
    const system = pack.entities.find((e) => e.type === 'system')!;
    const k = system.choices.findIndex((c) => c.at.kind === 'creation');
    (system.choices[k] as Choice & { scope?: string }).scope = 'initial';
    const d = validatePack(pack, []);
    expect(d.map((x) => [x.code, x.severity])).toEqual([['choice.scopeOnNonClassChoice', 'error']]);
    expect(d[0]?.path).toBe(`entities.${pack.entities.indexOf(system)}.choices.${k}.scope`);
  });

  it('a scope on a class-row choice is legal', () => {
    const pack = structuredClone(core);
    const fighter = pack.entities.find((e) => e.id === FIGHTER);
    if (fighter?.type !== 'class') throw new Error('fixture drift');
    (fighter.levels[0]!.choices[0] as Choice & { scope?: string }).scope = 'later';
    expect(validatePack(pack, [])).toEqual([]);
  });
});

describe('fix round 1: an answered initial-scoped sibling suppresses the later-scoped choice', () => {
  it('a later class whose initial-scoped row choice already has a (legacy) decision is not offered the later-scoped sibling', () => {
    const facts = factsWith([
      { classId: FIGHTER, level: 1 },
      { classId: DRUID, level: 1 },
    ]);
    facts.decisions[`${DRUID}@1/only-initial`] = ['legacy answer'];
    const ids = outstandingChoices(facts, index).map((r) => r.choiceId);
    expect(ids).not.toContain(`${DRUID}@1/only-later`);
    expect(ids).not.toContain(`${DRUID}@1/only-initial`);
    expect(ids).toContain(`${DRUID}@1/either`);
  });
});

describe('fix round 1: level-up advancement steps honor scope', () => {
  const stepsFor = (classes: { classId: string; level: number }[], decisions: Record<string, string[]> = {}) => {
    const facts = factsWith(classes);
    Object.assign(facts.decisions, decisions);
    facts.xp = 10_000_000;
    const sheet = derive(facts, index);
    return pendingAdvancements(sheet, facts, index)
      .find((a) => a.classId === DRUID)
      ?.steps.map((s) => s.choiceId);
  };

  it('the initial class levelling into a row is asked its initial-scoped and unscoped choices only', () => {
    expect(stepsFor([{ classId: DRUID, level: 1 }])).toEqual([`${DRUID}@2/only-initial`, `${DRUID}@2/either`]);
  });

  it('a later class levelling into a row is asked its later-scoped and unscoped choices only', () => {
    expect(
      stepsFor([
        { classId: FIGHTER, level: 1 },
        { classId: DRUID, level: 1 },
      ]),
    ).toEqual([`${DRUID}@2/only-later`, `${DRUID}@2/either`]);
  });

  it('a later class whose initial-scoped sibling is already answered is not asked the later-scoped one', () => {
    expect(
      stepsFor(
        [
          { classId: FIGHTER, level: 1 },
          { classId: DRUID, level: 1 },
        ],
        { [`${DRUID}@2/only-initial`]: ['legacy answer'] },
      ),
    ).toEqual([`${DRUID}@2/either`]);
  });
});
