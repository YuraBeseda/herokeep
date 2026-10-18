import { describe, expect, it } from 'vitest';
import { SHEET_DIFF_EXCLUDED_KEYS, diffSheets } from '../../src/rebase/sheet-diff.ts';
import { baseSheet } from '../propose/support.ts';

/**
 * Plan 15 (phase 4 slice 5) Task 1, ruling 5 — the rebase report's VALUE diff: leaf paths only
 * (objects dot-joined, arrays `[i]`, the goldens' path style), sorted, with provenance subtrees
 * (`contributions`, `sources`) and `issues` left out.
 */
describe('diffSheets', () => {
  it('identical sheets → no changes', () => {
    expect(diffSheets(baseSheet(), baseSheet())).toEqual([]);
  });

  it('lists only changed leaf paths, sorted by path, with before/after', () => {
    const before = baseSheet({ prof: 2, pins: { 'core-mini': '1.0.0', 'rebase-mini': '1.0.0' } });
    const after = baseSheet({
      prof: 3,
      pins: { 'core-mini': '1.0.0', 'rebase-mini': '1.1.0' },
      speed: { walk: { value: 40, contributions: [{ source: 'x', kind: 'speed.bonus', amount: 10 }] } },
    });
    expect(diffSheets(before, after)).toEqual([
      { path: 'pins.rebase-mini', before: '1.0.0', after: '1.1.0' },
      { path: 'prof', before: 2, after: 3 },
      { path: 'speed.walk.value', before: 30, after: 40 },
    ]);
  });

  it('indexes arrays as [i] and reports added/removed leaves with undefined on the missing side', () => {
    const before = baseSheet({ classes: [{ classId: 'core-mini:class/fighter', level: 1 }] });
    const after = baseSheet({
      classes: [
        { classId: 'core-mini:class/fighter', level: 2 },
        { classId: 'core-mini:class/druid', level: 1 },
      ],
    });
    expect(diffSheets(before, after)).toEqual([
      { path: 'classes[0].level', before: 1, after: 2 },
      { path: 'classes[1].classId', before: undefined, after: 'core-mini:class/druid' },
      { path: 'classes[1].level', before: undefined, after: 1 },
    ]);
  });

  it('excludes contributions, sources and issues subtrees', () => {
    expect([...SHEET_DIFF_EXCLUDED_KEYS].sort()).toEqual(['contributions', 'issues', 'sources']);
    const before = baseSheet({
      proficiencies: [{ kind: 'armor', target: 'light', level: 'proficient', sources: ['a'] }],
      issues: [],
    });
    const after = baseSheet({
      ac: { value: 10, contributions: [{ source: 'new', kind: 'ac.bonus', amount: 0 }] },
      proficiencies: [{ kind: 'armor', target: 'light', level: 'proficient', sources: ['a', 'b'] }],
      issues: [{ severity: 'warning', code: 'x', message: 'y' }],
    });
    expect(diffSheets(before, after)).toEqual([]);
  });

  it('is deterministic and does not mutate its inputs', () => {
    const before = baseSheet({ prof: 2 });
    const after = baseSheet({ prof: 4 });
    const snapshot = JSON.stringify([before, after]);
    expect(diffSheets(before, after)).toEqual(diffSheets(before, after));
    expect(JSON.stringify([before, after])).toBe(snapshot);
  });
});
