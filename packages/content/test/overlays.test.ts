import { describe, expect, it } from 'vitest';
import { applyOverlays } from '../src/overlays/merge.ts';
import corrections from '../src/overlays/corrections.json' with { type: 'json' };
import systemChoices from '../src/overlays/system-choices.json' with { type: 'json' };
import speciesOverlay from '../src/overlays/species.json' with { type: 'json' };
import fightingStyles from '../src/overlays/fighting-styles.json' with { type: 'json' };
import { transformClasses } from '../src/transform/classes.ts';
import { transformFeats } from '../src/transform/feats.ts';
import { transformSpecies } from '../src/transform/species.ts';
import { systemEntity } from '../src/static/system.ts';

describe('applyOverlays', () => {
  it('set replaces, merge concatenates arrays, unmatched throws, input not mutated', () => {
    const { classes } = transformClasses();
    const fighter = classes.find((c) => c.id === 'srd-5e-2024:class/fighter')!;
    const before = JSON.stringify(fighter);
    const [patched] = applyOverlays(
      [fighter],
      [{ id: fighter.id, set: { saves: ['str', 'con'] }, merge: { tags: ['martial'] } }],
    );
    expect((patched as { saves?: string[] }).saves).toEqual(['str', 'con']);
    expect(patched!.tags).toContain('martial');
    expect(JSON.stringify(fighter)).toBe(before);
    expect(() => applyOverlays([fighter], [{ id: 'srd-5e-2024:class/nope', set: {} }])).toThrow(/Unmatched overlay/);
  });

  it('corrections fix fighter saves with a citation', () => {
    const entry = (corrections as { id: string; cite?: string }[]).find((o) => o.id === 'srd-5e-2024:class/fighter');
    expect(entry?.cite).toMatch(/SRD 5\.2\.1/);
    const { classes } = transformClasses();
    const [fighter] = applyOverlays(
      classes.filter((c) => c.id === 'srd-5e-2024:class/fighter'),
      [entry!],
    );
    expect((fighter as { saves?: string[] }).saves).toEqual(['str', 'con']);
  });

  it('system gains the four creation choices', () => {
    const [sys] = applyOverlays([systemEntity()], systemChoices);
    const ids = (sys as { choices: { id: string }[] }).choices.map((c) => c.id);
    expect(ids.sort()).toEqual([
      'srd-5e-2024:system/5e-2024@0/ability-scores',
      'srd-5e-2024:system/5e-2024@0/background',
      'srd-5e-2024:system/5e-2024@0/class',
      'srd-5e-2024:system/5e-2024@0/species',
    ]);
  });

  it('species overlay: small halfling, darkvision dwarf', () => {
    const { species } = transformSpecies();
    const patched = applyOverlays(
      species,
      (speciesOverlay as { id: string }[]).filter((o) => species.some((s) => s.id === o.id)),
    );
    expect((patched.find((s) => s.id === 'srd-5e-2024:species/halfling') as { size?: string })?.size).toBe('small');
    const dwarf = patched.find((s) => s.id === 'srd-5e-2024:species/dwarf') as {
      effects?: { type: string; sense?: string }[];
    };
    expect(dwarf?.effects?.some((e) => e.type === 'sense.grant' && e.sense === 'darkvision')).toBe(true);
  });

  it('fighting styles are tagged and mechanized', () => {
    const feats = transformFeats();
    const patched = applyOverlays(
      feats,
      (fightingStyles as { id: string }[]).filter((o) => feats.some((f) => f.id === o.id)),
    );
    const tagged = patched.filter((f) => f.tags.includes('fighting-style'));
    expect(tagged).toHaveLength(4);
    const archery = tagged.find((f) => f.id === 'srd-5e-2024:feat/archery') as { effects?: { type: string }[] };
    expect(archery?.effects?.some((e) => e.type === 'attack.bonus')).toBe(true);
  });
});
