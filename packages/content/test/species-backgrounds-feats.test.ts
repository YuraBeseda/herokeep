import { describe, expect, it } from 'vitest';
import { transformBackgrounds } from '../src/transform/backgrounds.ts';
import { transformFeats } from '../src/transform/feats.ts';
import { transformSpecies } from '../src/transform/species.ts';
import { readFixture } from '../src/upstream.ts';
import { expectAllValid } from './support/valid.ts';

describe('species', () => {
  const { species, features } = transformSpecies();
  it('9 species, each granting its trait features; all valid', () => {
    expect(species).toHaveLength(9);
    expectAllValid(species);
    expectAllValid(features);
    expect(species.map((s) => s.id)).toContain('srd-5e-2024:species/dragonborn');
    for (const s of species) expect((s as { grants: unknown[] }).grants.length, s.id).toBeGreaterThanOrEqual(1);
    const granted = new Set(
      species.flatMap((s) => (s as { grants: { feature: string }[] }).grants.map((g) => g.feature)),
    );
    for (const id of granted)
      expect(
        features.map((f) => f.id),
        id,
      ).toContain(id);
  });
});

describe('backgrounds', () => {
  const backgrounds = transformBackgrounds();
  it('4 backgrounds with the SRD structured fields, cross-checked against benefit text', () => {
    expect(backgrounds).toHaveLength(4);
    expectAllValid(backgrounds);
    const acolyte = backgrounds.find((b) => b.id === 'srd-5e-2024:background/acolyte') as {
      abilityScores?: string[];
      originFeat?: string;
      skillProficiencies?: string[];
    };
    expect(acolyte?.abilityScores).toEqual(['int', 'wis', 'cha']);
    expect(acolyte?.skillProficiencies).toEqual(['insight', 'religion']);
    const benefits = readFixture('BackgroundBenefit').filter((r) => String(r.pk).startsWith('srd-2024_acolyte'));
    const abilityBenefit = benefits.find((r) => String(r.pk).includes('ability'));
    const text = String((abilityBenefit?.fields as { desc?: string })?.desc ?? '');
    for (const word of ['Intelligence', 'Wisdom', 'Charisma']) expect(text).toContain(word);
  });
});

describe('feats', () => {
  const feats = transformFeats();
  it('17 feats with mapped categories; fighting styles present', () => {
    expect(feats).toHaveLength(17);
    expectAllValid(feats);
    const cats = new Set(feats.map((f) => (f as { category?: string }).category));
    expect(cats).toContain('origin');
    expect(cats).toContain('fightingStyle');
    expect(cats).toContain('epicBoon');
    expect(feats.map((f) => f.id)).toContain('srd-5e-2024:feat/alert');
    expect(feats.filter((f) => (f as { category?: string }).category === 'fightingStyle')).toHaveLength(4);
  });

  it('R23: repeatable is derived from a "Repeatable" FeatBenefit, not hard-coded false', () => {
    const byId = new Map(feats.map((f) => [f.id, f]));
    const repeatableIds = [
      'srd-5e-2024:feat/magic-initiate',
      'srd-5e-2024:feat/skilled',
      'srd-5e-2024:feat/ability-score-improvement',
    ];
    for (const id of repeatableIds) {
      expect((byId.get(id) as { repeatable?: boolean })?.repeatable, id).toBe(true);
    }
    expect((byId.get('srd-5e-2024:feat/alert') as { repeatable?: boolean })?.repeatable).toBe(false);
    // Verified over all 35 FeatBenefit records: exactly these 3 feats carry a "Repeatable" benefit.
    const actuallyRepeatable = feats.filter((f) => (f as { repeatable?: boolean }).repeatable).map((f) => f.id);
    expect(actuallyRepeatable.sort()).toEqual([...repeatableIds].sort());
  });
});
