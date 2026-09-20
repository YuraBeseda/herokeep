import { describe, expect, it } from 'vitest';
import {
  CAMPAIGN_EVENT_ACTORS,
  CAMPAIGN_EVENT_PAYLOADS,
  CampaignSettingsSchema,
  EVENT_ACTORS,
  EVENT_PAYLOADS,
  EventEnvelopeSchema,
  parseEvent,
} from '../src/events/index.ts';

const base = {
  id: '018f6d2e-7b1a-7c3d-9e4f-5a6b7c8d9e0f',
  stream: 'camp:2b7a1f22-1111-4c9d-a8f2-0a1b2c3d4e5f',
  ts: '2026-09-20T12:00:00.000Z',
  actor: { userId: 'usr_1', deviceId: 'dev_1', role: 'dm' },
  v: 1,
};

const UUID_A = '11111111-2222-4333-8444-555555555555';
const UUID_B = '22222222-3333-4444-8555-666666666666';

const VALID_SETTINGS = {
  system: '5e-2024',
  packs: [{ id: 'srd-5e-2024', version: '1.0.0' }],
  houseRules: {
    strictValidation: true,
    allowOverrides: true,
    editOutsideSession: 'free',
    xpMode: 'xp',
    hpOnLevelUp: 'roll',
    encumbrance: 'off',
    attunementMax: 3,
    startingLevel: 1,
  },
  visibility: {
    partySheets: 'none',
    rolls: 'everyone',
    allowPrivateRolls: true,
  },
  join: { open: true, requireApproval: false },
};

// One schema-valid accept sample per campaign-stream event family (doc-02 § "Event catalog —
// campaign stream"); the reject sample is that same payload plus an unknown field, which every
// strictObject payload must refuse (mirrors events.test.ts's NEW_EVENT_CASES pattern).
const CAMPAIGN_EVENT_CASES: { type: string; accept: Record<string, unknown> }[] = [
  {
    type: 'campaign.created',
    accept: { name: 'The Sunless Citadel', system: '5e-2024', corePack: { id: 'srd-5e-2024', version: '1.0.0' } },
  },
  { type: 'campaign.renamed', accept: { name: 'A New Name' } },
  { type: 'campaign.settings_changed', accept: { settings: VALID_SETTINGS } },
  { type: 'campaign.join_code_rotated', accept: { joinCode: '7QX4-M2HN' } },
  { type: 'campaign.archived', accept: {} },
  { type: 'pack.enabled', accept: { packId: 'homebrew-pack', version: '1.0.0', sha256: '0'.repeat(64) } },
  { type: 'pack.disabled', accept: { packId: 'homebrew-pack', version: '1.0.0', sha256: '0'.repeat(64) } },
  { type: 'member.joined', accept: { userId: 'usr_2', displayName: 'Rin', role: 'player' } },
  { type: 'member.left', accept: { userId: 'usr_2', displayName: 'Rin', role: 'player' } },
  { type: 'member.removed', accept: { userId: 'usr_2', displayName: 'Rin', role: 'player' } },
  { type: 'member.renamed', accept: { displayName: 'Rin the Bold' } },
  { type: 'campaign.character_joined', accept: { characterId: UUID_A, ownerId: 'usr_2', name: 'Rin' } },
  { type: 'campaign.character_left', accept: { characterId: UUID_A, ownerId: 'usr_2', name: 'Rin' } },
  {
    type: 'party.overview_updated',
    accept: {
      characterId: UUID_A,
      overview: {
        hp: 12,
        hpMax: 18,
        temp: 0,
        ac: 15,
        level: 3,
        classes: [{ classId: 'srd-5e-2024:class/fighter', level: 3 }],
        conditions: [],
        concentration: false,
        passivePerception: 12,
      },
    },
  },
  { type: 'session.started', accept: { title: 'Session 12' } },
  { type: 'session.ended', accept: {} },
  {
    type: 'roll.logged',
    accept: {
      characterId: UUID_A,
      label: 'Attack roll',
      formula: '1d20+5',
      results: [{ die: 'd20', value: 14 }],
      total: 19,
      kind: 'attack',
      visibility: 'everyone',
    },
  },
  { type: 'chat.message', accept: { text: 'Hello party', visibility: 'everyone' } },
  { type: 'dm.note_added', accept: { id: UUID_B, title: 'Secret', body: 'The baron is a doppelganger.' } },
  { type: 'dm.note_updated', accept: { id: UUID_B, body: 'Updated secret.' } },
  { type: 'dm.note_removed', accept: { id: UUID_B } },
];

describe.each(CAMPAIGN_EVENT_CASES)('parseEvent $type', ({ type, accept }) => {
  it('accepts a schema-valid payload', () => {
    const r = parseEvent({ ...base, type, payload: accept });
    expect(r.ok, JSON.stringify(r)).toBe(true);
  });

  it('rejects a payload with an unknown field', () => {
    const r = parseEvent({ ...base, type, payload: { ...accept, unexpectedField: true } });
    expect(r.ok).toBe(false);
  });
});

describe('the complete campaign-stream event catalog', () => {
  const CAMPAIGN_EVENT_COUNT = 21;

  it('registers a payload schema for every catalog event', () => {
    expect(Object.keys(CAMPAIGN_EVENT_PAYLOADS)).toHaveLength(CAMPAIGN_EVENT_COUNT);
  });

  it('declares an actor list for every catalog event', () => {
    expect(Object.keys(CAMPAIGN_EVENT_ACTORS)).toHaveLength(CAMPAIGN_EVENT_COUNT);
  });

  it('gives every CAMPAIGN_EVENT_PAYLOADS key a matching CAMPAIGN_EVENT_ACTORS entry', () => {
    for (const key of Object.keys(CAMPAIGN_EVENT_PAYLOADS)) {
      const type = key.slice(0, key.lastIndexOf('@'));
      expect(CAMPAIGN_EVENT_ACTORS[type], `missing CAMPAIGN_EVENT_ACTORS entry for ${type}`).toBeDefined();
    }
  });

  it('merges character + campaign registries into the flat EVENT_PAYLOADS/EVENT_ACTORS exports', () => {
    expect(EVENT_PAYLOADS['campaign.created@1']).toBeDefined();
    expect(EVENT_PAYLOADS['character.created@1']).toBeDefined();
    expect(EVENT_ACTORS['campaign.created']).toBeDefined();
    expect(EVENT_ACTORS['character.created']).toBeDefined();
  });
});

describe('CampaignSettingsSchema', () => {
  it('accepts the full settings document', () => {
    expect(CampaignSettingsSchema.safeParse(VALID_SETTINGS).success).toBe(true);
  });

  it('rejects an unknown editOutsideSession enum value', () => {
    const bad = { ...VALID_SETTINGS, houseRules: { ...VALID_SETTINGS.houseRules, editOutsideSession: 'sometimes' } };
    expect(CampaignSettingsSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects an unknown xpMode enum value', () => {
    const bad = { ...VALID_SETTINGS, houseRules: { ...VALID_SETTINGS.houseRules, xpMode: 'story' } };
    expect(CampaignSettingsSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects an unknown hpOnLevelUp enum value', () => {
    const bad = { ...VALID_SETTINGS, houseRules: { ...VALID_SETTINGS.houseRules, hpOnLevelUp: 'reroll' } };
    expect(CampaignSettingsSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects an unknown encumbrance enum value', () => {
    const bad = { ...VALID_SETTINGS, houseRules: { ...VALID_SETTINGS.houseRules, encumbrance: 'realistic' } };
    expect(CampaignSettingsSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects an unknown visibility.partySheets enum value', () => {
    const bad = { ...VALID_SETTINGS, visibility: { ...VALID_SETTINGS.visibility, partySheets: 'partial' } };
    expect(CampaignSettingsSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects an unknown visibility.rolls enum value (private is not a campaign-wide default)', () => {
    const bad = { ...VALID_SETTINGS, visibility: { ...VALID_SETTINGS.visibility, rolls: 'private' } };
    expect(CampaignSettingsSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects a settings document missing the join sub-document', () => {
    const bad = Object.fromEntries(Object.entries(VALID_SETTINGS).filter(([key]) => key !== 'join'));
    expect(CampaignSettingsSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects an unknown top-level field (strictObject)', () => {
    expect(CampaignSettingsSchema.safeParse({ ...VALID_SETTINGS, extra: true }).success).toBe(false);
  });

  it('rejects startingLevel above the 5e level cap (20)', () => {
    const bad = { ...VALID_SETTINGS, houseRules: { ...VALID_SETTINGS.houseRules, startingLevel: 21 } };
    expect(CampaignSettingsSchema.safeParse(bad).success).toBe(false);
  });
});

describe('chat.message text byte cap (doc-02: "text ≤ 2 KB")', () => {
  it('accepts text at exactly 2048 bytes', () => {
    const r = parseEvent({
      ...base,
      type: 'chat.message',
      payload: { text: 'a'.repeat(2048), visibility: 'everyone' },
    });
    expect(r.ok, JSON.stringify(r)).toBe(true);
  });

  it('rejects text at 2049 bytes', () => {
    const r = parseEvent({
      ...base,
      type: 'chat.message',
      payload: { text: 'a'.repeat(2049), visibility: 'everyone' },
    });
    expect(r.ok).toBe(false);
  });

  it('rejects text that is under the char cap but over the byte cap (multi-byte UTF-8)', () => {
    // Each '€' is 3 bytes in UTF-8; 700 of them is 2100 bytes but only 700 UTF-16 code units.
    const r = parseEvent({ ...base, type: 'chat.message', payload: { text: '€'.repeat(700), visibility: 'everyone' } });
    expect(r.ok).toBe(false);
  });
});

describe('roll.logged kind/visibility enums', () => {
  const rollBase = {
    label: 'Save',
    formula: '1d20+2',
    results: [{ die: 'd20', value: 10 }],
    total: 12,
    kind: 'save',
    visibility: 'dm',
  };

  it('accepts every documented kind value', () => {
    for (const kind of ['check', 'attack', 'damage', 'save', 'spell', 'custom']) {
      const r = parseEvent({ ...base, type: 'roll.logged', payload: { ...rollBase, kind } });
      expect(r.ok, `kind=${kind}: ${JSON.stringify(r)}`).toBe(true);
    }
  });

  it('rejects an undocumented kind value', () => {
    const r = parseEvent({ ...base, type: 'roll.logged', payload: { ...rollBase, kind: 'initiative' } });
    expect(r.ok).toBe(false);
  });

  it('accepts every documented visibility value', () => {
    for (const visibility of ['everyone', 'dm', 'private']) {
      const r = parseEvent({ ...base, type: 'roll.logged', payload: { ...rollBase, visibility } });
      expect(r.ok, `visibility=${visibility}: ${JSON.stringify(r)}`).toBe(true);
    }
  });

  it('rejects an undocumented visibility value', () => {
    const r = parseEvent({ ...base, type: 'roll.logged', payload: { ...rollBase, visibility: 'party' } });
    expect(r.ok).toBe(false);
  });
});

// doc-08 §Authorization matrix, campaign rows, quoted verbatim in each test name below.
describe('EVENT_ACTORS campaign rows (doc-08 §Authorization matrix)', () => {
  it('"Append campaign settings/packs/session/member removal | — | ✔ | ✖ | ✖" (DM only)', () => {
    expect(CAMPAIGN_EVENT_ACTORS['campaign.settings_changed']).toEqual(['dm']);
    expect(CAMPAIGN_EVENT_ACTORS['pack.enabled']).toEqual(['dm']);
    expect(CAMPAIGN_EVENT_ACTORS['pack.disabled']).toEqual(['dm']);
    expect(CAMPAIGN_EVENT_ACTORS['session.started']).toEqual(['dm']);
    expect(CAMPAIGN_EVENT_ACTORS['session.ended']).toEqual(['dm']);
    expect(CAMPAIGN_EVENT_ACTORS['member.removed']).toEqual(['dm']);
  });

  it('"roll.logged, chat.message, member.renamed, own campaign.character_joined/left | — | ✔ | ✔ | ✖" (DM and Member)', () => {
    expect(CAMPAIGN_EVENT_ACTORS['roll.logged']).toEqual(['dm', 'member']);
    expect(CAMPAIGN_EVENT_ACTORS['chat.message']).toEqual(['dm', 'member']);
    expect(CAMPAIGN_EVENT_ACTORS['member.renamed']).toEqual(['dm', 'member']);
    expect(CAMPAIGN_EVENT_ACTORS['campaign.character_joined']).toEqual(['dm', 'member']);
    expect(CAMPAIGN_EVENT_ACTORS['campaign.character_left']).toEqual(['dm', 'member']);
  });

  it('doc-02 actor column "M / D" for member.joined/left/removed resolves to member self-service join/leave, DM-only removal', () => {
    // member.joined ALSO grants 'dm' (fix round 1, controller-sanctioned): the campaign's own DM
    // legitimately records their own bootstrap membership row via this type too (self-binding at
    // the actor level, `campaign-actor.ts`, is what still prevents a DM admitting anyone else).
    expect(CAMPAIGN_EVENT_ACTORS['member.joined']).toEqual(['member', 'dm']);
    expect(CAMPAIGN_EVENT_ACTORS['member.left']).toEqual(['member']);
    expect(CAMPAIGN_EVENT_ACTORS['member.removed']).toEqual(['dm']);
  });

  it('"Read campaign stream | — | ✔ | ✔ (DM notes filtered out) | ✖" implies dm.note_* is DM-authored', () => {
    expect(CAMPAIGN_EVENT_ACTORS['dm.note_added']).toEqual(['dm']);
    expect(CAMPAIGN_EVENT_ACTORS['dm.note_updated']).toEqual(['dm']);
    expect(CAMPAIGN_EVENT_ACTORS['dm.note_removed']).toEqual(['dm']);
  });
});

describe('member role in the envelope (ActorRoleSchema gains "member")', () => {
  it('accepts actor.role = member', () => {
    const r = EventEnvelopeSchema.safeParse({
      ...base,
      actor: { userId: 'usr_2', deviceId: 'dev_2', role: 'member' },
      type: 'chat.message',
      payload: { text: 'hi', visibility: 'everyone' },
    });
    expect(r.success, JSON.stringify(r)).toBe(true);
  });

  it('parseEvent accepts a member-authored roll.logged event end to end', () => {
    const r = parseEvent({
      ...base,
      actor: { userId: 'usr_2', deviceId: 'dev_2', role: 'member' },
      type: 'roll.logged',
      payload: {
        label: 'Perception check',
        formula: '1d20+3',
        results: [{ die: 'd20', value: 11 }],
        total: 14,
        kind: 'check',
        visibility: 'everyone',
      },
    });
    expect(r.ok, JSON.stringify(r)).toBe(true);
  });
});
