import type { Entity, Predicate } from '@hk/protocol';
import { describe, expect, it } from 'vitest';
import { collectEntityFormulas, collectEntityPredicates } from '../../src/content/entity-formulas.ts';
import { validatePack } from '../../src/content/validate.ts';
import { PREDICATE_MAX_DEPTH, checkPredicateShape } from '../../src/predicate/depth.ts';
import { loadFixturePack } from '../support/fixtures.ts';

const nest = (depth: number): Predicate => {
  let p: Predicate = { tag: 'leaf' };
  for (let i = 0; i < depth; i++) p = { not: p };
  return p;
};

describe('collectEntityFormulas', () => {
  it('collects uses.count, charges.max, row extra values, and prerequisite/when predicate formulas', () => {
    const feature = {
      id: 'x-pack:feature/f',
      type: 'feature',
      name: 'F',
      tags: [],
      prerequisites: [{ formula: 'level >= 2' }],
      effects: [],
      grants: [{ feature: 'x-pack:feature/g', when: { formula: 'prof >= 3' } }],
      choices: [],
      uses: { count: 'prof', per: 'longRest' },
    } as unknown as Entity;
    expect(collectEntityFormulas(feature)).toEqual([
      { path: 'prerequisites.0.formula', src: 'level >= 2', allowComparison: true },
      { path: 'grants.0.when.formula', src: 'prof >= 3', allowComparison: true },
      { path: 'uses.count', src: 'prof', allowComparison: false },
    ]);

    const item = {
      id: 'x-pack:item/i',
      type: 'item',
      name: 'I',
      tags: [],
      prerequisites: [],
      effects: [],
      grants: [],
      choices: [],
      category: 'magic',
      charges: { max: 'classLevel(wizard)', reset: 'dawn' },
    } as unknown as Entity;
    expect(collectEntityFormulas(item)).toEqual([
      { path: 'charges.max', src: 'classLevel(wizard)', allowComparison: false },
    ]);

    const cls = {
      id: 'x-pack:class/c',
      type: 'class',
      name: 'C',
      tags: [],
      prerequisites: [],
      effects: [],
      grants: [],
      choices: [],
      hitDie: 8,
      primaryAbility: ['int'],
      saves: ['int'],
      armorTraining: [],
      weaponProficiencies: [],
      toolProficiencies: [],
      skillChoice: { from: ['arcana'], count: 1 },
      subclassLevel: 3,
      levels: [
        {
          level: 1,
          grants: [],
          choices: [
            {
              id: 'x-pack:class/c@1/pick',
              prompt: 'P',
              at: { kind: 'classLevel', class: 'c', level: 1 },
              pick: { literal: 'text' },
              count: 1,
              unique: true,
              repeatableAt: [],
              prerequisites: [{ formula: 'mod(int) >= 1' }],
            },
          ],
          extra: { sneak: 'ceil(classLevel(c) / 2)', flat: 3 },
        },
      ],
    } as unknown as Entity;
    expect(collectEntityFormulas(cls)).toEqual([
      { path: 'levels.0.choices.0.prerequisites.0.formula', src: 'mod(int) >= 1', allowComparison: true },
      { path: 'levels.0.extra.sneak', src: 'ceil(classLevel(c) / 2)', allowComparison: false },
    ]);
  });
});

describe('collectEntityPredicates (class/subclass level-row grants)', () => {
  it('collects a row-grant "when" predicate, feeds it into collectEntityFormulas, and shape-checks it', () => {
    const clsBase = {
      id: 'x-pack:class/c',
      type: 'class',
      name: 'C',
      tags: [],
      prerequisites: [],
      effects: [],
      grants: [],
      choices: [],
      hitDie: 8,
      primaryAbility: ['int'],
      saves: ['int'],
      armorTraining: [],
      weaponProficiencies: [],
      toolProficiencies: [],
      skillChoice: { from: ['arcana'], count: 1 },
      subclassLevel: 3,
    };

    const cls = {
      ...clsBase,
      levels: [{ level: 1, grants: [{ feature: 'x-pack:feature/g', when: { formula: 'prof >= 2' } }], choices: [] }],
    } as unknown as Entity;

    expect(collectEntityPredicates(cls)).toEqual([{ path: 'levels.0.grants.0.when', p: { formula: 'prof >= 2' } }]);
    expect(collectEntityFormulas(cls)).toEqual([
      { path: 'levels.0.grants.0.when.formula', src: 'prof >= 2', allowComparison: true },
    ]);

    const tooDeep = {
      ...clsBase,
      levels: [
        { level: 1, grants: [{ feature: 'x-pack:feature/g', when: nest(PREDICATE_MAX_DEPTH + 1) }], choices: [] },
      ],
    } as unknown as Entity;
    const [site] = collectEntityPredicates(tooDeep);
    const d = checkPredicateShape(site!.p, site!.path, tooDeep.id);
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ severity: 'error', code: 'predicate.tooDeep', entityId: 'x-pack:class/c' });
  });
});

describe('validatePack wires entity formulas', () => {
  it('reports a syntax error in feature.uses.count with the entity path', () => {
    const pack = loadFixturePack('core-mini');
    const sw = pack.entities.find((e) => e.id === 'core-mini:feature/second-wind');
    if (sw?.type !== 'feature') throw new Error('fixture drift');
    (sw as { uses?: { count: string; per: string } }).uses = { count: 'prof +', per: 'shortRest' };
    const d = validatePack(pack, []);
    expect(d.map((x) => [x.code, x.path])).toEqual([
      ['formula.syntax', expect.stringMatching(/^entities\.\d+\.uses\.count$/)],
    ]);
    expect(d[0]?.entityId).toBe('core-mini:feature/second-wind');
  });
});
