import type { Event } from '@hk/protocol';
import { describe, expect, it } from 'vitest';
import { emptyFacts, type SystemRules } from '../src/reduce/facts.ts';
import { HANDLERS as IDENTITY_HANDLERS } from '../src/reduce/handlers/identity.ts';
import { HANDLERS as LEVELING_HANDLERS } from '../src/reduce/handlers/leveling.ts';
import { effectiveRules, reduce } from '../src/reduce/reducer.ts';
import { ENGINE_VERSION } from '../src/version.ts';

const stream = 'char:2b7a1f22-1111-4c9d-a8f2-0a1b2c3d4e5f';
const id = (n: number) => `018f6d2e-7b1a-7c3d-9e4f-${String(n).padStart(12, '0')}`;
const ev = (n: number, type: string, payload: unknown, extra: Partial<Event> = {}): Event => ({
  id: id(n),
  stream,
  seq: n,
  ts: '2026-08-30T12:00:00.000Z',
  actor: { userId: 'u', deviceId: 'd', role: 'owner' },
  type,
  v: 1,
  payload,
  ...extra,
});

const created = ev(1, 'character.created', {
  name: 'Ivan',
  system: 'mini',
  corePack: { id: 'core-mini', version: '1.0.0' },
  engineVersion: '0.1.0',
  grammaticalGender: 'masculine',
});

describe('reduce: revert pre-scan (design ruling 2)', () => {
  it('(a) revert-by-id skips a committed target that appears earlier in seq order than the revert', () => {
    const rename = ev(2, 'character.renamed', { name: 'Ivanka' });
    const revert = ev(3, 'event.reverted', { targetId: rename.id });
    const f = reduce([created, rename, revert]);
    expect(f.name).toBe('Ivan');
    expect(f.skipped).toEqual([{ eventId: rename.id, reason: 'reverted' }]);
    expect(f.lastSeq).toBe(3);
  });

  it('also skips a target that appears LATER in seq order than the revert (whole-array pre-scan)', () => {
    // The revert (seq 2) names a target that is only committed afterwards (seq 3) — a fold that
    // only looked backward at revert time would miss this; the pre-scan sees the whole array.
    const revert = ev(2, 'event.reverted', { targetId: id(3) });
    const rename = ev(3, 'character.renamed', { name: 'Ivanka' });
    const f = reduce([created, revert, rename]);
    expect(f.name).toBe('Ivan');
    expect(f.skipped).toEqual([{ eventId: rename.id, reason: 'reverted' }]);
  });

  it('(b) revert-by-txId skips all three events of a transaction', () => {
    const txId = '018f6d2e-7b1a-7c3d-9e4f-aaaaaaaaaaaa';
    const a = ev(2, 'character.renamed', { name: 'A' }, { txId });
    const b = ev(3, 'character.gender_set', { grammaticalGender: 'feminine' }, { txId });
    const c = ev(4, 'character.appearance_set', { age: '30' }, { txId });
    const revert = ev(5, 'event.reverted', { txId });
    const f = reduce([created, a, b, c, revert]);
    expect(f.name).toBe('Ivan');
    expect(f.grammaticalGender).toBe('masculine');
    expect(f.appearance).toEqual({});
    expect(f.skipped).toEqual([
      { eventId: a.id, reason: 'reverted' },
      { eventId: b.id, reason: 'reverted' },
      { eventId: c.id, reason: 'reverted' },
    ]);
    expect(f.lastSeq).toBe(5);
  });

  it('(c) revert of an unknown id is a clean no-op', () => {
    const revert = ev(2, 'event.reverted', { targetId: id(999) });
    const f = reduce([created, revert]);
    expect(f.name).toBe('Ivan');
    expect(f.skipped).toEqual([]);
    expect(f.lastSeq).toBe(2);
  });
});

describe('reduce: handler registry', () => {
  it('(d) handler modules never collide on a key', () => {
    // Add each new handlers/*.ts module here as later tasks introduce it.
    const modules: Record<string, unknown>[] = [IDENTITY_HANDLERS, LEVELING_HANDLERS];
    const totalKeys = modules.reduce((n, mod) => n + Object.keys(mod).length, 0);
    const union = new Set(modules.flatMap((mod) => Object.keys(mod)));
    expect(union.size).toBe(totalKeys);
  });
});

describe('reduce: system rules context', () => {
  const mkRules = (allowHitDice: boolean): SystemRules => ({
    restRules: {
      shortRest: { allowHitDice },
      longRest: {
        hpToMax: true,
        restoreAllSlots: true,
        hitDiceRegainDivisor: 2,
        hitDiceRegainMin: 1,
        exhaustionReduce: 1,
      },
    },
    hpRules: { firstLevelMaxHitDie: true, averageRounding: 'up' },
  });

  it("(e) a resumed snapshot's own rules beat the rules argument", () => {
    const snapshotRules = mkRules(true);
    const argRules = mkRules(false);
    const from = { seq: 1, facts: emptyFacts(stream), engineVersion: ENGINE_VERSION, rules: snapshotRules };
    expect(effectiveRules(from, argRules)).toBe(snapshotRules);
  });

  it('falls back to the rules argument when the snapshot carries none', () => {
    const argRules = mkRules(false);
    const from = { seq: 1, facts: emptyFacts(stream), engineVersion: ENGINE_VERSION };
    expect(effectiveRules(from, argRules)).toBe(argRules);
    expect(effectiveRules(undefined, argRules)).toBe(argRules);
    expect(effectiveRules(undefined, undefined)).toBeUndefined();
  });
});
