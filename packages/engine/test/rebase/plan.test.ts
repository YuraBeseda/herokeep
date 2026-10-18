import type { Event, Pack } from '@hk/protocol';
import { describe, expect, it } from 'vitest';
import { type ContentIndex, createContentIndex } from '../../src/content/index.ts';
import type { Pins } from '../../src/content/deps.ts';
import { validatePack } from '../../src/content/validate.ts';
import * as engine from '../../src/index.ts';
import { hasErrors } from '../../src/diagnostics.ts';
import { derive } from '../../src/derive/index.ts';
import { validateSelection } from '../../src/derive/validation.ts';
import type { ProposedEvent } from '../../src/propose/index.ts';
import { planRebase } from '../../src/rebase/plan.ts';
import { diffSheets } from '../../src/rebase/sheet-diff.ts';
import type { Facts, SystemRules } from '../../src/reduce/facts.ts';
import { reduce } from '../../src/reduce/reducer.ts';
import { loadEngineFixturePack, loadFixturePack } from '../support/fixtures.ts';

/**
 * Plan 15 (phase 4 slice 5) Task 1, ruling 5 / Review Focus 3 — `planRebase` over the rebase-mini
 * pair (1.0.0 → 1.1.0): v2 deprecates `feat/old-luck` in favour of `feat/luck` (migration), drops
 * the `charm` choice (choice-missing), raises `feat/nimble`'s dex prerequisite 8 → 18
 * (prerequisite-failed), and raises `feature/sprite-step`'s walk bonus 5 → 10 (a value change).
 */
const core = loadFixturePack('core-mini');
const v1 = loadEngineFixturePack('rebase-v1');
const v2 = loadEngineFixturePack('rebase-v2');

const stream = 'char:2b7a1f22-1111-4c9d-a8f2-0a1b2c3d4e5f';
const ev = (n: number, type: string, payload: unknown): Event => ({
  id: `018f6d2e-7b1a-7c3d-9e4f-${String(n).padStart(12, '0')}`,
  stream,
  seq: n,
  ts: '2026-10-18T12:00:00.000Z',
  actor: { userId: 'u', deviceId: 'd', role: 'owner' },
  type,
  v: 1,
  payload,
});
/** Appends drafted events after `log` (the way a commit assigns the next seqs). */
const commit = (log: Event[], drafts: ProposedEvent[]): Event[] => [
  ...log,
  ...drafts.map((d, i) => ev(log.length + i + 1, d.type, d.payload)),
];

const SPECIES = 'core-mini:system/mini@0/species';
const ABILITIES = 'core-mini:system/mini@0/ability-scores';
const GIFT = 'rebase-mini:species/sprite@0/gift';
const CHARM = 'rebase-mini:species/sprite@0/charm';
const TRICK = 'rebase-mini:species/sprite@0/trick';
const GIFT_CONTEXT = { origin: 'creation' };

const baseLog = (giftPick: string, version: string, extra: { charm?: boolean; trick?: boolean } = {}): Event[] => {
  const events: unknown[][] = [
    [
      'character.created',
      {
        name: 'Ivan',
        system: 'mini',
        corePack: { id: 'core-mini', version: '1.0.0' },
        engineVersion: '0.1.0',
        grammaticalGender: 'masculine',
      },
    ],
    ['pack.pinned', { packId: 'rebase-mini', version }],
    ['decision.made', { choiceId: ABILITIES, selection: ['str:10', 'dex:14', 'con:10', 'int:10', 'wis:10', 'cha:10'] }],
    ['decision.made', { choiceId: SPECIES, selection: ['rebase-mini:species/sprite'] }],
    ['decision.made', { choiceId: GIFT, selection: [giftPick], context: GIFT_CONTEXT }],
  ];
  if (extra.charm !== false)
    events.push([
      'decision.made',
      { choiceId: CHARM, selection: ['rebase-mini:feat/keen-eye'], context: GIFT_CONTEXT },
    ]);
  if (extra.trick !== false)
    events.push(['decision.made', { choiceId: TRICK, selection: ['rebase-mini:feat/nimble'] }]);
  return events.map(([type, payload], i) => ev(i + 1, type as string, payload));
};

const v1Log = () => baseLog('rebase-mini:feat/old-luck', '1.0.0');
const indexFor = (pins: Pins, packs: Pack[] = [core, v1, v2]): ContentIndex =>
  createContentIndex(packs, { pins, roots: Object.keys(pins) });
const rulesOf = (index: ContentIndex): SystemRules => ({
  restRules: index.system().restRules,
  hpRules: index.system().hpRules,
});

const setup = () => {
  const facts = reduce(v1Log());
  const current = indexFor(facts.pins);
  const nextPins = { ...facts.pins, 'rebase-mini': '1.1.0' };
  const next = indexFor(nextPins);
  return { facts, current, next, nextPins, rules: rulesOf(current) };
};

const MIGRATION_EVENTS: ProposedEvent[] = [
  { type: 'pack.pinned', v: 1, payload: { packId: 'rebase-mini', version: '1.1.0', previous: '1.0.0' } },
  {
    type: 'decision.made',
    v: 1,
    payload: { choiceId: GIFT, selection: ['rebase-mini:feat/luck'], context: GIFT_CONTEXT },
  },
  { type: 'decision.cleared', v: 1, payload: { choiceId: CHARM } },
  { type: 'decision.cleared', v: 1, payload: { choiceId: TRICK } },
];

describe('engine barrel', () => {
  it('exports the rebase planner and the sheet diff', () => {
    expect(engine.planRebase).toBe(planRebase);
    expect(engine.diffSheets).toBe(diffSheets);
    expect(engine.propose.pinPack).toBeTypeOf('function');
    expect(engine.propose.unpinPack).toBeTypeOf('function');
  });
});

describe('rebase fixtures', () => {
  it('both versions are valid packs against the core', () => {
    expect(hasErrors(validatePack(v1, [core]))).toBe(false);
    expect(hasErrors(validatePack(v2, [core]))).toBe(false);
  });

  it('every v1 decision is valid under v1 (the "before" state is clean)', () => {
    const { facts, current, rules } = setup();
    const sheet = derive(facts, current, rules);
    for (const [choiceId, selection] of Object.entries(facts.decisions)) {
      const issues = validateSelection(sheet, facts, current, choiceId, selection).filter((d) =>
        ['selection.unresolved', 'selection.notOffered', 'selection.prerequisiteFailed'].includes(d.code),
      );
      expect(issues, choiceId).toEqual([]);
    }
  });
});

describe('planRebase v1 → v2', () => {
  it('migrates the deprecated selection via replacedBy', () => {
    const { facts, current, next, nextPins, rules } = setup();
    const plan = planRebase(facts, current, next, nextPins, rules);
    expect(plan.migrations).toEqual([
      { choiceId: GIFT, from: 'rebase-mini:feat/old-luck', to: 'rebase-mini:feat/luck' },
    ]);
  });

  it('reports the removed choice and the tightened prerequisite, sorted by choiceId', () => {
    const { facts, current, next, nextPins, rules } = setup();
    const plan = planRebase(facts, current, next, nextPins, rules);
    expect(plan.invalid).toEqual([
      { choiceId: CHARM, selection: ['rebase-mini:feat/keen-eye'], reason: 'choice-missing' },
      { choiceId: TRICK, selection: ['rebase-mini:feat/nimble'], reason: 'prerequisite-failed' },
    ]);
  });

  it('lists the numeric change (and the pin) in changes with before/after, sorted', () => {
    const { facts, current, next, nextPins, rules } = setup();
    const plan = planRebase(facts, current, next, nextPins, rules);
    expect(plan.changes).toContainEqual({ path: 'speed.walk.value', before: 35, after: 40 });
    expect(plan.changes).toContainEqual({ path: 'pins.rebase-mini', before: '1.0.0', after: '1.1.0' });
    const paths = plan.changes.map((c) => c.path);
    expect(paths).toEqual([...paths].sort());
    expect(paths.some((p) => p.includes('contributions') || p.startsWith('issues'))).toBe(false);
  });

  it('orders events: pack.pinned → decision.made (migrations) → decision.cleared (unfixable)', () => {
    const { facts, current, next, nextPins, rules } = setup();
    expect(planRebase(facts, current, next, nextPins, rules).events).toEqual(MIGRATION_EVENTS);
  });

  it('replaying facts + plan events against next resolves cleanly and equals a fresh pick of the new entity', () => {
    const { current, next, nextPins, rules } = setup();
    const log = v1Log();
    const plan = planRebase(reduce(log), current, next, nextPins, rules);
    const replayed = reduce(commit(log, plan.events));

    expect(replayed.pins).toEqual(nextPins);
    expect(replayed.decisions[GIFT]).toEqual(['rebase-mini:feat/luck']);
    expect(replayed.decisionContexts[GIFT]).toEqual(GIFT_CONTEXT);
    expect(replayed.decisions[CHARM]).toBeUndefined();
    expect(replayed.decisionContexts[CHARM]).toBeUndefined(); // cleared with its decision (plan.ts mirrors this)
    expect(replayed.decisions[TRICK]).toBeUndefined();

    const sheet = derive(replayed, next, rules);
    const codes = sheet.issues.map((d) => d.code);
    expect(codes).not.toContain('decision.unknownChoice');
    expect(codes).not.toContain('derive.unresolvedEntity');
    for (const [choiceId, selection] of Object.entries(replayed.decisions)) {
      const bad = validateSelection(sheet, replayed, next, choiceId, selection).filter((d) =>
        ['selection.unresolved', 'selection.notOffered', 'selection.prerequisiteFailed'].includes(d.code),
      );
      expect(bad, choiceId).toEqual([]);
    }

    // Review Focus 3: the migrated log derives the same sheet as a character that picked
    // `feat/luck` on v2 from the start (minus the two decisions the rebase cleared).
    const fresh = reduce(baseLog('rebase-mini:feat/luck', '1.1.0', { charm: false, trick: false }));
    expect(sheet).toEqual(derive(fresh, next, rules));

    // `changes` is exactly the diff Confirm produces: the sheet now vs the replayed sheet.
    expect(plan.changes).toEqual(diffSheets(derive(reduce(log), current, rules), sheet));

    // ...and a second rebase of the migrated character to the same pins is empty.
    expect(planRebase(replayed, next, next, nextPins, rules)).toEqual({
      changes: [],
      invalid: [],
      migrations: [],
      events: [],
    });
  });

  it('identical pins → an empty plan', () => {
    const { facts, current, rules } = setup();
    expect(planRebase(facts, current, current, { ...facts.pins }, rules)).toEqual({
      changes: [],
      invalid: [],
      migrations: [],
      events: [],
    });
  });

  it('a decision that was already invalid before the update is not reported as invalidated by it', () => {
    const log = v1Log();
    const facts = reduce([...log, ev(log.length + 1, 'decision.made', { choiceId: `${GIFT}--9`, selection: ['x'] })]);
    const current = indexFor(facts.pins);
    const nextPins = { ...facts.pins, 'rebase-mini': '1.1.0' };
    const plan = planRebase(facts, current, indexFor(nextPins), nextPins, rulesOf(current));
    expect(plan.invalid.map((i) => i.choiceId)).toEqual([CHARM, TRICK]);
  });

  it('a pin absent from nextPins → pack.unpinned (never for the core), before any decision event', () => {
    const { facts, current, rules } = setup();
    const corePins = { 'core-mini': '1.0.0' };
    const plan = planRebase(facts, current, indexFor(corePins), corePins, rules);
    expect(plan.events[0]).toEqual({ type: 'pack.unpinned', v: 1, payload: { packId: 'rebase-mini' } });
    expect(plan.events.filter((e) => e.type.startsWith('pack.'))).toHaveLength(1);
    expect(plan.invalid.find((i) => i.choiceId === SPECIES)?.reason).toBe('selection-missing');
    expect(plan.invalid.find((i) => i.choiceId === GIFT)?.reason).toBe('choice-missing');

    // The core is never unpinned, even when a caller leaves it out of nextPins.
    const noCore = planRebase(facts, current, indexFor(corePins), {}, rules);
    expect(noCore.events.filter((e) => e.type === 'pack.unpinned')).toEqual([
      { type: 'pack.unpinned', v: 1, payload: { packId: 'rebase-mini' } },
    ]);
  });

  it('a deprecated selection whose replacement also fails → selection-deprecated, no migration', () => {
    const v2NoLuckOffer = structuredClone(v2);
    const sprite = v2NoLuckOffer.entities.find((e) => e.id === 'rebase-mini:species/sprite')!;
    const gift = sprite.choices.find((c) => c.id === GIFT)!;
    gift.pick = { static: ['rebase-mini:feat/keen-eye'] };
    const { facts, current, nextPins, rules } = setup();
    const plan = planRebase(facts, current, indexFor(nextPins, [core, v1, v2NoLuckOffer]), nextPins, rules);
    expect(plan.migrations).toEqual([]);
    expect(plan.invalid).toContainEqual({
      choiceId: GIFT,
      selection: ['rebase-mini:feat/old-luck'],
      reason: 'selection-deprecated',
    });
    expect(plan.events).toContainEqual({ type: 'decision.cleared', v: 1, payload: { choiceId: GIFT } });
  });

  it('a selected entity removed from the pack → selection-missing', () => {
    const v2NoNimble = structuredClone(v2);
    v2NoNimble.entities = v2NoNimble.entities.filter((e) => e.id !== 'rebase-mini:feat/nimble');
    const { facts, current, nextPins, rules } = setup();
    const plan = planRebase(facts, current, indexFor(nextPins, [core, v1, v2NoNimble]), nextPins, rules);
    expect(plan.invalid).toContainEqual({
      choiceId: TRICK,
      selection: ['rebase-mini:feat/nimble'],
      reason: 'selection-missing',
    });
  });

  it('is deterministic: two calls are deep-equal and the inputs are not mutated', () => {
    const { facts, current, next, nextPins, rules } = setup();
    const before: Facts = structuredClone(facts);
    const a = planRebase(facts, current, next, nextPins, rules);
    const b = planRebase(facts, current, next, nextPins, rules);
    expect(a).toEqual(b);
    expect(facts).toEqual(before);
  });
});
