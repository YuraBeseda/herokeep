import { type Event, type Pack } from '@hk/protocol';
import { describe, expect, it } from 'vitest';
import { createContentIndex } from '../../src/content/index.ts';
import { validatePack } from '../../src/content/validate.ts';
import { derive, outstandingChoices } from '../../src/derive/index.ts';
import { validateSelection } from '../../src/derive/validation.ts';
import { reduce } from '../../src/reduce/reducer.ts';
import { loadFixturePack } from '../support/fixtures.ts';

// Plan 12 task 2 — a choice's `count` may be a formula over the character (`classLevel(...)`), so a
// class choice grows with level (fighter weapon masteries 3 -> 4 at class level 4). The growth re-offers
// the SAME choice id as outstanding (its recorded decision is now short of the resolved count).

const fighterId = 'core-mini:class/fighter';
const masteries = `${fighterId}@1/weapon-masteries`;
const GROWTH = '3 + min(1, floor(classLevel(fighter) / 4))';

function growthPack(count: number | string): Pack {
  const core = loadFixturePack('core-mini');
  const fighter = core.entities.find((e) => e.id === fighterId);
  if (fighter?.type !== 'class') throw new Error('fixture fighter missing');
  const choice = fighter.levels[0]!.choices.find((c) => c.id === masteries);
  if (!choice) throw new Error('fixture masteries choice missing');
  choice.count = count;
  return core;
}

const stream = 'char:2b7a1f22-1111-4c9d-a8f2-0a1b2c3d4e5f';
const ev = (n: number, type: string, payload: unknown): Event => ({
  id: `018f6d2e-7b1a-7c3d-9e4f-${String(n).padStart(12, '0')}`,
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
const upTo = (level: number): Event[] =>
  Array.from({ length: level }, (_, i) => ev(2 + i, 'level.gained', { classId: fighterId, level: i + 1 }));
const decide = (n: number, picks: string[]) => ev(n, 'decision.made', { choiceId: masteries, selection: picks });
const picks = (n: number) => Array.from({ length: n }, (_, i) => `weapon-${i + 1}`);

const request = (events: Event[], index: ReturnType<typeof createContentIndex>) =>
  derive(reduce(events), index).outstandingChoices.find((c) => c.choiceId === masteries);

describe('progression-driven choice counts', () => {
  const index = createContentIndex([growthPack(GROWTH)]);

  it('resolves the count formula against the class level', () => {
    expect(request([created, ...upTo(1)], index)?.count).toBe(3);
    expect(request([created, ...upTo(3)], index)?.count).toBe(3);
    expect(request([created, ...upTo(4)], index)?.count).toBe(4);
  });

  it('keeps a fully answered choice quiet until the count grows, then re-offers it with the larger count', () => {
    const answered = [created, ...upTo(3), decide(20, picks(3))];
    expect(request(answered, index)).toBeUndefined();

    const grown = [...answered, ...[4].map((l) => ev(21, 'level.gained', { classId: fighterId, level: l }))];
    expect(request(grown, index)).toEqual({ choiceId: masteries, ownerId: fighterId, count: 4 });
    expect(outstandingChoices(reduce(grown), index).some((c) => c.choiceId === masteries)).toBe(true);

    const reanswered = [...grown, decide(22, picks(4))];
    expect(request(reanswered, index)).toBeUndefined();
  });

  it('validates a selection against the RESOLVED count', () => {
    const facts = reduce([created, ...upTo(4), decide(20, picks(3))]);
    const sheet = derive(facts, index);
    const short = validateSelection(sheet, facts, index, masteries, picks(3));
    expect(short.map((d) => d.code)).toContain('selection.count');
    expect(validateSelection(sheet, facts, index, masteries, picks(4)).map((d) => d.code)).not.toContain(
      'selection.count',
    );
  });

  it('leaves an integer count byte-identical: a decided choice is never re-offered for a length mismatch', () => {
    const fixed = createContentIndex([growthPack(3)]);
    expect(request([created, ...upTo(1)], fixed)?.count).toBe(3);
    expect(request([created, ...upTo(4), decide(20, picks(1))], fixed)).toBeUndefined();
  });
});

describe('count formula validation', () => {
  it('accepts a well-formed count formula', () => {
    expect(validatePack(growthPack(GROWTH), [])).toEqual([]);
  });

  it.each(['mod(str)', 'score(str)', 'prof', '3 + prof', 'resource(rage)', 'max(2, mod(dex))'])(
    'rejects count formula %s: symbols outside the count context (level, classLevel, hitDie)',
    (src) => {
      const issues = validatePack(growthPack(src), []);
      expect(issues.some((i) => i.severity === 'error' && i.path?.includes('count'))).toBe(true);
    },
  );

  it('accepts level, classLevel and hitDie in a count formula', () => {
    expect(validatePack(growthPack('1 + floor(level / 5) + min(1, hitDie(fighter) / 12)'), [])).toEqual([]);
  });

  it('an unevaluable count resolves to 1 without throwing (mirrors predicate formulas: validation reports, derive never fails)', () => {
    const bad = createContentIndex([growthPack('3 +')]);
    expect(request([created, ...upTo(4)], bad)?.count).toBe(1);
  });

  it('rejects a count formula that references an unknown symbol', () => {
    const issues = validatePack(growthPack('3 + bogus(fighter)'), []);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.some((i) => i.path?.includes('count') && i.severity === 'error')).toBe(true);
  });
});
