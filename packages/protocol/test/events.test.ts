import { describe, expect, it } from 'vitest';
import { EVENT_ACTORS, parseEvent } from '../src/events/index.ts';

const base = {
  id: '018f6d2e-7b1a-7c3d-9e4f-5a6b7c8d9e0f',
  stream: 'char:2b7a1f22-1111-4c9d-a8f2-0a1b2c3d4e5f',
  ts: '2026-08-30T12:00:00.000Z',
  actor: { userId: 'usr_1', deviceId: 'dev_1', role: 'owner' },
  v: 1,
};

describe('parseEvent', () => {
  it('accepts the three phase-1a events', () => {
    const ok = (type: string, payload: unknown) => {
      const r = parseEvent({ ...base, type, payload });
      expect(r.ok, JSON.stringify(r)).toBe(true);
    };
    ok('character.created', {
      name: 'Ivan',
      system: 'mini',
      corePack: { id: 'core-mini', version: '1.0.0' },
      engineVersion: '0.1.0',
      grammaticalGender: 'masculine',
    });
    ok('pack.pinned', { packId: 'core-mini', version: '1.0.0' });
    ok('decision.made', {
      choiceId: 'core-mini:class/fighter@1/fighting-style',
      selection: ['core-mini:feat/defense'],
    });
  });

  it('rejects unknown types, bad payloads and malformed envelopes', () => {
    expect(parseEvent({ ...base, type: 'hp.exploded', payload: {} }).ok).toBe(false);
    expect(parseEvent({ ...base, type: 'pack.pinned', payload: { packId: 'core-mini' } }).ok).toBe(false);
    expect(
      parseEvent({
        ...base,
        stream: 'char:not-a-uuid',
        type: 'pack.pinned',
        payload: { packId: 'core-mini', version: '1.0.0' },
      }).ok,
    ).toBe(false);
    expect(
      parseEvent({ ...base, seq: 0, type: 'pack.pinned', payload: { packId: 'core-mini', version: '1.0.0' } }).ok,
    ).toBe(false);
  });

  it('declares allowed actors per type', () => {
    expect(EVENT_ACTORS['character.created']).toEqual(['owner']);
    expect(EVENT_ACTORS['pack.pinned']).toEqual(['owner', 'dm']);
  });
});
