import { describe, expect, it } from 'vitest';
import { applyPatch, parsePointer } from '../../src/content/patch.ts';

describe('json patch', () => {
  it('parses pointers with escapes', () => {
    expect(parsePointer('/levels/0/grants/-')).toEqual(['levels', '0', 'grants', '-']);
    expect(parsePointer('/a~1b/c~0d')).toEqual(['a/b', 'c~d']);
    expect(parsePointer('')).toEqual([]);
  });

  it('adds, replaces and removes without mutating the input', () => {
    const doc = { levels: [{ level: 1, grants: [{ feature: 'a' }] }], name: 'Fighter' };
    const r = applyPatch(doc, [
      { op: 'add', path: '/levels/0/grants/-', value: { feature: 'b' } },
      { op: 'replace', path: '/name', value: 'Warrior' },
      { op: 'add', path: '/levels/0/grants/0', value: { feature: 'z' } },
      { op: 'remove', path: '/levels/0/level' },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.result).toEqual({
      levels: [{ grants: [{ feature: 'z' }, { feature: 'a' }, { feature: 'b' }] }],
      name: 'Warrior',
    });
    expect(doc.name).toBe('Fighter');
    expect(doc.levels[0]!.grants).toHaveLength(1);
  });

  it('fails on missing targets and reports the op index', () => {
    const r = applyPatch({ a: 1 }, [{ op: 'replace', path: '/b', value: 2 }]);
    expect(r).toMatchObject({ ok: false, opIndex: 0 });
    expect(applyPatch({ a: [1] }, [{ op: 'remove', path: '/a/5' }]).ok).toBe(false);
    expect(applyPatch({ a: 1 }, [{ op: 'add', path: '/a/b', value: 1 }]).ok).toBe(false);
  });
});
