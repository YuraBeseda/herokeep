import type { Event } from '@hk/protocol';
import { campaignIdOfCharacter, lastCampaignLinkEvent } from './character-campaign-link';

const STREAM = 'char:00000000-0000-4000-8000-000000000001';
const CAMPAIGN_A = '00000000-0000-4000-8000-0000000000a1';
const CAMPAIGN_B = '00000000-0000-4000-8000-0000000000b2';

let nextEventId = 1;

function mkEvent(type: string, payload: unknown, seq?: number, id?: string): Event {
  const eventId = id ?? `00000000-0000-4000-8000-${String(nextEventId++).padStart(12, '0')}`;
  return {
    id: eventId,
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

// Fix round 1 (finding 2): `lastCampaignLinkEvent` is the richer scan `campaignIdOfCharacter` is
// now defined in terms of — these pin the `committed`/`eventId` fields a resume flow needs.
describe('lastCampaignLinkEvent', () => {
  it('returns undefined for an empty event list', () => {
    expect(lastCampaignLinkEvent([])).toBeUndefined();
  });

  it('reports a COMMITTED character.campaign_joined (has a seq)', () => {
    const events = [
      mkEvent('character.campaign_joined', { campaignId: CAMPAIGN_A }, 2, 'evt-joined'),
    ];
    expect(lastCampaignLinkEvent(events)).toEqual({
      type: 'character.campaign_joined',
      campaignId: CAMPAIGN_A,
      eventId: 'evt-joined',
      committed: true,
    });
  });

  it('reports a still-PENDING character.campaign_joined (no seq) as committed: false', () => {
    const events = [
      mkEvent('character.campaign_joined', { campaignId: CAMPAIGN_A }, undefined, 'evt-pending'),
    ];
    expect(lastCampaignLinkEvent(events)).toEqual({
      type: 'character.campaign_joined',
      campaignId: CAMPAIGN_A,
      eventId: 'evt-pending',
      committed: false,
    });
  });

  it('also reports a character.campaign_left event (unlike campaignIdOfCharacter, which folds it to undefined)', () => {
    const events = [
      mkEvent('character.campaign_joined', { campaignId: CAMPAIGN_A }, 1),
      mkEvent('character.campaign_left', { campaignId: CAMPAIGN_A }, 2, 'evt-left'),
    ];
    expect(lastCampaignLinkEvent(events)).toEqual({
      type: 'character.campaign_left',
      campaignId: CAMPAIGN_A,
      eventId: 'evt-left',
      committed: true,
    });
    expect(campaignIdOfCharacter(events)).toBeUndefined();
  });

  it('reports a still-PENDING character.campaign_left as committed: false', () => {
    const events = [
      mkEvent('character.campaign_joined', { campaignId: CAMPAIGN_A }, 1),
      mkEvent('character.campaign_left', { campaignId: CAMPAIGN_A }, undefined, 'evt-left-pending'),
    ];
    expect(lastCampaignLinkEvent(events)).toEqual({
      type: 'character.campaign_left',
      campaignId: CAMPAIGN_A,
      eventId: 'evt-left-pending',
      committed: false,
    });
  });
});
