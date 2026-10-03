import { createContentIndex, derive, reduce } from '@hk/engine';
import type { Event } from '@hk/protocol';
import { describe, expect, it } from 'vitest';
import { buildPack } from '../src/build.ts';
import { applyOverlays } from '../src/overlays/merge.ts';
import { loadOverlays } from '../src/overlays/load.ts'; // { corrections, systemChoices, species, fightingStyles, barbarian, cleric, fighter, warlock, wizard }
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

  it('fighter: weapon-masteries is a real query pick, count 3 (fix round 1), and fighting-style repeats at every later level', () => {
    const f = patchedClasses.find((c) => c.id === 'srd-5e-2024:class/fighter') as ClassShape;
    const l1 = f.levels.find((r) => r.level === 1)!;
    const masteries = l1.choices.find((c) => c.id.endsWith('/weapon-masteries'))!;
    expect(masteries.pick).toEqual({ query: { type: 'item', hasField: ['weapon.mastery'] } });
    // Plan 12 task 2: the count is now a classLevel formula (3 at level 0/1; per-level rows are checked
    // against the vendored column in fighter-mastery-count.test.ts).
    expect(masteries.count).toMatch(/^3 \+ /);
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

  it('wizard: Scholar has a feature.text fallback (fix round 1) but its choice stays deliberately unauthored (engine + apps/web carry)', () => {
    const w = patchedClasses.find((c) => c.id === 'srd-5e-2024:class/wizard') as ClassShape;
    const choiceIds = w.levels.flatMap((r) => r.choices.map((c) => c.id));
    expect(choiceIds.some((id) => id.includes('scholar'))).toBe(false);
    const scholar = patchedFeatures.find((x) => x.id.endsWith('wizard-scholar')) as {
      effects: { type: string }[];
    };
    expect(scholar.effects.some((e) => e.type === 'feature.text')).toBe(true);
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

describe('barbarian to level 20 mechanics (task 9)', () => {
  const { classes, subclasses, features } = transformClasses();
  const o = loadOverlays();
  const patchedClasses = applyOverlays(
    classes,
    [...o.corrections, ...o.barbarian].filter((x) => classes.some((c) => c.id === x.id)),
  );
  const patchedSubclasses = applyOverlays(
    subclasses,
    o.barbarian.filter((x) => subclasses.some((s) => s.id === x.id)),
  );
  const patchedFeatures = applyOverlays(
    features,
    o.barbarian.filter((x) => features.some((f) => f.id === x.id)),
  );

  interface ClassShape {
    saves: string[];
    armorTraining: string[];
    skillChoice: { from: string[]; count: number };
    levels: {
      level: number;
      extra?: Record<string, unknown>;
      choices: { id: string; pick: unknown; count: number }[];
    }[];
  }

  it('barbarian: core traits (no heavy armor training, 2-skill choice from the barbarian list)', () => {
    const b = patchedClasses.find((c) => c.id === 'srd-5e-2024:class/barbarian') as ClassShape;
    expect(b.saves).toEqual(['con', 'str']);
    expect(b.armorTraining).toEqual(['light', 'medium', 'shields']);
    expect(b.armorTraining).not.toContain('heavy');
    expect(b.skillChoice.count).toBe(2);
    expect(b.skillChoice.from).toEqual(
      expect.arrayContaining(['animal-handling', 'athletics', 'intimidation', 'nature', 'perception', 'survival']),
    );
  });

  it('barbarian: an ASI/feat choice is authored at every 2024 ASI level (4, 8, 12, 16, 19) and subclass at 3', () => {
    const b = patchedClasses.find((c) => c.id === 'srd-5e-2024:class/barbarian') as ClassShape;
    const choiceIds = b.levels.flatMap((r) => r.choices.map((c) => c.id));
    for (const level of [4, 8, 12, 16, 19]) {
      expect(choiceIds, `level ${level}`).toContain(`srd-5e-2024:class/barbarian@${level}/feat`);
    }
    expect(choiceIds).toContain('srd-5e-2024:class/barbarian@3/subclass');
    // Not offered at a non-ASI level.
    expect(choiceIds).not.toContain('srd-5e-2024:class/barbarian@5/feat');
  });

  it('barbarian: weapon-masteries is a real query pick with the vendored level-1 count (2)', () => {
    const b = patchedClasses.find((c) => c.id === 'srd-5e-2024:class/barbarian') as ClassShape;
    const l1 = b.levels.find((r) => r.level === 1)!;
    const masteries = l1.choices.find((c) => c.id.endsWith('/weapon-masteries'))!;
    expect(masteries.pick).toEqual({ query: { type: 'item', hasField: ['weapon.mastery'] } });
    expect(masteries.count).toBe(2);
  });

  it('barbarian: Unarmored Defense is a real ac.formula gated on wearing no armor', () => {
    const ud = patchedFeatures.find((x) => x.id.endsWith('barbarian-unarmored-defense')) as {
      effects: { type: string; formula?: string; when?: unknown }[];
    };
    expect(ud.effects).toContainEqual({
      type: 'ac.formula',
      formula: '10 + mod(dex) + mod(con)',
      key: 'barbarian-unarmored-defense',
      when: { armor: { category: ['none'] } },
    });
  });

  it('barbarian: Rage is a real stepped resource formula, not a level-1 literal', () => {
    const rage = patchedFeatures.find((x) => x.id.endsWith('feature/barbarian-rage')) as {
      effects: { type: string; id?: string; max?: string; reset?: string }[];
    };
    const def = rage.effects.find((e) => e.type === 'resource.define');
    expect(def).toMatchObject({ id: 'rage', reset: 'shortRest' });
    expect(def?.max).toContain('classLevel(barbarian)');
    expect(def?.max).not.toBe('2');
  });

  it('barbarian: Danger Sense and Feral Instinct and Fast Movement are real, armor/condition-gated effects', () => {
    const danger = patchedFeatures.find((x) => x.id.endsWith('danger-sense')) as {
      effects: { type: string; on?: string; when?: unknown }[];
    };
    expect(danger.effects).toContainEqual({
      type: 'advantage.grant',
      on: 'save.dex',
      when: { not: { condition: 'srd-5e-2024:condition/incapacitated' } },
    });

    const feral = patchedFeatures.find((x) => x.id.endsWith('feral-instinct')) as {
      effects: { type: string; on?: string }[];
    };
    expect(feral.effects).toContainEqual({ type: 'advantage.grant', on: 'initiative' });

    const fast = patchedFeatures.find((x) => x.id.endsWith('fast-movement')) as {
      effects: { type: string; mode?: string; value?: number; when?: unknown }[];
    };
    expect(fast.effects).toContainEqual({
      type: 'speed.bonus',
      mode: 'walk',
      value: 10,
      when: { armor: { category: ['none', 'light', 'medium'] } },
    });
  });

  it('barbarian: Primal Champion raises the ability cap to 25 alongside a +4 bonus', () => {
    const champion = patchedFeatures.find((x) => x.id.endsWith('primal-champion')) as {
      effects: { type: string; ability?: string; value?: number }[];
    };
    expect(champion.effects).toContainEqual({ type: 'ability.bonus', ability: 'str', value: 4 });
    expect(champion.effects).toContainEqual({ type: 'ability.bonus', ability: 'con', value: 4 });
    expect(champion.effects).toContainEqual({ type: 'ability.max', ability: 'str', value: 25 });
    expect(champion.effects).toContainEqual({ type: 'ability.max', ability: 'con', value: 25 });
  });

  it('barbarian: extraAttack.set at level 5', () => {
    const extra = patchedFeatures.find((x) => x.id.endsWith('feature/barbarian-extra-attack')) as {
      effects: { type: string; count?: number }[];
    };
    expect(extra.effects).toContainEqual({ type: 'extraAttack.set', count: 2 });
  });

  it('barbarian: features with genuinely inexpressible (raging-state or per-trigger) mechanics carry a feature.text fallback', () => {
    for (const slug of [
      'reckless-attack',
      'primal-knowledge',
      'instinctive-pounce',
      'brutal-strike',
      'relentless-rage',
      'improved-brutal-strike',
      'persistent-rage',
      'improved-brutal-strike-enhanced',
      'indomitable-might',
    ]) {
      const feat = patchedFeatures.find((x) => x.id === `srd-5e-2024:feature/barbarian-${slug}`) as {
        effects: { type: string }[];
      };
      expect(
        feat.effects.some((e) => e.type === 'feature.text'),
        slug,
      ).toBe(true);
    }
  });

  it('path of the berserker: every feature carries a feature.text fallback (raging-state or trigger/action gaps)', () => {
    for (const slug of ['frenzy', 'mindless-rage', 'retaliation', 'intimidating-presence']) {
      const feat = patchedFeatures.find((x) => x.id === `srd-5e-2024:feature/path-of-the-berserker-${slug}`) as {
        effects: { type: string }[];
      };
      expect(
        feat.effects.some((e) => e.type === 'feature.text'),
        slug,
      ).toBe(true);
    }
    const berserker = patchedSubclasses.find((s) => s.id === 'srd-5e-2024:subclass/path-of-the-berserker');
    expect(berserker).toBeDefined();
  });

  it('buildPack composes the barbarian overlay with zero diagnostics', () => {
    const pack = buildPack();
    expect(pack.entities.some((e) => e.id === 'srd-5e-2024:class/barbarian')).toBe(true);
  });
});

describe('cleric and life domain to level 20 mechanics (task 10)', () => {
  const { classes, subclasses, features } = transformClasses();
  const o = loadOverlays();
  const patchedClasses = applyOverlays(
    classes,
    [...o.corrections, ...o.cleric].filter((x) => classes.some((c) => c.id === x.id)),
  );
  const patchedSubclasses = applyOverlays(
    subclasses,
    o.cleric.filter((x) => subclasses.some((s) => s.id === x.id)),
  );
  const patchedFeatures = applyOverlays(
    features,
    o.cleric.filter((x) => features.some((f) => f.id === x.id)),
  );

  interface ClassShape {
    saves: string[];
    armorTraining: string[];
    weaponProficiencies: string[];
    skillChoice: { from: string[]; count: number };
    levels: {
      level: number;
      extra?: Record<string, unknown>;
      choices: { id: string; pick: unknown; count: number }[];
    }[];
  }

  it('cleric: core traits (no heavy armor, simple weapons only, 2-skill choice from the cleric list)', () => {
    const c = patchedClasses.find((x) => x.id === 'srd-5e-2024:class/cleric') as ClassShape;
    expect(c.armorTraining).toEqual(['light', 'medium', 'shields']);
    expect(c.armorTraining).not.toContain('heavy');
    expect(c.weaponProficiencies).toEqual(['simple']);
    expect(c.skillChoice.count).toBe(2);
    expect(c.skillChoice.from).toEqual(
      expect.arrayContaining(['history', 'insight', 'medicine', 'persuasion', 'religion']),
    );
  });

  it('cleric: an ASI/feat choice is authored at every 2024 ASI level (4, 8, 12, 16, 19) and subclass at 3', () => {
    const c = patchedClasses.find((x) => x.id === 'srd-5e-2024:class/cleric') as ClassShape;
    const choiceIds = c.levels.flatMap((r) => r.choices.map((ch) => ch.id));
    for (const level of [4, 8, 12, 16, 19]) {
      expect(choiceIds, `level ${level}`).toContain(`srd-5e-2024:class/cleric@${level}/feat`);
    }
    expect(choiceIds).toContain('srd-5e-2024:class/cleric@3/subclass');
    // Not offered at a non-ASI level.
    expect(choiceIds).not.toContain('srd-5e-2024:class/cleric@5/feat');
  });

  it('cleric: no weapon-mastery choice is authored (Cleric has no vendored Weapon Mastery feature)', () => {
    const c = patchedClasses.find((x) => x.id === 'srd-5e-2024:class/cleric') as ClassShape;
    const choiceIds = c.levels.flatMap((r) => r.choices.map((ch) => ch.id));
    expect(choiceIds.some((id) => id.includes('weapon-master'))).toBe(false);
  });

  it('cleric: spellcasting is a real full prepared caster keyed on Wisdom, with cantrips-known row extras at 3/4/5 (1/4/10)', () => {
    const spellcasting = patchedFeatures.find((x) => x.id.endsWith('cleric-spellcasting')) as {
      effects: { type: string; cantripsKnown?: string }[];
    };
    const sc = spellcasting.effects.find((e) => e.type === 'spellcasting.define');
    expect(sc).toMatchObject({ preparation: 'prepared', slots: 'full', ability: 'wis', focus: true, ritual: true });
    expect(sc?.cantripsKnown).toBe('3 + floor(classLevel(cleric) / 4)');

    const c = patchedClasses.find((x) => x.id === 'srd-5e-2024:class/cleric') as ClassShape;
    expect(c.levels.find((r) => r.level === 1)?.extra?.['cleric-cantrips-known']).toBe(3);
    expect(c.levels.find((r) => r.level === 4)?.extra?.['cleric-cantrips-known']).toBe(4);
    expect(c.levels.find((r) => r.level === 10)?.extra?.['cleric-cantrips-known']).toBe(5);
    // Prepared spells stayed on the pre-existing, upstream-auto-carried key (unchanged shape).
    expect(c.levels.find((r) => r.level === 20)?.extra?.['cleric-prepared-spells']).toBe(22);
  });

  it('cleric: Channel Divinity and Divine Intervention are real resources, not level-1 literals', () => {
    const cd = patchedFeatures.find((x) => x.id.endsWith('cleric-channel-divinity')) as {
      effects: { type: string; id?: string; max?: string; reset?: string }[];
    };
    const cdDef = cd.effects.find((e) => e.type === 'resource.define');
    expect(cdDef).toMatchObject({ id: 'channel-divinity', reset: 'shortRest' });
    expect(cdDef?.max).toContain('classLevel(cleric)');
    expect(cdDef?.max).not.toBe('2');

    const di = patchedFeatures.find((x) => x.id.endsWith('cleric-divine-intervention')) as {
      effects: { type: string; id?: string; max?: string; reset?: string }[];
    };
    expect(di.effects.find((e) => e.type === 'resource.define')).toMatchObject({
      id: 'divine-intervention',
      max: '1',
      reset: 'longRest',
    });
  });

  it('cleric: features with genuinely inexpressible mechanics (unrepresentable two-option choices, untriggerable bonuses, conditional resets) carry a feature.text fallback', () => {
    for (const slug of [
      'divine-order',
      'sear-undead',
      'blessed-strikes',
      'improved-blessed-strikes',
      'greater-divine-intervention',
    ]) {
      const feat = patchedFeatures.find((x) => x.id === `srd-5e-2024:feature/cleric-${slug}`) as {
        effects: { type: string }[];
      };
      expect(
        feat.effects.some((e) => e.type === 'feature.text'),
        slug,
      ).toBe(true);
    }
  });

  it('life domain: Preserve Life is a real action.define drawing on the Channel Divinity resource; the rest of the subclass falls back to text', () => {
    const subclass = patchedSubclasses.find((s) => s.id === 'srd-5e-2024:subclass/life-domain');
    expect(subclass).toBeDefined();

    const preserveLife = patchedFeatures.find((x) => x.id.endsWith('cleric-life-domain-preserve-life')) as {
      effects: { type: string; resource?: string; kind?: string }[];
    };
    expect(preserveLife.effects).toContainEqual(
      expect.objectContaining({ type: 'action.define', kind: 'action', resource: 'channel-divinity' }),
    );

    for (const slug of ['disciple-of-life', 'life-domain-spells', 'blessed-healer', 'supreme-healing']) {
      const feat = patchedFeatures.find((x) => x.id === `srd-5e-2024:feature/cleric-life-domain-${slug}`) as {
        effects: { type: string }[];
      };
      expect(
        feat.effects.some((e) => e.type === 'feature.text'),
        slug,
      ).toBe(true);
    }
  });

  it('buildPack composes the cleric overlay with zero diagnostics', () => {
    const pack = buildPack();
    expect(pack.entities.some((e) => e.id === 'srd-5e-2024:class/cleric')).toBe(true);
    expect(pack.entities.some((e) => e.id === 'srd-5e-2024:subclass/life-domain')).toBe(true);
  });
});

describe('warlock and fiend patron to level 20 mechanics (task 11)', () => {
  const { classes, subclasses, features } = transformClasses();
  const o = loadOverlays();
  const patchedClasses = applyOverlays(
    classes,
    [...o.corrections, ...o.warlock].filter((x) => classes.some((c) => c.id === x.id)),
  );
  const patchedSubclasses = applyOverlays(
    subclasses,
    o.warlock.filter((x) => subclasses.some((s) => s.id === x.id)),
  );
  const patchedFeatures = applyOverlays(
    features,
    o.warlock.filter((x) => features.some((f) => f.id === x.id)),
  );

  interface ClassShape {
    saves: string[];
    armorTraining: string[];
    weaponProficiencies: string[];
    skillChoice: { from: string[]; count: number };
    levels: {
      level: number;
      extra?: Record<string, unknown>;
      choices: { id: string; pick: unknown; count: number }[];
    }[];
  }

  it('warlock: core traits (light armor only, simple weapons only, 2-skill choice from the warlock list)', () => {
    const w = patchedClasses.find((x) => x.id === 'srd-5e-2024:class/warlock') as ClassShape;
    expect(w.armorTraining).toEqual(['light']);
    expect(w.weaponProficiencies).toEqual(['simple']);
    expect(w.skillChoice.count).toBe(2);
    expect(w.skillChoice.from).toEqual(
      expect.arrayContaining(['arcana', 'deception', 'history', 'intimidation', 'investigation', 'nature', 'religion']),
    );
  });

  it('warlock: an ASI/feat choice is authored at every 2024 ASI level (4, 8, 12, 16, 19) and subclass at 3', () => {
    const w = patchedClasses.find((x) => x.id === 'srd-5e-2024:class/warlock') as ClassShape;
    const choiceIds = w.levels.flatMap((r) => r.choices.map((ch) => ch.id));
    for (const level of [4, 8, 12, 16, 19]) {
      expect(choiceIds, `level ${level}`).toContain(`srd-5e-2024:class/warlock@${level}/feat`);
    }
    expect(choiceIds).toContain('srd-5e-2024:class/warlock@3/subclass');
    // Not offered at a non-ASI level.
    expect(choiceIds).not.toContain('srd-5e-2024:class/warlock@5/feat');
  });

  it('warlock: no weapon-mastery choice is authored (Warlock has no vendored Weapon Mastery feature)', () => {
    const w = patchedClasses.find((x) => x.id === 'srd-5e-2024:class/warlock') as ClassShape;
    const choiceIds = w.levels.flatMap((r) => r.choices.map((ch) => ch.id));
    expect(choiceIds.some((id) => id.includes('weapon-master'))).toBe(false);
  });

  it('warlock: Pact Magic is a real spellcasting.define with slots:pact, keyed on Charisma, with cantrips-known row extras at 2/3/4 (1/4/10)', () => {
    const pactMagic = patchedFeatures.find((x) => x.id.endsWith('warlock-pact-magic')) as {
      effects: { type: string; cantripsKnown?: string; preparedCount?: string }[];
    };
    const sc = pactMagic.effects.find((e) => e.type === 'spellcasting.define');
    expect(sc).toMatchObject({
      preparation: 'prepared',
      slots: 'pact',
      ability: 'cha',
      focus: true,
      ritual: false,
    });
    expect(sc?.cantripsKnown).toBeUndefined();
    expect(sc?.preparedCount).toBeUndefined();

    const w = patchedClasses.find((x) => x.id === 'srd-5e-2024:class/warlock') as ClassShape;
    expect(w.levels.find((r) => r.level === 1)?.extra?.['warlock-cantrips-known']).toBe(2);
    expect(w.levels.find((r) => r.level === 4)?.extra?.['warlock-cantrips-known']).toBe(3);
    expect(w.levels.find((r) => r.level === 10)?.extra?.['warlock-cantrips-known']).toBe(4);
    // Prepared spells stayed on the pre-existing, upstream-auto-carried key (unchanged shape).
    expect(w.levels.find((r) => r.level === 20)?.extra?.['warlock-prepared-spells']).toBe(15);
  });

  it('warlock: pact slots resolve through the REAL system pact table, matching the SRD worked example (level 5 -> two level 3 slots)', () => {
    // End-to-end pact-lane validation (ruling 2): the same sparse-row shape task 3's engine reads,
    // now sourced from the real SRD pack rather than a synthetic fixture.
    const pack = buildPack();
    const system = pack.entities.find((e) => e.type === 'system') as {
      tables: { spellSlots: { pact?: number[][] } };
    };
    expect(system.tables.spellSlots.pact?.[4]).toEqual([0, 0, 2]);
  });

  it("warlock: Magical Cunning, Contact Patron, Mystic Arcanum, and Dark One's Own Luck are real resources, not text-only", () => {
    const mc = patchedFeatures.find((x) => x.id.endsWith('warlock-magical-cunning')) as {
      effects: { type: string; id?: string; max?: string; reset?: string }[];
    };
    expect(mc.effects.find((e) => e.type === 'resource.define')).toMatchObject({
      id: 'magical-cunning',
      max: '1',
      reset: 'longRest',
    });

    const cp = patchedFeatures.find((x) => x.id.endsWith('warlock-contact-patron')) as {
      effects: { type: string; id?: string; max?: string; reset?: string }[];
    };
    expect(cp.effects.find((e) => e.type === 'resource.define')).toMatchObject({
      id: 'contact-patron',
      max: '1',
      reset: 'longRest',
    });

    const ma = patchedFeatures.find((x) => x.id.endsWith('warlock-mystic-arcanum')) as {
      effects: { type: string; id?: string; max?: string; reset?: string }[];
    };
    const maDef = ma.effects.find((e) => e.type === 'resource.define');
    expect(maDef).toMatchObject({ id: 'mystic-arcanum', reset: 'longRest' });
    expect(maDef?.max).toContain('classLevel(warlock)');

    const dool = patchedFeatures.find((x) => x.id.endsWith('warlock-fiend-patron-dark-ones-own-luck')) as {
      effects: { type: string; id?: string; max?: string; reset?: string }[];
    };
    expect(dool.effects.find((e) => e.type === 'resource.define')).toMatchObject({
      id: 'dark-ones-own-luck',
      max: 'max(1, mod(cha))',
      reset: 'longRest',
    });
  });

  it('warlock: features with genuinely inexpressible mechanics (unmanufacturable invocation entities, untriggerable bonuses, no healing/temp-HP vocabulary) carry a feature.text fallback', () => {
    for (const slug of ['eldritch-invocations', 'eldritch-master']) {
      const feat = patchedFeatures.find((x) => x.id === `srd-5e-2024:feature/warlock-${slug}`) as {
        effects: { type: string }[];
      };
      expect(
        feat.effects.some((e) => e.type === 'feature.text'),
        slug,
      ).toBe(true);
    }
  });

  it("fiend patron: Dark One's Own Luck is a real resource; the rest of the subclass falls back to text", () => {
    const subclass = patchedSubclasses.find((s) => s.id === 'srd-5e-2024:subclass/fiend-patron');
    expect(subclass).toBeDefined();

    for (const slug of ['dark-ones-blessing', 'fiend-spells', 'fiendish-resilience', 'hurl-through-hell']) {
      const feat = patchedFeatures.find((x) => x.id === `srd-5e-2024:feature/warlock-fiend-patron-${slug}`) as {
        effects: { type: string }[];
      };
      expect(
        feat.effects.some((e) => e.type === 'feature.text'),
        slug,
      ).toBe(true);
    }
  });

  it('buildPack composes the warlock overlay with zero diagnostics', () => {
    const pack = buildPack();
    expect(pack.entities.some((e) => e.id === 'srd-5e-2024:class/warlock')).toBe(true);
    expect(pack.entities.some((e) => e.id === 'srd-5e-2024:subclass/fiend-patron')).toBe(true);
  });
});

// ---- Plan 12 task 5: SRD feats at scale ---------------------------------------------------------

const FP = 'srd-5e-2024';
const featPack = buildPack();
const featIndex = createContentIndex([featPack]);
const featRules = { restRules: featIndex.system().restRules, hpRules: featIndex.system().hpRules };
interface FeatShape {
  prerequisites: unknown[];
  effects?: { type: string; [k: string]: unknown }[];
  choices?: { id: string; count: unknown; pick: unknown }[];
}
const featEntity = (slug: string) =>
  featPack.entities.find((e) => e.id === `${FP}:feat/${slug}`) as unknown as FeatShape;
const featEffects = (slug: string) => featEntity(slug).effects ?? [];

const ALL_FEATS = [
  'alert',
  'magic-initiate',
  'savage-attacker',
  'skilled',
  'ability-score-improvement',
  'grappler',
  'archery',
  'defense',
  'great-weapon-fighting',
  'two-weapon-fighting',
  'boon-of-combat-prowess',
  'boon-of-dimensional-travel',
  'boon-of-fate',
  'boon-of-irresistible-offense',
  'boon-of-spell-recall',
  'boon-of-the-night-spirit',
  'boon-of-truesight',
];
const BOONS = ALL_FEATS.filter((s) => s.startsWith('boon-'));

describe('feats (task 5): every feat carries real mechanics or a ledgered text fallback', () => {
  it.each(ALL_FEATS)('%s is not silent (effects or choices authored)', (slug) => {
    const f = featEntity(slug);
    expect((f.effects?.length ?? 0) + (f.choices?.length ?? 0), slug).toBeGreaterThan(0);
  });

  it('alert: initiative gains the proficiency bonus; the swap rider is text', () => {
    expect(featEffects('alert')).toContainEqual({ type: 'initiative.bonus', value: 'prof' });
    expect(featEffects('alert').some((e) => e.type === 'feature.text')).toBe(true);
  });

  it('boon of truesight: truesight 60 ft', () => {
    expect(featEffects('boon-of-truesight')).toContainEqual({ type: 'sense.grant', sense: 'truesight', range: 60 });
  });

  it.each(BOONS)('%s: +1 to one ability (max 30) and a level-19 prerequisite', (slug) => {
    const f = featEntity(slug);
    expect(f.choices).toHaveLength(1);
    expect(f.choices![0]!.pick).toEqual({ abilities: { count: 1, max: 30, improve: '+1' } });
    expect(f.prerequisites).toContainEqual({ level: { gte: 19 } });
  });

  it('boon of spell recall additionally requires a spellcaster', () => {
    expect(featEntity('boon-of-spell-recall').prerequisites).toContainEqual({ spellcaster: true });
  });

  it('level / ability prerequisites are structured predicates', () => {
    expect(featEntity('ability-score-improvement').prerequisites).toContainEqual({ level: { gte: 4 } });
    const grappler = featEntity('grappler').prerequisites;
    expect(grappler).toContainEqual({ level: { gte: 4 } });
    expect(grappler).toContainEqual({ any: [{ ability: { str: { gte: 13 } } }, { ability: { dex: { gte: 13 } } }] });
  });

  it('text-fallback feats carry feature.text with the verbatim rule text', () => {
    for (const slug of ['magic-initiate', 'savage-attacker', 'skilled', 'grappler', 'boon-of-combat-prowess']) {
      expect(
        featEffects(slug).some((e) => e.type === 'feature.text'),
        slug,
      ).toBe(true);
    }
    expect(JSON.stringify(featEffects('savage-attacker'))).toContain('roll the weapon');
  });

  it('repeatable feats carry no non-stacking effect (task 1 boundary p1)', () => {
    for (const slug of ['magic-initiate', 'skilled', 'ability-score-improvement']) {
      for (const e of featEffects(slug)) {
        expect(['tag.grant', 'spellcasting.define'], `${slug}:${e.type}`).not.toContain(e.type);
      }
    }
  });
});

let featSeq = 0;
const featEv = (type: string, payload: unknown): Event => {
  featSeq += 1;
  return {
    id: `018f7000-0000-7000-8000-${String(featSeq).padStart(12, '0')}`,
    stream: 'char:11111111-1111-7111-8111-111111111111',
    seq: featSeq,
    ts: '2026-09-27T12:00:00.000Z',
    actor: { userId: 'u1', deviceId: 'd1', role: 'owner' },
    type,
    v: 1,
    payload,
  };
};
const featDecide = (choiceId: string, selection: string[]) => featEv('decision.made', { choiceId, selection });

/** A Fighter `level` (standard array, Soldier) with the given extra decisions appended after levelling. */
function featFighter(level: number, extra: [choiceId: string, selection: string[]][] = []): Event[] {
  featSeq = 0;
  const fighter = `${FP}:class/fighter`;
  return [
    featEv('character.created', {
      name: 'Aldric',
      system: '5e-2024',
      corePack: { id: FP, version: '0.1.0' },
      engineVersion: '0.1.0',
      grammaticalGender: 'masculine',
    }),
    featDecide(`${FP}:system/5e-2024@0/species`, [`${FP}:species/human`]),
    featDecide(`${FP}:system/5e-2024@0/background`, [`${FP}:background/soldier`]),
    featDecide(`${FP}:background/soldier@0/ability-scores`, ['str:+2', 'con:+1']),
    featDecide(`${FP}:system/5e-2024@0/ability-scores`, ['str:15', 'dex:14', 'con:14', 'int:10', 'wis:12', 'cha:8']),
    ...Array.from({ length: level }, (_, i) =>
      featEv('level.gained', { classId: fighter, level: i + 1, hpRoll: 'average' }),
    ),
    ...extra.map(([choiceId, selection]) => featDecide(choiceId, selection)),
  ];
}
const sheetOf = (events: Event[]) => derive(reduce(events, undefined, featRules), featIndex, featRules);
const profSkills = (events: Event[]) =>
  Object.entries(sheetOf(events).skills)
    .filter(([, s]) => s.proficiency !== 'none')
    .map(([k]) => k)
    .sort();

describe('feats (task 5): integration over the real pack', () => {
  it('alert at fighter 4: initiative = dex mod + proficiency bonus', () => {
    const base = sheetOf(featFighter(4)).initiative.value;
    const withAlert = sheetOf(featFighter(4, [[`${FP}:class/fighter@4/feat`, [`${FP}:feat/alert`]]]));
    expect(withAlert.initiative.value).toBe(base + 2); // proficiency bonus at level 4
  });

  it('boon of truesight at fighter 19 grants truesight 60', () => {
    const s = sheetOf(
      featFighter(19, [
        [`${FP}:class/fighter@19/feat`, [`${FP}:feat/boon-of-truesight`]],
        [`${FP}:feat/boon-of-truesight@19/ability-score`, ['str:+1']],
      ]),
    );
    expect(s.senses.find((x) => x.sense === 'truesight')?.range).toBe(60);
  });

  it('skilled taken twice (fighter 4 and 6) grants 6 distinct skill proficiencies', () => {
    const fighter = `${FP}:class/fighter`;
    const skilled = `${FP}:feat/skilled`;
    const skill = (s: string) => `${FP}:skill/${s}`;
    const baseline = profSkills(featFighter(6));
    // Pick skills the Soldier background does not already grant, so the delta is exactly the 6 picks.
    const first = ['acrobatics', 'arcana', 'history'];
    const second = ['insight', 'medicine', 'nature'];
    const events = featFighter(6, [
      [`${fighter}@4/feat`, [skilled]],
      [`${skilled}@1/skills`, first.map(skill)],
      [`${fighter}@6/feat`, [skilled]],
      [`${skilled}@1/skills--2`, second.map(skill)],
    ]);
    const sheet = sheetOf(events);
    expect(sheet.outstandingChoices.filter((c) => c.ownerId === skilled)).toEqual([]);
    expect(sheet.issues.filter((i) => i.code.startsWith('selection.'))).toEqual([]);
    const gained = profSkills(events).filter((s) => !baseline.includes(s));
    expect(gained).toEqual([...first, ...second].sort());
    expect(gained).toHaveLength(6);
  });
});

describe('rogue and thief to level 20 mechanics (task 7)', () => {
  const { classes, subclasses, features } = transformClasses();
  const o = loadOverlays();
  const patchedClasses = applyOverlays(
    classes,
    [...o.corrections, ...o.rogue].filter((x) => classes.some((c) => c.id === x.id)),
  );
  const patchedSubclasses = applyOverlays(
    subclasses,
    o.rogue.filter((x) => subclasses.some((s) => s.id === x.id)),
  );
  const patchedFeatures = applyOverlays(
    features,
    o.rogue.filter((x) => features.some((f) => f.id === x.id)),
  );

  interface ClassShape {
    saves: string[];
    armorTraining: string[];
    weaponProficiencies: string[];
    toolProficiencies: string[];
    skillChoice: { from: string[]; count: number };
    multiclass: { gains: { armorTraining: string[]; weaponProficiencies: string[]; skillChoiceCount: number } };
    levels: {
      level: number;
      extra?: Record<string, unknown>;
      choices: { id: string; pick: unknown; count: number }[];
    }[];
  }
  const rogue = () => patchedClasses.find((x) => x.id === 'srd-5e-2024:class/rogue') as ClassShape;
  const feature = (slug: string) =>
    patchedFeatures.find((x) => x.id === `srd-5e-2024:feature/rogue-${slug}`) as {
      effects: { type: string; [k: string]: unknown }[];
    };

  it('rogue: core traits (light armor, simple + martial finesse/light weapons, thieves tools, 4-skill choice)', () => {
    const r = rogue();
    expect(r.saves).toEqual(['dex', 'int']);
    expect(r.armorTraining).toEqual(['light']);
    expect(r.weaponProficiencies).toEqual(
      expect.arrayContaining(['simple', 'rapier', 'scimitar', 'shortsword', 'whip', 'hand-crossbow']),
    );
    expect(r.weaponProficiencies).not.toContain('martial');
    expect(r.toolProficiencies).toEqual(['thieves-tools']);
    expect(r.skillChoice.count).toBe(4);
    expect([...r.skillChoice.from].sort()).toEqual(
      [
        'acrobatics',
        'athletics',
        'deception',
        'insight',
        'intimidation',
        'investigation',
        'perception',
        'persuasion',
        'sleight-of-hand',
        'stealth',
      ].sort(),
    );
  });

  it('rogue: multiclass gains = light armor + one skill (no weapons)', () => {
    expect(rogue().multiclass.gains).toEqual({
      armorTraining: ['light'],
      weaponProficiencies: [],
      skillChoiceCount: 1,
    });
  });

  it('rogue: subclass choice at 3 offers only the rogue subclass query; ASI/feat at 4, 8, 12, 16, 19', () => {
    const rows = rogue().levels;
    const ids = rows.flatMap((r) => r.choices.map((c) => c.id));
    const sub = rows.flatMap((r) => r.choices).find((c) => c.id === 'srd-5e-2024:class/rogue@3/subclass')!;
    expect(sub.pick).toEqual({ query: { type: 'subclass', classes: ['rogue'] } });
    expect(sub.count).toBe(1);
    for (const level of [4, 8, 12, 16, 19])
      expect(ids, `level ${level}`).toContain(`srd-5e-2024:class/rogue@${level}/feat`);
    expect(ids).not.toContain('srd-5e-2024:class/rogue@10/feat');
    expect(
      subclasses.filter((s) => (s as { class: string }).class === 'srd-5e-2024:class/rogue').map((s) => s.id),
    ).toEqual(['srd-5e-2024:subclass/thief']);
  });

  it('rogue: weapon-masteries is a real query pick, count 2, with a matching mastery.grant', () => {
    const l1 = rogue().levels.find((r) => r.level === 1)!;
    const m = l1.choices.find((c) => c.id.endsWith('/weapon-masteries'))!;
    expect(m.pick).toEqual({ query: { type: 'item', hasField: ['weapon.mastery'] } });
    expect(m.count).toBe(2);
    expect(feature('weapon-mastery').effects).toContainEqual({ type: 'mastery.grant', count: '2' });
  });

  it('rogue: Sneak Attack is display-only: typed dice extras at all 20 levels, no effect on the feature', () => {
    const dice = rogue().levels.map((r) => r.extra?.['rogue-sneak-attack-column-data']);
    expect(dice).toEqual([1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10].map((n) => `${n}d6`));
    expect(feature('sneak-attack').effects.filter((e) => e.type !== 'feature.text')).toEqual([]);
  });

  it('rogue: Expertise is NEVER a plain skill pick (that would grant base proficiency) -- text fallback', () => {
    const allChoices = rogue().levels.flatMap((r) => r.choices);
    expect(allChoices.filter((c) => /expertise/i.test(c.id))).toEqual([]);
    expect(feature('expertise').effects.some((e) => e.type === 'feature.text')).toBe(true);
    expect(feature('expertise').effects.some((e) => e.type === 'proficiency.grant')).toBe(false);
  });

  it('rogue: real effects (Slippery Mind saves, Stroke of Luck resource, Thieves Cant language, Weapon Mastery)', () => {
    expect(feature('slippery-mind').effects).toEqual(
      expect.arrayContaining([
        { type: 'proficiency.grant', kind: 'save', target: 'wis', level: 'proficient' },
        { type: 'proficiency.grant', kind: 'save', target: 'cha', level: 'proficient' },
      ]),
    );
    expect(feature('stroke-of-luck').effects).toContainEqual(
      expect.objectContaining({ type: 'resource.define', id: 'stroke-of-luck', max: '1', reset: 'shortRest' }),
    );
    expect(feature('thieves-cant').effects).toContainEqual({
      type: 'language.grant',
      language: 'srd-5e-2024:language/thieves-cant',
    });
  });

  it('rogue and thief: state/trigger-gated features carry a feature.text fallback', () => {
    for (const slug of [
      'cunning-action',
      'cunning-strike',
      'steady-aim',
      'uncanny-dodge',
      'evasion',
      'reliable-talent',
      'improved-cunning-strike',
      'devious-strikes',
      'elusive',
      'thief-fast-hands',
      'thief-second-story-work',
      'thief-supreme-sneak',
      'thief-thiefs-reflexes',
      'thief-use-magic-device',
    ]) {
      expect(
        feature(slug).effects.some((e) => e.type === 'feature.text'),
        slug,
      ).toBe(true);
    }
    expect(patchedSubclasses.find((s) => s.id === 'srd-5e-2024:subclass/thief')).toBeDefined();
  });

  it('buildPack composes the rogue overlay with the rogue class mechanized', () => {
    const pack = buildPack();
    const r = pack.entities.find((e) => e.id === 'srd-5e-2024:class/rogue') as unknown as ClassShape;
    expect(r.skillChoice.count).toBe(4);
  });
});

describe('monk and warrior of the open hand to level 20 mechanics (task 8)', () => {
  const { classes, subclasses, features } = transformClasses();
  const o = loadOverlays();
  const patchedClasses = applyOverlays(
    classes,
    [...o.corrections, ...o.monk].filter((x) => classes.some((c) => c.id === x.id)),
  );
  const patchedFeatures = applyOverlays(
    features,
    o.monk.filter((x) => features.some((f) => f.id === x.id)),
  );

  interface MonkShape {
    hitDie: number;
    saves: string[];
    armorTraining: string[];
    weaponProficiencies: string[];
    skillChoice: { from: string[]; count: number };
    multiclass: { gains: { armorTraining: string[]; weaponProficiencies: string[]; skillChoiceCount: number } };
    levels: {
      level: number;
      extra?: Record<string, unknown>;
      choices: { id: string; pick: unknown; count: number }[];
    }[];
  }
  const monk = () => patchedClasses.find((x) => x.id === 'srd-5e-2024:class/monk') as unknown as MonkShape;
  const feature = (slug: string) =>
    patchedFeatures.find((x) => x.id === `srd-5e-2024:feature/monk-${slug}`) as unknown as {
      effects: { type: string; [k: string]: unknown }[];
    };

  it('monk: core traits (d8, dex/wis saves, no armor, simple + martial light weapons, 2 skills from 6)', () => {
    const m = monk();
    expect(m.hitDie).toBe(8);
    expect(m.saves).toEqual(['str', 'dex']); // upstream [dex, wis] corrected by corrections.json
    expect(m.armorTraining).toEqual([]);
    expect(m.weaponProficiencies).toEqual(['simple', 'hand-crossbow', 'scimitar', 'shortsword']);
    expect(m.skillChoice.count).toBe(2);
    expect([...m.skillChoice.from].sort()).toEqual(
      ['acrobatics', 'athletics', 'history', 'insight', 'religion', 'stealth'].sort(),
    );
  });

  it('monk: multiclass gains = simple + martial Light weapons, no armor/skills (owner-flagged, SRD-silent in the vendor)', () => {
    expect(monk().multiclass.gains).toEqual({
      armorTraining: [],
      weaponProficiencies: ['simple', 'hand-crossbow', 'scimitar', 'shortsword'],
      skillChoiceCount: 0,
    });
  });

  it('monk: subclass choice at 3 offers only Open Hand; ASI at 4/8/12/16 + Epic Boon at 19, none at 10', () => {
    const rows = monk().levels;
    const choices = rows.flatMap((r) => r.choices);
    const ids = choices.map((c) => c.id);
    const sub = choices.find((c) => c.id === 'srd-5e-2024:class/monk@3/subclass')!;
    expect(sub.pick).toEqual({ query: { type: 'subclass', classes: ['monk'] } });
    for (const level of [4, 8, 12, 16, 19])
      expect(ids, `level ${level}`).toContain(`srd-5e-2024:class/monk@${level}/feat`);
    expect(ids).not.toContain('srd-5e-2024:class/monk@10/feat');
    expect(ids.some((i) => i.endsWith('/weapon-masteries'))).toBe(false);
    expect(
      subclasses.filter((s) => (s as { class: string }).class === 'srd-5e-2024:class/monk').map((s) => s.id),
    ).toEqual(['srd-5e-2024:subclass/warrior-of-the-open-hand']);
  });

  it('monk: Martial Arts die is display-only typed extras at all 20 levels (ruling 1)', () => {
    const dice = monk().levels.map((r) => r.extra?.['monk-martial-arts-dice']);
    const rep = (die: string, n: number): string[] => Array.from({ length: n }, () => die);
    expect(dice).toEqual([...rep('1d6', 4), ...rep('1d8', 6), ...rep('1d10', 6), ...rep('1d12', 4)]);
    expect(feature('martial-arts').effects.filter((e) => e.type !== 'feature.text')).toEqual([]);
  });

  it('monk: Focus Points resource formula reproduces the vendored column at all 20 levels; absent at level 1', () => {
    const def = feature('monks-focus').effects.find((e) => e.type === 'resource.define') as unknown as {
      id: string;
      max: string;
      reset: string;
    };
    expect(def).toMatchObject({ id: 'focus-points', reset: 'shortRest' });
    expect(def.max).toBe('classLevel(monk)');
    const column = monk().levels.map((r) => r.extra?.['monk-focus-points']);
    expect(column[0]).toBeUndefined(); // level 1 has no Focus Points row
    expect(column.slice(1)).toEqual(Array.from({ length: 19 }, (_, i) => i + 2));
    // the define lives on a feature first granted at level 2, so it materializes only from level 2
    const grantedAt = (slug: string) =>
      monk().levels.find((r) =>
        (r as unknown as { grants: { feature: string }[] }).grants.some(
          (g) => g.feature === `srd-5e-2024:feature/monk-${slug}`,
        ),
      )!.level;
    expect(grantedAt('monks-focus')).toBe(2);
  });

  it('monk: Unarmored Defense is ac.formula 10+DEX+WIS suppressed by armor OR a shield', () => {
    expect(feature('unarmored-defense').effects).toContainEqual({
      type: 'ac.formula',
      formula: '10 + mod(dex) + mod(wis)',
      key: 'monk-unarmored-defense',
      when: { all: [{ armor: { category: ['none'] } }, { shield: false }] },
    });
  });

  it('monk: Unarmored Movement is stepped speed.bonus increments reproducing the vendored column', () => {
    const eff = feature('unarmored-movement').effects.filter((e) => e.type === 'speed.bonus') as unknown as {
      mode: string;
      value: number;
      key: string;
      when: { all: [unknown, unknown, { classLevel: { monk: { gte: number } } }] };
    }[];
    expect(eff).toHaveLength(5);
    const total = (level: number) =>
      eff.filter((e) => level >= e.when.all[2].classLevel.monk.gte).reduce((a, e) => a + e.value, 0);
    // vendored srd-2024_monk_unarmored-movement column: none at 1, +10 (2-5), +15 (6-9), +20 (10-13), +25 (14-17), +30 (18-20)
    const column = (l: number) => (l < 2 ? 0 : l < 6 ? 10 : l < 10 ? 15 : l < 14 ? 20 : l < 18 ? 25 : 30);
    for (let l = 1; l <= 20; l++) expect(total(l), `level ${l}`).toBe(column(l));
    expect(new Set(eff.map((e) => e.key)).size).toBe(5);
    for (const e of eff) {
      expect(e.mode).toBe('walk');
      expect(e.when.all[0]).toEqual({ armor: { category: ['none'] } });
      expect(e.when.all[1]).toEqual({ shield: false });
    }
  });

  it('monk: Extra Attack and Body and Mind are real effects (extraAttack.set, +4 dex/wis capped at 25)', () => {
    expect(feature('extra-attack').effects).toContainEqual({ type: 'extraAttack.set', count: 2 });
    const bm = feature('body-and-mind').effects;
    for (const ability of ['dex', 'wis']) {
      expect(bm).toContainEqual({ type: 'ability.bonus', ability, value: 4 });
      expect(bm).toContainEqual({ type: 'ability.max', ability, value: 25 });
    }
  });

  it('monk: real saves effect (Disciplined Survivor) and text fallbacks for state/spend-gated features', () => {
    expect(feature('disciplined-survivor').effects.some((e) => e.type === 'proficiency.grant')).toBe(true);
    for (const slug of [
      'martial-arts',
      'uncanny-metabolism',
      'deflect-attacks',
      'stunning-strike',
      'slow-fall',
      'empowered-strikes',
      'evasion',
      'acrobatic-movement',
      'heightened-focus',
      'self-restoration',
      'deflect-energy',
      'disciplined-survivor',
      'perfect-focus',
      'superior-defense',
      'warrior-of-the-open-hand-open-hand-technique',
      'warrior-of-the-open-hand-wholeness-of-body',
      'warrior-of-the-open-hand-fleet-step',
      'warrior-of-the-open-hand-quivering-palm',
    ]) {
      expect(
        feature(slug).effects.some((e) => e.type === 'feature.text'),
        slug,
      ).toBe(true);
    }
  });
});

describe('monk integration over the real pack (task 8)', () => {
  const monkId = `${FP}:class/monk`;
  function monkChar(level: number): Event[] {
    featSeq = 0;
    return [
      featEv('character.created', {
        name: 'Lin',
        system: '5e-2024',
        corePack: { id: FP, version: '0.1.0' },
        engineVersion: '0.1.0',
        grammaticalGender: 'feminine',
      }),
      featDecide(`${FP}:system/5e-2024@0/species`, [`${FP}:species/human`]),
      featDecide(`${FP}:system/5e-2024@0/background`, [`${FP}:background/soldier`]),
      featDecide(`${FP}:background/soldier@0/ability-scores`, ['dex:+2', 'con:+1']),
      featDecide(`${FP}:system/5e-2024@0/ability-scores`, ['str:8', 'dex:15', 'con:14', 'int:10', 'wis:14', 'cha:12']),
      ...Array.from({ length: level }, (_, i) =>
        featEv('level.gained', { classId: monkId, level: i + 1, hpRoll: 'average' }),
      ),
    ];
  }

  it('Focus Points: absent at level 1, then max == monk level', () => {
    expect(sheetOf(monkChar(1)).resources.find((r) => r.id === 'focus-points')).toBeUndefined();
    for (const l of [2, 3, 5, 10, 20])
      expect(sheetOf(monkChar(l)).resources.find((r) => r.id === 'focus-points')?.max.value, `level ${l}`).toBe(l);
  });

  it('Unarmored Defense + Movement derive: AC 10+dex+wis, speed 30 + column', () => {
    // dex 15+2 = 17 (+3), wis 14 (+2): unarmored AC = 10 + 3 + 2
    expect(sheetOf(monkChar(1)).ac.value).toBe(15);
    expect(sheetOf(monkChar(1)).speed['walk']!.value).toBe(30);
    const expected: [number, number][] = [
      [2, 40],
      [5, 40],
      [6, 45],
      [10, 50],
      [14, 55],
      [18, 60],
      [20, 60],
    ];
    for (const [l, speed] of expected) expect(sheetOf(monkChar(l)).speed['walk']!.value, `level ${l}`).toBe(speed);
  });

  const equipped = (level: number, ...slugs: string[]) => {
    const facts = reduce(monkChar(level), undefined, featRules);
    facts.inventory = slugs.map((s, i) => ({
      instanceId: `i${i}`,
      itemId: `${FP}:item/${s}`,
      qty: 1,
      equipped: true,
      attuned: false,
    }));
    return derive(facts, featIndex, featRules);
  };

  it('Disciplined Survivor at monk 14: proficient in ALL SIX saves (str/dex from class, con/int/wis/cha granted)', () => {
    const at13 = equipped(13).abilities;
    expect(
      Object.entries(at13)
        .filter(([, a]) => a.saveProficient)
        .map(([k]) => k)
        .sort(),
    ).toEqual(['dex', 'str']);
    const at14 = equipped(14).abilities;
    expect(Object.keys(at14).sort()).toEqual(['cha', 'con', 'dex', 'int', 'str', 'wis']);
    for (const [k, a] of Object.entries(at14)) expect(a.saveProficient, k).toBe(true);
  });

  it('Unarmored Defense and Movement are suppressed by armor and by a shield alone (text: armor OR Shield)', () => {
    // unarmored: 10 + dex 3 + wis 2 = 15, speed 30 + 15 at level 6 = 45
    expect(equipped(6).ac.value).toBe(15);
    expect(equipped(6).speed['walk']!.value).toBe(45);
    // chain mail: flat 16, no unarmored formula, no movement bonus
    expect(equipped(6, 'chain-mail').ac.value).toBe(16);
    expect(equipped(6, 'chain-mail').speed['walk']!.value).toBe(30);
    // shield only: formula suppressed -> 10 + dex 3 + shield 2 = 15 (a leaked formula would give 17); no movement bonus
    expect(equipped(6, 'shield').ac.value).toBe(15);
    expect(equipped(6, 'shield').speed['walk']!.value).toBe(30);
  });
});

describe('paladin and oath of devotion to level 20 mechanics (task 9)', () => {
  const { classes, subclasses, features } = transformClasses();
  const o = loadOverlays();
  const patchedClasses = applyOverlays(
    classes,
    [...o.corrections, ...o.paladin].filter((x) => classes.some((c) => c.id === x.id)),
  );
  const patchedFeatures = applyOverlays(
    features,
    o.paladin.filter((x) => features.some((f) => f.id === x.id)),
  );
  interface PaladinShape {
    hitDie: number;
    saves: string[];
    armorTraining: string[];
    weaponProficiencies: string[];
    skillChoice: { from: string[]; count: number };
    multiclass: { gains: { armorTraining: string[]; weaponProficiencies: string[]; skillChoiceCount: number } };
    levels: { level: number; choices: { id: string; pick: unknown; count: number | string }[] }[];
  }
  const paladin = () => patchedClasses.find((x) => x.id === 'srd-5e-2024:class/paladin') as unknown as PaladinShape;
  const feature = (slug: string) =>
    patchedFeatures.find((x) => x.id === `srd-5e-2024:feature/paladin-${slug}`) as unknown as {
      effects: { type: string; [k: string]: unknown }[];
    };

  it('paladin: core traits (d10, wis/cha saves, all armor + shields, simple + martial, 2 skills from 6)', () => {
    const p = paladin();
    expect(p.hitDie).toBe(10);
    expect([...p.saves].sort()).toEqual(['cha', 'wis']);
    expect(p.armorTraining).toEqual(['light', 'medium', 'heavy', 'shields']);
    expect(p.weaponProficiencies).toEqual(['simple', 'martial']);
    expect(p.skillChoice.count).toBe(2);
    expect([...p.skillChoice.from].sort()).toEqual(
      ['athletics', 'insight', 'intimidation', 'medicine', 'persuasion', 'religion'].sort(),
    );
  });

  it('paladin: multiclass gains = martial weapons, light/medium armor, shields (owner-flagged, SRD-silent)', () => {
    expect(paladin().multiclass.gains).toEqual({
      armorTraining: ['light', 'medium', 'shields'],
      weaponProficiencies: ['martial'],
      skillChoiceCount: 0,
    });
  });

  it('paladin: choices — masteries x2 @1, fighting style @2, Devotion-only subclass @3, ASI 4/8/12/16 + boon 19', () => {
    const rows = paladin().levels;
    const choices = rows.flatMap((r) => r.choices);
    const ids = choices.map((c) => c.id);
    const mastery = choices.find((c) => c.id === 'srd-5e-2024:class/paladin@1/weapon-masteries')!;
    expect(mastery.count).toBe(2);
    expect(mastery.pick).toEqual({ query: { type: 'item', hasField: ['weapon.mastery'] } });
    const style = rows.find((r) => r.level === 2)!.choices.find((c) => c.id.endsWith('/fighting-style'))!;
    expect(style.pick).toEqual({ query: { type: 'feat', tags: ['fighting-style'] } });
    expect(choices.find((c) => c.id === 'srd-5e-2024:class/paladin@3/subclass')!.pick).toEqual({
      query: { type: 'subclass', classes: ['paladin'] },
    });
    for (const level of [4, 8, 12, 16, 19])
      expect(ids, `level ${level}`).toContain(`srd-5e-2024:class/paladin@${level}/feat`);
    expect(ids).not.toContain('srd-5e-2024:class/paladin@10/feat');
    expect(
      subclasses.filter((s) => (s as { class: string }).class === 'srd-5e-2024:class/paladin').map((s) => s.id),
    ).toEqual(['srd-5e-2024:subclass/oath-of-devotion']);
  });

  it('paladin: Spellcasting is a CHA half-caster with prepared spells, holy-symbol focus, no ritual casting', () => {
    expect(feature('spellcasting').effects).toEqual([
      {
        type: 'spellcasting.define',
        class: 'paladin',
        ability: 'cha',
        list: 'paladin',
        preparation: 'prepared',
        slots: 'half',
        ritual: false,
        focus: true,
      },
    ]);
  });

  it('paladin: Oath of Devotion spells are level-gated always-prepared grants over real pack spell ids', () => {
    const effs = feature('oath-of-devotion-spells').effects as unknown as {
      type: string;
      spell: string;
      alwaysPrepared: boolean;
      when: { classLevel: { paladin: { gte: number } } };
    }[];
    const byLevel: Record<number, string[]> = {};
    for (const e of effs) {
      expect(e.type).toBe('spell.grant');
      expect(e.alwaysPrepared).toBe(true);
      (byLevel[e.when.classLevel.paladin.gte] ??= []).push(e.spell.replace('srd-5e-2024:spell/', ''));
    }
    expect(byLevel).toEqual({
      3: ['protection-from-evil-and-good', 'shield-of-faith'],
      5: ['aid', 'zone-of-truth'],
      9: ['beacon-of-hope', 'dispel-magic'],
      13: ['freedom-of-movement', 'guardian-of-faith'],
      17: ['commune', 'flame-strike'],
    });
    for (const e of effs) expect(featIndex.get(e.spell)?.type, e.spell).toBe('spell');
  });

  it('paladin: text fallbacks present for the state/ally/choice-gated features', () => {
    for (const slug of [
      'fighting-style',
      'radiant-strikes',
      'restoring-touch',
      'aura-of-courage',
      'aura-expansion',
      'oath-of-devotion-aura-of-devotion',
      'oath-of-devotion-smite-of-protection',
    ]) {
      expect(
        feature(slug).effects.some((e) => e.type === 'feature.text'),
        slug,
      ).toBe(true);
    }
  });
});

describe('paladin integration over the real pack (task 9)', () => {
  const paladinId = `${FP}:class/paladin`;
  const spell = (s: string) => `${FP}:spell/${s}`;
  function paladinChar(level: number, opts: { devotion?: boolean; cha?: number } = {}): Event[] {
    featSeq = 0;
    const cha = opts.cha ?? 14;
    return [
      featEv('character.created', {
        name: 'Aldis',
        system: '5e-2024',
        corePack: { id: FP, version: '0.1.0' },
        engineVersion: '0.1.0',
        grammaticalGender: 'masculine',
      }),
      featDecide(`${FP}:system/5e-2024@0/species`, [`${FP}:species/human`]),
      featDecide(`${FP}:system/5e-2024@0/background`, [`${FP}:background/soldier`]),
      featDecide(`${FP}:background/soldier@0/ability-scores`, ['str:+2', 'con:+1']),
      featDecide(`${FP}:system/5e-2024@0/ability-scores`, [
        'str:15',
        'dex:8',
        'con:13',
        'int:10',
        'wis:12',
        `cha:${cha}`,
      ]),
      ...Array.from({ length: level }, (_, i) =>
        featEv('level.gained', {
          classId: paladinId,
          level: i + 1,
          hpRoll: 'average',
          ...(opts.devotion && i + 1 === 3 ? { subclassId: `${FP}:subclass/oath-of-devotion` } : {}),
        }),
      ),
    ];
  }
  const block = (level: number, opts: { devotion?: boolean } = {}) =>
    sheetOf(paladinChar(level, opts)).spellcasting.find((b) => b.classId === paladinId)!;

  it('saves: wis + cha proficient and nothing else (derive-level)', () => {
    const a = sheetOf(paladinChar(1)).abilities;
    expect(
      Object.entries(a)
        .filter(([, v]) => v.saveProficient)
        .map(([k]) => k)
        .sort(),
    ).toEqual(['cha', 'wis']);
  });

  it('armor + weapon proficiencies: light/medium/heavy/shields, simple + martial (derive-level)', () => {
    const p = sheetOf(paladinChar(1)).proficiencies;
    const has = (kind: string, target: string) => p.some((x) => x.kind === kind && x.target === target);
    for (const t of ['light', 'medium', 'heavy', 'shields']) expect(has('armor', t), t).toBe(true);
    for (const t of ['simple', 'martial']) expect(has('weapon', t), t).toBe(true);
  });

  it('half-caster slots pin the half table: 2@1, 3@3, 4+2@5, 4/3/2@9, 4/3/3/1@13, 4/3/3/3/2@19-20', () => {
    const max = (l: number) => block(l).slots.map((s) => s.max);
    expect(max(1)).toEqual([2]);
    expect(max(2)).toEqual([2]);
    expect(max(3)).toEqual([3]);
    expect(max(5)).toEqual([4, 2]);
    expect(max(7)).toEqual([4, 3]);
    expect(max(9)).toEqual([4, 3, 2]);
    expect(max(13)).toEqual([4, 3, 3, 1]);
    expect(max(17)).toEqual([4, 3, 3, 3, 1]);
    expect(max(19)).toEqual([4, 3, 3, 3, 2]);
    expect(max(20)).toEqual([4, 3, 3, 3, 2]);
    expect(block(1).cantripsKnown ?? 0).toBe(0);
  });

  it('prepared-spell cap follows the vendored Prepared Spells column', () => {
    const col: Record<number, number> = { 1: 2, 2: 3, 3: 4, 5: 6, 9: 9, 11: 10, 13: 11, 17: 14, 19: 15, 20: 15 };
    for (const [l, n] of Object.entries(col)) expect(block(Number(l)).preparedMax, `level ${l}`).toBe(n);
  });

  it("Paladin's Smite (2) and Faithful Steed (5) are always prepared and each carry a long-rest free-cast resource", () => {
    expect(block(1).alwaysPrepared).toBeUndefined();
    expect(block(2).alwaysPrepared).toEqual([spell('divine-smite')]);
    expect([...block(5).alwaysPrepared!].sort()).toEqual([spell('divine-smite'), spell('find-steed')].sort());
    const res = (l: number, id: string) => sheetOf(paladinChar(l)).resources.find((r) => r.id === id);
    expect(res(1, 'paladins-smite')).toBeUndefined();
    expect(res(2, 'paladins-smite')).toMatchObject({ reset: 'longRest', max: { value: 1 } });
    expect(res(4, 'faithful-steed')).toBeUndefined();
    expect(res(5, 'faithful-steed')).toMatchObject({ reset: 'longRest', max: { value: 1 } });
  });

  it('Oath of Devotion grants accumulate at 3/5/9/13/17, are always-prepared, and do not eat the prepared cap', () => {
    const ap = (l: number) => block(l, { devotion: true }).alwaysPrepared ?? [];
    const base = [spell('divine-smite')];
    expect(block(2, { devotion: true }).alwaysPrepared).toEqual(base); // no subclass yet at 2
    expect([...ap(3)].sort()).toEqual(
      [...base, spell('protection-from-evil-and-good'), spell('shield-of-faith')].sort(),
    );
    expect(ap(4)).toEqual(ap(3));
    expect([...ap(5)].sort()).toEqual([...ap(4), spell('find-steed'), spell('aid'), spell('zone-of-truth')].sort());
    const l17 = ap(17)
      .map((s) => s.replace(`${FP}:spell/`, ''))
      .sort();
    expect(l17).toEqual(
      [
        'divine-smite',
        'find-steed',
        'protection-from-evil-and-good',
        'shield-of-faith',
        'aid',
        'zone-of-truth',
        'beacon-of-hope',
        'dispel-magic',
        'freedom-of-movement',
        'guardian-of-faith',
        'commune',
        'flame-strike',
      ].sort(),
    );
    const b = block(17, { devotion: true });
    expect(b.preparedMax).toBe(14);
    for (const s of b.alwaysPrepared ?? []) expect(b.prepared).toContain(s);
    // without the oath only the class-level grants appear
    expect([...block(17).alwaysPrepared!].sort()).toEqual([spell('divine-smite'), spell('find-steed')].sort());
  });

  it('Lay on Hands pool = 5 x paladin level, long-rest reset', () => {
    for (const l of [1, 2, 7, 20]) {
      expect(
        sheetOf(paladinChar(l)).resources.find((r) => r.id === 'lay-on-hands'),
        `level ${l}`,
      ).toMatchObject({
        reset: 'longRest',
        max: { value: 5 * l },
      });
    }
  });

  it('Channel Divinity: absent before 3, 2 uses at 3-10, 3 uses from 11 (matches cleric reset precedent)', () => {
    const cd = (l: number) => sheetOf(paladinChar(l)).resources.find((r) => r.id === 'paladin-channel-divinity');
    expect(cd(1)).toBeUndefined();
    expect(cd(2)).toBeUndefined();
    for (const l of [3, 5, 10]) expect(cd(l)?.max.value, `level ${l}`).toBe(2);
    for (const l of [11, 15, 20]) expect(cd(l)?.max.value, `level ${l}`).toBe(3);
    expect(cd(3)?.reset).toBe('shortRest');
    // Divine Sense surfaces as a bonus action spending that pool
    expect(sheetOf(paladinChar(3)).actions.find((a) => a.id === 'divine-sense')).toMatchObject({
      kind: 'bonus',
      resource: 'paladin-channel-divinity',
    });
  });

  it('Aura of Protection (6): every save gains max(1, CHA mod), suppressed while Incapacitated (derive-level)', () => {
    const saves = (l: number, cha?: number) => {
      const a = sheetOf(paladinChar(l, { cha })).abilities;
      return Object.fromEntries(Object.entries(a).map(([k, v]) => [k, v.save.value]));
    };
    const before = saves(5);
    const after = saves(6); // proficiency bonus is +3 at both levels -> the delta is the aura alone
    for (const k of Object.keys(before)) expect(after[k]! - before[k]!, k).toBe(2); // CHA 14 -> +2
    // negative modifier floors at +1: CHA 8 (-1) still grants +1
    const lowBefore = saves(5, 8);
    const lowAfter = saves(6, 8);
    for (const k of Object.keys(lowBefore)) expect(lowAfter[k]! - lowBefore[k]!, k).toBe(1);
    // Incapacitated: the aura is inactive
    const facts = reduce(paladinChar(6), undefined, featRules);
    facts.conditions = [
      { conditionId: `${FP}:condition/incapacitated`, sinceEventId: '018f7000-0000-7000-8000-000000000001' },
    ];
    const down = derive(facts, featIndex, featRules).abilities;
    for (const k of Object.keys(before)) expect(down[k]!.save.value, k).toBe(before[k]);
  });

  it('Extra Attack at 5, weapon mastery count 2, Oath resources (Holy Nimbus at 20, Sacred Weapon action at 3)', () => {
    expect(sheetOf(paladinChar(4)).attacksPerAction).toBe(1);
    expect(sheetOf(paladinChar(5)).attacksPerAction).toBe(2);
    expect(sheetOf(paladinChar(1)).masteryCount).toBe(2);
    const dev = (l: number) => sheetOf(paladinChar(l, { devotion: true }));
    expect(dev(19).resources.find((r) => r.id === 'holy-nimbus')).toBeUndefined();
    expect(dev(20).resources.find((r) => r.id === 'holy-nimbus')).toMatchObject({
      reset: 'longRest',
      max: { value: 1 },
    });
    expect(dev(3).actions.find((a) => a.id === 'sacred-weapon')).toMatchObject({
      resource: 'paladin-channel-divinity',
    });
    expect(dev(9).actions.find((a) => a.id === 'abjure-foes')).toMatchObject({
      kind: 'action',
      resource: 'paladin-channel-divinity',
    });
  });
});

describe('ranger and hunter to level 20 mechanics (task 10)', () => {
  const { classes, subclasses, features } = transformClasses();
  const o = loadOverlays();
  const patchedClasses = applyOverlays(
    classes,
    [...o.corrections, ...o.ranger].filter((x) => classes.some((c) => c.id === x.id)),
  );
  const patchedFeatures = applyOverlays(
    features,
    o.ranger.filter((x) => features.some((f) => f.id === x.id)),
  );
  interface RangerShape {
    hitDie: number;
    saves: string[];
    armorTraining: string[];
    weaponProficiencies: string[];
    skillChoice: { from: string[]; count: number };
    multiclass: { gains: { armorTraining: string[]; weaponProficiencies: string[]; skillChoiceCount: number } };
    levels: { level: number; choices: { id: string; pick: unknown; count: number | string }[] }[];
  }
  const ranger = () => patchedClasses.find((x) => x.id === 'srd-5e-2024:class/ranger') as unknown as RangerShape;
  const feature = (slug: string) =>
    patchedFeatures.find((x) => x.id === `srd-5e-2024:feature/ranger-${slug}`) as unknown as {
      effects: { type: string; [k: string]: unknown }[];
    };

  it('ranger: core traits (d10, str/dex saves, light+medium+shields, simple+martial, 3 skills from 8)', () => {
    const r = ranger();
    expect(r.hitDie).toBe(10);
    expect([...r.saves].sort()).toEqual(['dex', 'str']);
    expect(r.armorTraining).toEqual(['light', 'medium', 'shields']);
    expect(r.weaponProficiencies).toEqual(['simple', 'martial']);
    expect(r.skillChoice.count).toBe(3);
    expect([...r.skillChoice.from].sort()).toEqual(
      [
        'animal-handling',
        'athletics',
        'insight',
        'investigation',
        'nature',
        'perception',
        'stealth',
        'survival',
      ].sort(),
    );
  });

  it('ranger: multiclass gains = martial, light/medium armor, shields, ONE skill (owner-flagged, SRD-silent)', () => {
    expect(ranger().multiclass.gains).toEqual({
      armorTraining: ['light', 'medium', 'shields'],
      weaponProficiencies: ['martial'],
      skillChoiceCount: 1,
    });
  });

  it('ranger: choices — masteries x2 @1, fighting style @2, Hunter subclass @3, ASI 4/8/12/16 + boon 19', () => {
    const rows = ranger().levels;
    const choices = rows.flatMap((r) => r.choices);
    const ids = choices.map((c) => c.id);
    const mastery = choices.find((c) => c.id === 'srd-5e-2024:class/ranger@1/weapon-masteries')!;
    expect(mastery.count).toBe(2);
    expect(mastery.pick).toEqual({ query: { type: 'item', hasField: ['weapon.mastery'] } });
    const style = rows.find((r) => r.level === 2)!.choices.find((c) => c.id.endsWith('/fighting-style'))!;
    expect(style.pick).toEqual({ query: { type: 'feat', tags: ['fighting-style'] } });
    expect(choices.find((c) => c.id === 'srd-5e-2024:class/ranger@3/subclass')!.pick).toEqual({
      query: { type: 'subclass', classes: ['ranger'] },
    });
    for (const level of [4, 8, 12, 16, 19])
      expect(ids, `level ${level}`).toContain(`srd-5e-2024:class/ranger@${level}/feat`);
    expect(ids).not.toContain('srd-5e-2024:class/ranger@10/feat');
    expect(
      subclasses.filter((s) => (s as { class: string }).class === 'srd-5e-2024:class/ranger').map((s) => s.id),
    ).toEqual(['srd-5e-2024:subclass/hunter']);
  });

  it('ranger: Spellcasting is a WIS half-caster with prepared spells, druidic focus, no ritual casting', () => {
    expect(feature('spellcasting').effects).toEqual([
      {
        type: 'spellcasting.define',
        class: 'ranger',
        ability: 'wis',
        list: 'ranger',
        preparation: 'prepared',
        slots: 'half',
        ritual: false,
        focus: true,
      },
    ]);
  });

  it('ranger: text fallbacks present for the inexpressible features (expertise, Hunter options, riders)', () => {
    for (const slug of [
      'deft-explorer',
      'expertise',
      'fighting-style',
      'precise-hunter',
      'relentless-hunter',
      'foe-slayer',
      'roving',
      'hunter-hunters-lore',
      'hunter-hunters-prey',
      'hunter-defensive-tactics',
      'hunter-superior-hunters-prey',
      'hunter-superior-hunters-defense',
    ]) {
      expect(
        feature(slug).effects.some((e) => e.type === 'feature.text'),
        slug,
      ).toBe(true);
    }
  });

  it('ranger: Expertise / Deft Explorer are NEVER authored as skill picks or proficiency grants (state-wrong shape)', () => {
    for (const slug of ['deft-explorer', 'expertise']) {
      expect(
        feature(slug).effects.map((e) => e.type),
        slug,
      ).toEqual(['feature.text']);
    }
    const choices = ranger().levels.flatMap((r) => r.choices);
    expect(choices.some((c) => /expertise|deft/.test(c.id))).toBe(false);
  });
});

describe('ranger integration over the real pack (task 10)', () => {
  const rangerId = `${FP}:class/ranger`;
  const spell = (s: string) => `${FP}:spell/${s}`;
  function rangerChar(level: number, opts: { hunter?: boolean; wis?: number } = {}): Event[] {
    featSeq = 0;
    const wis = opts.wis ?? 14;
    return [
      featEv('character.created', {
        name: 'Elora',
        system: '5e-2024',
        corePack: { id: FP, version: '0.1.0' },
        engineVersion: '0.1.0',
        grammaticalGender: 'feminine',
      }),
      featDecide(`${FP}:system/5e-2024@0/species`, [`${FP}:species/human`]),
      featDecide(`${FP}:system/5e-2024@0/background`, [`${FP}:background/soldier`]),
      featDecide(`${FP}:background/soldier@0/ability-scores`, ['str:+2', 'con:+1']),
      featDecide(`${FP}:system/5e-2024@0/ability-scores`, [
        'str:15',
        'dex:13',
        'con:13',
        'int:10',
        `wis:${wis}`,
        'cha:8',
      ]),
      ...Array.from({ length: level }, (_, i) =>
        featEv('level.gained', {
          classId: rangerId,
          level: i + 1,
          hpRoll: 'average',
          ...(opts.hunter && i + 1 === 3 ? { subclassId: `${FP}:subclass/hunter` } : {}),
        }),
      ),
    ];
  }
  const block = (level: number) => sheetOf(rangerChar(level)).spellcasting.find((b) => b.classId === rangerId)!;
  const equipped = (level: number, ...slugs: string[]) => {
    const facts = reduce(rangerChar(level), undefined, featRules);
    facts.inventory = slugs.map((s, i) => ({
      instanceId: `i${i}`,
      itemId: `${FP}:item/${s}`,
      qty: 1,
      equipped: true,
      attuned: false,
    }));
    return derive(facts, featIndex, featRules);
  };

  it('saves: str + dex proficient and nothing else (derive-level)', () => {
    const a = sheetOf(rangerChar(1)).abilities;
    expect(
      Object.entries(a)
        .filter(([, v]) => v.saveProficient)
        .map(([k]) => k)
        .sort(),
    ).toEqual(['dex', 'str']);
  });

  it('armor + weapon proficiencies: light/medium/shields, simple + martial, NOT heavy (derive-level)', () => {
    const p = sheetOf(rangerChar(1)).proficiencies;
    const has = (kind: string, target: string) => p.some((x) => x.kind === kind && x.target === target);
    for (const t of ['light', 'medium', 'shields']) expect(has('armor', t), t).toBe(true);
    expect(has('armor', 'heavy')).toBe(false);
    for (const t of ['simple', 'martial']) expect(has('weapon', t), t).toBe(true);
  });

  it('half-caster slots follow the vendored columns level by level (2@1, 3@3, 4/2@5, 4/3/2@9, 4/3/3/1@13, 4/3/3/3/2@19)', () => {
    const max = (l: number) => block(l).slots.map((s) => s.max);
    expect(max(1)).toEqual([2]);
    expect(max(2)).toEqual([2]);
    expect(max(3)).toEqual([3]);
    expect(max(5)).toEqual([4, 2]);
    expect(max(7)).toEqual([4, 3]);
    expect(max(9)).toEqual([4, 3, 2]);
    expect(max(11)).toEqual([4, 3, 3]);
    expect(max(13)).toEqual([4, 3, 3, 1]);
    expect(max(15)).toEqual([4, 3, 3, 2]);
    expect(max(17)).toEqual([4, 3, 3, 3, 1]);
    expect(max(19)).toEqual([4, 3, 3, 3, 2]);
    expect(max(20)).toEqual([4, 3, 3, 3, 2]);
    expect(block(1).cantripsKnown ?? 0).toBe(0); // no cantrips column vendored for Ranger
  });

  it('prepared-spell cap follows the vendored Prepared Spells column (2@1 ... 15@19-20)', () => {
    const col: Record<number, number> = {
      1: 2,
      2: 3,
      3: 4,
      4: 5,
      5: 6,
      6: 6,
      7: 7,
      8: 7,
      9: 9,
      10: 9,
      11: 10,
      12: 10,
      13: 11,
      14: 11,
      15: 12,
      16: 12,
      17: 14,
      18: 14,
      19: 15,
      20: 15,
    };
    for (const [l, n] of Object.entries(col)) expect(block(Number(l)).preparedMax, `level ${l}`).toBe(n);
  });

  it("Favored Enemy: Hunter's Mark always prepared from level 1 (real pack spell) + free-cast tracker 2/3/4/5/6", () => {
    expect(featIndex.get(spell('hunters-mark'))?.type).toBe('spell');
    expect(block(1).alwaysPrepared).toEqual([spell('hunters-mark')]);
    expect(block(1).prepared).toContain(spell('hunters-mark'));
    expect(block(20).alwaysPrepared).toEqual([spell('hunters-mark')]);
    const fe = (l: number) => sheetOf(rangerChar(l)).resources.find((r) => r.id === 'favored-enemy');
    const col: Record<number, number> = { 1: 2, 2: 2, 4: 2, 5: 3, 8: 3, 9: 4, 12: 4, 13: 5, 16: 5, 17: 6, 20: 6 };
    for (const [l, n] of Object.entries(col)) expect(fe(Number(l))?.max.value, `level ${l}`).toBe(n);
    expect(fe(1)).toMatchObject({ reset: 'longRest' });
    // the always-prepared grant does not eat the prepared cap
    expect(block(1).preparedMax).toBe(2);
  });

  it('Weapon Mastery count 2, Extra Attack at 5', () => {
    expect(sheetOf(rangerChar(1)).masteryCount).toBe(2);
    expect(sheetOf(rangerChar(4)).attacksPerAction).toBe(1);
    expect(sheetOf(rangerChar(5)).attacksPerAction).toBe(2);
  });

  it('Roving (6): walk speed +10 unless wearing heavy armor (derive-level)', () => {
    expect(equipped(5).speed['walk']!.value).toBe(30);
    expect(equipped(6).speed['walk']!.value).toBe(40);
    expect(equipped(6, 'chain-shirt').speed['walk']!.value).toBe(40);
    expect(equipped(6, 'chain-mail').speed['walk']!.value).toBe(30);
  });

  it("Tireless (10) and Nature's Veil (14): Wisdom-modifier long-rest pools with min 1 + spending actions", () => {
    const pool = (l: number, id: string, wis?: number) =>
      sheetOf(rangerChar(l, { wis })).resources.find((r) => r.id === id);
    expect(pool(9, 'tireless')).toBeUndefined();
    expect(pool(10, 'tireless')?.max.value).toBe(2); // WIS 14 -> +2
    expect(pool(10, 'tireless', 8)?.max.value).toBe(1); // negative modifier floors at 1
    expect(pool(10, 'tireless')?.reset).toBe('longRest');
    expect(pool(13, 'natures-veil')).toBeUndefined();
    expect(pool(14, 'natures-veil')?.max.value).toBe(2);
    expect(pool(14, 'natures-veil', 8)?.max.value).toBe(1);
    expect(sheetOf(rangerChar(14)).actions.find((a) => a.id === 'natures-veil')).toMatchObject({
      kind: 'bonus',
      resource: 'natures-veil',
    });
    expect(sheetOf(rangerChar(10)).actions.find((a) => a.id === 'tireless-temporary-hit-points')).toMatchObject({
      resource: 'tireless',
    });
  });

  it('Feral Senses (18): Blindsight 30 ft, absent before', () => {
    const bs = (l: number) => sheetOf(rangerChar(l)).senses.find((s) => s.sense === 'blindsight');
    expect(bs(17)).toBeUndefined();
    expect(bs(18)?.range).toBe(30);
    expect(bs(20)?.range).toBe(30);
  });

  it('Hunter subclass resolves from level 3 without breaking the sheet (text-only features)', () => {
    const s = sheetOf(rangerChar(15, { hunter: true }));
    expect(s.spellcasting.find((b) => b.classId === rangerId)!.alwaysPrepared).toEqual([spell('hunters-mark')]);
  });
});

describe('bard and college of lore to level 20 mechanics (task 11)', () => {
  const { classes, subclasses, features } = transformClasses();
  const o = loadOverlays();
  const patchedClasses = applyOverlays(
    classes,
    [...o.corrections, ...o.bard].filter((x) => classes.some((c) => c.id === x.id)),
  );
  const patchedSubclasses = applyOverlays(
    subclasses,
    o.bard.filter((x) => subclasses.some((s) => s.id === x.id)),
  );
  const patchedFeatures = applyOverlays(
    features,
    o.bard.filter((x) => features.some((f) => f.id === x.id)),
  );
  interface BardShape {
    hitDie: number;
    saves: string[];
    armorTraining: string[];
    weaponProficiencies: string[];
    skillChoice: { from: string[]; count: number };
    multiclass: { gains: { armorTraining: string[]; weaponProficiencies: string[]; skillChoiceCount: number } };
    levels: { level: number; choices: { id: string; pick: unknown; count: number | string }[] }[];
  }
  const bard = () => patchedClasses.find((x) => x.id === 'srd-5e-2024:class/bard') as unknown as BardShape;
  const feature = (slug: string) =>
    patchedFeatures.find((x) => x.id === `srd-5e-2024:feature/${slug}`) as unknown as {
      effects: { type: string; [k: string]: unknown }[];
    };

  it('bard: core traits (d8, dex/cha saves, light armor, simple weapons, any 3 of the 18 skills)', () => {
    const b = bard();
    expect(b.hitDie).toBe(8);
    expect([...b.saves].sort()).toEqual(['cha', 'dex']);
    expect(b.armorTraining).toEqual(['light']);
    expect(b.weaponProficiencies).toEqual(['simple']);
    expect(b.skillChoice.count).toBe(3);
    expect(b.skillChoice.from).toHaveLength(18);
  });

  it('bard: multiclass gains = light armor, ONE skill (owner-flagged, SRD-silent)', () => {
    expect(bard().multiclass.gains).toEqual({ armorTraining: ['light'], weaponProficiencies: [], skillChoiceCount: 1 });
  });

  it('bard: choices — subclass @3, ASI 4/8/12/16 + boon 19; no expertise / jack picks', () => {
    const choices = bard().levels.flatMap((r) => r.choices);
    const ids = choices.map((c) => c.id);
    expect(choices.find((c) => c.id === 'srd-5e-2024:class/bard@3/subclass')!.pick).toEqual({
      query: { type: 'subclass', classes: ['bard'] },
    });
    for (const level of [4, 8, 12, 16, 19])
      expect(ids, `level ${level}`).toContain(`srd-5e-2024:class/bard@${level}/feat`);
    expect(ids.some((id) => /expertise|jack/.test(id))).toBe(false);
    expect(
      subclasses.filter((s) => (s as { class: string }).class === 'srd-5e-2024:class/bard').map((s) => s.id),
    ).toEqual(['srd-5e-2024:subclass/college-of-lore']);
  });

  it('bard: Spellcasting is a CHA full caster with prepared spells + instrument focus, no ritual casting', () => {
    expect(feature('bard-spellcasting').effects).toEqual([
      {
        type: 'spellcasting.define',
        class: 'bard',
        ability: 'cha',
        list: 'bard',
        preparation: 'prepared',
        slots: 'full',
        ritual: false,
        focus: true,
      },
    ]);
  });

  it('bard: Expertise is text-only (never a skill pick or proficiency grant — state-wrong shapes)', () => {
    expect(feature('bard-expertise').effects.map((e) => e.type)).toEqual(['feature.text']);
  });

  it('bard: Jack of All Trades = 18 half-proficiency skill grants (one per system skill)', () => {
    const effs = feature('bard-jack-of-all-trades').effects;
    expect(effs.every((e) => e.type === 'proficiency.grant' && e['kind'] === 'skill' && e['level'] === 'half')).toBe(
      true,
    );
    expect(effs.map((e) => e['target'] as string).sort()).toEqual([...bard().skillChoice.from].sort());
  });

  it('bard: text fallbacks present for the inexpressible features', () => {
    for (const slug of [
      'bard-expertise',
      'bard-font-of-inspiration',
      'bard-countercharm',
      'bard-magical-secrets',
      'bard-superior-inspiration',
      'bard-words-of-creation',
      'college-of-lore-cutting-words',
      'college-of-lore-magical-discoveries',
      'college-of-lore-peerless-skill',
      'college-of-lore-bonus-proficiencies',
    ]) {
      expect(
        feature(slug).effects.some((e) => e.type === 'feature.text' || e.type === 'action.define'),
        slug,
      ).toBe(true);
    }
  });

  it('college of lore: Bonus Proficiencies is a count-3 skill-query pick on the subclass level-3 row', () => {
    const lore = patchedSubclasses.find((s) => s.id === 'srd-5e-2024:subclass/college-of-lore') as unknown as {
      levels: { level: number; choices: { id: string; pick: unknown; count: number }[] }[];
    };
    const c = lore.levels.find((r) => r.level === 3)!.choices.find((x) => x.id.endsWith('@3/bonus-proficiencies'))!;
    expect(c.pick).toEqual({ query: { type: 'skill' } });
    expect(c.count).toBe(3);
  });
});

describe('bard integration over the real pack (task 11)', () => {
  const bardId = `${FP}:class/bard`;
  const lore = `${FP}:subclass/college-of-lore`;
  const skill = (s: string) => `${FP}:skill/${s}`;
  const spell = (s: string) => `${FP}:spell/${s}`;
  function bardChar(
    level: number,
    opts: { cha?: number; lore?: boolean; skills?: string[]; extra?: [string, string[]][] } = {},
  ): Event[] {
    featSeq = 0;
    return [
      featEv('character.created', {
        name: 'Lark',
        system: '5e-2024',
        corePack: { id: FP, version: '0.1.0' },
        engineVersion: '0.1.0',
        grammaticalGender: 'feminine',
      }),
      featDecide(`${FP}:system/5e-2024@0/species`, [`${FP}:species/human`]),
      featDecide(`${FP}:system/5e-2024@0/background`, [`${FP}:background/soldier`]),
      featDecide(`${FP}:background/soldier@0/ability-scores`, ['str:+2', 'con:+1']),
      featDecide(`${FP}:system/5e-2024@0/ability-scores`, [
        'str:10',
        'dex:13',
        'con:13',
        'int:10',
        'wis:10',
        `cha:${opts.cha ?? 15}`,
      ]),
      ...Array.from({ length: level }, (_, i) =>
        featEv('level.gained', {
          classId: bardId,
          level: i + 1,
          hpRoll: 'average',
          ...(opts.lore && i + 1 === 3 ? { subclassId: lore } : {}),
        }),
      ),
      featDecide(`${bardId}@1/skills`, opts.skills ?? ['persuasion', 'performance', 'deception']),
      ...(opts.extra ?? []).map(([id, sel]) => featDecide(id, sel)),
    ];
  }
  const block = (level: number) => sheetOf(bardChar(level)).spellcasting.find((b) => b.classId === bardId)!;
  const pool = (level: number, cha?: number) =>
    sheetOf(bardChar(level, { cha })).resources.find((r) => r.id === 'bardic-inspiration');

  it('saves: dex + cha proficient and nothing else (derive-level)', () => {
    const a = sheetOf(bardChar(1)).abilities;
    expect(
      Object.entries(a)
        .filter(([, v]) => v.saveProficient)
        .map(([k]) => k)
        .sort(),
    ).toEqual(['cha', 'dex']);
  });

  it('armor + weapon proficiencies: light only, simple only (derive-level)', () => {
    const p = sheetOf(bardChar(1)).proficiencies;
    const has = (kind: string, target: string) => p.some((x) => x.kind === kind && x.target === target);
    expect(has('armor', 'light')).toBe(true);
    for (const t of ['medium', 'heavy', 'shields']) expect(has('armor', t), t).toBe(false);
    expect(has('weapon', 'simple')).toBe(true);
    expect(has('weapon', 'martial')).toBe(false);
  });

  it('class skills: any 3 of the 18 are accepted and become proficient (derive-level)', () => {
    const s = sheetOf(bardChar(1, { skills: ['arcana', 'history', 'medicine'] }));
    expect(s.issues.filter((i) => i.code === 'derive.unknownSkill')).toEqual([]);
    for (const k of ['arcana', 'history', 'medicine']) expect(s.skills[k]!.proficiency, k).toBe('proficient');
  });

  it('full-caster slots follow the vendored columns level by level', () => {
    const max = (l: number) => block(l).slots.map((s) => s.max);
    expect(max(1)).toEqual([2]);
    expect(max(3)).toEqual([4, 2]);
    expect(max(5)).toEqual([4, 3, 2]);
    expect(max(9)).toEqual([4, 3, 3, 3, 1]);
    expect(max(13)).toEqual([4, 3, 3, 3, 2, 1, 1]);
    expect(max(18)).toEqual([4, 3, 3, 3, 3, 1, 1, 1, 1]);
    expect(max(20)).toEqual([4, 3, 3, 3, 3, 2, 2, 1, 1]);
  });

  it('cantrips known follow the vendored Cantrips column (2@1-3, 3@4-9, 4@10-20)', () => {
    const col: Record<number, number> = { 1: 2, 2: 2, 3: 2, 4: 3, 5: 3, 9: 3, 10: 4, 14: 4, 20: 4 };
    for (const [l, n] of Object.entries(col)) expect(block(Number(l)).cantripsKnown, `level ${l}`).toBe(n);
  });

  it('prepared-spell cap follows the vendored Prepared Spells column (4@1 ... 22@20)', () => {
    const col: Record<number, number> = {
      1: 4,
      2: 5,
      3: 6,
      4: 7,
      5: 9,
      6: 10,
      7: 11,
      8: 12,
      9: 14,
      10: 15,
      11: 16,
      12: 16,
      13: 17,
      14: 17,
      15: 18,
      16: 18,
      17: 19,
      18: 20,
      19: 21,
      20: 22,
    };
    for (const [l, n] of Object.entries(col)) expect(block(Number(l)).preparedMax, `level ${l}`).toBe(n);
  });

  it('Bardic Inspiration: Charisma-modifier pool, min 1, long rest (reset stays longRest: Font of Inspiration is text)', () => {
    expect(pool(1)?.max.value).toBe(2); // CHA 15 -> +2
    expect(pool(1, 8)?.max.value).toBe(1); // negative modifier floors at 1
    expect(pool(1, 20)?.max.value).toBe(5);
    expect(pool(1)?.reset).toBe('longRest');
    expect(pool(5)?.reset).toBe('longRest'); // Font of Inspiration (5) cannot change a defined reset
    expect(sheetOf(bardChar(1)).actions.find((a) => a.id === 'bardic-inspiration')).toMatchObject({
      kind: 'bonus',
      resource: 'bardic-inspiration',
    });
  });

  it('Jack of All Trades: half proficiency on non-proficient skills only, from level 2 (derive-level)', () => {
    const at = (l: number) => sheetOf(bardChar(l));
    expect(at(1).skills['arcana']!.proficiency).toBe('none');
    expect(at(1).skills['arcana']!.total.value).toBe(0);
    // level 2 (prof +2): half = 1, INT 10 -> +0
    expect(at(2).skills['arcana']!.proficiency).toBe('half');
    expect(at(2).skills['arcana']!.total.value).toBe(1);
    // proficient skills stay fully proficient (CHA 15 -> +2, prof 2)
    expect(at(2).skills['persuasion']!.proficiency).toBe('proficient');
    expect(at(2).skills['persuasion']!.total.value).toBe(4);
    // half rounds down at every proficiency step: +3 -> 1, +4 -> 2, +5 -> 2, +6 -> 3
    expect(at(5).skills['arcana']!.total.value).toBe(1);
    expect(at(9).skills['arcana']!.total.value).toBe(2);
    expect(at(13).skills['arcana']!.total.value).toBe(2);
    expect(at(17).skills['arcana']!.total.value).toBe(3);
  });

  it('Words of Creation (20): Power Word Heal and Power Word Kill always prepared, absent at 19', () => {
    expect(block(19).alwaysPrepared ?? []).toEqual([]);
    expect([...(block(20).alwaysPrepared ?? [])].sort()).toEqual([spell('power-word-heal'), spell('power-word-kill')]);
    // always-prepared spells don't eat the prepared cap
    expect(block(20).preparedMax).toBe(22);
  });

  it('College of Lore: Bonus Proficiencies asks for 3 skills at 3, and the picks land as proficiencies', () => {
    const before = sheetOf(bardChar(3, { lore: true }));
    expect(before.outstandingChoices.filter((c) => c.choiceId.endsWith('@3/bonus-proficiencies'))).toHaveLength(1);
    const picks = ['arcana', 'history', 'medicine'];
    const after = sheetOf(bardChar(3, { lore: true, extra: [[`${lore}@3/bonus-proficiencies`, picks.map(skill)]] }));
    expect(after.outstandingChoices.filter((c) => c.choiceId.endsWith('@3/bonus-proficiencies'))).toEqual([]);
    expect(after.issues.filter((i) => i.code.startsWith('selection.'))).toEqual([]);
    for (const k of picks) expect(after.skills[k]!.proficiency, k).toBe('proficient');
    // full proficiency beats Jack of All Trades' half
    expect(after.skills['arcana']!.total.value).toBe(2); // INT +0, prof 2
  });

  it('Lore resolves through level 20 without breaking the sheet', () => {
    const s = sheetOf(
      bardChar(20, {
        lore: true,
        extra: [[`${lore}@3/bonus-proficiencies`, ['arcana', 'history', 'medicine'].map(skill)]],
      }),
    );
    expect(s.issues.filter((i) => i.severity === 'error')).toEqual([]);
  });
});

describe('sorcerer and draconic sorcery to level 20 mechanics (task 12)', () => {
  const { classes, subclasses, features } = transformClasses();
  const o = loadOverlays();
  const patchedClasses = applyOverlays(
    classes,
    [...o.corrections, ...o.sorcerer].filter((x) => classes.some((c) => c.id === x.id)),
  );
  const patchedFeatures = applyOverlays(
    features,
    o.sorcerer.filter((x) => features.some((f) => f.id === x.id)),
  );
  interface SorcShape {
    hitDie: number;
    saves: string[];
    armorTraining: string[];
    weaponProficiencies: string[];
    skillChoice: { from: string[]; count: number };
    multiclass: { gains: { armorTraining: string[]; weaponProficiencies: string[]; skillChoiceCount?: number } };
    levels: { level: number; grants: { feature: string }[]; choices: { id: string; pick: unknown }[] }[];
  }
  const sorc = () => patchedClasses.find((x) => x.id === 'srd-5e-2024:class/sorcerer') as unknown as SorcShape;
  const feature = (slug: string) =>
    patchedFeatures.find((x) => x.id === `srd-5e-2024:feature/${slug}`) as unknown as {
      effects: { type: string; [k: string]: unknown }[];
    };

  it('sorcerer: core traits (d6, con/cha saves, simple weapons, no armor, 2 of the six listed skills)', () => {
    const s = sorc();
    expect(s.hitDie).toBe(6);
    expect([...s.saves].sort()).toEqual(['cha', 'con']);
    expect(s.armorTraining).toEqual([]);
    expect(s.weaponProficiencies).toEqual(['simple']);
    expect(s.skillChoice.count).toBe(2);
    expect([...s.skillChoice.from].sort()).toEqual([
      'arcana',
      'deception',
      'insight',
      'intimidation',
      'persuasion',
      'religion',
    ]);
  });

  it('sorcerer: multiclass gains = none (SRD-silent, owner-flagged)', () => {
    expect(sorc().multiclass.gains).toEqual({ armorTraining: [], weaponProficiencies: [], skillChoiceCount: 0 });
  });

  it('sorcerer: choices — subclass @3, ASI 4/8/12/16 + boon 19; Metamagic is never a pick', () => {
    const choices = sorc().levels.flatMap((r) => r.choices);
    const ids = choices.map((c) => c.id);
    expect(choices.find((c) => c.id === 'srd-5e-2024:class/sorcerer@3/subclass')!.pick).toEqual({
      query: { type: 'subclass', classes: ['sorcerer'] },
    });
    for (const level of [4, 8, 12, 16, 19])
      expect(ids, `level ${level}`).toContain(`srd-5e-2024:class/sorcerer@${level}/feat`);
    expect(ids.some((id) => id.includes('metamagic') || id.includes('affinity'))).toBe(false);
    expect(
      subclasses.filter((s) => (s as { class: string }).class === 'srd-5e-2024:class/sorcerer').map((s) => s.id),
    ).toEqual(['srd-5e-2024:subclass/draconic-sorcery']);
  });

  it('Metamagic: no per-option entities exist (single option-list blob), so text-only at 2, 10 and 17', () => {
    expect(patchedFeatures.filter((f) => f.id.includes('metamagic')).map((f) => f.id)).toEqual([
      'srd-5e-2024:feature/sorcerer-metamagic',
      'srd-5e-2024:feature/sorcerer-metamagic-options',
    ]);
    expect(feature('sorcerer-metamagic').effects.map((e) => e.type)).toEqual(['feature.text']);
    expect(feature('sorcerer-metamagic-options').effects).toEqual([]);
    const at = sorc()
      .levels.filter((r) => r.grants.some((g) => g.feature.endsWith('sorcerer-metamagic')))
      .map((r) => r.level);
    expect(at).toEqual([2, 10, 17]);
  });

  it('sorcerer: Spellcasting is a CHA full caster with prepared spells + arcane focus, no ritual casting', () => {
    expect(feature('sorcerer-spellcasting').effects).toEqual([
      {
        type: 'spellcasting.define',
        class: 'sorcerer',
        ability: 'cha',
        list: 'sorcerer',
        preparation: 'prepared',
        slots: 'full',
        ritual: false,
        focus: true,
      },
    ]);
  });

  it('sorcerer: text fallbacks present for the inexpressible features', () => {
    for (const slug of [
      'sorcerer-metamagic',
      'sorcerer-sorcerous-restoration',
      'sorcerer-sorcery-incarnate',
      'sorcerer-arcane-apotheosis',
      'sorcerer-draconic-sorcery-elemental-affinity',
      'sorcerer-draconic-sorcery-dragon-companion',
    ]) {
      expect(
        feature(slug).effects.some((e) => e.type === 'feature.text'),
        slug,
      ).toBe(true);
    }
  });

  it('Elemental Affinity: no damage.resistance authored (a fixed type would be state-wrong for a chosen one)', () => {
    expect(feature('sorcerer-draconic-sorcery-elemental-affinity').effects.map((e) => e.type)).toEqual([
      'feature.text',
    ]);
  });

  it('Draconic Resilience is hp.bonus classLevel + ac.formula gated on NO ARMOR only (a shield is not armor)', () => {
    expect(feature('sorcerer-draconic-sorcery-draconic-resilience').effects).toEqual([
      { type: 'hp.bonus', value: 'classLevel(sorcerer)' },
      {
        type: 'ac.formula',
        formula: '10 + mod(dex) + mod(cha)',
        key: 'draconic-resilience',
        when: { armor: { category: ['none'] } },
      },
    ]);
  });
});

describe('sorcerer integration over the real pack (task 12)', () => {
  const sorcId = `${FP}:class/sorcerer`;
  const draconic = `${FP}:subclass/draconic-sorcery`;
  const spell = (s: string) => `${FP}:spell/${s}`;
  function sorcChar(level: number, opts: { cha?: number; draconic?: boolean; skills?: string[] } = {}): Event[] {
    featSeq = 0;
    return [
      featEv('character.created', {
        name: 'Ember',
        system: '5e-2024',
        corePack: { id: FP, version: '0.1.0' },
        engineVersion: '0.1.0',
        grammaticalGender: 'feminine',
      }),
      featDecide(`${FP}:system/5e-2024@0/species`, [`${FP}:species/human`]),
      featDecide(`${FP}:system/5e-2024@0/background`, [`${FP}:background/soldier`]),
      featDecide(`${FP}:background/soldier@0/ability-scores`, ['dex:+2', 'con:+1']),
      featDecide(`${FP}:system/5e-2024@0/ability-scores`, [
        'str:8',
        'dex:13',
        'con:13',
        'int:10',
        'wis:10',
        `cha:${opts.cha ?? 15}`,
      ]),
      ...Array.from({ length: level }, (_, i) =>
        featEv('level.gained', {
          classId: sorcId,
          level: i + 1,
          hpRoll: 'average',
          ...(opts.draconic && i + 1 === 3 ? { subclassId: draconic } : {}),
        }),
      ),
      featDecide(`${sorcId}@1/skills`, opts.skills ?? ['persuasion', 'arcana']),
    ];
  }
  const block = (level: number, opts: { draconic?: boolean } = {}) =>
    sheetOf(sorcChar(level, opts)).spellcasting.find((b) => b.classId === sorcId)!;
  const res = (level: number, id: string, opts: { draconic?: boolean } = {}) =>
    sheetOf(sorcChar(level, opts)).resources.find((r) => r.id === id);

  it('saves: con + cha proficient and nothing else (derive-level)', () => {
    const a = sheetOf(sorcChar(1)).abilities;
    expect(
      Object.entries(a)
        .filter(([, v]) => v.saveProficient)
        .map(([k]) => k)
        .sort(),
    ).toEqual(['cha', 'con']);
  });

  it('armor: none; weapons: simple only (derive-level)', () => {
    const p = sheetOf(sorcChar(1)).proficiencies;
    const has = (kind: string, target: string) => p.some((x) => x.kind === kind && x.target === target);
    for (const t of ['light', 'medium', 'heavy', 'shields']) expect(has('armor', t), t).toBe(false);
    expect(has('weapon', 'simple')).toBe(true);
    expect(has('weapon', 'martial')).toBe(false);
  });

  it('class skills: two of the six are accepted and become proficient (derive-level)', () => {
    const s = sheetOf(sorcChar(1, { skills: ['insight', 'religion'] }));
    expect(s.issues.filter((i) => i.code === 'derive.unknownSkill')).toEqual([]);
    for (const k of ['insight', 'religion']) expect(s.skills[k]!.proficiency, k).toBe('proficient');
    expect(s.skills['stealth']!.proficiency).toBe('none');
  });

  it('full-caster slots follow the vendored columns level by level', () => {
    const max = (l: number) => block(l).slots.map((s) => s.max);
    expect(max(1)).toEqual([2]);
    expect(max(3)).toEqual([4, 2]);
    expect(max(5)).toEqual([4, 3, 2]);
    expect(max(9)).toEqual([4, 3, 3, 3, 1]);
    expect(max(13)).toEqual([4, 3, 3, 3, 2, 1, 1]);
    expect(max(18)).toEqual([4, 3, 3, 3, 3, 1, 1, 1, 1]);
    expect(max(20)).toEqual([4, 3, 3, 3, 3, 2, 2, 1, 1]);
  });

  it('cantrips known follow the vendored Cantrips column (4@1-3, 5@4-9, 6@10-20)', () => {
    const col: Record<number, number> = { 1: 4, 2: 4, 3: 4, 4: 5, 5: 5, 9: 5, 10: 6, 14: 6, 20: 6 };
    for (const [l, n] of Object.entries(col)) expect(block(Number(l)).cantripsKnown, `level ${l}`).toBe(n);
  });

  it('prepared-spell cap follows the vendored Prepared Spells column (2@1 ... 22@20)', () => {
    const col = [2, 4, 6, 7, 9, 10, 11, 12, 14, 15, 16, 16, 17, 17, 18, 18, 19, 20, 21, 22];
    col.forEach((n, i) => expect(block(i + 1).preparedMax, `level ${i + 1}`).toBe(n));
  });

  it('Sorcery Points: absent at 1, then max == class level == the vendored column at every level 2..20', () => {
    expect(res(1, 'sorcery-points')).toBeUndefined();
    const pack = featPack.entities.find((e) => e.id === sorcId) as unknown as {
      levels: { level: number; extra: Record<string, number> }[];
    };
    for (let l = 2; l <= 20; l++) {
      const vendored = pack.levels.find((r) => r.level === l)!.extra['sorcerer-sorcery-points'];
      expect(vendored, `vendored row ${l}`).toBe(l);
      expect(res(l, 'sorcery-points')?.max.value, `level ${l}`).toBe(vendored);
    }
    expect(res(2, 'sorcery-points')?.max.value).toBe(2);
    expect(res(20, 'sorcery-points')?.max.value).toBe(20);
    expect(res(10, 'sorcery-points')?.reset).toBe('longRest');
  });

  it('Innate Sorcery: two uses per long rest from level 1, bonus action spends the pool', () => {
    for (const l of [1, 7, 20]) {
      expect(res(l, 'innate-sorcery')?.max.value, `level ${l}`).toBe(2);
      expect(res(l, 'innate-sorcery')?.reset).toBe('longRest');
    }
    expect(sheetOf(sorcChar(1)).actions.find((a) => a.id === 'innate-sorcery')).toMatchObject({
      kind: 'bonus',
      resource: 'innate-sorcery',
    });
  });

  it('Draconic Resilience HP: +3 at 3 then +1 per level (== sorcerer level), absent without the subclass', () => {
    const hp = (l: number, d: boolean) => sheetOf(sorcChar(l, { draconic: d })).hp.max.value;
    for (const l of [1, 2]) expect(hp(l, true), `level ${l}`).toBe(hp(l, false));
    for (const l of [3, 4, 5, 10, 17, 20]) expect(hp(l, true) - hp(l, false), `level ${l}`).toBe(l);
  });

  const equipped = (level: number, ...slugs: string[]) => {
    const facts = reduce(sorcChar(level, { draconic: true }), undefined, featRules);
    facts.inventory = slugs.map((s, i) => ({
      instanceId: `i${i}`,
      itemId: `${FP}:item/${s}`,
      qty: 1,
      equipped: true,
      attuned: false,
    }));
    return derive(facts, featIndex, featRules);
  };

  it('Draconic Resilience AC: 10+dex+cha unarmored, suppressed by armor, NOT by a shield', () => {
    // dex 13+2 = 15 (+2), cha 15 (+2): 10 + 2 + 2 = 14 from level 3; plain 12 before (no subclass formula)
    expect(sheetOf(sorcChar(3)).ac.value).toBe(12);
    expect(equipped(3).ac.value).toBe(14);
    // chain mail: flat 16, formula suppressed
    expect(equipped(3, 'chain-mail').ac.value).toBe(16);
    // shield is not armor: formula still applies, shield adds +2
    expect(equipped(3, 'shield').ac.value).toBe(16);
  });

  it('Draconic Spells: always prepared by level 3/5/7/9, off the prepared cap', () => {
    const ap = (l: number) => [...(block(l, { draconic: true }).alwaysPrepared ?? [])].sort();
    const at3 = ['alter-self', 'chromatic-orb', 'command', 'dragons-breath'];
    const at5 = [...at3, 'fear', 'fly'];
    const at7 = [...at5, 'arcane-eye', 'charm-monster'];
    const at9 = [...at7, 'legend-lore', 'summon-dragon'];
    expect(block(2, { draconic: true }).alwaysPrepared ?? []).toEqual([]);
    expect(ap(3)).toEqual(at3.map(spell).sort());
    expect(ap(4)).toEqual(at3.map(spell).sort());
    expect(ap(5)).toEqual(at5.map(spell).sort());
    expect(ap(7)).toEqual(at7.map(spell).sort());
    expect(ap(9)).toEqual(at9.map(spell).sort());
    expect(ap(20)).toEqual(at9.map(spell).sort());
    expect(block(9, { draconic: true }).preparedMax).toBe(14);
  });

  it('Dragon Wings (14) and Dragon Companion (19, as vendored) are one-use long-rest pools', () => {
    const d = { draconic: true };
    expect(res(13, 'dragon-wings', d)).toBeUndefined();
    expect(res(14, 'dragon-wings', d)?.max.value).toBe(1);
    expect(res(14, 'dragon-wings', d)?.reset).toBe('longRest');
    expect(sheetOf(sorcChar(14, d)).actions.find((a) => a.id === 'dragon-wings')).toMatchObject({
      kind: 'bonus',
      resource: 'dragon-wings',
    });
    expect(res(18, 'dragon-companion', d)).toBeUndefined();
    expect(res(19, 'dragon-companion', d)?.max.value).toBe(1);
  });

  it('Draconic Sorcery resolves through level 20 without breaking the sheet', () => {
    const s = sheetOf(sorcChar(20, { draconic: true }));
    expect(s.issues.filter((i) => i.severity === 'error')).toEqual([]);
  });
});

describe('druid and circle of the land to level 20 mechanics (task 13)', () => {
  const { classes, subclasses, features } = transformClasses();
  const o = loadOverlays();
  const patchedClasses = applyOverlays(
    classes,
    [...o.corrections, ...o.druid].filter((x) => classes.some((c) => c.id === x.id)),
  );
  const patchedFeatures = applyOverlays(
    features,
    o.druid.filter((x) => features.some((f) => f.id === x.id)),
  );
  interface DruidShape {
    hitDie: number;
    saves: string[];
    armorTraining: string[];
    weaponProficiencies: string[];
    toolProficiencies: string[];
    skillChoice: { from: string[]; count: number };
    multiclass: { gains: { armorTraining: string[]; weaponProficiencies: string[]; skillChoiceCount?: number } };
    levels: { level: number; grants: { feature: string }[]; choices: { id: string; pick: unknown }[] }[];
  }
  const druid = () => patchedClasses.find((x) => x.id === 'srd-5e-2024:class/druid') as unknown as DruidShape;
  const feature = (slug: string) =>
    patchedFeatures.find((x) => x.id === `srd-5e-2024:feature/${slug}`) as unknown as {
      effects: { type: string; [k: string]: unknown }[];
    };

  it('druid: core traits (d8, int/wis saves, simple weapons, light armor + shields, herbalism kit, 2 of the eight listed skills)', () => {
    const d = druid();
    expect(d.hitDie).toBe(8);
    expect([...d.saves].sort()).toEqual(['int', 'wis']);
    expect(d.armorTraining).toEqual(['light', 'shields']);
    expect(d.weaponProficiencies).toEqual(['simple']);
    expect(d.toolProficiencies).toEqual(['herbalism-kit']);
    expect(d.skillChoice.count).toBe(2);
    expect([...d.skillChoice.from].sort()).toEqual([
      'animal-handling',
      'arcana',
      'insight',
      'medicine',
      'nature',
      'perception',
      'religion',
      'survival',
    ]);
  });

  it('druid: multiclass gains = light armor + shields (SRD-silent, owner-flagged)', () => {
    expect(druid().multiclass.gains).toEqual({
      armorTraining: ['light', 'shields'],
      weaponProficiencies: [],
      skillChoiceCount: 0,
    });
  });

  it('druid: choices — subclass @3, ASI 4/8/12/16 + boon 19; Primal Order / Elemental Fury / Wild Shape forms are never picks', () => {
    const choices = druid().levels.flatMap((r) => r.choices);
    const ids = choices.map((c) => c.id);
    expect(choices.find((c) => c.id === 'srd-5e-2024:class/druid@3/subclass')!.pick).toEqual({
      query: { type: 'subclass', classes: ['druid'] },
    });
    for (const level of [4, 8, 12, 16, 19])
      expect(ids, `level ${level}`).toContain(`srd-5e-2024:class/druid@${level}/feat`);
    expect(ids.some((id) => /order|fury|form|land/.test(id))).toBe(false);
    expect(
      subclasses.filter((s) => (s as { class: string }).class === 'srd-5e-2024:class/druid').map((s) => s.id),
    ).toEqual(['srd-5e-2024:subclass/circle-of-the-land']);
  });

  it('druid: Spellcasting is a WIS full caster with prepared spells + druidic focus, no ritual casting', () => {
    expect(feature('druid-spellcasting').effects).toEqual([
      {
        type: 'spellcasting.define',
        class: 'druid',
        ability: 'wis',
        list: 'druid',
        preparation: 'prepared',
        slots: 'full',
        ritual: false,
        focus: true,
      },
    ]);
  });

  it('Wild Shape: forms are text (no beast entities of any kind exist in the pack)', () => {
    const packEntities = featPack.entities as { id: string; type: string }[];
    expect(packEntities.filter((e) => /\/(wolf|rat|spider|riding-horse|brown-bear)$/.test(e.id))).toEqual([]);
    expect(feature('druid-wild-shape').effects.map((e) => e.type)).toEqual(['resource.define', 'action.define']);
    expect(feature('druid-wild-shape-uses').effects).toEqual([]);
  });

  it('text fallbacks present for the inexpressible features; the swapped upstream rows stay untouched', () => {
    for (const slug of [
      'druid-primal-order',
      'druid-wild-companion',
      'druid-wild-resurgence',
      'druid-elemental-fury',
      'druid-improved-elemental-fury',
      'druid-beast-spells',
      'druid-archdruid',
      'druid-circle-of-the-land-spell-list',
      'druid-circle-of-the-land-natural-recovery',
    ]) {
      expect(
        feature(slug).effects.map((e) => e.type),
        slug,
      ).toEqual(['feature.text']);
    }
    for (const slug of ['druid-circle-of-the-land-natures-ward', 'druid-circle-of-the-land-natures-sanctuary'])
      expect(feature(slug).effects, slug).toEqual([]);
  });

  it('Circle of the Land Spells: NO spell.grant anywhere in the circle (per-land-type lists, re-chosen every Long Rest)', () => {
    for (const f of patchedFeatures.filter((x) => x.id.includes('circle-of-the-land'))) {
      const effs = (f as unknown as { effects: { type: string }[] }).effects;
      expect(
        effs.filter((e) => e.type === 'spell.grant'),
        f.id,
      ).toEqual([]);
    }
  });
});

describe('druid integration over the real pack (task 13)', () => {
  const druidId = `${FP}:class/druid`;
  const land = `${FP}:subclass/circle-of-the-land`;
  const spell = (s: string) => `${FP}:spell/${s}`;
  function druidChar(level: number, opts: { wis?: number; land?: boolean; skills?: string[] } = {}): Event[] {
    featSeq = 0;
    return [
      featEv('character.created', {
        name: 'Fern',
        system: '5e-2024',
        corePack: { id: FP, version: '0.1.0' },
        engineVersion: '0.1.0',
        grammaticalGender: 'feminine',
      }),
      featDecide(`${FP}:system/5e-2024@0/species`, [`${FP}:species/human`]),
      featDecide(`${FP}:system/5e-2024@0/background`, [`${FP}:background/soldier`]),
      featDecide(`${FP}:background/soldier@0/ability-scores`, ['dex:+2', 'con:+1']),
      featDecide(`${FP}:system/5e-2024@0/ability-scores`, [
        'str:8',
        'dex:13',
        'con:13',
        'int:10',
        `wis:${opts.wis ?? 15}`,
        'cha:10',
      ]),
      ...Array.from({ length: level }, (_, i) =>
        featEv('level.gained', {
          classId: druidId,
          level: i + 1,
          hpRoll: 'average',
          ...(opts.land && i + 1 === 3 ? { subclassId: land } : {}),
        }),
      ),
      featDecide(`${druidId}@1/skills`, opts.skills ?? ['nature', 'perception']),
    ];
  }
  const block = (level: number, opts: { land?: boolean } = {}) =>
    sheetOf(druidChar(level, opts)).spellcasting.find((b) => b.classId === druidId)!;
  const res = (level: number, id: string, opts: { land?: boolean } = {}) =>
    sheetOf(druidChar(level, opts)).resources.find((r) => r.id === id);

  it('saves: int + wis proficient and nothing else (derive-level)', () => {
    const a = sheetOf(druidChar(1)).abilities;
    expect(
      Object.entries(a)
        .filter(([, v]) => v.saveProficient)
        .map(([k]) => k)
        .sort(),
    ).toEqual(['int', 'wis']);
  });

  it('armor: light + shields (no medium/heavy); weapons: simple only; herbalism kit (derive-level)', () => {
    const p = sheetOf(druidChar(1)).proficiencies;
    const has = (kind: string, target: string) => p.some((x) => x.kind === kind && x.target === target);
    expect(has('armor', 'light')).toBe(true);
    expect(has('armor', 'shields')).toBe(true);
    for (const t of ['medium', 'heavy']) expect(has('armor', t), t).toBe(false);
    expect(has('weapon', 'simple')).toBe(true);
    expect(has('weapon', 'martial')).toBe(false);
    // Tool proficiencies are class DATA only (the engine derives no tool proficiency for any class,
    // rogue's Thieves' Tools included); the herbalism kit is pinned at the data level above.
  });

  it('class skills: two of the eight are accepted and become proficient (derive-level)', () => {
    const s = sheetOf(druidChar(1, { skills: ['medicine', 'survival'] }));
    expect(s.issues.filter((i) => i.code === 'derive.unknownSkill')).toEqual([]);
    for (const k of ['medicine', 'survival']) expect(s.skills[k]!.proficiency, k).toBe('proficient');
    expect(s.skills['stealth']!.proficiency).toBe('none');
  });

  it('full-caster slots follow the vendored columns level by level', () => {
    const max = (l: number) => block(l).slots.map((s) => s.max);
    expect(max(1)).toEqual([2]);
    expect(max(3)).toEqual([4, 2]);
    expect(max(5)).toEqual([4, 3, 2]);
    expect(max(9)).toEqual([4, 3, 3, 3, 1]);
    expect(max(13)).toEqual([4, 3, 3, 3, 2, 1, 1]);
    expect(max(20)).toEqual([4, 3, 3, 3, 3, 2, 2, 1, 1]);
  });

  it('cantrips known follow the vendored Cantrips column (2@1-3, 3@4-9, 4@10-20) at every level', () => {
    for (let l = 1; l <= 20; l++) expect(block(l).cantripsKnown, `level ${l}`).toBe(l >= 10 ? 4 : l >= 4 ? 3 : 2);
  });

  it('prepared-spell cap follows the vendored Prepared Spells column (4@1 ... 22@20)', () => {
    const col = [4, 5, 6, 7, 9, 10, 11, 12, 14, 15, 16, 16, 17, 17, 18, 18, 19, 20, 21, 22];
    col.forEach((n, i) => expect(block(i + 1).preparedMax, `level ${i + 1}`).toBe(n));
  });

  it('Wild Shape: formula == every vendored srd-2024_druid_wild-shape-uses row (2@2-5, 3@6-16, 4@17-20); absent at 1', () => {
    expect(res(1, 'wild-shape')).toBeUndefined();
    const pack = featPack.entities.find((e) => e.id === druidId) as unknown as {
      levels: { level: number; extra: Record<string, number> }[];
    };
    for (let l = 2; l <= 20; l++) {
      const vendored = pack.levels.find((r) => r.level === l)!.extra['druid-wild-shape-uses'];
      expect(vendored, `vendored row ${l}`).toBe(l >= 17 ? 4 : l >= 6 ? 3 : 2);
      expect(res(l, 'wild-shape')?.max.value, `level ${l}`).toBe(vendored);
    }
    expect(res(10, 'wild-shape')?.reset).toBe('shortRest');
    expect(sheetOf(druidChar(2)).actions.find((a) => a.id === 'wild-shape')).toMatchObject({
      kind: 'bonus',
      resource: 'wild-shape',
    });
  });

  it('Druidic: grants the Druidic language and keeps Speak with Animals always prepared (off the cap)', () => {
    const s = sheetOf(druidChar(1));
    expect(s.languages.map((l) => l.id)).toContain(`${FP}:language/druidic`);
    expect(block(1).alwaysPrepared).toEqual([spell('speak-with-animals')]);
    expect(block(1).preparedMax).toBe(4);
  });

  it('Wild Companion is text only: Find Familiar is NOT granted (the feature casts it via slot or Wild Shape, it is not prepared)', () => {
    expect(block(2).alwaysPrepared).toEqual([spell('speak-with-animals')]);
  });

  it('Circle of the Land: no always-prepared circle spells at any level (honest: the lists depend on a per-Long-Rest land choice)', () => {
    for (const l of [3, 5, 7, 9, 20])
      expect(block(l, { land: true }).alwaysPrepared, `level ${l}`).toEqual([spell('speak-with-animals')]);
  });

  it("Land's Aid (3) spends a Wild Shape use as a Magic action", () => {
    expect(sheetOf(druidChar(2, { land: true })).actions.find((a) => a.id === 'lands-aid')).toBeUndefined();
    expect(sheetOf(druidChar(3, { land: true })).actions.find((a) => a.id === 'lands-aid')).toMatchObject({
      kind: 'action',
      resource: 'wild-shape',
    });
  });

  it('Druid + Circle of the Land resolve through level 20 without breaking the sheet', () => {
    for (const l of [1, 2, 3, 10, 20]) {
      const s = sheetOf(druidChar(l, { land: l >= 3 }));
      expect(
        s.issues.filter((i) => i.severity === 'error'),
        `level ${l}`,
      ).toEqual([]);
    }
  });
});
