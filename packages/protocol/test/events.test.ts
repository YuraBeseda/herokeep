import { describe, expect, it } from 'vitest';
import {
  EVENT_ACTORS as CHARACTER_EVENT_ACTORS,
  EVENT_PAYLOADS as CHARACTER_EVENT_PAYLOADS,
} from '../src/events/character.ts';
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
    // doc-08 §Authorization matrix: "Append owner events (... pack.pinned)" is Owner-only; a
    // DM's pin on an owner's character goes through `override.applied` instead (gated by
    // `houseRules.allowOverrides`), never by appending `pack.pinned` directly.
    expect(EVENT_ACTORS['pack.pinned']).toEqual(['owner']);
  });
});

// The rest of the Phase-1 character-stream event catalog
// (docs/02-architecture/02-domain-model-and-events.md § "Event catalog — character stream"),
// beyond the three phase-1a events covered above. One schema-valid accept sample per event;
// the reject sample is that same payload plus an unknown field, which every strictObject
// payload must refuse.
const UUID_A = '11111111-2222-4333-8444-555555555555';
const UUID_B = '22222222-3333-4444-8555-666666666666';

const NEW_EVENT_CASES: { type: string; accept: Record<string, unknown> }[] = [
  { type: 'character.renamed', accept: { name: 'Ivan' } },
  { type: 'character.appearance_set', accept: { description: 'A tall half-elf ranger.', eyes: 'green' } },
  { type: 'character.gender_set', accept: { grammaticalGender: 'feminine' } },
  { type: 'character.archived', accept: {} },
  { type: 'character.restored', accept: {} },
  { type: 'character.owner_transferred', accept: { toUserId: 'usr_2' } },
  { type: 'character.campaign_joined', accept: { campaignId: UUID_A } },
  { type: 'character.campaign_left', accept: { campaignId: UUID_A } },
  { type: 'decision.cleared', accept: { choiceId: 'core-mini:class/fighter@1/fighting-style' } },
  { type: 'level.gained', accept: { classId: 'core-mini:class/fighter', level: 1 } },
  { type: 'level.granted', accept: {} },
  { type: 'xp.awarded', accept: { amount: 300 } },
  { type: 'hp.changed', accept: { delta: -5, kind: 'damage' } },
  { type: 'hit_dice.spent', accept: { classId: 'core-mini:class/fighter', count: 1 } },
  { type: 'hit_dice.regained', accept: { classId: 'core-mini:class/fighter', count: 1 } },
  { type: 'death_save.recorded', accept: { result: 'success' } },
  { type: 'stabilized', accept: {} },
  { type: 'slot.spent', accept: { level: 3 } },
  { type: 'slot.restored', accept: { level: 3 } },
  { type: 'resource.spent', accept: { resourceId: 'second-wind' } },
  { type: 'resource.restored', accept: { resourceId: 'second-wind' } },
  { type: 'spell.prepared', accept: { spellId: 'core-mini:spell/fireball', classId: 'core-mini:class/wizard' } },
  { type: 'spell.unprepared', accept: { spellId: 'core-mini:spell/fireball', classId: 'core-mini:class/wizard' } },
  {
    type: 'spell.learned',
    accept: { spellId: 'core-mini:spell/fireball', classId: 'core-mini:class/wizard', source: 'levelUp' },
  },
  {
    type: 'spell.forgotten',
    accept: { spellId: 'core-mini:spell/fireball', classId: 'core-mini:class/wizard', source: 'levelUp' },
  },
  { type: 'spell.cast', accept: { spellId: 'core-mini:spell/fireball', level: 3 } },
  { type: 'concentration.started', accept: { spellId: 'core-mini:spell/fireball' } },
  { type: 'concentration.ended', accept: {} },
  { type: 'condition.added', accept: { conditionId: 'core-mini:condition/prone' } },
  { type: 'condition.removed', accept: { conditionId: 'core-mini:condition/prone' } },
  { type: 'item.added', accept: { instanceId: UUID_A, itemId: 'core-mini:item/longsword', qty: 1 } },
  { type: 'item.removed', accept: { instanceId: UUID_A, qty: 1 } },
  { type: 'item.equipped', accept: { instanceId: UUID_A } },
  { type: 'item.unequipped', accept: { instanceId: UUID_A } },
  { type: 'item.attuned', accept: { instanceId: UUID_A } },
  { type: 'item.unattuned', accept: { instanceId: UUID_A } },
  { type: 'item.updated', accept: { instanceId: UUID_A, qty: 2 } },
  { type: 'currency.changed', accept: { gp: 10, cp: -5 } },
  { type: 'rest.taken', accept: { kind: 'long' } },
  { type: 'inspiration.changed', accept: { value: true } },
  { type: 'note.added', accept: { id: UUID_B, title: 'Session 1', body: 'Met the party.' } },
  { type: 'note.updated', accept: { id: UUID_B, body: 'Updated note.' } },
  { type: 'note.removed', accept: { id: UUID_B } },
  {
    type: 'portrait.set',
    accept: { hash: `sha256:${'0'.repeat(64)}`, thumbHash: 'abc123', mime: 'image/png', w: 256, h: 256 },
  },
  { type: 'portrait.cleared', accept: {} },
  { type: 'override.applied', accept: { path: 'ac', value: 17, reason: 'DM ruling' } },
  { type: 'event.reverted', accept: { targetId: UUID_A, reason: 'undo' } },
  { type: 'history.compacted', accept: { throughSeq: 10, facts: {} } },
];

describe.each(NEW_EVENT_CASES)('parseEvent $type', ({ type, accept }) => {
  it('accepts a schema-valid payload', () => {
    const r = parseEvent({ ...base, type, payload: accept });
    expect(r.ok, JSON.stringify(r)).toBe(true);
  });

  it('rejects a payload with an unknown field', () => {
    const r = parseEvent({ ...base, type, payload: { ...accept, unexpectedField: true } });
    expect(r.ok).toBe(false);
  });
});

// Scoped to character.ts's OWN registries (not the merged `EVENT_PAYLOADS`/`EVENT_ACTORS` from
// index.ts, which additionally carries the campaign-stream catalog as of plan-9 Task 1) — this
// describe block is specifically about the Phase-1 character-stream catalog staying complete.
describe('the complete Phase-1 character event catalog', () => {
  const CHARACTER_EVENT_COUNT = 51; // 3 phase-1a events above + 48 NEW_EVENT_CASES

  it('registers a payload schema for every catalog event', () => {
    expect(Object.keys(CHARACTER_EVENT_PAYLOADS)).toHaveLength(CHARACTER_EVENT_COUNT);
  });

  it('declares an actor list for every catalog event', () => {
    expect(Object.keys(CHARACTER_EVENT_ACTORS)).toHaveLength(CHARACTER_EVENT_COUNT);
  });

  it('gives every EVENT_PAYLOADS key a matching EVENT_ACTORS entry', () => {
    for (const key of Object.keys(CHARACTER_EVENT_PAYLOADS)) {
      const type = key.slice(0, key.lastIndexOf('@'));
      expect(CHARACTER_EVENT_ACTORS[type], `missing EVENT_ACTORS entry for ${type}`).toBeDefined();
    }
  });
});
