import { describe, expect, it } from 'vitest';
import { parseEvent } from '../src/events/index.ts';

const base = {
  id: '018f6d2e-7b1a-7c3d-9e4f-5a6b7c8d9e0f',
  stream: 'char:2b7a1f22-1111-4c9d-a8f2-0a1b2c3d4e5f',
  ts: '2026-08-30T12:00:00.000Z',
  actor: { userId: 'usr_1', deviceId: 'dev_1', role: 'owner' },
};
const prone = 'core-mini:condition/prone';
const ok = (type: string, v: number, payload: unknown) => parseEvent({ ...base, type, v, payload }).ok;

describe('condition.added@2 / condition.updated@1', () => {
  it('keeps condition.added@1 parsing', () => {
    expect(ok('condition.added', 1, { conditionId: prone, source: 'x', until: 'dawn' })).toBe(true);
  });
  it('accepts v2 with and without a duration', () => {
    expect(ok('condition.added', 2, { conditionId: prone })).toBe(true);
    expect(
      ok('condition.added', 2, {
        conditionId: prone,
        level: 2,
        source: 'Hold Person',
        startedAtRound: 0,
        duration: { kind: 'rounds', amount: 10 },
      }),
    ).toBe(true);
    expect(ok('condition.added', 2, { conditionId: prone, duration: { kind: 'untilLongRest' } })).toBe(true);
  });
  it.each([0, -1, 1.5, 1000])('rejects duration amount %s', (amount) => {
    expect(ok('condition.added', 2, { conditionId: prone, duration: { kind: 'minutes', amount } })).toBe(false);
  });
  it('rejects an amount on a rest duration, a long source and a negative round', () => {
    expect(ok('condition.added', 2, { conditionId: prone, duration: { kind: 'untilLongRest', amount: 1 } })).toBe(
      false,
    );
    expect(ok('condition.added', 2, { conditionId: prone, source: 'x'.repeat(81) })).toBe(false);
    expect(ok('condition.added', 2, { conditionId: prone, startedAtRound: -1 })).toBe(false);
  });
  it('parses condition.updated@1 and requires a duration', () => {
    expect(ok('condition.updated', 1, { conditionId: prone, duration: { kind: 'hours', amount: 1 } })).toBe(true);
    expect(ok('condition.updated', 1, { conditionId: prone })).toBe(false);
  });
  it('accepts encounterId on v2', () => {
    const encounterId = '2b7a1f22-1111-4c9d-a8f2-0a1b2c3d4e5f';
    expect(ok('condition.added', 2, { conditionId: prone, startedAtRound: 1, encounterId })).toBe(true);
    expect(ok('round.advanced', 1, { encounterId, round: 2 })).toBe(true);
    expect(ok('round.advanced', 1, { encounterId, round: -1 })).toBe(false);
  });
});
