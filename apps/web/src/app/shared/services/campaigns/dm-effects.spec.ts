import {
  conditionDraft,
  damageDraft,
  healDraft,
  inspirationDraft,
  itemGrantDraft,
  levelGrantedDraft,
  overrideAppliedDraft,
  tempHpDraft,
  xpAwardedDraft,
  type HpSnapshot,
} from './dm-effects';

describe('dm-effects (DM effects panel draft builders)', () => {
  describe('damageDraft', () => {
    it('sends a NEGATIVE delta clamped to reachable HP (current + temp)', () => {
      const hp: HpSnapshot = { current: 10, max: 20, temp: 3 };
      expect(damageDraft(5, hp)).toEqual([
        { type: 'hp.changed', v: 1, payload: { delta: -5, kind: 'damage' } },
      ]);
    });

    it('clamps an over-large amount to current + temp (never past 0 reachable)', () => {
      const hp: HpSnapshot = { current: 4, max: 20, temp: 2 };
      expect(damageDraft(99, hp)).toEqual([
        { type: 'hp.changed', v: 1, payload: { delta: -6, kind: 'damage' } },
      ]);
    });

    it('a negative/zero typed amount never produces a positive reachable delta', () => {
      const hp: HpSnapshot = { current: 10, max: 20, temp: 0 };
      expect(damageDraft(-5, hp)).toEqual([
        { type: 'hp.changed', v: 1, payload: { delta: 0, kind: 'damage' } },
      ]);
    });

    it('prepends a resolving hp.changed{kind:set} when currentWasMax (the long-rest sentinel)', () => {
      const hp: HpSnapshot = { current: 28, max: 28, temp: 0, currentWasMax: true };
      expect(damageDraft(10, hp)).toEqual([
        { type: 'hp.changed', v: 1, payload: { delta: 28, kind: 'set' } },
        { type: 'hp.changed', v: 1, payload: { delta: -10, kind: 'damage' } },
      ]);
    });
  });

  describe('healDraft', () => {
    it('sends a POSITIVE delta clamped to headroom below max', () => {
      const hp: HpSnapshot = { current: 15, max: 20, temp: 0 };
      expect(healDraft(3, hp)).toEqual([
        { type: 'hp.changed', v: 1, payload: { delta: 3, kind: 'heal' } },
      ]);
    });

    it('clamps overhealing to the remaining headroom, never past max', () => {
      const hp: HpSnapshot = { current: 18, max: 20, temp: 0 };
      expect(healDraft(50, hp)).toEqual([
        { type: 'hp.changed', v: 1, payload: { delta: 2, kind: 'heal' } },
      ]);
    });

    it('prepends a resolving hp.changed{kind:set} when currentWasMax', () => {
      const hp: HpSnapshot = { current: 30, max: 30, temp: 0, currentWasMax: true };
      expect(healDraft(5, hp)).toEqual([
        { type: 'hp.changed', v: 1, payload: { delta: 30, kind: 'set' } },
        { type: 'hp.changed', v: 1, payload: { delta: 0, kind: 'heal' } },
      ]);
    });
  });

  describe('tempHpDraft', () => {
    it('sends a single hp.changed{kind:temp} draft, magnitude only, never negative', () => {
      expect(tempHpDraft(5)).toEqual([
        { type: 'hp.changed', v: 1, payload: { delta: 5, kind: 'temp' } },
      ]);
      expect(tempHpDraft(-5)).toEqual([
        { type: 'hp.changed', v: 1, payload: { delta: 0, kind: 'temp' } },
      ]);
    });
  });

  describe('conditionDraft', () => {
    it('add=true with no level omits the field entirely (strictObject-safe)', () => {
      expect(conditionDraft('srd-5e-2024:condition.prone', true)).toEqual({
        type: 'condition.added',
        v: 1,
        payload: { conditionId: 'srd-5e-2024:condition.prone' },
      });
    });

    it('add=true with a level (exhaustion) includes it', () => {
      expect(conditionDraft('srd-5e-2024:condition.exhaustion', true, 2)).toEqual({
        type: 'condition.added',
        v: 1,
        payload: { conditionId: 'srd-5e-2024:condition.exhaustion', level: 2 },
      });
    });

    it('add=false builds condition.removed with conditionId only', () => {
      expect(conditionDraft('srd-5e-2024:condition.prone', false)).toEqual({
        type: 'condition.removed',
        v: 1,
        payload: { conditionId: 'srd-5e-2024:condition.prone' },
      });
    });
  });

  it('inspirationDraft builds inspiration.changed{value}', () => {
    expect(inspirationDraft(true)).toEqual({
      type: 'inspiration.changed',
      v: 1,
      payload: { value: true },
    });
    expect(inspirationDraft(false)).toEqual({
      type: 'inspiration.changed',
      v: 1,
      payload: { value: false },
    });
  });

  describe('xpAwardedDraft', () => {
    it('builds xp.awarded (the REAL type — doc-02 shorthand "xp.granted" does not exist)', () => {
      expect(xpAwardedDraft(150)).toEqual({
        type: 'xp.awarded',
        v: 1,
        payload: { amount: 150 },
      });
    });

    it('includes reason only when given', () => {
      expect(xpAwardedDraft(150, 'defeated the dragon')).toEqual({
        type: 'xp.awarded',
        v: 1,
        payload: { amount: 150, reason: 'defeated the dragon' },
      });
    });

    it('allows a negative amount (corrections)', () => {
      expect(xpAwardedDraft(-50)).toEqual({
        type: 'xp.awarded',
        v: 1,
        payload: { amount: -50 },
      });
    });
  });

  describe('levelGrantedDraft', () => {
    it('omits count entirely when not given (schema default of 1 is implicit)', () => {
      expect(levelGrantedDraft()).toEqual({ type: 'level.granted', v: 1, payload: {} });
    });

    it('includes count when given', () => {
      expect(levelGrantedDraft(2)).toEqual({
        type: 'level.granted',
        v: 1,
        payload: { count: 2 },
      });
    });
  });

  describe('itemGrantDraft', () => {
    it('builds item.added with the caller-supplied instanceId, qty, and name', () => {
      expect(
        itemGrantDraft('11111111-1111-4111-8111-111111111111', 3, 'Potion of Healing'),
      ).toEqual({
        type: 'item.added',
        v: 1,
        payload: {
          instanceId: '11111111-1111-4111-8111-111111111111',
          qty: 3,
          name: 'Potion of Healing',
        },
      });
    });

    it('omits name when blank', () => {
      expect(itemGrantDraft('11111111-1111-4111-8111-111111111111', 1, '')).toEqual({
        type: 'item.added',
        v: 1,
        payload: { instanceId: '11111111-1111-4111-8111-111111111111', qty: 1 },
      });
    });
  });

  it('overrideAppliedDraft builds override.applied{path, value, reason}', () => {
    expect(overrideAppliedDraft('ac', 18, 'story reward')).toEqual({
      type: 'override.applied',
      v: 1,
      payload: { path: 'ac', value: 18, reason: 'story reward' },
    });
  });
});
