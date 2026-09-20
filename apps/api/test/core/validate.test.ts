/**
 * Plan-9 Task 2, T2 obligation (b): the stream-binding guard — a campaign-only event type must
 * never be accepted on a `char:` stream, and a character-only type never on a `camp:` stream.
 * `@hk/protocol`'s `EVENT_STREAM_KIND` (packages/protocol/src/events/index.ts) is the source of
 * truth for which kind a type belongs to; `validateEvent` is where it's enforced — BEFORE
 * `stream-actor.ts`'s `permissions.allowed` call (doc-10's pipeline order: parse → size →
 * permission → dedupe; this check rides along with "parse", rejecting `invalid` exactly like a
 * bad payload would).
 *
 * Testable at this level with a synthetic stream id: no `CampaignActor` needs to exist yet for
 * `validateEvent(event, 'camp:<uuid>')` to be a meaningful call.
 */
import { describe, expect, it } from 'vitest';
import { uuidv7 } from '../../src/core/ids.ts';
import { validateEvent } from '../../src/core/validate.ts';

const CHAR_STREAM = `char:${uuidv7()}`;
const CAMP_STREAM = `camp:${uuidv7()}`;

function baseEnvelope(overrides: Record<string, unknown>) {
  return {
    id: uuidv7(),
    ts: new Date().toISOString(),
    actor: { userId: 'user-1', deviceId: 'device-1', role: 'owner' },
    v: 1,
    ...overrides,
  };
}

describe('validateEvent — stream-binding guard', () => {
  it('rejects a campaign-only type (roll.logged) appended to a char: stream as invalid', () => {
    const event = baseEnvelope({
      stream: CHAR_STREAM,
      type: 'roll.logged',
      payload: {
        label: 'Attack roll',
        formula: '1d20+5',
        results: [{ die: 'd20', value: 15 }],
        total: 20,
        kind: 'attack',
        visibility: 'everyone',
      },
    });
    const result = validateEvent(event, CHAR_STREAM);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('event.invalid');
  });

  it('rejects a character-only type (hp.changed) appended to a camp: stream as invalid', () => {
    const event = baseEnvelope({
      stream: CAMP_STREAM,
      type: 'hp.changed',
      payload: { delta: -5, kind: 'damage' },
    });
    const result = validateEvent(event, CAMP_STREAM);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('event.invalid');
  });

  it('accepts a character type on a char: stream', () => {
    const event = baseEnvelope({ stream: CHAR_STREAM, type: 'note.added', payload: { id: uuidv7() } });
    const result = validateEvent(event, CHAR_STREAM);
    expect(result.ok).toBe(true);
  });

  it('accepts a campaign type on a camp: stream', () => {
    const event = baseEnvelope({
      stream: CAMP_STREAM,
      type: 'chat.message',
      payload: { text: 'hello', visibility: 'everyone' },
    });
    const result = validateEvent(event, CAMP_STREAM);
    expect(result.ok).toBe(true);
  });
});
