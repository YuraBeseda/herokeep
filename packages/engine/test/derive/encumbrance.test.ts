import { describe, expect, it } from 'vitest';
import { createContentIndex } from '../../src/content/index.ts';
import { derive } from '../../src/derive/index.ts';
import { resolveCarryState } from '../../src/derive/encumbrance.ts';
import { emptyFacts } from '../../src/reduce/facts.ts';
import { loadFixturePack } from '../support/fixtures.ts';

const index = createContentIndex([loadFixturePack('core-mini'), loadFixturePack('content-mini')]);
const baseFacts = () => emptyFacts('char:test');

// core-mini:system/mini's own `encumbrance` fixture (TEST DATA, not SRD-cited — see doc-04):
//   standard.capacity = score(str) * 15
//   variant.capacity  = score(str) * 15 (hard cap)
//   variant.thresholds = [ {score(str)*5, 'encumbered', +10}, {score(str)*10, 'heavilyEncumbered', +20} ]
// default STR (no ability-scores decision made) = 10, so: standard/variant hard cap = 150,
// encumbered threshold = 50, heavilyEncumbered threshold = 100.

const chainMail = 'core-mini:item/chain-mail'; // weight 55
const longsword = 'core-mini:item/longsword'; // weight 3
const shortbow = 'core-mini:item/shortbow'; // weight 2

/** Ruling 1 (phase 4, plan 11 task 5 — "encumbrance option"). */
describe('derive: overrides.encumbrance default ("off")', () => {
  it('no overrides at all: no Sheet.carry, no overridesProvenance.encumbrance', () => {
    const sheet = derive(baseFacts(), index);
    expect('carry' in sheet).toBe(false);
    expect(sheet.overridesProvenance).toBeUndefined();
  });

  it('overrides.encumbrance explicitly "off": same as absent (zero computation)', () => {
    const facts = baseFacts();
    facts.inventory = [{ instanceId: 'i1', itemId: chainMail, qty: 1, equipped: true, attuned: false }];
    const sheet = derive(facts, index, undefined, { encumbrance: 'off' });
    expect('carry' in sheet).toBe(false);
    expect(sheet.overridesProvenance).toBeUndefined();
  });
});

describe('derive: overrides.encumbrance "standard" (binary normal/overloaded)', () => {
  it('under capacity: state "normal"', () => {
    const facts = baseFacts();
    facts.inventory = [{ instanceId: 'i1', itemId: longsword, qty: 1, equipped: true, attuned: false }]; // load 3
    const sheet = derive(facts, index, undefined, { encumbrance: 'standard' });

    expect(sheet.carry).toEqual({ mode: 'standard', capacity: 150, load: 3, state: 'normal' });
    expect(sheet.overridesProvenance).toEqual({ encumbrance: 'house rule' });
  });

  it('over capacity: state "overloaded"', () => {
    const facts = baseFacts();
    facts.inventory = [
      { instanceId: 'i1', itemId: chainMail, qty: 3, equipped: true, attuned: false }, // 55*3 = 165 > 150
    ];
    const sheet = derive(facts, index, undefined, { encumbrance: 'standard' });

    expect(sheet.carry).toEqual({ mode: 'standard', capacity: 150, load: 165, state: 'overloaded' });
  });

  it('at exactly capacity: state "normal" (inclusive limit, not exceeded)', () => {
    const facts = baseFacts();
    facts.inventory = [{ instanceId: 'i1', itemId: chainMail, qty: 1, equipped: true, attuned: false }]; // 55
    facts.inventory.push({ instanceId: 'i2', itemId: chainMail, qty: 1, equipped: false, attuned: false }); // 55
    facts.inventory.push({ instanceId: 'i3', itemId: longsword, qty: 1, equipped: false, attuned: false }); // 3
    // 55 + 55 + 3 = 113, still under 150 — bump with a custom item to land exactly on 150.
    facts.inventory.push({
      instanceId: 'i4',
      qty: 1,
      equipped: false,
      attuned: false,
      custom: { weight: 37 },
    });
    const sheet = derive(facts, index, undefined, { encumbrance: 'standard' });

    expect(sheet.carry).toEqual({ mode: 'standard', capacity: 150, load: 150, state: 'normal' });
  });
});

describe('derive: overrides.encumbrance "variant" (graded thresholds)', () => {
  it('below every threshold: state "normal"', () => {
    const facts = baseFacts();
    facts.inventory = [{ instanceId: 'i1', itemId: longsword, qty: 1, equipped: true, attuned: false }]; // 3
    const sheet = derive(facts, index, undefined, { encumbrance: 'variant' });

    expect(sheet.carry).toEqual({ mode: 'variant', capacity: 150, load: 3, state: 'normal' });
  });

  it('at/over the first threshold (50) but under the second (100): state "encumbered"', () => {
    const facts = baseFacts();
    facts.inventory = [{ instanceId: 'i1', itemId: chainMail, qty: 1, equipped: true, attuned: false }]; // 55
    const sheet = derive(facts, index, undefined, { encumbrance: 'variant' });

    expect(sheet.carry).toEqual({ mode: 'variant', capacity: 150, load: 55, state: 'encumbered' });
  });

  it('at/over the second threshold (100) but under the hard cap (150): state "heavilyEncumbered"', () => {
    const facts = baseFacts();
    facts.inventory = [
      { instanceId: 'i1', itemId: chainMail, qty: 1, equipped: true, attuned: false }, // 55
      { instanceId: 'i2', itemId: chainMail, qty: 1, equipped: false, attuned: false }, // 55
    ];
    const sheet = derive(facts, index, undefined, { encumbrance: 'variant' });

    expect(sheet.carry).toEqual({ mode: 'variant', capacity: 150, load: 110, state: 'heavilyEncumbered' });
  });

  it('over the hard cap: state "overloaded" (takes priority over the graded thresholds)', () => {
    const facts = baseFacts();
    facts.inventory = [
      { instanceId: 'i1', itemId: chainMail, qty: 3, equipped: true, attuned: false }, // 165
    ];
    const sheet = derive(facts, index, undefined, { encumbrance: 'variant' });

    expect(sheet.carry).toEqual({ mode: 'variant', capacity: 150, load: 165, state: 'overloaded' });
  });
});

describe('derive: Sheet.carry.load — inventory weight sourcing', () => {
  it('sums resolved item weight × qty across multiple entries', () => {
    const facts = baseFacts();
    facts.inventory = [
      { instanceId: 'i1', itemId: longsword, qty: 1, equipped: true, attuned: false }, // 3
      { instanceId: 'i2', itemId: shortbow, qty: 3, equipped: false, attuned: false }, // 2*3 = 6
    ];
    const sheet = derive(facts, index, undefined, { encumbrance: 'standard' });
    expect(sheet.carry?.load).toBe(9);
  });

  it('counts an entry REGARDLESS of equipped/attuned state (unlike charges/attunement)', () => {
    const facts = baseFacts();
    facts.inventory = [{ instanceId: 'i1', itemId: chainMail, qty: 1, equipped: false, attuned: false }];
    const sheet = derive(facts, index, undefined, { encumbrance: 'standard' });
    expect(sheet.carry?.load).toBe(55);
  });

  it('a resolved item with no `weight` field contributes 0', () => {
    // core-mini:item/whetstone has no `weight` field at all (added for this test).
    const facts = baseFacts();
    facts.inventory = [
      { instanceId: 'i1', itemId: 'core-mini:item/whetstone', qty: 1, equipped: false, attuned: false },
    ];
    const sheet = derive(facts, index, undefined, { encumbrance: 'standard' });
    expect(sheet.carry?.load).toBe(0);
  });

  it('a custom item (no itemId) with a numeric custom.weight contributes it × qty', () => {
    const facts = baseFacts();
    facts.inventory = [
      { instanceId: 'i1', qty: 2, equipped: false, attuned: false, name: 'Homemade sack', custom: { weight: 4 } },
    ];
    const sheet = derive(facts, index, undefined, { encumbrance: 'standard' });
    expect(sheet.carry?.load).toBe(8);
  });

  it('a custom item with no custom.weight (or a non-numeric one) contributes 0', () => {
    const facts = baseFacts();
    facts.inventory = [
      { instanceId: 'i1', qty: 1, equipped: false, attuned: false, name: 'Homemade dagger' },
      { instanceId: 'i2', qty: 1, equipped: false, attuned: false, custom: { weight: 'heavy' } },
    ];
    const sheet = derive(facts, index, undefined, { encumbrance: 'standard' });
    expect(sheet.carry?.load).toBe(0);
  });

  it('an unresolved itemId contributes 0 (and does not crash — a separate derive.unresolvedItem warning already covers visibility)', () => {
    const facts = baseFacts();
    facts.inventory = [
      { instanceId: 'i1', itemId: 'core-mini:item/does-not-exist', qty: 5, equipped: true, attuned: false },
    ];
    const sheet = derive(facts, index, undefined, { encumbrance: 'standard' });
    expect(sheet.carry?.load).toBe(0);
  });

  // Fix round 1 (task 5 review, Important): `item.custom` is an UNVALIDATED bag
  // (`ItemAddedV1.custom: z.record(..., z.unknown())` checks only the key, never the value) — a
  // client can put anything in `custom.weight`. Each of these must produce a SANE `load` (never
  // NaN, which would silently poison every threshold comparison to `false`/'normal'; never a
  // negative offset to every other item's weight).
  it('custom.weight: NaN contributes 0, not NaN (would otherwise poison the whole load)', () => {
    const facts = baseFacts();
    facts.inventory = [
      { instanceId: 'i1', itemId: chainMail, qty: 1, equipped: true, attuned: false }, // 55, real weight
      { instanceId: 'i2', qty: 1, equipped: false, attuned: false, custom: { weight: NaN } },
    ];
    const sheet = derive(facts, index, undefined, { encumbrance: 'standard' });
    expect(sheet.carry?.load).toBe(55); // NOT NaN
    expect(Number.isNaN(sheet.carry?.load)).toBe(false);
  });

  it('custom.weight: Infinity contributes 0, not Infinity', () => {
    const facts = baseFacts();
    facts.inventory = [
      { instanceId: 'i1', itemId: chainMail, qty: 1, equipped: true, attuned: false },
      { instanceId: 'i2', qty: 1, equipped: false, attuned: false, custom: { weight: Infinity } },
    ];
    const sheet = derive(facts, index, undefined, { encumbrance: 'standard' });
    expect(sheet.carry?.load).toBe(55);
  });

  it('custom.weight: -Infinity contributes 0, not -Infinity', () => {
    const facts = baseFacts();
    facts.inventory = [
      { instanceId: 'i1', itemId: chainMail, qty: 1, equipped: true, attuned: false },
      { instanceId: 'i2', qty: 1, equipped: false, attuned: false, custom: { weight: -Infinity } },
    ];
    const sheet = derive(facts, index, undefined, { encumbrance: 'standard' });
    expect(sheet.carry?.load).toBe(55);
  });

  it('custom.weight: negative contributes 0, not a negative offset to other items', () => {
    const facts = baseFacts();
    facts.inventory = [
      { instanceId: 'i1', itemId: chainMail, qty: 1, equipped: true, attuned: false }, // 55
      { instanceId: 'i2', qty: 1, equipped: false, attuned: false, custom: { weight: -1000 } },
    ];
    const sheet = derive(facts, index, undefined, { encumbrance: 'standard' });
    expect(sheet.carry?.load).toBe(55); // NOT 55 - 1000 = -945
  });

  it('custom.weight: an absurdly huge but FINITE positive value is legal and NOT clamped', () => {
    const facts = baseFacts();
    facts.inventory = [{ instanceId: 'i1', qty: 1, equipped: false, attuned: false, custom: { weight: 1_000_000 } }];
    const sheet = derive(facts, index, undefined, { encumbrance: 'standard' });
    expect(sheet.carry?.load).toBe(1_000_000);
    expect(sheet.carry?.state).toBe('overloaded'); // 1,000,000 > capacity (150) — comparison stays sane
  });
});

describe('derive: overridesProvenance merges attunementMax + encumbrance independently', () => {
  it('both overridden together: both provenance keys present', () => {
    const sheet = derive(baseFacts(), index, undefined, { attunementMax: 5, encumbrance: 'standard' });
    expect(sheet.overridesProvenance).toEqual({ attunementMax: 'house rule', encumbrance: 'house rule' });
  });

  it('only attunementMax overridden: encumbrance key absent (not "off"-valued)', () => {
    const sheet = derive(baseFacts(), index, undefined, { attunementMax: 5 });
    expect(sheet.overridesProvenance).toEqual({ attunementMax: 'house rule' });
    expect('carry' in sheet).toBe(false);
  });
});

/**
 * `resolveCarryState` — the pure computation core, unit-tested directly (no `ContentIndex`/pack
 * needed) so the "pack hasn't authored this mode yet" edge case doesn't require a second fixture
 * pack: `deriveEncumbrance` (the `derive()`-wired integration) always reads `index.system().
 * encumbrance`, which may be `undefined` for any pack authored before this task, or missing just
 * the ONE mode a caller asked for.
 */
describe('resolveCarryState (pure)', () => {
  const evalFormula = (f: string) => (f === 'score(str) * 15' ? 150 : f === 'score(str) * 5' ? 50 : 0);

  it('mode "standard" but system.encumbrance is entirely absent: warning diagnostic, no carry', () => {
    const r = resolveCarryState(undefined, 'standard', 10, evalFormula);
    expect(r.carry).toBeUndefined();
    expect(r.issue).toMatchObject({ severity: 'warning', code: 'derive.encumbranceConfigMissing' });
  });

  it('mode "variant" but system.encumbrance.variant is absent (only .standard supplied): warning, no carry', () => {
    const r = resolveCarryState({ standard: { capacity: 'score(str) * 15' } }, 'variant', 10, evalFormula);
    expect(r.carry).toBeUndefined();
    expect(r.issue).toMatchObject({ severity: 'warning', code: 'derive.encumbranceConfigMissing' });
  });

  it('mode "standard" but system.encumbrance.standard is absent (only .variant supplied): warning, no carry', () => {
    const r = resolveCarryState(
      { variant: { capacity: 'score(str) * 15', thresholds: [{ capacity: 'score(str) * 5', state: 'encumbered' }] } },
      'standard',
      10,
      evalFormula,
    );
    expect(r.carry).toBeUndefined();
    expect(r.issue).toMatchObject({ severity: 'warning', code: 'derive.encumbranceConfigMissing' });
  });

  it('unsorted thresholds are sorted before resolution (authoring order does not matter)', () => {
    const config = {
      variant: {
        capacity: 'score(str) * 15',
        thresholds: [
          { capacity: 'score(str) * 10', state: 'heavilyEncumbered' as const },
          { capacity: 'score(str) * 5', state: 'encumbered' as const },
        ],
      },
    };
    const withHighLoad = resolveCarryState(config, 'variant', 100, (f) =>
      f === 'score(str) * 15' ? 150 : f === 'score(str) * 10' ? 100 : f === 'score(str) * 5' ? 50 : 0,
    );
    expect(withHighLoad.carry?.state).toBe('heavilyEncumbered');
  });
});
