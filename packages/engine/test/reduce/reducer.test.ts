import type { Event } from '@hk/protocol';
import { describe, expect, it } from 'vitest';
import { reduce } from '../../src/reduce/reducer.ts';

const stream = 'char:2b7a1f22-1111-4c9d-a8f2-0a1b2c3d4e5f';
const ev = (n: number, type: string, payload: unknown, extra: Partial<Event> = {}): Event => ({
  id: `018f6d2e-7b1a-7c3d-9e4f-${String(n).padStart(12, '0')}`,
  stream,
  seq: n,
  ts: '2026-08-30T12:00:00.000Z',
  actor: { userId: 'u', deviceId: 'd', role: 'owner' },
  type,
  v: 1,
  payload,
  ...extra,
});
const created = ev(1, 'character.created', {
  name: 'Ivan',
  system: 'mini',
  corePack: { id: 'core-mini', version: '1.0.0' },
  engineVersion: '0.1.0',
  grammaticalGender: 'masculine',
});
const pinned = ev(2, 'pack.pinned', { packId: 'homebrew-mini', version: '1.2.0' });
const decided = ev(3, 'decision.made', {
  choiceId: 'core-mini:class/fighter@1/fighting-style',
  selection: ['core-mini:feat/defense'],
});

describe('reduce', () => {
  it('folds the three events into facts', () => {
    const f = reduce([created, pinned, decided]);
    expect(f.name).toBe('Ivan');
    expect(f.pins).toEqual({ 'core-mini': '1.0.0', 'homebrew-mini': '1.2.0' });
    expect(f.decisions).toEqual({ 'core-mini:class/fighter@1/fighting-style': ['core-mini:feat/defense'] });
    expect(f.lastSeq).toBe(3);
    expect(f.skipped).toEqual([]);
  });

  it('orders by seq, applies pending (no seq) events last, and skips duplicates', () => {
    const pending = { ...decided, id: '018f6d2e-7b1a-7c3d-9e4f-aaaaaaaaaaaa', seq: undefined } as Event;
    const f = reduce([pinned, created, pending, { ...pinned }]);
    expect(f.pins['homebrew-mini']).toBe('1.2.0');
    expect(f.decisions['core-mini:class/fighter@1/fighting-style']).toEqual(['core-mini:feat/defense']);
    expect(f.skipped).toEqual([{ eventId: pinned.id, reason: 'duplicate' }]);
    expect(f.lastSeq).toBe(2);
  });

  it('never throws: unknown types and out-of-order creation are recorded as skipped', () => {
    const earlyDecision = ev(1, 'decision.made', {
      choiceId: 'core-mini:class/fighter@1/fighting-style',
      selection: ['core-mini:feat/defense'],
    });
    const unknown = ev(2, 'hp.exploded', {});
    const createdAt3 = ev(3, 'character.created', {
      name: 'Ivan',
      system: 'mini',
      corePack: { id: 'core-mini', version: '1.0.0' },
      engineVersion: '0.1.0',
      grammaticalGender: 'masculine',
    });
    const dupCreated = { ...createdAt3, id: '018f6d2e-7b1a-7c3d-9e4f-bbbbbbbbbbbb', seq: 4 };
    // Passed out of seq order on purpose: replay must still apply strictly by seq
    // (1, 2, 3, 4), so the decision at seq 1 legitimately precedes character.created at seq 3.
    const f = reduce([createdAt3, earlyDecision, dupCreated, unknown]);
    expect(f.skipped.map((s) => s.reason)).toEqual(['not-created', 'unknown-type', 'already-created']);
    expect(f.name).toBe('Ivan');
  });

  it('resumes from a snapshot', () => {
    const first = reduce([created, pinned]);
    const resumed = reduce([created, pinned, decided], { seq: 2, facts: first, engineVersion: '0.1.0' });
    expect(resumed).toEqual(reduce([created, pinned, decided]));
  });

  it('is independent of array arrival order: replay converges by seq alone', () => {
    expect(reduce([created, pinned, decided])).toEqual(reduce([decided, created, pinned]));
    expect(reduce([created, pinned, decided])).toEqual(reduce([pinned, decided, created]));
  });
});
