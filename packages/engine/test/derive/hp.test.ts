import { describe, expect, it } from 'vitest';
import { createContentIndex } from '../../src/content/index.ts';
import { deriveAbilities } from '../../src/derive/abilities.ts';
import { compose } from '../../src/derive/composition.ts';
import { deriveHp } from '../../src/derive/hp.ts';
import { emptyFacts } from '../../src/reduce/facts.ts';
import type { SystemRules } from '../../src/reduce/facts.ts';
import { loadFixturePack } from '../support/fixtures.ts';

const index = createContentIndex([loadFixturePack('core-mini'), loadFixturePack('content-mini')]);
const baseFacts = () => emptyFacts('char:test');
const systemRules = (): SystemRules => {
  const sys = index.system();
  return { restRules: sys.restRules, hpRules: sys.hpRules };
};

describe('deriveHp', () => {
  it('prices HP level-by-level: level 1 max hit die, a rolled level clamped, and an average level rounded per hpRules', () => {
    const facts = baseFacts();
    facts.decisions['core-mini:system/mini@0/ability-scores'] = [
      'str:10',
      'dex:10',
      'con:14',
      'int:10',
      'wis:10',
      'cha:10',
    ];
    facts.classes = [{ classId: 'core-mini:class/fighter', level: 3 }];
    facts.hpRolls = { 'core-mini:class/fighter': [7, 'average'] };
    const comp = compose(facts, index);
    const abilities = deriveAbilities(facts, comp, index);
    const r = deriveHp(abilities, comp, facts, index, systemRules());

    // (10 hitDie + 2 conMod) + (7 roll + 2 conMod) + (6 average + 2 conMod) = 29
    expect(r.max.value).toBe(29);
  });

  it('reports per-class hit dice totals, spent count, and remaining (total - spent)', () => {
    const facts = baseFacts();
    facts.classes = [{ classId: 'core-mini:class/fighter', level: 3 }];
    facts.hitDiceSpent = { 'core-mini:class/fighter': 1 };
    facts.hpRolls = { 'core-mini:class/fighter': [5, 5] };
    const comp = compose(facts, index);
    const abilities = deriveAbilities(facts, comp, index);
    const r = deriveHp(abilities, comp, facts, index, systemRules());

    expect(r.hitDice).toEqual({
      'core-mini:class/fighter': { die: 10, total: 3, spent: 1, remaining: 2 },
    });
  });

  it('floors remaining at 0 rather than going negative when spent exceeds total', () => {
    const facts = baseFacts();
    facts.classes = [{ classId: 'core-mini:class/fighter', level: 3 }];
    // The reducer stays permissive (doc-02) — an over-spend past `total` is possible in raw
    // facts; derivation must still surface a display-safe, non-negative `remaining`.
    facts.hitDiceSpent = { 'core-mini:class/fighter': 5 };
    const comp = compose(facts, index);
    const abilities = deriveAbilities(facts, comp, index);
    const r = deriveHp(abilities, comp, facts, index, systemRules());

    expect(r.hitDice['core-mini:class/fighter']).toEqual({
      die: 10,
      total: 3,
      spent: 5,
      remaining: 0,
    });
  });

  it('lets facts.hp.maxOverride win outright, recording an override contribution', () => {
    const facts = baseFacts();
    facts.classes = [{ classId: 'core-mini:class/fighter', level: 1 }];
    facts.hp.maxOverride = 5;
    const comp = compose(facts, index);
    const abilities = deriveAbilities(facts, comp, index);
    const r = deriveHp(abilities, comp, facts, index, systemRules());

    expect(r.max.value).toBe(5);
    expect(r.max.contributions).toContainEqual(expect.objectContaining({ kind: 'override', amount: 5 }));
  });

  it("resolves facts.hp.current of 'max' to the derived max", () => {
    const facts = baseFacts();
    facts.classes = [{ classId: 'core-mini:class/fighter', level: 1 }];
    facts.hp.current = 'max';
    const comp = compose(facts, index);
    const abilities = deriveAbilities(facts, comp, index);
    const r = deriveHp(abilities, comp, facts, index, systemRules());

    expect(r.current).toBe(r.max.value);
  });

  it('clamps a stale current above the derived max down to max', () => {
    const facts = baseFacts();
    facts.classes = [{ classId: 'core-mini:class/fighter', level: 1 }];
    facts.hp.current = 9999;
    const comp = compose(facts, index);
    const abilities = deriveAbilities(facts, comp, index);
    const r = deriveHp(abilities, comp, facts, index, systemRules());

    expect(r.current).toBe(r.max.value);
    expect(r.current).toBeLessThan(9999);
  });

  it('clamps a negative stale current up to 0', () => {
    const facts = baseFacts();
    facts.classes = [{ classId: 'core-mini:class/fighter', level: 1 }];
    facts.hp.current = -5;
    const comp = compose(facts, index);
    const abilities = deriveAbilities(facts, comp, index);
    const r = deriveHp(abilities, comp, facts, index, systemRules());

    expect(r.current).toBe(0);
  });

  it('keeps current and temp as-is when current is within [0, max]', () => {
    const facts = baseFacts();
    facts.classes = [{ classId: 'core-mini:class/fighter', level: 1 }];
    facts.hp.current = 3;
    facts.hp.temp = 4;
    const comp = compose(facts, index);
    const abilities = deriveAbilities(facts, comp, index);
    const r = deriveHp(abilities, comp, facts, index, systemRules());

    expect(r.current).toBe(3);
    expect(r.temp).toBe(4);
  });

  it('passes death saves through unchanged', () => {
    const facts = baseFacts();
    facts.deathSaves = { successes: 2, failures: 1 };
    const comp = compose(facts, index);
    const abilities = deriveAbilities(facts, comp, index);
    const r = deriveHp(abilities, comp, facts, index, systemRules());

    expect(r.deathSaves).toEqual({ successes: 2, failures: 1 });
  });

  it('maps conditions to id/level/source, dropping the event provenance', () => {
    const facts = baseFacts();
    facts.conditions = [{ conditionId: 'core-mini:condition/prone', source: 'x', sinceEventId: 'e1', level: 2 }];
    const comp = compose(facts, index);
    const abilities = deriveAbilities(facts, comp, index);
    const r = deriveHp(abilities, comp, facts, index, systemRules());

    expect(r.conditions).toEqual([{ conditionId: 'core-mini:condition/prone', level: 2, source: 'x' }]);
  });

  it('adds hp.perLevel (x totalLevel) and hp.bonus effects to the HP max', () => {
    const facts = baseFacts();
    facts.decisions['core-mini:system/mini@0/ability-scores'] = [
      'str:10',
      'dex:10',
      'con:10',
      'int:10',
      'wis:10',
      'cha:10',
    ];
    facts.classes = [{ classId: 'core-mini:class/fighter', level: 2 }];
    facts.hpRolls = { 'core-mini:class/fighter': [4] };
    const comp = compose(facts, index);
    const abilities = deriveAbilities(facts, comp, index);
    const abilitiesWithHpEffects = {
      ...abilities,
      effects: [
        ...abilities.effects,
        { effect: { type: 'hp.perLevel' as const, value: 1 }, source: 'core-mini:class/fighter' },
        { effect: { type: 'hp.bonus' as const, value: 3, key: 'tough' }, source: 'core-mini:class/fighter' },
      ],
    };
    const r = deriveHp(abilitiesWithHpEffects, comp, facts, index, systemRules());

    // dice+con: (10+0) + (4+0) = 14; hp.perLevel 1 x totalLevel(2) = 2; hp.bonus flat 3 => 19
    expect(r.max.value).toBe(19);
  });

  it('falls back to average-only pricing (ignoring rolls) with a warning when no SystemRules are given', () => {
    const facts = baseFacts();
    facts.decisions['core-mini:system/mini@0/ability-scores'] = [
      'str:10',
      'dex:10',
      'con:14',
      'int:10',
      'wis:10',
      'cha:10',
    ];
    facts.classes = [{ classId: 'core-mini:class/fighter', level: 3 }];
    facts.hpRolls = { 'core-mini:class/fighter': [7, 'average'] }; // ignored without rules
    const comp = compose(facts, index);
    const abilities = deriveAbilities(facts, comp, index);
    const r = deriveHp(abilities, comp, facts, index);

    // average(d10) = 6 (either rounding); con mod +2; no firstLevelMaxHitDie without rules -> all 3 levels average
    expect(r.max.value).toBe((6 + 2) * 3);
    expect(r.issues).toContainEqual(expect.objectContaining({ severity: 'warning', code: 'derive.noSystemRules' }));
  });

  it('clamps a rolled level at the low end (0 rolls up to 1)', () => {
    const facts = baseFacts();
    facts.classes = [{ classId: 'core-mini:class/fighter', level: 2 }];
    facts.hpRolls = { 'core-mini:class/fighter': [0] };
    const comp = compose(facts, index);
    const abilities = deriveAbilities(facts, comp, index);
    const r = deriveHp(abilities, comp, facts, index, systemRules());

    // level1 (firstLevelMaxHitDie) = hitDie(10) + conMod(0); level2 roll 0 clamps up to 1 + conMod(0)
    expect(r.max.value).toBe(10 + 1);
  });

  it('clamps a rolled level at the high end (a roll above hitDie clamps down to hitDie)', () => {
    const facts = baseFacts();
    facts.classes = [{ classId: 'core-mini:class/fighter', level: 2 }];
    facts.hpRolls = { 'core-mini:class/fighter': [15] }; // hitDie(10) + 5
    const comp = compose(facts, index);
    const abilities = deriveAbilities(facts, comp, index);
    const r = deriveHp(abilities, comp, facts, index, systemRules());

    expect(r.max.value).toBe(10 + 10);
  });
});
