import type { Event } from '@hk/protocol';
import { describe, expect, it } from 'vitest';
import { reduce } from '../src/reduce/reducer.ts';

const stream = 'char:2b7a1f22-1111-4c9d-a8f2-0a1b2c3d4e5f';
const id = (n: number) => `018f6d2e-7b1a-7c3d-9e4f-${String(n).padStart(12, '0')}`;
const ev = (n: number, type: string, payload: unknown): Event => ({
  id: id(n),
  stream,
  seq: n,
  ts: '2026-08-30T12:00:00.000Z',
  actor: { userId: 'u', deviceId: 'd', role: 'owner' },
  type,
  v: 1,
  payload,
});

const created = ev(1, 'character.created', {
  name: 'Ivan',
  system: 'mini',
  corePack: { id: 'core-mini', version: '1.0.0' },
  engineVersion: '0.1.0',
  grammaticalGender: 'masculine',
});

describe('identity handlers: not-created skip (guard table)', () => {
  const guarded: [type: string, payload: unknown][] = [
    ['character.renamed', { name: 'X' }],
    ['character.appearance_set', { age: '1' }],
    ['character.gender_set', { grammaticalGender: 'feminine' }],
    ['character.archived', {}],
    ['character.restored', {}],
    ['decision.made', { choiceId: 'c', selection: ['x'] }],
    ['decision.cleared', { choiceId: 'c' }],
    ['portrait.set', { hash: 'h', thumbHash: 't', mime: 'image/png', w: 1, h: 1 }],
    ['portrait.cleared', {}],
    ['note.added', { id: id(1), title: 'T', body: 'B' }],
    ['note.updated', { id: id(1), title: 'T2' }],
    ['note.removed', { id: id(1) }],
  ];

  it.each(guarded)('%s is skipped with reason not-created before character.created', (type, payload) => {
    const f = reduce([ev(2, type, payload)]);
    expect(f.skipped).toEqual([{ eventId: id(2), reason: 'not-created' }]);
    expect(f.created).toBe(false);
  });
});

describe('identity handlers: happy path', () => {
  it('character.renamed sets name', () => {
    const f = reduce([created, ev(2, 'character.renamed', { name: 'Ivanka' })]);
    expect(f.name).toBe('Ivanka');
    expect(f.skipped).toEqual([]);
  });

  it('character.gender_set sets grammaticalGender', () => {
    const f = reduce([created, ev(2, 'character.gender_set', { grammaticalGender: 'feminine' })]);
    expect(f.grammaticalGender).toBe('feminine');
  });

  it('archived flag round-trip: character.archived then character.restored', () => {
    const archived = reduce([created, ev(2, 'character.archived', {})]);
    expect(archived.archived).toBe(true);
    const restored = reduce([created, ev(2, 'character.archived', {}), ev(3, 'character.restored', {})]);
    expect(restored.archived).toBe(false);
  });

  it('decision.made stores the selection and, when present, the context for the timeline', () => {
    const decided = ev(2, 'decision.made', {
      choiceId: 'core-mini:class/fighter@1/fighting-style',
      selection: ['core-mini:feat/defense'],
      context: { method: 'standardArray', scores: [15, 14, 13, 12, 10, 8] },
    });
    const f = reduce([created, decided]);
    expect(f.decisions['core-mini:class/fighter@1/fighting-style']).toEqual(['core-mini:feat/defense']);
    expect(f.decisionContexts['core-mini:class/fighter@1/fighting-style']).toEqual({
      method: 'standardArray',
      scores: [15, 14, 13, 12, 10, 8],
    });
  });

  it('decision.made without a context leaves decisionContexts untouched', () => {
    const decided = ev(2, 'decision.made', { choiceId: 'a:b/c@1/d', selection: ['x'] });
    const f = reduce([created, decided]);
    expect(f.decisionContexts).toEqual({});
  });

  it('decision.cleared deletes both the decision and its context', () => {
    const choiceId = 'core-mini:class/fighter@1/fighting-style';
    const decided = ev(2, 'decision.made', { choiceId, selection: ['x'], context: { a: 1 } });
    const cleared = ev(3, 'decision.cleared', { choiceId });
    const f = reduce([created, decided, cleared]);
    expect(f.decisions[choiceId]).toBeUndefined();
    expect(f.decisionContexts[choiceId]).toBeUndefined();
  });

  it('portrait.set stores hash + thumbHash, portrait.cleared removes it', () => {
    const set = ev(2, 'portrait.set', { hash: 'sha256-abc', thumbHash: 'th', mime: 'image/png', w: 10, h: 10 });
    const withPortrait = reduce([created, set]);
    expect(withPortrait.portrait).toEqual({ hash: 'sha256-abc', thumbHash: 'th' });
    const cleared = ev(3, 'portrait.cleared', {});
    const withoutPortrait = reduce([created, set, cleared]);
    expect(withoutPortrait.portrait).toBeUndefined();
  });

  it('note.added, note.updated by id (partial merge), note.removed', () => {
    const noteId = id(900);
    const otherId = id(901);
    const added = ev(2, 'note.added', { id: noteId, title: 'T', body: 'B' });
    const otherAdded = ev(3, 'note.added', { id: otherId, title: 'Other', body: 'X' });
    // Only `body` is sent: `title` on the target note must be left untouched, and the other
    // note (different id) must be untouched entirely.
    const updated = ev(4, 'note.updated', { id: noteId, body: 'B2' });
    const afterUpdate = reduce([created, added, otherAdded, updated]);
    expect(afterUpdate.notes).toEqual([
      { id: noteId, title: 'T', body: 'B2' },
      { id: otherId, title: 'Other', body: 'X' },
    ]);
    const removed = ev(5, 'note.removed', { id: noteId });
    const afterRemove = reduce([created, added, otherAdded, updated, removed]);
    expect(afterRemove.notes).toEqual([{ id: otherId, title: 'Other', body: 'X' }]);
  });

  it('character.appearance_set merges only the fields present, keeping unspecified fields', () => {
    const first = ev(2, 'character.appearance_set', { age: '25', eyes: 'blue' });
    const second = ev(3, 'character.appearance_set', { eyes: 'green', hair: 'black' });
    const f = reduce([created, first, second]);
    expect(f.appearance).toEqual({ age: '25', eyes: 'green', hair: 'black' });
  });

  it('no-op skips: multiplayer/campaign-shaped events are not-applicable-solo regardless of creation', () => {
    const events = [
      ev(1, 'character.owner_transferred', { toUserId: 'u2' }),
      ev(2, 'character.campaign_joined', { campaignId: id(950) }),
      ev(3, 'character.campaign_left', { campaignId: id(950) }),
      ev(4, 'level.granted', { count: 1 }),
      ev(5, 'history.compacted', { throughSeq: 1, facts: {} }),
    ];
    const f = reduce(events);
    expect(f.skipped.map((s) => s.reason)).toEqual(Array(5).fill('not-applicable-solo'));

    // Applies even after creation, and doesn't touch created/other fields. Distinct ids from
    // `created` (id 1) — reusing an id would collide and read as a 'duplicate' skip instead.
    const eventsAfterCreated = [
      ev(2, 'character.owner_transferred', { toUserId: 'u2' }),
      ev(3, 'character.campaign_joined', { campaignId: id(950) }),
      ev(4, 'character.campaign_left', { campaignId: id(950) }),
      ev(5, 'level.granted', { count: 1 }),
      ev(6, 'history.compacted', { throughSeq: 1, facts: {} }),
    ];
    const afterCreated = reduce([created, ...eventsAfterCreated]);
    expect(afterCreated.skipped.map((s) => s.reason)).toEqual(Array(5).fill('not-applicable-solo'));
    expect(afterCreated.name).toBe('Ivan');
  });
});
