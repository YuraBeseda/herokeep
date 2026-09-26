import type { Event } from '@hk/protocol';
import { campaignIdOfCharacter } from './character-campaign-link';

const STREAM = 'char:00000000-0000-4000-8000-000000000001';
const CAMPAIGN_A = '00000000-0000-4000-8000-0000000000a1';
const CAMPAIGN_B = '00000000-0000-4000-8000-0000000000b2';

let nextEventId = 1;

function mkEvent(type: string, payload: unknown, seq?: number): Event {
  const id = `00000000-0000-4000-8000-${String(nextEventId++).padStart(12, '0')}`;
  return {
    id,
    stream: STREAM,
    ts: '2026-09-26T00:00:00.000Z',
    actor: { userId: 'usr_owner', deviceId: 'dev_1', role: 'owner' },
    type,
    v: 1,
    payload,
    ...(seq !== undefined ? { seq } : {}),
  };
}

describe('campaignIdOfCharacter', () => {
  it('returns undefined for an empty event list', () => {
    expect(campaignIdOfCharacter([])).toBeUndefined();
  });

  it('returns undefined when the character has never joined a campaign', () => {
    const events = [mkEvent('character.created', { name: 'Aria' }, 1)];
    expect(campaignIdOfCharacter(events)).toBeUndefined();
  });

  it('returns the campaignId after a character.campaign_joined event', () => {
    const events = [
      mkEvent('character.created', { name: 'Aria' }, 1),
      mkEvent('character.campaign_joined', { campaignId: CAMPAIGN_A }, 2),
    ];
    expect(campaignIdOfCharacter(events)).toBe(CAMPAIGN_A);
  });

  it('returns undefined after a matching character.campaign_left event', () => {
    const events = [
      mkEvent('character.created', { name: 'Aria' }, 1),
      mkEvent('character.campaign_joined', { campaignId: CAMPAIGN_A }, 2),
      mkEvent('character.campaign_left', { campaignId: CAMPAIGN_A }, 3),
    ];
    expect(campaignIdOfCharacter(events)).toBeUndefined();
  });

  it('returns the NEW campaignId after leaving one campaign and joining another', () => {
    const events = [
      mkEvent('character.created', { name: 'Aria' }, 1),
      mkEvent('character.campaign_joined', { campaignId: CAMPAIGN_A }, 2),
      mkEvent('character.campaign_left', { campaignId: CAMPAIGN_A }, 3),
      mkEvent('character.campaign_joined', { campaignId: CAMPAIGN_B }, 4),
    ];
    expect(campaignIdOfCharacter(events)).toBe(CAMPAIGN_B);
  });

  it('considers still-PENDING events (no seq) at the tail — a just-appended, not-yet-acked join', () => {
    const events = [
      mkEvent('character.created', { name: 'Aria' }, 1),
      mkEvent('character.campaign_joined', { campaignId: CAMPAIGN_A }), // pending — no seq
    ];
    expect(campaignIdOfCharacter(events)).toBe(CAMPAIGN_A);
  });

  it('ignores unrelated event types interleaved among the relevant ones', () => {
    const events = [
      mkEvent('character.created', { name: 'Aria' }, 1),
      mkEvent('character.campaign_joined', { campaignId: CAMPAIGN_A }, 2),
      mkEvent('xp.awarded', { amount: 100 }, 3),
      mkEvent('note.added', { id: 'n1', title: 'Loot', body: '' }, 4),
    ];
    expect(campaignIdOfCharacter(events)).toBe(CAMPAIGN_A);
  });
});
