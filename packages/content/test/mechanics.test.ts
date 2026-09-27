import { describe, expect, it } from 'vitest';
import { buildPack } from '../src/build.ts';
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

describe('fighter and wizard 6–20 mechanics (task 8)', () => {
  const { classes, subclasses, features } = transformClasses();
  const o = loadOverlays();
  const patchedClasses = applyOverlays(
    classes,
    [...o.corrections, ...o.fighter, ...o.wizard].filter((x) => classes.some((c) => c.id === x.id)),
  );
  const patchedSubclasses = applyOverlays(
    subclasses,
    [...o.fighter, ...o.wizard].filter((x) => subclasses.some((s) => s.id === x.id)),
  );
  const patchedFeatures = applyOverlays(
    features,
    [...o.fighter, ...o.wizard].filter((x) => features.some((f) => f.id === x.id)),
  );

  interface ClassShape {
    levels: {
      level: number;
      extra?: Record<string, unknown>;
      choices: { id: string; pick: unknown; count: number }[];
    }[];
  }

  it('fighter: an ASI/feat choice is authored at every 2024 ASI level (4, 6, 8, 12, 14, 16, 19)', () => {
    const f = patchedClasses.find((c) => c.id === 'srd-5e-2024:class/fighter') as ClassShape;
    const choiceIds = f.levels.flatMap((r) => r.choices.map((c) => c.id));
    for (const level of [4, 6, 8, 12, 14, 16, 19]) {
      expect(choiceIds, `level ${level}`).toContain(`srd-5e-2024:class/fighter@${level}/feat`);
    }
    // Not offered at a non-ASI level.
    expect(choiceIds).not.toContain('srd-5e-2024:class/fighter@5/feat');
  });

  it('fighter: weapon-masteries is a real query pick (count stays 1, apps/web scope carry) and fighting-style repeats at every later level', () => {
    const f = patchedClasses.find((c) => c.id === 'srd-5e-2024:class/fighter') as ClassShape;
    const l1 = f.levels.find((r) => r.level === 1)!;
    const masteries = l1.choices.find((c) => c.id.endsWith('/weapon-masteries'))!;
    expect(masteries.pick).toEqual({ query: { type: 'item', hasField: ['weapon.mastery'] } });
    expect(masteries.count).toBe(1);
    const style = l1.choices.find((c) => c.id.endsWith('/fighting-style')) as unknown as { repeatableAt: number[] };
    expect(style.repeatableAt).toEqual(
      Array.from({ length: 19 }, (_, i) => i + 2), // 2..20
    );
  });

  it('fighter: Second Wind, Action Surge and Indomitable resources are stepped formulas, not level-1 literals', () => {
    const secondWind = patchedFeatures.find((x) => x.id.endsWith('second-wind')) as {
      effects: { type: string; max?: string }[];
    };
    const swMax = secondWind.effects.find((e) => e.type === 'resource.define')?.max;
    expect(swMax).toContain('classLevel(fighter)');
    expect(swMax).not.toBe('2');

    const actionSurge = patchedFeatures.find((x) => x.id.endsWith('fighter-action-surge')) as {
      effects: { type: string; uses?: { count: string } }[];
    };
    const asCount = actionSurge.effects.find((e) => e.type === 'action.define')?.uses?.count;
    expect(asCount).toContain('classLevel(fighter)');
    expect(asCount).not.toBe('1');

    const indomitable = patchedFeatures.find((x) => x.id.endsWith('fighter-indomitable')) as {
      effects: { type: string; id?: string; reset?: string }[];
    };
    const indom = indomitable.effects.find((e) => e.type === 'resource.define');
    expect(indom).toMatchObject({ id: 'indomitable', reset: 'longRest' });
  });

  it('fighter: extraAttack.set escalates to 3 (level 11) and 4 (level 20) on distinct features', () => {
    const two = patchedFeatures.find((x) => x.id.endsWith('two-extra-attacks')) as {
      effects: { type: string; count?: number }[];
    };
    const three = patchedFeatures.find((x) => x.id.endsWith('three-extra-attacks')) as {
      effects: { type: string; count?: number }[];
    };
    expect(two.effects).toContainEqual({ type: 'extraAttack.set', count: 3 });
    expect(three.effects).toContainEqual({ type: 'extraAttack.set', count: 4 });
  });

  it('fighter: features with genuinely inexpressible mechanics carry a feature.text fallback', () => {
    for (const slug of ['tactical-mind', 'tactical-shift', 'tactical-master', 'studied-attacks']) {
      const feat = patchedFeatures.find((x) => x.id === `srd-5e-2024:feature/fighter-${slug}`) as {
        effects: { type: string }[];
      };
      expect(
        feat.effects.some((e) => e.type === 'feature.text'),
        slug,
      ).toBe(true);
    }
  });

  it('champion: Additional Fighting Style is a real second choice at level 7, and later features are authored', () => {
    const champion = patchedSubclasses.find((s) => s.id === 'srd-5e-2024:subclass/champion') as ClassShape;
    const l7 = champion.levels.find((r) => r.level === 7)!;
    expect(l7.choices).toHaveLength(1);
    expect(l7.choices[0]!.pick).toEqual({ query: { type: 'feat', tags: ['fighting-style'] } });

    const athlete = patchedFeatures.find((x) => x.id.endsWith('remarkable-athlete')) as {
      effects: { type: string; on?: string }[];
    };
    expect(athlete.effects).toContainEqual({ type: 'advantage.grant', on: 'initiative' });
    expect(athlete.effects).toContainEqual({ type: 'advantage.grant', on: 'skill.athletics' });

    const survivor = patchedFeatures.find((x) => x.id.endsWith('champion-survivor')) as {
      effects: { type: string }[];
    };
    expect(survivor.effects.some((e) => e.type === 'feature.text')).toBe(true);
  });

  it('wizard: an ASI/feat choice is authored at every 2024 ASI level (4, 8, 12, 16, 19)', () => {
    const w = patchedClasses.find((c) => c.id === 'srd-5e-2024:class/wizard') as ClassShape;
    const choiceIds = w.levels.flatMap((r) => r.choices.map((c) => c.id));
    for (const level of [4, 8, 12, 16, 19]) {
      expect(choiceIds, `level ${level}`).toContain(`srd-5e-2024:class/wizard@${level}/feat`);
    }
  });

  it('wizard: cantrips-known row extras match the real vendored breakpoints (3/4/5 at 1/4/10), overriding the linear formula', () => {
    const w = patchedClasses.find((c) => c.id === 'srd-5e-2024:class/wizard') as ClassShape;
    expect(w.levels.find((r) => r.level === 1)?.extra?.['wizard-cantrips-known']).toBe(3);
    expect(w.levels.find((r) => r.level === 4)?.extra?.['wizard-cantrips-known']).toBe(4);
    expect(w.levels.find((r) => r.level === 10)?.extra?.['wizard-cantrips-known']).toBe(5);
    // Prepared spells stayed on the pre-existing, upstream-auto-carried key (unchanged shape).
    expect(w.levels.find((r) => r.level === 20)?.extra?.['wizard-prepared-spells']).toBe(25);
  });

  it('wizard: Scholar is deliberately NOT authored as a choice (engine + apps/web carry, documented)', () => {
    const w = patchedClasses.find((c) => c.id === 'srd-5e-2024:class/wizard') as ClassShape;
    const choiceIds = w.levels.flatMap((r) => r.choices.map((c) => c.id));
    expect(choiceIds.some((id) => id.includes('scholar'))).toBe(false);
    const scholar = patchedFeatures.find((x) => x.id.endsWith('wizard-scholar')) as { effects: unknown[] };
    expect(scholar.effects).toEqual([]);
  });

  it('evoker: Empowered Evocation authors the (currently inert) spell damage.bonus; Overchannel/Sculpt Spells fall back to text', () => {
    const empowered = patchedFeatures.find((x) => x.id.endsWith('empowered-evocation')) as {
      effects: { type: string; value?: string; filter?: { spell?: boolean } }[];
    };
    expect(empowered.effects).toContainEqual({ type: 'damage.bonus', value: 'mod(int)', filter: { spell: true } });

    for (const slug of ['overchannel', 'sculpt-spells']) {
      const feat = patchedFeatures.find((x) => x.id === `srd-5e-2024:feature/wizard-evoker-${slug}`) as {
        effects: { type: string }[];
      };
      expect(
        feat.effects.some((e) => e.type === 'feature.text'),
        slug,
      ).toBe(true);
    }
  });

  it('buildPack composes the extended overlays with zero diagnostics', () => {
    const pack = buildPack();
    expect(pack.entities.length).toBeGreaterThan(0);
  });
});
