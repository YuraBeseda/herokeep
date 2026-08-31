// packages/content/test/static.test.ts
import { SystemEntitySchema, parseEntityId } from '@hk/protocol';
import { describe, expect, it } from 'vitest';
import { ATTRIBUTION, packManifest } from '../src/static/attribution.ts';
import { languageEntities } from '../src/static/languages.ts';
import { systemEntity } from '../src/static/system.ts';

describe('system entity', () => {
  const sys = systemEntity();
  it('validates and carries the 2024 shape', () => {
    const r = SystemEntitySchema.safeParse(sys);
    expect(r.success, JSON.stringify(r.success ? '' : r.error.issues)).toBe(true);
    if (sys.type !== 'system') throw new Error();
    expect(sys.abilities.map((a) => a.id)).toEqual(['str', 'dex', 'con', 'int', 'wis', 'cha']);
    expect(sys.skills).toHaveLength(18);
    expect(sys.skills.find((s) => s.id === 'sleight-of-hand')?.ability).toBe('dex');
    expect(sys.compositionSlots.map((s) => s.id)).toEqual(['species', 'background', 'class']);
    expect(sys.tables.xp).toHaveLength(20);
    expect(sys.tables.xp[4]).toBe(6500);
    expect(sys.tables.xp[19]).toBe(355000);
    expect(sys.tables.proficiency).toEqual([2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 6, 6, 6, 6]);
    expect(sys.tables.spellSlots.full).toHaveLength(20);
    expect(sys.tables.spellSlots.full?.[0]).toEqual([2]);
    expect(sys.tables.spellSlots.full?.[4]).toEqual([4, 3, 2]);
    expect(sys.tables.spellSlots.full?.[19]).toEqual([4, 3, 3, 3, 3, 2, 2, 1, 1]);
    expect(sys.abilityGeneration.standardArray).toEqual([15, 14, 13, 12, 10, 8]);
    expect(sys.abilityGeneration.pointBuy).toEqual({
      budget: 27,
      min: 8,
      max: 15,
      costs: { '8': 0, '9': 1, '10': 2, '11': 3, '12': 4, '13': 5, '14': 7, '15': 9 },
    });
    expect(sys.attunementMax).toBe(3);
    expect(sys.conditions).toHaveLength(15);
  });
});

describe('languages and manifest', () => {
  it('ships the SRD language list as entities', () => {
    const langs = languageEntities();
    expect(langs.length).toBeGreaterThanOrEqual(16);
    for (const l of langs) expect(parseEntityId(l.id)?.type).toBe('language');
    expect(langs.map((l) => l.name)).toContain('Common');
    expect(langs.map((l) => l.name)).toContain('Draconic');
  });
  it('attribution is the exact SRD 5.2.1 statement', () => {
    expect(ATTRIBUTION.startsWith('This work includes material from the System Reference Document 5.2.1')).toBe(true);
    expect(ATTRIBUTION).toContain('https://www.dndbeyond.com/srd');
    expect(ATTRIBUTION).toContain('https://creativecommons.org/licenses/by/4.0/legalcode');
    expect(packManifest()).toMatchObject({
      format: 1,
      id: 'srd-5e-2024',
      version: '0.1.0',
      kind: 'core',
      system: '5e-2024',
      license: 'CC-BY-4.0',
      locale: 'en',
    });
  });
});
