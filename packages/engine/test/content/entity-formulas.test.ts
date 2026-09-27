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

  it('skips formula-grammar validation for row-extra values shaped like Dice or ExtraText (T1 carry, ruling 5)', () => {
    // Discrimination rule: a string `extra` value that parses as `DiceSchema` (e.g. Rage Damage
    // "1d6") or `ExtraTextSchema` (e.g. an ordinal column "1st") is a typed literal, not a formula —
    // it must NOT reach `validateFormula()` (which would reject it: "d" and a leading digit aren't
    // legal formula grammar). A genuine formula string (uses an operator/paren/function) still does.
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
          choices: [],
          extra: { rage: '1d6', ordinal: '1st', bonus: 'level + 2' },
        },
      ],
    } as unknown as Entity;
    expect(collectEntityFormulas(cls)).toEqual([
      { path: 'levels.0.extra.bonus', src: 'level + 2', allowComparison: false },
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

// Plan 11 final wave F2 (ledger Carry-V): the `system` entity's own formula/predicate sites —
// `multiclass.prerequisites` (predicates) and `encumbrance.{standard,variant}.capacity` /
// `variant.thresholds[].capacity` (formulas) — are deep-validated like every other entity's.
describe('collectEntityPredicates / collectEntityFormulas (system arm)', () => {
  const systemWith = (extra: Record<string, unknown>): Entity => {
    const sys = loadFixturePack('core-mini').entities.find((e) => e.type === 'system')!;
    return { ...sys, ...extra };
  };

  it('collects multiclass prerequisites and encumbrance capacities', () => {
    const sys = systemWith({
      multiclass: { prerequisites: { fighter: { any: [{ formula: 'score(str) >= 13' }, { tag: 't' }] } } },
      encumbrance: {
        standard: { capacity: 'score(str) * 15' },
        variant: {
          capacity: 'score(str) * 15',
          thresholds: [{ capacity: 'score(str) * 5', state: 'encumbered', speedPenalty: 10 }],
        },
      },
    });
    expect(collectEntityPredicates(sys)).toEqual([
      { path: 'multiclass.prerequisites.fighter', p: { any: [{ formula: 'score(str) >= 13' }, { tag: 't' }] } },
    ]);
    expect(collectEntityFormulas(sys)).toEqual([
      { path: 'multiclass.prerequisites.fighter.any.0.formula', src: 'score(str) >= 13', allowComparison: true },
      { path: 'encumbrance.standard.capacity', src: 'score(str) * 15', allowComparison: false },
      { path: 'encumbrance.variant.capacity', src: 'score(str) * 15', allowComparison: false },
      { path: 'encumbrance.variant.thresholds.0.capacity', src: 'score(str) * 5', allowComparison: false },
    ]);
  });

  it('validatePack reports a malformed system capacity formula and prerequisite predicate', () => {
    const pack = loadFixturePack('core-mini');
    const i = pack.entities.findIndex((e) => e.type === 'system');
    pack.entities[i] = {
      ...pack.entities[i]!,
      multiclass: { prerequisites: { fighter: { formula: 'score(str) >=' } } },
      encumbrance: { standard: { capacity: 'score(str) *' } },
    } as Entity;
    const d = validatePack(pack, []);
    expect(d.map((x) => [x.code, x.path])).toEqual([
      ['formula.syntax', `entities.${i}.multiclass.prerequisites.fighter.formula`],
      ['formula.syntax', `entities.${i}.encumbrance.standard.capacity`],
    ]);
    expect(d.every((x) => x.entityId === pack.entities[i]!.id)).toBe(true);
  });

  it('validatePack shape-checks a too-deep multiclass prerequisite', () => {
    const pack = loadFixturePack('core-mini');
    const i = pack.entities.findIndex((e) => e.type === 'system');
    pack.entities[i] = {
      ...pack.entities[i]!,
      multiclass: { prerequisites: { fighter: nest(PREDICATE_MAX_DEPTH + 1) } },
    } as Entity;
    expect(validatePack(pack, []).map((x) => x.code)).toContain('predicate.tooDeep');
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
