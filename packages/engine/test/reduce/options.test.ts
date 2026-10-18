import type { Event } from '@hk/protocol';
import { describe, expect, it } from 'vitest';
import { emptyFacts } from '../../src/reduce/facts.ts';
import { reduce } from '../../src/reduce/reducer.ts';

/** Plan 14 (phase 4 slice 4) Task 5, design ruling 8 — `character.options.set@1` → `Facts.options`. */
const stream = 'char:2b7a1f22-1111-4c9d-a8f2-0a1b2c3d4e5f';
const ev = (n: number, type: string, payload: unknown): Event => ({
  id: `018f6d2e-7b1a-7c3d-9e4f-${String(n).padStart(12, '0')}`,
  stream,
  seq: n,
  ts: '2026-10-18T12:00:00.000Z',
  actor: { userId: 'u', deviceId: 'd', role: 'owner' },
  type,
  v: 1,
  payload,
});
const created = ev(1, 'character.created', {
  name: 'Ivan',
  system: 'mini',
  corePack: { id: 'core-mini', version: '1.0.0' },
  engineVersion: '0.1.0',
  grammaticalGender: 'masculine',
});

describe('reduce: character.options.set@1', () => {
  it('emptyFacts starts with no options', () => {
    expect(emptyFacts(stream).options).toEqual({});
  });

  it('a legacy log without the event reduces to options {}', () => {
    const f = reduce([created, ev(2, 'character.renamed', { name: 'Olena' })]);
    expect(f.options).toEqual({});
    expect(f.skipped).toEqual([]);
  });

  it('sets the given option', () => {
    const f = reduce([created, ev(2, 'character.options.set', { encumbrance: 'variant' })]);
    expect(f.options).toEqual({ encumbrance: 'variant' });
    expect(f.skipped).toEqual([]);
  });

  it('last write per key wins', () => {
    const f = reduce([
      created,
      ev(2, 'character.options.set', { encumbrance: 'variant' }),
      ev(3, 'character.options.set', { encumbrance: 'standard' }),
    ]);
    expect(f.options).toEqual({ encumbrance: 'standard' });
  });

  it('merges per key: an empty patch leaves earlier keys untouched', () => {
    const f = reduce([
      created,
      ev(2, 'character.options.set', { encumbrance: 'variant' }),
      ev(3, 'character.options.set', {}),
    ]);
    expect(f.options).toEqual({ encumbrance: 'variant' });
    expect(f.skipped).toEqual([]);
  });

  it('records "off" explicitly (an explicit choice, not a deletion)', () => {
    const f = reduce([
      created,
      ev(2, 'character.options.set', { encumbrance: 'variant' }),
      ev(3, 'character.options.set', { encumbrance: 'off' }),
    ]);
    expect(f.options).toEqual({ encumbrance: 'off' });
  });

  it('skips before character.created, like every other identity event', () => {
    const f = reduce([ev(1, 'character.options.set', { encumbrance: 'variant' })]);
    expect(f.options).toEqual({});
    expect(f.skipped).toHaveLength(1);
  });
});
