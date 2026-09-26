import type { Event } from '@hk/protocol';
import { type CampaignState, projectCampaign } from './campaign-projection';

const STREAM = 'camp:00000000-0000-4000-8000-000000000001';

let nextEventId = 1;

/** Builds a minimal, valid `Event` envelope for `STREAM`. `seq` defaults to the call order (1, 2,
 * 3, ...) within a single test file run via an auto-incrementing counter reset per describe block
 * is NOT done — tests instead pass `seq` explicitly whenever order matters, and omit it (pending)
 * when it doesn't. `id` is always unique and stable per call so log-entry `eventId` assertions can
 * pin an exact value. */
function mkEvent(
  type: string,
  payload: unknown,
  overrides: Partial<Pick<Event, 'seq' | 'actor' | 'id' | 'ts'>> = {},
): Event {
  const id = overrides.id ?? `00000000-0000-4000-8000-${String(nextEventId++).padStart(12, '0')}`;
  return {
    id,
    stream: STREAM,
    ts: overrides.ts ?? '2026-09-26T00:00:00.000Z',
    actor: overrides.actor ?? { userId: 'usr_dm', deviceId: 'dev_1', role: 'dm' },
    type,
    v: 1,
    payload,
    ...(overrides.seq !== undefined ? { seq: overrides.seq } : {}),
  };
}

describe('projectCampaign', () => {
  it('returns an empty-default state for an empty event list', () => {
    const state = projectCampaign([]);

    expect(state.name).toBe('');
    expect(state.system).toBe('');
    expect(state.settings).toBeNull();
    expect(state.joinCode).toBeUndefined();
    expect(state.members.size).toBe(0);
    expect(state.roster.size).toBe(0);
    expect(state.packs.size).toBe(0);
    expect(state.overviews.size).toBe(0);
    expect(state.session).toEqual({ active: false });
    expect(state.log).toEqual([]);
    expect(state.dmNotes.size).toBe(0);
    expect(state.archived).toBe(false);
  });

  describe('campaign lifecycle', () => {
    it('campaign.created sets name and system', () => {
      const events = [
        mkEvent(
          'campaign.created',
          {
            name: 'Curse of Strahd',
            system: 'srd-5e-2024',
            corePack: { id: 'srd-5e-2024', version: '1.0.0' },
          },
          { seq: 1 },
        ),
      ];

      const state = projectCampaign(events);

      expect(state.name).toBe('Curse of Strahd');
      expect(state.system).toBe('srd-5e-2024');
    });

    it('campaign.renamed overwrites name only', () => {
      const events = [
        mkEvent(
          'campaign.created',
          { name: 'Old Name', system: 'srd-5e-2024', corePack: { id: 'p', version: '1.0.0' } },
          { seq: 1 },
        ),
        mkEvent('campaign.renamed', { name: 'New Name' }, { seq: 2 }),
      ];

      const state = projectCampaign(events);

      expect(state.name).toBe('New Name');
      expect(state.system).toBe('srd-5e-2024');
    });

    it('campaign.settings_changed replaces settings wholesale', () => {
      const settings = mkSettings();
      const events = [mkEvent('campaign.settings_changed', { settings }, { seq: 1 })];

      const state = projectCampaign(events);

      expect(state.settings).toEqual(settings);
    });

    it('campaign.join_code_rotated sets joinCode', () => {
      const events = [mkEvent('campaign.join_code_rotated', { joinCode: '7QX4-M2HN' }, { seq: 1 })];

      const state = projectCampaign(events);

      expect(state.joinCode).toBe('7QX4-M2HN');
    });

    it('campaign.archived sets archived: true', () => {
      const events = [mkEvent('campaign.archived', {}, { seq: 1 })];

      const state = projectCampaign(events);

      expect(state.archived).toBe(true);
    });
  });

  describe('packs', () => {
    it('pack.enabled adds a pack keyed by packId', () => {
      const events = [
        mkEvent(
          'pack.enabled',
          { packId: 'homebrew-pack', version: '1.0.0', sha256: 'a'.repeat(64) },
          { seq: 1 },
        ),
      ];

      const state = projectCampaign(events);

      expect(state.packs.get('homebrew-pack')).toEqual({
        version: '1.0.0',
        sha256: 'a'.repeat(64),
      });
    });

    it('pack.disabled removes the pack', () => {
      const events = [
        mkEvent(
          'pack.enabled',
          { packId: 'homebrew-pack', version: '1.0.0', sha256: 'a'.repeat(64) },
          { seq: 1 },
        ),
        mkEvent(
          'pack.disabled',
          { packId: 'homebrew-pack', version: '1.0.0', sha256: 'a'.repeat(64) },
          { seq: 2 },
        ),
      ];

      const state = projectCampaign(events);

      expect(state.packs.has('homebrew-pack')).toBe(false);
    });

    it('re-enabling with a new version overwrites the entry', () => {
      const events = [
        mkEvent(
          'pack.enabled',
          { packId: 'homebrew-pack', version: '1.0.0', sha256: 'a'.repeat(64) },
          { seq: 1 },
        ),
        mkEvent(
          'pack.enabled',
          { packId: 'homebrew-pack', version: '2.0.0', sha256: 'b'.repeat(64) },
          { seq: 2 },
        ),
      ];

      const state = projectCampaign(events);

      expect(state.packs.get('homebrew-pack')).toEqual({
        version: '2.0.0',
        sha256: 'b'.repeat(64),
      });
    });
  });

  describe('members', () => {
    it('member.joined adds a member with removed: false', () => {
      const events = [
        mkEvent(
          'member.joined',
          { userId: 'usr_a', displayName: 'Alice', role: 'player' },
          { seq: 1 },
        ),
      ];

      const state = projectCampaign(events);

      expect(state.members.get('usr_a')).toEqual({
        displayName: 'Alice',
        role: 'player',
        removed: false,
      });
    });

    it('member.removed flags the row removed: true, entry persists', () => {
      const events = [
        mkEvent(
          'member.joined',
          { userId: 'usr_a', displayName: 'Alice', role: 'player' },
          { seq: 1 },
        ),
        mkEvent(
          'member.removed',
          { userId: 'usr_a', displayName: 'Alice', role: 'player' },
          { seq: 2, actor: { userId: 'usr_dm', deviceId: 'dev_1', role: 'dm' } },
        ),
      ];

      const state = projectCampaign(events);

      expect(state.members.get('usr_a')).toEqual({
        displayName: 'Alice',
        role: 'player',
        removed: true,
      });
      expect(state.members.has('usr_a')).toBe(true);
    });

    it('member.left flags the row removed: true too (same field, no separate `left` field on MemberEntry), entry persists', () => {
      const events = [
        mkEvent(
          'member.joined',
          { userId: 'usr_a', displayName: 'Alice', role: 'player' },
          { seq: 1 },
        ),
        mkEvent(
          'member.left',
          { userId: 'usr_a', displayName: 'Alice', role: 'player' },
          { seq: 2, actor: { userId: 'usr_a', deviceId: 'dev_1', role: 'member' } },
        ),
      ];

      const state = projectCampaign(events);

      expect(state.members.get('usr_a')).toEqual({
        displayName: 'Alice',
        role: 'player',
        removed: true,
      });
    });

    it('member.joined after member.left reactivates the row (removed: false again)', () => {
      const events = [
        mkEvent(
          'member.joined',
          { userId: 'usr_a', displayName: 'Alice', role: 'player' },
          { seq: 1 },
        ),
        mkEvent(
          'member.left',
          { userId: 'usr_a', displayName: 'Alice', role: 'player' },
          { seq: 2 },
        ),
        mkEvent(
          'member.joined',
          { userId: 'usr_a', displayName: 'Alice', role: 'player' },
          { seq: 3 },
        ),
      ];

      const state = projectCampaign(events);

      expect(state.members.get('usr_a')?.removed).toBe(false);
    });

    it('member.renamed targets the AUTHORING actor (envelope actor.userId), not a payload field', () => {
      const events = [
        mkEvent(
          'member.joined',
          { userId: 'usr_a', displayName: 'Alice', role: 'player' },
          { seq: 1 },
        ),
        mkEvent(
          'member.renamed',
          { displayName: 'Alicia' },
          { seq: 2, actor: { userId: 'usr_a', deviceId: 'dev_1', role: 'member' } },
        ),
      ];

      const state = projectCampaign(events);

      expect(state.members.get('usr_a')).toEqual({
        displayName: 'Alicia',
        role: 'player',
        removed: false,
      });
    });

    it('member.renamed for an unknown actor is a no-op (no member row materializes)', () => {
      const events = [
        mkEvent(
          'member.renamed',
          { displayName: 'Ghost' },
          { seq: 1, actor: { userId: 'usr_ghost', deviceId: 'dev_1', role: 'member' } },
        ),
      ];

      const state = projectCampaign(events);

      expect(state.members.has('usr_ghost')).toBe(false);
    });
  });

  describe('roster (character <-> campaign linkage)', () => {
    it('campaign.character_joined adds a roster entry with left: false', () => {
      const events = [
        mkEvent(
          'campaign.character_joined',
          { characterId: '00000000-0000-4000-8000-000000000099', ownerId: 'usr_a', name: 'Elora' },
          { seq: 1 },
        ),
      ];

      const state = projectCampaign(events);

      expect(state.roster.get('00000000-0000-4000-8000-000000000099')).toEqual({
        ownerId: 'usr_a',
        name: 'Elora',
        left: false,
      });
    });

    it('campaign.character_left flags left: true, entry PERSISTS (visible until DM unlinks)', () => {
      const events = [
        mkEvent(
          'campaign.character_joined',
          { characterId: '00000000-0000-4000-8000-000000000099', ownerId: 'usr_a', name: 'Elora' },
          { seq: 1 },
        ),
        mkEvent(
          'campaign.character_left',
          { characterId: '00000000-0000-4000-8000-000000000099', ownerId: 'usr_a', name: 'Elora' },
          { seq: 2 },
        ),
      ];

      const state = projectCampaign(events);

      expect(state.roster.get('00000000-0000-4000-8000-000000000099')).toEqual({
        ownerId: 'usr_a',
        name: 'Elora',
        left: true,
      });
      expect(state.roster.has('00000000-0000-4000-8000-000000000099')).toBe(true);
    });
  });

  describe('party.overview_updated', () => {
    it('sets the overview for characterId, last-write-wins by seq order', () => {
      const overviewA = mkOverview({ hp: 10 });
      const overviewB = mkOverview({ hp: 4 });
      const events = [
        mkEvent(
          'party.overview_updated',
          { characterId: '00000000-0000-4000-8000-000000000099', overview: overviewA },
          { seq: 1 },
        ),
        mkEvent(
          'party.overview_updated',
          { characterId: '00000000-0000-4000-8000-000000000099', overview: overviewB },
          { seq: 2 },
        ),
      ];

      const state = projectCampaign(events);

      expect(state.overviews.get('00000000-0000-4000-8000-000000000099')).toEqual(overviewB);
    });
  });

  describe('sessions', () => {
    it('session.started sets active: true, startedAt: eventId, and title', () => {
      const events = [
        mkEvent('session.started', { title: 'Session 1' }, { seq: 1, id: 'evt-start-1' }),
      ];

      const state = projectCampaign(events);

      expect(state.session).toEqual({ active: true, startedAt: 'evt-start-1', title: 'Session 1' });
    });

    it('session.ended sets active: false and clears startedAt', () => {
      const events = [
        mkEvent('session.started', { title: 'Session 1' }, { seq: 1, id: 'evt-start-1' }),
        mkEvent('session.ended', {}, { seq: 2, id: 'evt-end-1' }),
      ];

      const state = projectCampaign(events);

      expect(state.session).toEqual({ active: false, title: undefined });
      expect(state.session.startedAt).toBeUndefined();
    });
  });

  describe('log (rolls, chat, session markers, in seq order)', () => {
    it('roll.logged appends a `roll` LogEntry carrying actorUserId and the full payload', () => {
      const rollPayload = {
        label: 'Attack roll',
        formula: '1d20+5',
        results: [{ die: 'd20', value: 14 }],
        total: 19,
        kind: 'attack' as const,
        visibility: 'everyone' as const,
      };
      const events = [
        mkEvent('roll.logged', rollPayload, {
          seq: 1,
          id: 'evt-roll-1',
          actor: { userId: 'usr_a', deviceId: 'dev_1', role: 'member' },
        }),
      ];

      const state = projectCampaign(events);

      expect(state.log).toEqual([
        { kind: 'roll', seq: 1, eventId: 'evt-roll-1', actorUserId: 'usr_a', payload: rollPayload },
      ]);
    });

    it('chat.message appends a `chat` LogEntry carrying actorUserId and the full payload', () => {
      const chatPayload = { text: 'Hello party', visibility: 'everyone' as const };
      const events = [
        mkEvent('chat.message', chatPayload, {
          seq: 1,
          id: 'evt-chat-1',
          actor: { userId: 'usr_a', deviceId: 'dev_1', role: 'member' },
        }),
      ];

      const state = projectCampaign(events);

      expect(state.log).toEqual([
        { kind: 'chat', seq: 1, eventId: 'evt-chat-1', actorUserId: 'usr_a', payload: chatPayload },
      ]);
    });

    it('session.started/ended append session-start/session-end markers', () => {
      const events = [
        mkEvent('session.started', { title: 'Session 1' }, { seq: 1, id: 'evt-start-1' }),
        mkEvent('session.ended', {}, { seq: 2, id: 'evt-end-1' }),
      ];

      const state = projectCampaign(events);

      expect(state.log).toEqual([
        { kind: 'session-start', seq: 1, eventId: 'evt-start-1', title: 'Session 1' },
        { kind: 'session-end', seq: 2, eventId: 'evt-end-1', title: undefined },
      ]);
    });

    it('interleaved families land in the log in seq order', () => {
      const events = [
        mkEvent('session.started', {}, { seq: 1, id: 'evt-1' }),
        mkEvent(
          'chat.message',
          { text: 'go go go', visibility: 'everyone' as const },
          { seq: 2, id: 'evt-2', actor: { userId: 'usr_a', deviceId: 'd', role: 'member' } },
        ),
        mkEvent(
          'roll.logged',
          {
            label: 'Save',
            formula: '1d20',
            results: [{ die: 'd20', value: 11 }],
            total: 11,
            kind: 'save' as const,
            visibility: 'everyone' as const,
          },
          { seq: 3, id: 'evt-3', actor: { userId: 'usr_a', deviceId: 'd', role: 'member' } },
        ),
      ];

      const state = projectCampaign(events);

      expect(state.log.map((entry) => entry.eventId)).toEqual(['evt-1', 'evt-2', 'evt-3']);
      expect(state.log.map((entry) => entry.kind)).toEqual(['session-start', 'chat', 'roll']);
    });
  });

  describe('dm notes', () => {
    const noteId = '00000000-0000-4000-8000-0000000000aa';

    it('dm.note_added inserts a note', () => {
      const events = [
        mkEvent(
          'dm.note_added',
          { id: noteId, title: 'Secret', body: 'The lich is here' },
          { seq: 1 },
        ),
      ];

      const state = projectCampaign(events);

      expect(state.dmNotes.get(noteId)).toEqual({ title: 'Secret', body: 'The lich is here' });
    });

    it('dm.note_updated replaces the note wholesale', () => {
      const events = [
        mkEvent('dm.note_added', { id: noteId, title: 'Secret', body: 'draft' }, { seq: 1 }),
        mkEvent('dm.note_updated', { id: noteId, title: 'Secret', body: 'final' }, { seq: 2 }),
      ];

      const state = projectCampaign(events);

      expect(state.dmNotes.get(noteId)).toEqual({ title: 'Secret', body: 'final' });
    });

    it('dm.note_removed deletes the note', () => {
      const events = [
        mkEvent('dm.note_added', { id: noteId, title: 'Secret', body: 'draft' }, { seq: 1 }),
        mkEvent('dm.note_removed', { id: noteId }, { seq: 2 }),
      ];

      const state = projectCampaign(events);

      expect(state.dmNotes.has(noteId)).toBe(false);
    });
  });

  describe('unknown/future event types', () => {
    it('are skipped silently, without throwing, and do not affect other state', () => {
      const events = [
        mkEvent('campaign.renamed', { name: 'Kept Name' }, { seq: 1 }),
        mkEvent('campaign.some_future_type', { anything: 'goes' }, { seq: 2 }),
      ];

      expect(() => projectCampaign(events)).not.toThrow();
      const state = projectCampaign(events);
      expect(state.name).toBe('Kept Name');
      expect(state.log).toEqual([]);
    });
  });

  describe('pending (seq-less) events', () => {
    it('are folded after every committed event, in their given array order, regardless of array position', () => {
      // Pending event listed FIRST in the array, committed events after — the fold must still
      // apply committed (by seq) before pending (array order), per doc-03's
      // `facts = reduce(committed ++ pending)` convention.
      const events: Event[] = [
        mkEvent('campaign.renamed', { name: 'Pending Name' }, {}), // no seq: pending
        mkEvent(
          'campaign.created',
          {
            name: 'Committed Name',
            system: 'srd-5e-2024',
            corePack: { id: 'p', version: '1.0.0' },
          },
          { seq: 1 },
        ),
      ];

      const state = projectCampaign(events);

      // Committed (seq 1) applies first -> name = 'Committed Name'; pending applies AFTER -> overwritten.
      expect(state.name).toBe('Pending Name');
    });

    it('multiple pending events keep their relative array order after all committed ones', () => {
      const events: Event[] = [
        mkEvent('campaign.renamed', { name: 'First Pending' }, {}),
        mkEvent('campaign.renamed', { name: 'Second Pending' }, {}),
        mkEvent(
          'campaign.created',
          { name: 'Committed', system: 'srd-5e-2024', corePack: { id: 'p', version: '1.0.0' } },
          { seq: 1 },
        ),
      ];

      const state = projectCampaign(events);

      expect(state.name).toBe('Second Pending');
    });

    it('a pending roll.logged lands at the tail of the log, after committed entries', () => {
      const rollPayload = {
        label: 'Pending roll',
        formula: '1d20',
        results: [{ die: 'd20', value: 7 }],
        total: 7,
        kind: 'check' as const,
        visibility: 'everyone' as const,
      };
      const events: Event[] = [
        mkEvent('roll.logged', rollPayload, {
          id: 'evt-pending',
          actor: { userId: 'usr_a', deviceId: 'd', role: 'member' },
        }), // pending: no seq
        mkEvent('session.started', {}, { seq: 1, id: 'evt-committed' }),
      ];

      const state = projectCampaign(events);

      expect(state.log.map((entry) => entry.eventId)).toEqual(['evt-committed', 'evt-pending']);
    });
  });

  describe('full lifecycle scenario', () => {
    it('create -> settings -> join members -> characters -> session -> rolls/chat -> removal -> unlink', () => {
      const settings = mkSettings();
      const characterId = '00000000-0000-4000-8000-0000000000c1';
      const events: Event[] = [
        mkEvent(
          'campaign.created',
          {
            name: 'Curse of Strahd',
            system: 'srd-5e-2024',
            corePack: { id: 'srd-5e-2024', version: '1.0.0' },
          },
          { seq: 1 },
        ),
        mkEvent('campaign.settings_changed', { settings }, { seq: 2 }),
        mkEvent(
          'member.joined',
          { userId: 'usr_dm', displayName: 'The DM', role: 'dm' },
          { seq: 3 },
        ),
        mkEvent(
          'member.joined',
          { userId: 'usr_a', displayName: 'Alice', role: 'player' },
          { seq: 4, actor: { userId: 'usr_a', deviceId: 'd', role: 'member' } },
        ),
        mkEvent(
          'campaign.character_joined',
          { characterId, ownerId: 'usr_a', name: 'Elora' },
          { seq: 5, actor: { userId: 'usr_a', deviceId: 'd', role: 'member' } },
        ),
        mkEvent('session.started', { title: 'Session 1' }, { seq: 6, id: 'evt-session-start' }),
        mkEvent(
          'roll.logged',
          {
            label: 'Initiative',
            formula: '1d20+2',
            results: [{ die: 'd20', value: 15 }],
            total: 17,
            kind: 'check' as const,
            visibility: 'everyone' as const,
          },
          { seq: 7, id: 'evt-roll', actor: { userId: 'usr_a', deviceId: 'd', role: 'member' } },
        ),
        mkEvent(
          'chat.message',
          { text: 'Rolling initiative!', visibility: 'everyone' as const },
          { seq: 8, id: 'evt-chat', actor: { userId: 'usr_a', deviceId: 'd', role: 'member' } },
        ),
        mkEvent('session.ended', {}, { seq: 9, id: 'evt-session-end' }),
        mkEvent(
          'member.removed',
          { userId: 'usr_a', displayName: 'Alice', role: 'player' },
          { seq: 10 },
        ),
        mkEvent(
          'campaign.character_left',
          { characterId, ownerId: 'usr_a', name: 'Elora' },
          { seq: 11 },
        ),
      ];

      const state = projectCampaign(events);

      expect(state.name).toBe('Curse of Strahd');
      expect(state.system).toBe('srd-5e-2024');
      expect(state.settings).toEqual(settings);
      expect(state.archived).toBe(false);
      expect(state.members.get('usr_dm')).toEqual({
        displayName: 'The DM',
        role: 'dm',
        removed: false,
      });
      expect(state.members.get('usr_a')).toEqual({
        displayName: 'Alice',
        role: 'player',
        removed: true,
      });
      expect(state.members.has('usr_a')).toBe(true); // persists per the flagging design
      expect(state.roster.get(characterId)).toEqual({
        ownerId: 'usr_a',
        name: 'Elora',
        left: true,
      });
      expect(state.roster.has(characterId)).toBe(true); // persists until DM unlinks
      expect(state.session).toEqual({ active: false, title: undefined });
      expect(state.log.map((e) => e.kind)).toEqual([
        'session-start',
        'roll',
        'chat',
        'session-end',
      ]);
      expect(state.log.map((e) => e.eventId)).toEqual([
        'evt-session-start',
        'evt-roll',
        'evt-chat',
        'evt-session-end',
      ]);
    });
  });

  it('never mutates the input array (defensive: caller may reuse it)', () => {
    const events = [mkEvent('campaign.renamed', { name: 'X' }, { seq: 1 })];
    const snapshot = JSON.parse(JSON.stringify(events)) as unknown;

    projectCampaign(events);

    expect(JSON.parse(JSON.stringify(events))).toEqual(snapshot);
  });

  it('is deterministic: same input produces an equal (deep) state on repeated calls', () => {
    const events = [
      mkEvent(
        'campaign.created',
        { name: 'X', system: 'srd-5e-2024', corePack: { id: 'p', version: '1.0.0' } },
        { seq: 1 },
      ),
      mkEvent(
        'member.joined',
        { userId: 'usr_a', displayName: 'Alice', role: 'player' },
        { seq: 2 },
      ),
    ];

    const a = projectCampaign(events);
    const b = projectCampaign(events);

    expect(a).toEqual(b);
  });
});

function mkSettings() {
  return {
    system: 'srd-5e-2024',
    packs: [{ id: 'srd-5e-2024', version: '1.0.0' }],
    houseRules: {
      strictValidation: true,
      allowOverrides: false,
      editOutsideSession: 'free' as const,
      xpMode: 'xp' as const,
      hpOnLevelUp: 'average' as const,
      encumbrance: 'off' as const,
      attunementMax: 3,
      startingLevel: 1,
    },
    visibility: {
      partySheets: 'overview' as const,
      rolls: 'everyone' as const,
      allowPrivateRolls: true,
    },
    join: { open: true, requireApproval: false },
  };
}

function mkOverview(
  overrides: Partial<CampaignState['overviews'] extends Map<string, infer V> ? V : never> = {},
) {
  return {
    hp: 8,
    hpMax: 10,
    temp: 0,
    ac: 15,
    level: 1,
    classes: [{ classId: 'fighter', level: 1 }],
    conditions: [],
    concentration: false,
    passivePerception: 12,
    ...overrides,
  };
}
