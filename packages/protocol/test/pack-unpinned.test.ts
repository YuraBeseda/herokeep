/**
 * Plan 15 (phase 4 slice 5) Task 1, design ruling 3 — `pack.unpinned@1 {packId}`: the additive,
 * owner-only opt-out from a pinned content pack (the reducer deletes `pins[packId]`). A strict
 * payload: the pack id only, nothing else.
 */
import { describe, expect, it } from 'vitest';
import { EVENT_ACTORS, PackUnpinnedV1 } from '../src/events/character.ts';
import { type PackUnpinned, parseEvent } from '../src/index.ts';

const base = {
  id: '018f6d2e-7b1a-7c3d-9e4f-5a6b7c8d9e0f',
  stream: 'char:2b7a1f22-1111-4c9d-a8f2-0a1b2c3d4e5f',
  ts: '2026-10-18T12:00:00.000Z',
  actor: { userId: 'usr_1', deviceId: 'dev_1', role: 'owner' },
  v: 1,
};

describe('pack.unpinned@1', () => {
  it('accepts a pack id', () => {
    const payload: PackUnpinned = { packId: 'homebrew' };
    const r = parseEvent({ ...base, type: 'pack.unpinned', payload });
    expect(r.ok, JSON.stringify(r)).toBe(true);
  });

  it('rejects an extra key and a malformed pack id', () => {
    expect(parseEvent({ ...base, type: 'pack.unpinned', payload: { packId: 'homebrew', version: '1.0.0' } }).ok).toBe(
      false,
    );
    expect(PackUnpinnedV1.safeParse({ packId: 'Not A Pack' }).success).toBe(false);
    expect(PackUnpinnedV1.safeParse({}).success).toBe(false);
  });

  it('is owner-only (like pack.pinned)', () => {
    expect(EVENT_ACTORS['pack.unpinned']).toEqual(['owner']);
  });
});
