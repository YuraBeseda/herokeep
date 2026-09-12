import { describe, expect, it } from 'vitest';
import { applyOverlays } from '../src/overlays/merge.ts';
import corrections from '../src/overlays/corrections.json' with { type: 'json' };
import systemChoices from '../src/overlays/system-choices.json' with { type: 'json' };
import speciesOverlay from '../src/overlays/species.json' with { type: 'json' };
import backgroundsOverlay from '../src/overlays/backgrounds.json' with { type: 'json' };
import fightingStyles from '../src/overlays/fighting-styles.json' with { type: 'json' };
import featsOverlay from '../src/overlays/feats.json' with { type: 'json' };
import { transformBackgrounds } from '../src/transform/backgrounds.ts';
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

  it('every background gains exactly one abilities-pick creation choice, +2/+1 across two abilities', () => {
    const backgrounds = transformBackgrounds();
    const patched = applyOverlays(backgrounds, backgroundsOverlay);
    expect(patched).toHaveLength(4);
    for (const bg of patched) {
      const choices = (bg as { choices: { id: string; at: { kind: string }; pick: unknown; count: number }[] }).choices;
      expect(choices, bg.id).toHaveLength(1);
      const [choice] = choices;
      expect(choice!.id, bg.id).toBe(`${bg.id}@0/ability-scores`);
      expect(choice!.at, bg.id).toEqual({ kind: 'creation' });
      expect(choice!.pick, bg.id).toMatchObject({ abilities: { count: 2, improve: '+2/+1' } });
    }
  });

  it('the Ability Score Improvement feat gains its own abilities-pick choice, +2 to one ability', () => {
    const feats = transformFeats();
    const patched = applyOverlays(feats, featsOverlay);
    const asi = patched.find((f) => f.id === 'srd-5e-2024:feat/ability-score-improvement') as {
      choices: { id: string; at: unknown; pick: unknown; count: number }[];
    };
    expect(asi.choices).toHaveLength(1);
    const [choice] = asi.choices;
    expect(choice!.id).toBe('srd-5e-2024:feat/ability-score-improvement@4/ability-scores');
    expect(choice!.at).toEqual({ kind: 'level', level: 4 });
    expect(choice!.pick).toMatchObject({ abilities: { count: 1, improve: '+2' } });
    // Every other feat is untouched by this overlay.
    const untouched = patched.filter((f) => f.id !== 'srd-5e-2024:feat/ability-score-improvement');
    for (const f of untouched) expect((f as { choices: unknown[] }).choices, f.id).toHaveLength(0);
  });
});
