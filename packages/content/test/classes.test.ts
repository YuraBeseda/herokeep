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
});
