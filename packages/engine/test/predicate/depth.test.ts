import type { Predicate } from '@hk/protocol';
import { describe, expect, it } from 'vitest';
import { PREDICATE_MAX_DEPTH, checkPredicateShape } from '../../src/predicate/depth.ts';
import { validateEffects } from '../../src/effects/validate.ts';

const nest = (depth: number): Predicate => {
  let p: Predicate = { tag: 'leaf' };
  for (let i = 0; i < depth; i++) p = { not: p };
  return p;
};

describe('checkPredicateShape', () => {
  it('accepts nesting up to the cap and flags beyond it', () => {
    expect(checkPredicateShape(nest(PREDICATE_MAX_DEPTH), 'when')).toEqual([]);
    const d = checkPredicateShape(nest(PREDICATE_MAX_DEPTH + 1), 'when', 'x:feat/y');
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ severity: 'error', code: 'predicate.tooDeep', entityId: 'x:feat/y' });
  });
  it('flags all/any wider than 32', () => {
    const wide: Predicate = { any: Array.from({ length: 33 }, () => ({ tag: 't' })) };
    expect(checkPredicateShape(wide, 'when')[0]?.code).toBe('predicate.tooWide');
    expect(checkPredicateShape({ any: Array.from({ length: 32 }, () => ({ tag: 't' })) }, 'when')).toEqual([]);
  });
  it('is wired into effect validation via when', () => {
    const d = validateEffects([{ type: 'ac.bonus', value: 1, when: nest(20) }], 'effects', 'x:feat/y');
    expect(d.map((x) => x.code)).toContain('predicate.tooDeep');
  });
});
