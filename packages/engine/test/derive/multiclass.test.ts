import { describe, expect, it } from 'vitest';
import { createContentIndex } from '../../src/content/index.ts';
import { deriveAbilities } from '../../src/derive/abilities.ts';
import { compose } from '../../src/derive/composition.ts';
import { deriveHp } from '../../src/derive/hp.ts';
import { derive } from '../../src/derive/index.ts';
import { emptyFacts } from '../../src/reduce/facts.ts';
import type { SystemRules } from '../../src/reduce/facts.ts';
import { loadFixturePack } from '../support/fixtures.ts';
import { loadDistPack } from '../support/golden.ts';

const index = createContentIndex([loadFixturePack('core-mini'), loadFixturePack('multiclass-mini')]);
const baseFacts = () => emptyFacts('char:test');
const systemRules = (): SystemRules => {
  const sys = index.system();
  return { restRules: sys.restRules, hpRules: sys.hpRules };
};

const wizard = 'multiclass-mini:class/wizard';
const fighter = 'core-mini:class/fighter';
const druid = 'core-mini:class/druid';

/**
 * Ruling 7/8 (phase 4, plan 11 task 2): `facts.classes[]` order (order gained) is authoritative
 * for HP pricing, saves and proficiency contribution. A Wizard-then-Fighter character (Wizard
 * gained FIRST, Fighter SECOND) pins all three at once — deliberately using ids where alphabetical
 * order ("core-mini:..." < "multiclass-mini:...") would put Fighter first if `derive/hp.ts` still
 * sorted `Object.keys(comp.classLevels)`, so this test distinguishes the order fix from a
 * same-numeric-result coincidence.
 */
describe('multiclass composition (ruling 7/8): Wizard-then-Fighter', () => {
  const twoClassFacts = () => {
    const facts = baseFacts();
    // All scores 10 (conMod 0) so HP math below is die-value-only and easy to hand-verify.
    facts.decisions['core-mini:system/mini@0/ability-scores'] = [
      'str:10',
      'dex:10',
      'con:10',
      'int:10',
      'wis:10',
      'cha:10',
    ];
    facts.classes = [
      { classId: wizard, level: 3 },
      { classId: fighter, level: 2 },
    ];
    return facts;
  };

  it("prices HP with the max hit die at the FIRST class's (wizard) level 1 only — a later class's own level 1 (fighter) is priced average, never max", () => {
    const facts = twoClassFacts();
    const comp = compose(facts, index);
    const abilities = deriveAbilities(facts, comp, index);
    const hp = deriveHp(abilities, comp, facts, index, systemRules());

    // wizard (first, hitDie 6, 'up' rounding): level1 MAX (6) + level2 avg(4) + level3 avg(4) = 14
    // fighter (second, hitDie 10): level1 avg(6) [NOT max — not the first class] + level2 avg(6) = 12
    // conMod 0 throughout => total 26. (Pre-fix bug would give every class's own level 1 the max
    // die — fighter's level 1 would wrongly price at 10 instead of 6, giving 30. A fix that only
    // restricts "first class" via alphabetical sort instead of facts order would wrongly treat
    // fighter as first — giving 28.)
    expect(hp.max.value).toBe(26);
  });

  it('grants saves from the FIRST class (wizard) only — the second class (fighter) contributes no save proficiency at all', () => {
    const facts = twoClassFacts();
    const comp = compose(facts, index);
    const abilities = deriveAbilities(facts, comp, index);

    expect(abilities.abilities['int']!.saveProficient).toBe(true);
    expect(abilities.abilities['wis']!.saveProficient).toBe(true);
    // Fighter's own saves (str, con) must NOT show up just because fighter is on the sheet.
    expect(abilities.abilities['str']!.saveProficient).toBe(false);
    expect(abilities.abilities['con']!.saveProficient).toBe(false);
  });

  it("restricts the SECOND class's (fighter) armor/weapon proficiencies to its multiclass.gains — no heavy armor, but light/medium/shields and simple/martial weapons still land", () => {
    const facts = twoClassFacts();
    const sheet = derive(facts, index, systemRules());

    const has = (kind: string, target: string) =>
      sheet.proficiencies.some((p) => p.kind === kind && p.target === target);

    // Fighter's FULL armorTraining (core-mini.json) includes 'heavy' — multiclass.gains omits it.
    expect(has('armor', 'heavy')).toBe(false);
    expect(has('armor', 'light')).toBe(true);
    expect(has('armor', 'medium')).toBe(true);
    expect(has('armor', 'shields')).toBe(true);
    expect(has('weapon', 'simple')).toBe(true); // also granted by wizard (first class, full)
    expect(has('weapon', 'martial')).toBe(true); // fighter's multiclass.gains

    // Wizard (first class) always contributes its FULL proficiencies, gains or not.
    expect(has('weapon', 'simple')).toBe(true);
  });

  it("falls back to a later class's FULL proficiencies when it has no multiclass.gains data (old/fixture-pack compat)", () => {
    const facts = baseFacts();
    facts.classes = [
      { classId: wizard, level: 1 },
      { classId: druid, level: 1 }, // core-mini's druid has no `multiclass` field at all
    ];
    const sheet = derive(facts, index, systemRules());
    const has = (kind: string, target: string) =>
      sheet.proficiencies.some((p) => p.kind === kind && p.target === target);

    // Druid's full armorTraining/weaponProficiencies (core-mini.json) — un-restricted, since no
    // multiclass.gains exists to restrict it.
    expect(has('armor', 'light')).toBe(true);
    expect(has('weapon', 'simple')).toBe(true);
  });
});

/**
 * Plan 12 final wave W2: the SRD 5.2.1 multiclassing table row for Monk is "Simple weapons and
 * Martial weapons that have the Light property" (owner-flagged: the vendored rule is prose only —
 * see `packages/content/src/transform/classes.ts`). A later-class Monk's `gains` must carry exactly
 * that row in the engine's vocabulary (a category, or a specific weapon slug).
 */
describe('multiclass weapon gains on the real SRD pack (W2): wizard → monk', () => {
  const srd = createContentIndex([loadDistPack('srd-5e-2024')]);
  const facts = () => {
    const f = baseFacts();
    f.decisions['srd-5e-2024:system/5e-2024@0/ability-scores'] = [
      'str:10',
      'dex:14',
      'con:12',
      'int:15',
      'wis:13',
      'cha:8',
    ];
    f.classes = [
      { classId: 'srd-5e-2024:class/wizard', level: 1 },
      { classId: 'srd-5e-2024:class/monk', level: 1 },
    ];
    return f;
  };
  const proficientWith = (itemSlug: string) => {
    const sheet = derive(facts(), srd, { restRules: srd.system().restRules, hpRules: srd.system().hpRules });
    const item = srd.get(`srd-5e-2024:item/${itemSlug}`);
    if (item?.type !== 'item' || !item.weapon) throw new Error(`${itemSlug} is not a weapon item`);
    const targets = new Set(sheet.proficiencies.filter((p) => p.kind === 'weapon').map((p) => p.target));
    return targets.has(item.weapon.category) || targets.has(itemSlug) || item.tags.some((t) => targets.has(t));
  };

  it('is proficient with a shortsword (martial, Light — from the monk row)', () => {
    expect(proficientWith('shortsword')).toBe(true);
  });
  it('is proficient with a quarterstaff (simple)', () => {
    expect(proficientWith('quarterstaff')).toBe(true);
  });
  it('is NOT proficient with a longsword (martial, not Light)', () => {
    expect(proficientWith('longsword')).toBe(false);
  });
});

/**
 * Plan 13 task 7 (ruling 8): the attack line's weapon proficiency must come from the SAME
 * per-class, gains-restricted lists as `sheet.proficiencies` (pre-existing wrong since f114f01:
 * `derive/attacks.ts` read every class's FULL `weaponProficiencies`). SRD 5.2.1 multiclassing table:
 * a later-class Rogue gains "Light armor, one skill of your choice, Thieves' Tools" — no weapons — so
 * a Wizard → Rogue is NOT proficient with a Rapier (Martial), even though a first-class Rogue is.
 */
describe('attack proficiency follows multiclass gains (plan 13 task 7)', () => {
  const srd = createContentIndex([loadDistPack('srd-5e-2024')]);
  const srdRules = (): SystemRules => ({ restRules: srd.system().restRules, hpRules: srd.system().hpRules });
  const rapierSheet = (classes: { classId: string; level: number }[]) => {
    const f = baseFacts();
    // dex 14 (+2) > str 10 (+0): the finesse rapier prices with dex; total level 2 => prof +2.
    f.decisions['srd-5e-2024:system/5e-2024@0/ability-scores'] = [
      'str:10',
      'dex:14',
      'con:12',
      'int:15',
      'wis:13',
      'cha:8',
    ];
    f.classes = classes;
    f.inventory = [{ instanceId: 'i1', itemId: 'srd-5e-2024:item/rapier', qty: 1, equipped: true, attuned: false }];
    return derive(f, srd, srdRules());
  };
  const sheetProficientWithRapier = (sheet: ReturnType<typeof rapierSheet>) => {
    const targets = new Set(sheet.proficiencies.filter((p) => p.kind === 'weapon').map((p) => p.target));
    return targets.has('martial') || targets.has('rapier');
  };

  it('wizard → rogue: the rapier attack carries NO proficiency bonus, matching sheet.proficiencies', () => {
    const sheet = rapierSheet([
      { classId: 'srd-5e-2024:class/wizard', level: 1 },
      { classId: 'srd-5e-2024:class/rogue', level: 1 },
    ]);
    expect(sheetProficientWithRapier(sheet)).toBe(false);
    expect(sheet.attacks).toHaveLength(1);
    expect(sheet.attacks[0]!.ability).toBe('dex');
    expect(sheet.attacks[0]!.toHit.value).toBe(2); // dex +2 only — no prof (rogue gains carry no weapons)
  });

  it('rogue → wizard: rogue is the FIRST class, so its full list (rapier) still prices the attack', () => {
    const sheet = rapierSheet([
      { classId: 'srd-5e-2024:class/rogue', level: 1 },
      { classId: 'srd-5e-2024:class/wizard', level: 1 },
    ]);
    expect(sheetProficientWithRapier(sheet)).toBe(true);
    expect(sheet.attacks[0]!.toHit.value).toBe(4); // dex +2 + prof +2
  });

  it('single-class rogue: the rapier attack is unchanged (proficient)', () => {
    const sheet = rapierSheet([{ classId: 'srd-5e-2024:class/rogue', level: 2 }]);
    expect(sheetProficientWithRapier(sheet)).toBe(true);
    expect(sheet.attacks[0]!.toHit.value).toBe(4); // dex +2 + prof +2
  });

  it('compat: a later class with NO multiclass.gains data keeps its full weapon list on the attack line', () => {
    // core-mini alone: its fighter has no `multiclass` field (multiclass-mini is what patches gains in).
    const legacy = createContentIndex([loadFixturePack('core-mini')]);
    const f = baseFacts();
    f.decisions['core-mini:system/mini@0/ability-scores'] = [
      'str:16',
      'dex:10',
      'con:10',
      'int:10',
      'wis:10',
      'cha:10',
    ];
    f.classes = [
      { classId: druid, level: 1 },
      { classId: fighter, level: 1 },
    ];
    f.inventory = [{ instanceId: 'i1', itemId: 'core-mini:item/longsword', qty: 1, equipped: true, attuned: false }];
    const sys = legacy.system();
    const sheet = derive(f, legacy, { restRules: sys.restRules, hpRules: sys.hpRules });
    expect(sheet.proficiencies.some((p) => p.kind === 'weapon' && p.target === 'martial')).toBe(true);
    expect(sheet.attacks[0]!.toHit.value).toBe(5); // str +3 + prof +2 (fighter's full list: martial)
  });
});
