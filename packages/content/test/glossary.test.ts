import { describe, expect, it } from 'vitest';
import {
  transformAbilities,
  transformConditions,
  transformDamageTypes,
  transformRules,
  transformSkills,
} from '../src/transform/glossary.ts';
import { expectAllValid } from './support/valid.ts';

describe('glossary transforms', () => {
  it('abilities: 6, with 3-letter abbreviations', () => {
    const a = transformAbilities();
    expect(a).toHaveLength(6);
    expectAllValid(a);
    const cha = a.find((e) => e.id === 'srd-5e-2024:ability/charisma');
    expect(cha).toBeDefined();
    expect((cha as { abbreviation?: string }).abbreviation).toBe('cha');
  });
  it('skills: 18, each mapped to an ability key', () => {
    const s = transformSkills();
    expect(s).toHaveLength(18);
    expectAllValid(s);
    expect((s.find((e) => e.id === 'srd-5e-2024:skill/stealth') as { ability?: string })?.ability).toBe('dex');
    expect((s.find((e) => e.id === 'srd-5e-2024:skill/athletics') as { ability?: string })?.ability).toBe('str');
  });
  it('conditions: 15, exhaustion has 6 levels', () => {
    const c = transformConditions();
    expect(c).toHaveLength(15);
    expectAllValid(c);
    expect((c.find((e) => e.id === 'srd-5e-2024:condition/exhaustion') as { levels?: number })?.levels).toBe(6);
    expect(c.map((e) => e.id)).toContain('srd-5e-2024:condition/prone');
  });
  it('damage types: 13 rule entities with descriptions', () => {
    const d = transformDamageTypes();
    expect(d).toHaveLength(13);
    expectAllValid(d);
    expect(d.map((e) => e.name)).toContain('Damage type: Fire');
  });
  it('rules: 56, tagged by ruleset', () => {
    const r = transformRules();
    expect(r).toHaveLength(56);
    expectAllValid(r);
    expect(r.every((e) => e.tags.some((t) => t.startsWith('ruleset:')))).toBe(true);
  });
});
