import { describe, expect, it } from 'vitest';
import { createContentIndex } from '../../src/content/index.ts';
import { derive } from '../../src/derive/index.ts';
import { emptyFacts } from '../../src/reduce/facts.ts';
import type { CampaignClock } from '../../src/derive/overrides.ts';
import { loadFixturePack } from '../support/fixtures.ts';

const index = createContentIndex([loadFixturePack('core-mini'), loadFixturePack('content-mini')]);
const E1 = '11111111-1111-4111-8111-111111111111';
const E2 = '22222222-2222-4222-8222-222222222222';

function conditions(clock: CampaignClock | undefined, entry: object) {
  const facts = emptyFacts('char:test');
  facts.conditions = [{ conditionId: 'core-mini:condition/prone', sinceEventId: 'e', ...entry }];
  return derive(facts, index, undefined, clock ? { clock } : undefined).conditions[0];
}
const rounds3 = { duration: { kind: 'rounds', amount: 3 }, startedAtRound: 2, encounterId: E1 } as const;

describe('condition rounds from the campaign clock', () => {
  it('counts down from the round the condition started in', () => {
    expect(conditions({ encounter: { id: E1, round: 2 } }, rounds3)?.remaining).toEqual({ kind: 'rounds', value: 3 });
    expect(conditions({ encounter: { id: E1, round: 4 } }, rounds3)?.remaining).toEqual({ kind: 'rounds', value: 1 });
  });
  it('clamps at 0 and does not mark the condition ended while the encounter is open', () => {
    const c = conditions({ encounter: { id: E1, round: 9 } }, rounds3);
    expect(c?.remaining).toEqual({ kind: 'rounds', value: 0 });
    expect(c?.ended).toBeUndefined();
  });
  it('marks ended (remaining 0, never negative or jumping) once its encounter is closed or replaced', () => {
    for (const clock of [{}, { encounter: { id: E2, round: 1 } }]) {
      const c = conditions(clock, rounds3);
      expect(c?.ended).toBe(true);
      expect(c?.remaining).toEqual({ kind: 'rounds', value: 0 });
    }
  });
  it('shows no remaining without a clock, and an encounter-less condition follows the current encounter', () => {
    expect(conditions(undefined, rounds3)?.remaining).toBeUndefined();
    const noEnc = { duration: rounds3.duration, startedAtRound: rounds3.startedAtRound };
    expect(conditions({ encounter: { id: E2, round: 3 } }, noEnc)?.remaining).toEqual({ kind: 'rounds', value: 2 });
  });
  it('lets overrides.clock win over the solo facts.round clock', () => {
    const facts = emptyFacts('char:test');
    facts.conditions = [{ conditionId: 'core-mini:condition/prone', sinceEventId: 'e', ...rounds3 }];
    facts.round = { encounterId: E1, round: 3 };
    expect(derive(facts, index).conditions[0]?.remaining).toEqual({ kind: 'rounds', value: 2 });
    const linked = derive(facts, index, undefined, { clock: { encounter: { id: E1, round: 4 } } });
    expect(linked.conditions[0]?.remaining).toEqual({ kind: 'rounds', value: 1 });
  });
  it('derives hours as minutes x 60 and leaves untilRemoved without remaining', () => {
    expect(conditions(undefined, { duration: { kind: 'hours', amount: 2 } })?.remaining).toEqual({
      kind: 'time',
      minutes: 120,
    });
    const u = conditions(undefined, { duration: { kind: 'untilRemoved' } });
    expect(u?.duration).toEqual({ kind: 'untilRemoved' });
    expect(u?.remaining).toBeUndefined();
    expect(u?.endsAt).toBeUndefined();
  });
});
