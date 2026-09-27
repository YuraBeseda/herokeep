import { describe, expect, it } from 'vitest';
import { transformClasses } from '../src/transform/classes.ts';
import { expectAllValid } from './support/valid.ts';

describe('class transform', () => {
  const { classes, subclasses, features } = transformClasses();

  it('12 classes, 12 subclasses, all features linked', () => {
    expect(classes).toHaveLength(12);
    expect(subclasses).toHaveLength(12);
    expectAllValid(classes);
    expectAllValid(subclasses);
    expectAllValid(features);
    expect(classes.map((c) => c.id)).toContain('srd-5e-2024:class/fighter');
    expect(subclasses.map((s) => s.id)).toContain('srd-5e-2024:subclass/champion');
    const champion = subclasses.find((s) => s.id === 'srd-5e-2024:subclass/champion') as { class?: string };
    expect(champion?.class).toBe('srd-5e-2024:class/fighter');
  });

  it('progression rows reference existing features, ascending levels', () => {
    const featureIds = new Set(features.map((f) => f.id));
    for (const c of [...classes, ...subclasses] as {
      id: string;
      levels: { level: number; grants: { feature: string }[] }[];
    }[]) {
      let prev = 0;
      for (const row of c.levels) {
        expect(row.level, c.id).toBeGreaterThan(prev);
        prev = row.level;
        for (const g of row.grants)
          expect(featureIds.has(g.feature), `${c.id} L${row.level} → ${g.feature}`).toBe(true);
      }
      expect(c.levels.length, c.id).toBeGreaterThanOrEqual(1);
    }
  });

  it('spot golden: Fighter structure (pre-overlay)', () => {
    const fighter = classes.find((c) => c.id === 'srd-5e-2024:class/fighter') as {
      hitDie?: number;
      subclassLevel?: number;
      levels?: { level: number; grants: { feature: string }[] }[];
    };
    expect(fighter?.hitDie).toBe(10);
    expect(fighter?.subclassLevel).toBe(3);
    const l1 = fighter?.levels?.find((r) => r.level === 1);
    expect(l1?.grants.map((g) => g.feature)).toContain('srd-5e-2024:feature/fighter-second-wind');
    const l5 = fighter?.levels?.find((r) => r.level === 5);
    expect(l5?.grants.map((g) => g.feature)).toContain('srd-5e-2024:feature/fighter-extra-attack');
  });

  it('spot golden: Wizard is a full caster with a d6', () => {
    const wizard = classes.find((c) => c.id === 'srd-5e-2024:class/wizard') as { hitDie?: number };
    expect(wizard?.hitDie).toBe(6);
  });

  it('ruling 7: dice- and text-shaped row extras are now kept (Rogue Sneak Attack, Warlock Slot Level)', () => {
    // Sneak Attack's own `column_value` is real dice notation ("1d6" at level 1, upstream-verified);
    // the pre-task-7 transform dropped it (only a plain integer passed `NUMERIC_EXTRA_RE`).
    const rogue = classes.find((c) => c.id === 'srd-5e-2024:class/rogue') as {
      levels: { level: number; extra?: Record<string, unknown> }[];
    };
    expect(rogue.levels.find((r) => r.level === 1)?.extra?.['rogue-sneak-attack-column-data']).toBe('1d6');
    expect(rogue.levels.find((r) => r.level === 3)?.extra?.['rogue-sneak-attack-column-data']).toBe('2d6');

    // Slot Level's own `column_value` is a short ordinal ("1st" at level 1, upstream-verified) —
    // previously dropped for the same reason.
    const warlock = classes.find((c) => c.id === 'srd-5e-2024:class/warlock') as {
      levels: { level: number; extra?: Record<string, unknown> }[];
    };
    expect(warlock.levels.find((r) => r.level === 1)?.extra?.['warlock-slot-level']).toBe('1st');
    expect(warlock.levels.find((r) => r.level === 9)?.extra?.['warlock-slot-level']).toBe('5th');

    // Existing plain-integer extras (e.g. Rage Damage, "+2") are unaffected — still numbers, not text.
    const barbarian = classes.find((c) => c.id === 'srd-5e-2024:class/barbarian') as {
      levels: { level: number; extra?: Record<string, unknown> }[];
    };
    expect(barbarian.levels.find((r) => r.level === 1)?.extra?.['barbarian-rage-damage']).toBe(2);
  });

  it('T2 carry #3 / ruling 2: the five slice-1 classes carry real multiclass prerequisites + gains data', () => {
    const bySlug = (slug: string) =>
      classes.find((c) => c.id === `srd-5e-2024:class/${slug}`) as {
        multiclass?: {
          prerequisites: unknown;
          gains: { armorTraining: string[]; weaponProficiencies: string[]; skillChoiceCount: number };
        };
      };
    const fighter = bySlug('fighter');
    expect(fighter.multiclass?.prerequisites).toEqual({
      any: [{ ability: { str: { gte: 13 } } }, { ability: { dex: { gte: 13 } } }],
    });
    expect(fighter.multiclass?.gains).toEqual({
      armorTraining: ['light', 'medium', 'shields'],
      weaponProficiencies: ['simple', 'martial'],
      skillChoiceCount: 0,
    });

    const wizard = bySlug('wizard');
    expect(wizard.multiclass?.prerequisites).toEqual({ ability: { int: { gte: 13 } } });
    expect(wizard.multiclass?.gains).toEqual({ armorTraining: [], weaponProficiencies: [], skillChoiceCount: 0 });

    for (const slug of ['barbarian', 'cleric', 'warlock']) {
      expect(bySlug(slug).multiclass?.gains, slug).toBeDefined();
    }

    // Classes outside the five slice-1 classes get no `multiclass` field on the CLASS entity (the
    // system-level `multiclass.prerequisites` map still covers all 12 — see static.test.ts).
    expect(bySlug('sorcerer').multiclass).toBeUndefined();
  });
});
