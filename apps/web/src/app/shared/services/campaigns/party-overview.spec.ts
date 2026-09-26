import type { Sheet } from '@hk/engine';
import { deriveOverview, overviewsEqual } from './party-overview';

/** A minimal `Sheet` fixture with only the fields `deriveOverview` reads — every OTHER `Sheet`
 * field is irrelevant to this pure module, so this stays a partial cast rather than a full fixture
 * (mirrors `character-campaign-link.spec.ts`'s own minimal-`Event`-fixture style). */
function fixtureSheet(overrides: Record<string, unknown> = {}): Sheet {
  const sheet = {
    level: 3,
    classes: [{ classId: 'srd-5e-2024:class.fighter', level: 3 }],
    passivePerception: 13,
    ac: { value: 16, contributions: [] },
    hp: { max: { value: 28, contributions: [] }, current: 20, temp: 2 },
    conditions: [{ conditionId: 'srd-5e-2024:condition.prone' }],
    concentration: undefined,
    ...overrides,
  };
  return sheet as unknown as Sheet;
}

describe('deriveOverview', () => {
  it('maps hp/ac/level/classes/conditions/passivePerception straight off the Sheet', () => {
    const sheet = fixtureSheet();

    const overview = deriveOverview(sheet, undefined);

    expect(overview).toEqual({
      hp: 20,
      hpMax: 28,
      temp: 2,
      ac: 16,
      level: 3,
      classes: [{ classId: 'srd-5e-2024:class.fighter', level: 3 }],
      conditions: ['srd-5e-2024:condition.prone'],
      concentration: false,
      passivePerception: 13,
    });
  });

  it('strips subclassId off classes (the overview schema only carries classId+level)', () => {
    const sheet = fixtureSheet({
      classes: [
        {
          classId: 'srd-5e-2024:class.fighter',
          level: 3,
          subclassId: 'srd-5e-2024:subclass.champion',
        },
      ],
    });

    const overview = deriveOverview(sheet, undefined);

    expect(overview.classes).toEqual([{ classId: 'srd-5e-2024:class.fighter', level: 3 }]);
  });

  it('concentration is true whenever Sheet.concentration is present, regardless of spellId', () => {
    const sheet = fixtureSheet({ concentration: { spellId: 'srd-5e-2024:spell.bless' } });

    expect(deriveOverview(sheet, undefined).concentration).toBe(true);
  });

  it('omits portraitThumb entirely (never an explicit undefined key) when none is given', () => {
    const overview = deriveOverview(fixtureSheet(), undefined);

    expect('portraitThumb' in overview).toBe(false);
  });

  it('includes portraitThumb when a hash is given', () => {
    const overview = deriveOverview(fixtureSheet(), 'sha256:abc123');

    expect(overview.portraitThumb).toBe('sha256:abc123');
  });

  it('clamps classes/conditions to the schema max of 20 entries each', () => {
    const sheet = fixtureSheet({
      classes: Array.from({ length: 25 }, (_, i) => ({ classId: `class-${i}`, level: 1 })),
      conditions: Array.from({ length: 25 }, (_, i) => ({ conditionId: `cond-${i}` })),
    });

    const overview = deriveOverview(sheet, undefined);

    expect(overview.classes).toHaveLength(20);
    expect(overview.conditions).toHaveLength(20);
  });
});

describe('overviewsEqual', () => {
  const base = deriveOverview(fixtureSheet(), undefined);

  it('is true for two structurally identical overviews built separately', () => {
    const other = deriveOverview(fixtureSheet(), undefined);
    expect(overviewsEqual(base, other)).toBe(true);
  });

  it('is false when any scalar field differs', () => {
    const other = deriveOverview(fixtureSheet({ passivePerception: 14 }), undefined);
    expect(overviewsEqual(base, other)).toBe(false);
  });

  it('is false when the classes array differs (added entry)', () => {
    const other = deriveOverview(
      fixtureSheet({
        classes: [
          { classId: 'srd-5e-2024:class.fighter', level: 3 },
          { classId: 'srd-5e-2024:class.rogue', level: 1 },
        ],
      }),
      undefined,
    );
    expect(overviewsEqual(base, other)).toBe(false);
  });

  it('is false when one has portraitThumb and the other does not', () => {
    const withThumb = deriveOverview(fixtureSheet(), 'sha256:abc');
    expect(overviewsEqual(base, withThumb)).toBe(false);
  });

  it('is true comparing an overview against itself', () => {
    expect(overviewsEqual(base, base)).toBe(true);
  });
});
