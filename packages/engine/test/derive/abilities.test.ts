import { describe, expect, it } from 'vitest';
import { createContentIndex } from '../../src/content/index.ts';
import { compose } from '../../src/derive/composition.ts';
import { deriveAbilities } from '../../src/derive/abilities.ts';
import { emptyFacts } from '../../src/reduce/facts.ts';
import { loadFixturePack } from '../support/fixtures.ts';

const index = createContentIndex([loadFixturePack('core-mini'), loadFixturePack('content-mini')]);
const baseFacts = () => emptyFacts('char:test');

describe('deriveAbilities', () => {
  it('parses base ability scores from the ability-scores decision selection', () => {
    const facts = baseFacts();
    facts.decisions['core-mini:system/mini@0/ability-scores'] = [
      'str:15',
      'dex:13',
      'con:14',
      'int:12',
      'wis:10',
      'cha:8',
    ];
    const comp = compose(facts, index);
    const r = deriveAbilities(facts, comp, index);

    expect(r.abilities['str']!.score.value).toBe(15);
    expect(r.abilities['str']!.mod).toBe(2);
    expect(r.abilities['dex']!.score.value).toBe(13);
    expect(r.abilities['dex']!.mod).toBe(1);
    expect(r.abilities['cha']!.score.value).toBe(8);
    expect(r.abilities['cha']!.mod).toBe(-1); // floor((8-10)/2) = -1
  });

  it('defaults every ability to a score of 10 when no ability-scores decision has been made yet', () => {
    const comp = compose(baseFacts(), index);
    const r = deriveAbilities(baseFacts(), comp, index);
    expect(r.abilities['str']!.score.value).toBe(10);
    expect(r.abilities['str']!.mod).toBe(0);
  });

  it('warns on a malformed ability-score selection entry instead of throwing, and keeps the default', () => {
    const facts = baseFacts();
    facts.decisions['core-mini:system/mini@0/ability-scores'] = ['strength:15'];
    const comp = compose(facts, index);

    let r: ReturnType<typeof deriveAbilities> | undefined;
    expect(() => {
      r = deriveAbilities(facts, comp, index);
    }).not.toThrow();
    expect(r!.abilities['str']!.score.value).toBe(10);
    expect(r!.issues).toContainEqual(
      expect.objectContaining({ severity: 'warning', code: 'derive.abilityScoreInvalid' }),
    );
  });

  it("applies the background's ability-score bonus as a visible score contribution", () => {
    const facts = baseFacts();
    facts.decisions['core-mini:system/mini@0/ability-scores'] = [
      'str:10',
      'dex:10',
      'con:10',
      'int:14',
      'wis:12',
      'cha:10',
    ];
    facts.decisions['core-mini:system/mini@0/background'] = ['core-mini:background/acolyte'];
    facts.decisions['core-mini:background/acolyte@0/ability-scores'] = ['int:+2', 'wis:+1'];
    const comp = compose(facts, index);
    const r = deriveAbilities(facts, comp, index);

    expect(r.abilities['int']!.score.value).toBe(16);
    expect(r.abilities['int']!.score.contributions).toContainEqual(
      expect.objectContaining({ source: 'core-mini:background/acolyte', kind: 'ability.bonus', amount: 2 }),
    );
    expect(r.abilities['wis']!.score.value).toBe(13);
    expect(r.abilities['wis']!.score.contributions).toContainEqual(
      expect.objectContaining({ source: 'core-mini:background/acolyte', kind: 'ability.bonus', amount: 1 }),
    );
  });

  it('reads the proficiency bonus from the fixture table at level 1 and level 5', () => {
    const facts1 = baseFacts();
    facts1.classes = [{ classId: 'core-mini:class/fighter', level: 1 }];
    expect(deriveAbilities(facts1, compose(facts1, index), index).prof).toBe(2);

    const facts5 = baseFacts();
    facts5.classes = [{ classId: 'core-mini:class/fighter', level: 5 }];
    expect(deriveAbilities(facts5, compose(facts5, index), index).prof).toBe(3);
  });

  it('computes a save with proficiency (first class only) and one without', () => {
    const facts = baseFacts();
    facts.decisions['core-mini:system/mini@0/ability-scores'] = [
      'str:16',
      'dex:12',
      'con:14',
      'int:10',
      'wis:10',
      'cha:10',
    ];
    facts.classes = [{ classId: 'core-mini:class/fighter', level: 1 }]; // fighter saves: str, con
    const comp = compose(facts, index);
    const r = deriveAbilities(facts, comp, index);

    expect(r.abilities['str']!.saveProficient).toBe(true);
    expect(r.abilities['str']!.save.value).toBe(5); // mod(16)=3, prof=2 -> 5
    expect(r.abilities['dex']!.saveProficient).toBe(false);
    expect(r.abilities['dex']!.save.value).toBe(1); // mod(12)=1, not proficient
  });

  it('doubles the proficiency contribution for skill expertise, absorbing a plain-proficient source', () => {
    const facts = baseFacts();
    facts.decisions['core-mini:system/mini@0/ability-scores'] = [
      'str:10',
      'dex:16',
      'con:10',
      'int:10',
      'wis:10',
      'cha:10',
    ];
    facts.classes = [{ classId: 'core-mini:class/fighter', level: 1 }];
    facts.decisions['core-mini:class/fighter@1/skills'] = ['stealth'];
    facts.decisions['test:pick@0/expertise'] = ['core-mini:feature/skill-expert'];
    const comp = compose(facts, index);
    const r = deriveAbilities(facts, comp, index);

    expect(r.skills['stealth']!.proficiency).toBe('expertise');
    expect(r.skills['stealth']!.total.value).toBe(7); // mod(16)=3 + prof(2)*2 = 7
  });

  it('computes passive perception as 10 + the perception skill total', () => {
    const facts = baseFacts();
    facts.decisions['core-mini:system/mini@0/ability-scores'] = [
      'str:10',
      'dex:10',
      'con:10',
      'int:10',
      'wis:14',
      'cha:10',
    ];
    facts.decisions['core-mini:system/mini@0/background'] = ['core-mini:background/acolyte']; // grants Perception
    facts.classes = [{ classId: 'core-mini:class/fighter', level: 1 }];
    const comp = compose(facts, index);
    const r = deriveAbilities(facts, comp, index);

    expect(r.skills['perception']!.proficiency).toBe('proficient');
    expect(r.skills['perception']!.total.value).toBe(4); // mod(14)=2 + prof(2) = 4
    expect(r.passivePerception).toBe(14);
  });

  it('computes walk speed from the species base plus speed.bonus effects', () => {
    const facts = baseFacts();
    facts.decisions['core-mini:system/mini@0/species'] = ['core-mini:species/elf']; // speed 30
    facts.decisions['test:pick@0/speed'] = ['core-mini:feature/fleet-footed']; // +10
    const comp = compose(facts, index);
    const r = deriveAbilities(facts, comp, index);

    expect(r.speed['walk']!.value).toBe(40);
    expect(r.speed['walk']!.contributions).toContainEqual(
      expect.objectContaining({ source: 'core-mini:feature/fleet-footed', kind: 'speed.bonus', amount: 10 }),
    );
  });

  it('unions senses and languages granted by active effects', () => {
    const facts = baseFacts();
    facts.decisions['core-mini:system/mini@0/species'] = ['core-mini:species/elf']; // darkvision + Common
    const comp = compose(facts, index);
    const r = deriveAbilities(facts, comp, index);

    expect(r.senses).toEqual([{ sense: 'darkvision', range: 60, sources: ['core-mini:species/elf'] }]);
    expect(r.languages).toEqual([{ id: 'core-mini:language/common', sources: ['core-mini:species/elf'] }]);
  });

  it('resolves a deferred ability-gated effect against the final STR score when it passes', () => {
    const facts = baseFacts();
    facts.decisions['core-mini:system/mini@0/ability-scores'] = [
      'str:16',
      'dex:10',
      'con:10',
      'int:10',
      'wis:10',
      'cha:10',
    ];
    facts.decisions['test:pick@0/feat'] = ['core-mini:feat/iron-resolve'];
    facts.inventory = [
      { instanceId: 'i1', itemId: 'core-mini:item/cloak-of-protection', qty: 1, equipped: true, attuned: false },
      { instanceId: 'i2', itemId: 'core-mini:item/chain-mail', qty: 1, equipped: true, attuned: false },
    ];
    const comp = compose(facts, index);
    const r = deriveAbilities(facts, comp, index);

    expect(r.effects.some((e) => e.effect.type === 'ac.bonus' && e.effect.key === 'str-gated')).toBe(true);
    expect(r.effects.some((e) => e.effect.type === 'ac.bonus' && e.effect.key === 'heavy-armor-str-test')).toBe(true);
  });

  it('drops a deferred ability-gated effect that fails against the final STR score', () => {
    const facts = baseFacts();
    facts.decisions['core-mini:system/mini@0/ability-scores'] = [
      'str:10',
      'dex:10',
      'con:10',
      'int:10',
      'wis:10',
      'cha:10',
    ];
    facts.decisions['test:pick@0/feat'] = ['core-mini:feat/iron-resolve'];
    facts.inventory = [
      { instanceId: 'i1', itemId: 'core-mini:item/cloak-of-protection', qty: 1, equipped: true, attuned: false },
      { instanceId: 'i2', itemId: 'core-mini:item/chain-mail', qty: 1, equipped: true, attuned: false },
    ];
    const comp = compose(facts, index);
    const r = deriveAbilities(facts, comp, index);

    expect(r.effects.some((e) => e.effect.type === 'ac.bonus' && e.effect.key === 'str-gated')).toBe(false);
    expect(r.effects.some((e) => e.effect.type === 'ac.bonus' && e.effect.key === 'heavy-armor-str-test')).toBe(false);
    // score-free effects (composed unconditionally / gated only on armor & shield) are unaffected.
    expect(r.effects.some((e) => e.effect.type === 'ac.bonus' && e.effect.key === 'cloak')).toBe(true);
    expect(r.effects.some((e) => e.effect.type === 'ac.bonus' && e.effect.key === 'heavy-armor-test')).toBe(true);
  });
});
