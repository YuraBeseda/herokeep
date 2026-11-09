import type { Sheet } from '@hk/engine';
import { sheetChanges } from './level-up.summary';

/** Just the parts of a sheet the comparison reads. */
function sheet(over: {
  prof?: number;
  current?: number;
  dice?: Record<string, { die: number; total: number }>;
  slots?: { level: number; max: number }[];
  pact?: { level: number; count: number };
}): Sheet {
  const dice = over.dice ?? { fighter: { die: 10, total: 1 } };
  return {
    prof: over.prof ?? 2,
    hp: {
      current: over.current ?? 12,
      hitDice: Object.fromEntries(
        Object.entries(dice).map(([id, d]) => [id, { ...d, spent: 0, remaining: d.total }]),
      ),
    },
    spellcasting: over.slots
      ? [
          {
            classId: 'wizard',
            slots: over.slots.map((s) => ({ ...s, used: 0 })),
            ...(over.pact ? { pact: { ...over.pact, used: 0 } } : {}),
          },
        ]
      : [],
  } as unknown as Sheet;
}

const byField = (changes: ReturnType<typeof sheetChanges>, field: string) =>
  changes.find((change) => change.field === field);

describe('sheetChanges', () => {
  it('reports a field that changes as before and after, and one that does not as unchanged', () => {
    const changes = sheetChanges(
      sheet({ dice: { fighter: { die: 10, total: 1 } } }),
      sheet({ dice: { fighter: { die: 10, total: 2 } } }),
    );
    expect(byField(changes, 'hitDice')).toEqual({
      field: 'hitDice',
      before: '1d10',
      after: '2d10',
      changed: true,
    });
    expect(byField(changes, 'proficiency')).toEqual({
      field: 'proficiency',
      before: '+2',
      after: '+2',
      changed: false,
    });
    expect(byField(changes, 'currentHp')?.changed).toBe(false);
  });

  it('lists several hit dice sorted by die, and a proficiency bonus that grows', () => {
    const changes = sheetChanges(
      sheet({ prof: 2, dice: { a: { die: 10, total: 4 } } }),
      sheet({ prof: 3, dice: { b: { die: 8, total: 1 }, a: { die: 10, total: 5 } } }),
    );
    expect(byField(changes, 'hitDice')).toMatchObject({ before: '4d10', after: '1d8 + 5d10' });
    expect(byField(changes, 'proficiency')).toMatchObject({
      before: '+2',
      after: '+3',
      changed: true,
    });
  });

  it('shows spell slots per level only when either sheet has any', () => {
    expect(byField(sheetChanges(sheet({}), sheet({})), 'spellSlots')).toBeUndefined();
    const grown = sheetChanges(
      sheet({ slots: [{ level: 1, max: 2 }] }),
      sheet({
        slots: [
          { level: 1, max: 3 },
          { level: 2, max: 2 },
        ],
      }),
    );
    expect(byField(grown, 'spellSlots')).toMatchObject({
      before: '2',
      after: '3 · 2',
      changed: true,
    });
    const same = sheetChanges(
      sheet({ slots: [{ level: 1, max: 2 }] }),
      sheet({ slots: [{ level: 1, max: 2 }] }),
    );
    expect(byField(same, 'spellSlots')).toMatchObject({ before: '2', changed: false });
  });
});
