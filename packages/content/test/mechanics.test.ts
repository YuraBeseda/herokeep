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

  it('monk: multiclass gains = nothing (owner-flagged, SRD-silent in the vendor)', () => {
    expect(monk().multiclass.gains).toEqual({ armorTraining: [], weaponProficiencies: [], skillChoiceCount: 0 });
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
