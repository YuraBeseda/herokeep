import { describe, expect, it } from 'vitest';
import { applyOverlays } from '../src/overlays/merge.ts';
import { loadOverlays } from '../src/overlays/load.ts'; // { corrections, systemChoices, species, fightingStyles, fighter, wizard }
import { transformClasses } from '../src/transform/classes.ts';
import { transformFeats } from '../src/transform/feats.ts';

describe('rows merging', () => {
  it('merges grants/choices/extra into the matching level row without clobbering', () => {
    const { classes } = transformClasses();
    const fighter = classes.find((c) => c.id === 'srd-5e-2024:class/fighter')!;
    const upstreamL1 = (fighter as { levels: { level: number; grants: unknown[] }[] }).levels.find(
      (r) => r.level === 1,
    )!.grants.length;
    const [patched] = applyOverlays(
      [fighter],
      [
        {
          id: fighter.id,
          rows: [
            {
              level: 1,
              choices: [
                {
                  id: 'srd-5e-2024:class/fighter@1/x',
                  prompt: 'X',
                  at: { kind: 'classLevel', class: 'fighter', level: 1 },
                  pick: { literal: 'text' },
                  count: 1,
                  unique: true,
                  repeatableAt: [],
                  prerequisites: [],
                },
              ],
            },
          ],
        } as never,
      ],
    );
    const l1 = (patched as { levels: { level: number; grants: unknown[]; choices: unknown[] }[] }).levels.find(
      (r) => r.level === 1,
    )!;
    expect(l1.grants).toHaveLength(upstreamL1);
    expect(l1.choices).toHaveLength(1);
  });
});

describe('fighter and wizard 1–5 mechanics', () => {
  const { classes, subclasses, features } = transformClasses();
  const o = loadOverlays();
  const patchedClasses = applyOverlays(
    classes,
    [...o.corrections, ...o.fighter, ...o.wizard].filter((x) => classes.some((c) => c.id === x.id)),
  );
  const patchedFeatures = applyOverlays(
    features,
    [...o.fighter, ...o.wizard].filter((x) => features.some((f) => f.id === x.id)),
  );

  it('fighter: structure, fighting-style and subclass choices, second wind resource, extra attack', () => {
    const f = patchedClasses.find((c) => c.id === 'srd-5e-2024:class/fighter') as {
      saves: string[];
      armorTraining: string[];
      skillChoice: { count: number };
      levels: { level: number; choices: { id: string; pick: unknown }[] }[];
    };
    expect(f.saves).toEqual(['str', 'con']);
    expect(f.armorTraining).toContain('heavy');
    expect(f.skillChoice.count).toBe(2);
    const choiceIds = f.levels.flatMap((r) => r.choices.map((c) => c.id));
    expect(choiceIds).toContain('srd-5e-2024:class/fighter@1/fighting-style');
    expect(choiceIds).toContain('srd-5e-2024:class/fighter@3/subclass');
    expect(choiceIds).toContain('srd-5e-2024:class/fighter@4/feat');
    const secondWind = patchedFeatures.find((x) => x.id.endsWith('second-wind')) as { effects: { type: string }[] };
    expect(secondWind.effects.some((e) => e.type === 'resource.define')).toBe(true);
    const extraAttack = patchedFeatures.find((x) => x.id.includes('fighter') && x.id.includes('extra-attack')) as {
      effects: { type: string }[];
    };
    expect(extraAttack.effects.some((e) => e.type === 'extraAttack.set')).toBe(true);
  });

  it('wizard: spellbook full caster with cantrip formula and preparedSpells row extras', () => {
    const spellcasting = patchedFeatures.find((x) => x.id.includes('wizard') && x.id.includes('spellcasting')) as {
      effects: { type: string; cantripsKnown?: string }[];
    };
    const sc = spellcasting.effects.find((e) => e.type === 'spellcasting.define');
    expect(sc).toMatchObject({ preparation: 'spellbook', slots: 'full', ritual: true, ability: 'int' });
    expect(sc?.cantripsKnown).toBe('3 + floor(classLevel(wizard) / 4)');
    const w = patchedClasses.find((c) => c.id === 'srd-5e-2024:class/wizard') as {
      levels: { level: number; extra?: Record<string, unknown> }[];
    };
    // R20: upstream-derived slug key from transformClasses (extra keys must be slugs; the plan's camelCase 'preparedSpells' was schema-invalid)
    expect(w.levels.find((r) => r.level === 1)?.extra?.['wizard-prepared-spells']).toBe(4);
    expect(w.levels.find((r) => r.level === 5)?.extra?.['wizard-prepared-spells']).toBe(9);
  });

  it('applyRows inserts a new row at the correct ascending position (champion has rows at 3 and 7, not 5)', () => {
    const champion = subclasses.find((s) => s.id.includes('champion')) as { id: string; levels: { level: number }[] };
    const before = champion.levels.map((r) => r.level);
    expect(before).toContain(3);
    expect(before).toContain(7);
    expect(before).not.toContain(5);

    const [patched] = applyOverlays(
      [champion as never],
      [
        {
          id: champion.id,
          rows: [{ level: 5, extra: { 'test-inserted-row': 1 } }],
        },
      ],
    );
    const levels = (patched as { levels: { level: number; extra?: Record<string, unknown> }[] }).levels;
    expect(levels.map((r) => r.level)).toEqual([3, 5, 7, 10, 15, 18]);
    expect(levels.find((r) => r.level === 5)?.extra).toEqual({ 'test-inserted-row': 1 });
  });

  it('applyRows throws when a "rows" overlay targets a non-class/subclass entity', () => {
    const feats = transformFeats();
    const alert = feats.find((f) => f.id === 'srd-5e-2024:feat/alert')!;
    expect(() => applyOverlays([alert], [{ id: alert.id, rows: [{ level: 1 }] }])).toThrow(/rows require levels\[\]/);
  });
});
