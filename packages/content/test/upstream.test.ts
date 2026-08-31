import { describe, expect, it } from 'vitest';
import { pkSlug, readFixture } from '../src/upstream.ts';
import { classId, spellId } from '../src/ids.ts';

const COUNTS: Record<string, number> = {
  Spell: 339,
  CharacterClass: 24,
  ClassFeature: 352,
  ClassFeatureItem: 1811,
  Species: 9,
  SpeciesTrait: 51,
  Background: 4,
  BackgroundBenefit: 20,
  Feat: 17,
  FeatBenefit: 35,
  Weapon: 38,
  WeaponProperty: 17,
  WeaponPropertyAssignment: 108,
  Armor: 13,
  Item: 203,
  ConditionDescription: 15,
  SkillDescription: 18,
  AbilityDescription: 6,
  DamageTypeDescription: 13,
  Rule: 56,
  RuleSet: 11,
};

describe('vendored upstream snapshot', () => {
  it('has the pinned record counts', () => {
    for (const [name, n] of Object.entries(COUNTS)) expect(readFixture(name), name).toHaveLength(n);
  });
  it('every record is {model, pk, fields} with an srd-2024 pk where prefixed', () => {
    for (const name of Object.keys(COUNTS)) {
      for (const r of readFixture(name)) {
        expect(typeof r.model).toBe('string');
        expect(r.fields).toBeTypeOf('object');
      }
    }
  });
  it('pkSlug strips the prefix and normalizes to slug charset', () => {
    expect(pkSlug('srd-2024_acid-arrow')).toBe('acid-arrow');
    expect(pkSlug('srd-2024_alert_1_initative-proficiency')).toBe('alert-1-initative-proficiency');
    expect(() => pkSlug('srd-2024_Bad Slug!')).toThrow();
  });
  it('id builders compose namespaced ids', () => {
    expect(spellId('fireball')).toBe('srd-5e-2024:spell/fireball');
    expect(classId('fighter')).toBe('srd-5e-2024:class/fighter');
  });
});
