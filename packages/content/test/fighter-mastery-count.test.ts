import { readFileSync } from 'node:fs';
import { createContentIndex, resolveChoiceCount } from '@hk/engine';
import { describe, expect, it } from 'vitest';
import { buildPack } from '../src/build.ts';

// Plan 12 task 2: the fighter's weapon-mastery choice count is a formula over classLevel(fighter),
// and must reproduce EVERY vendored `srd-2024_fighter_weapon-mastery-count` column row (levels 1-20).

const FIGHTER = 'srd-5e-2024:class/fighter';
const CHOICE = `${FIGHTER}@1/weapon-masteries`;

interface VendoredRow {
  pk: string;
  fields: { level: number; column_value: string | null; parent: string };
}

const vendored = (
  JSON.parse(
    readFileSync(new URL('../upstream/open5e-srd-2024/ClassFeatureItem.json', import.meta.url), 'utf8'),
  ) as VendoredRow[]
)
  // `_count-1` is a vendored duplicate of the level-1 row (same value); the numbered pks are canonical.
  .filter((r) => r.fields.parent === 'srd-2024_fighter_weapon-mastery-count' && /_\d+$/.test(r.pk));

const pack = buildPack();
const index = createContentIndex([pack]);
const fighter = index.get(FIGHTER);
const choice =
  fighter?.type === 'class' ? fighter.levels.flatMap((r) => r.choices).find((c) => c.id === CHOICE) : undefined;

describe('fighter weapon-mastery count growth', () => {
  it('vendors exactly one count row per level 1-20', () => {
    expect(vendored.map((r) => r.fields.level).sort((a, b) => a - b)).toEqual(
      Array.from({ length: 20 }, (_, i) => i + 1),
    );
  });

  it('authors the count as a formula, not a fixed number', () => {
    expect(typeof choice?.count).toBe('string');
  });

  it.each(Array.from({ length: 20 }, (_, i) => i + 1))('matches the vendored column at fighter level %i', (level) => {
    const row = vendored.find((r) => r.fields.level === level)!;
    const resolved = resolveChoiceCount(choice!, { classes: [{ classId: FIGHTER, level }] }, index);
    expect(resolved, row.pk).toBe(Number(row.fields.column_value));
  });
});
