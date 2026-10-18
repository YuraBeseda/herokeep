/**
 * Plan 14 (phase 4 slice 4) Task 5, design ruling 8 — `character.options.set@1`: an additive,
 * owner-only character-stream event carrying per-character rule options. The payload is a strict
 * object of OPTIONAL keys (so a future option is an additive key, never a reshape); an empty object
 * is allowed (a no-op patch is still a well-formed payload); an unknown key is refused.
 */
import { describe, expect, it } from 'vitest';
import { CharacterOptionsSetV1, EVENT_ACTORS } from '../src/events/character.ts';
import { parseEvent } from '../src/events/index.ts';

const base = {
  id: '018f6d2e-7b1a-7c3d-9e4f-5a6b7c8d9e0f',
  stream: 'char:2b7a1f22-1111-4c9d-a8f2-0a1b2c3d4e5f',
  ts: '2026-10-18T12:00:00.000Z',
  actor: { userId: 'usr_1', deviceId: 'dev_1', role: 'owner' },
  v: 1,
};

describe('character.options.set@1', () => {
  it.each(['off', 'standard', 'variant'])('accepts encumbrance "%s"', (encumbrance) => {
    const r = parseEvent({ ...base, type: 'character.options.set', payload: { encumbrance } });
    expect(r.ok, JSON.stringify(r)).toBe(true);
  });

  it('accepts an empty object (every option key is optional)', () => {
    const r = parseEvent({ ...base, type: 'character.options.set', payload: {} });
    expect(r.ok, JSON.stringify(r)).toBe(true);
  });

  it('rejects an unknown option key', () => {
    const r = parseEvent({ ...base, type: 'character.options.set', payload: { flanking: true } });
    expect(r.ok).toBe(false);
  });

  it('rejects an encumbrance value outside the enum', () => {
    expect(CharacterOptionsSetV1.safeParse({ encumbrance: 'heavy' }).success).toBe(false);
  });

  it('is owner-only (a per-character preference, not a DM mechanic)', () => {
    expect(EVENT_ACTORS['character.options.set']).toEqual(['owner']);
  });
});
