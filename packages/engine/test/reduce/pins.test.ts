import type { Event } from '@hk/protocol';
import { describe, expect, it } from 'vitest';
import { reduce } from '../../src/reduce/reducer.ts';

/** Plan 15 (phase 4 slice 5) Task 1, ruling 3 — `pack.unpinned@1` deletes `Facts.pins[packId]`. */
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
const pinned = ev(2, 'pack.pinned', { packId: 'homebrew-mini', version: '1.2.0' });

describe('reduce: pack.unpinned@1', () => {
  it('pin then unpin leaves the pack absent from pins', () => {
    const f = reduce([created, pinned, ev(3, 'pack.unpinned', { packId: 'homebrew-mini' })]);
    expect(f.pins).toEqual({ 'core-mini': '1.0.0' });
    expect('homebrew-mini' in f.pins).toBe(false);
    expect(f.skipped).toEqual([]);
  });

  it('unpinning an unknown pack id is a no-op (never refused, never skipped)', () => {
    const before = reduce([created, pinned]);
    const after = reduce([created, pinned, ev(3, 'pack.unpinned', { packId: 'nope' })]);
    expect(after.pins).toEqual(before.pins);
    expect(after.skipped).toEqual([]);
  });

  it('a re-pin after an unpin restores the pin', () => {
    const f = reduce([
      created,
      pinned,
      ev(3, 'pack.unpinned', { packId: 'homebrew-mini' }),
      ev(4, 'pack.pinned', { packId: 'homebrew-mini', version: '1.3.0', previous: '1.2.0' }),
    ]);
    expect(f.pins).toEqual({ 'core-mini': '1.0.0', 'homebrew-mini': '1.3.0' });
  });

  it('a legacy log without the event reduces exactly as before', () => {
    const f = reduce([created, pinned]);
    expect(f.pins).toEqual({ 'core-mini': '1.0.0', 'homebrew-mini': '1.2.0' });
    expect(f.skipped).toEqual([]);
  });
});
