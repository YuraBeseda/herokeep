import { describe, expect, it } from 'vitest';
import type { Sheet } from '../../src/derive/sheet.ts';
import { propose } from '../../src/propose/index.ts';
import { reduce } from '../../src/reduce/reducer.ts';
import { baseSheet, captureProposeError, created, wrapAll } from './support.ts';

const wizard = 'core-mini:class/wizard';
const warlock = 'core-mini:class/warlock';
const fireball = 'core-mini:spell/fireball';
const eldritchBlast = 'core-mini:spell/eldritch-blast';

const casterSheet = (overrides: Partial<Sheet['spellcasting'][number]> = {}): Sheet =>
  baseSheet({
    spellcasting: [
      {
        classId: wizard,
        ability: 'int',
        dc: { value: 13, contributions: [] },
        attack: { value: 5, contributions: [] },
        slots: [
          { level: 1, max: 4, used: 2 },
          { level: 2, max: 2, used: 2 },
          { level: 3, max: 2, used: 0 },
        ],
        preparation: 'prepared',
        prepared: [fireball],
        known: [],
        ritual: true,
        ...overrides,
      },
    ],
  });

/**
 * A solo Warlock's `SpellcastingBlock` (task 3's shape): `.slots` is EMPTY by construction (never
 * populated from the sparse pact row — see `derive/spellcasting.ts`'s `SpellcastingBlock.pact` doc
 * comment) and `.pact` carries `{level, count, used}` instead. `pactLevel`/`pactCount`/`pactUsed`
 * default to the real level-5 Warlock row from `system.ts`'s `PACT_SLOTS` fixture (task 3's own
 * report): two level-3 pact slots.
 */
const pactCasterSheet = (opts: { pactLevel?: number; pactCount?: number; pactUsed?: number } = {}): Sheet =>
  baseSheet({
    spellcasting: [
      {
        classId: warlock,
        ability: 'cha',
        dc: { value: 14, contributions: [] },
        attack: { value: 6, contributions: [] },
        slots: [],
        pact: { level: opts.pactLevel ?? 3, count: opts.pactCount ?? 2, used: opts.pactUsed ?? 0 },
        preparation: 'prepared',
        prepared: [eldritchBlast],
        known: [],
        ritual: false,
      },
    ],
  });

describe('propose.spendSlot', () => {
  it('emits slot.spent{level} when a slot is available', () => {
    expect(propose.spendSlot(casterSheet(), 1)).toEqual([{ type: 'slot.spent', v: 1, payload: { level: 1 } }]);
  });

  it('refuses with "slot.none-left" when used >= max at that level', () => {
    const err = captureProposeError(() => propose.spendSlot(casterSheet(), 2));
    expect(err.diagnostics[0]?.code).toBe('slot.none-left');
  });

  it('refuses with "slot.none-left" when the level has no slot table entry at all', () => {
    const err = captureProposeError(() => propose.spendSlot(casterSheet(), 9));
    expect(err.diagnostics[0]?.code).toBe('slot.none-left');
  });
});

describe('propose.cast', () => {
  it('concentration: false defaults to consuming a slot at the cast level, omitting slotUsed/concentration from the payload', () => {
    expect(propose.cast(casterSheet(), fireball, { level: 1, concentration: false })).toEqual([
      { type: 'spell.cast', v: 1, payload: { spellId: fireball, level: 1 } },
    ]);
  });

  it('useSlot: false skips the slot check entirely (a cantrip) and forwards slotUsed: false', () => {
    expect(propose.cast(casterSheet(), fireball, { level: 0, useSlot: false, concentration: false })).toEqual([
      { type: 'spell.cast', v: 1, payload: { spellId: fireball, level: 0, slotUsed: false } },
    ]);
  });

  it('concentration: true forwards concentration: true on the payload', () => {
    expect(propose.cast(casterSheet(), fireball, { level: 3, useSlot: true, concentration: true })).toEqual([
      { type: 'spell.cast', v: 1, payload: { spellId: fireball, level: 3, slotUsed: true, concentration: true } },
    ]);
  });

  it('refuses with "slot.none-left" when the cast would consume a slot that has none left', () => {
    const err = captureProposeError(() => propose.cast(casterSheet(), fireball, { level: 2, concentration: false }));
    expect(err.diagnostics[0]?.code).toBe('slot.none-left');
  });
});

// Task 11 (phase 4 plan 11) — the sanctioned pact-awareness addition to `propose/casting.ts`, ruling
// 2's cross-usability clause (vendored `Rule.json`, pk `srd-2024_multiclassing_spellcasting`, "Pact
// Magic" paragraph, quoted in full in `pactSlotFor`'s own header comment).
describe('propose.spendSlot — pact lane', () => {
  it('opts.pact spends the PACT slot and records ITS OWN level (pact.level), not the requested one', () => {
    // Requesting level 1 (a Warlock's own lowest-level prepared spell) against a level-3 pact slot:
    // "where level suffices" — pact.level (3) >= the requested level (1).
    expect(propose.spendSlot(pactCasterSheet(), 1, { pact: true })).toEqual([
      { type: 'slot.spent', v: 1, payload: { level: 3, pact: true } },
    ]);
  });

  it('opts.pact refuses with "slot.none-left" when the pact slot\'s own level is BELOW the requested level', () => {
    const err = captureProposeError(() => propose.spendSlot(pactCasterSheet({ pactLevel: 2 }), 3, { pact: true }));
    expect(err.diagnostics[0]?.code).toBe('slot.none-left');
  });

  it('opts.pact refuses with "slot.none-left" when every pact slot is already used', () => {
    const err = captureProposeError(() =>
      propose.spendSlot(pactCasterSheet({ pactCount: 2, pactUsed: 2 }), 1, { pact: true }),
    );
    expect(err.diagnostics[0]?.code).toBe('slot.none-left');
  });

  it('opts.pact refuses with "slot.none-left" on a sheet with no pact lane at all (a non-Warlock)', () => {
    const err = captureProposeError(() => propose.spendSlot(casterSheet(), 1, { pact: true }));
    expect(err.diagnostics[0]?.code).toBe('slot.none-left');
  });

  it("without opts.pact, a pact-only sheet (no regular slots) still refuses at the pact-caster's own level", () => {
    // Proves the two lanes are genuinely SEPARATE, not a silent fallback: asking for the regular lane
    // on a solo Warlock (whose `.slots` is `[]` by construction, task 3) finds nothing.
    const err = captureProposeError(() => propose.spendSlot(pactCasterSheet(), 3));
    expect(err.diagnostics[0]?.code).toBe('slot.none-left');
  });
});

describe('propose.cast — pact lane', () => {
  it("opts.pact emits BOTH spell.cast{slotUsed:false} and a separate slot.spent{pact:true} at the pact slot's own level", () => {
    expect(propose.cast(pactCasterSheet(), eldritchBlast, { level: 1, concentration: false, pact: true })).toEqual([
      { type: 'spell.cast', v: 1, payload: { spellId: eldritchBlast, level: 1, slotUsed: false } },
      { type: 'slot.spent', v: 1, payload: { level: 3, pact: true } },
    ]);
  });

  it('opts.pact + concentration: true still forwards concentration: true on the spell.cast event', () => {
    const events = propose.cast(pactCasterSheet(), eldritchBlast, { level: 1, concentration: true, pact: true });
    expect(events).toEqual([
      { type: 'spell.cast', v: 1, payload: { spellId: eldritchBlast, level: 1, slotUsed: false, concentration: true } },
      { type: 'slot.spent', v: 1, payload: { level: 3, pact: true } },
    ]);
  });

  it('opts.pact refuses with "slot.none-left" when the pact slot is exhausted, emitting NEITHER event', () => {
    const err = captureProposeError(() =>
      propose.cast(pactCasterSheet({ pactCount: 1, pactUsed: 1 }), eldritchBlast, {
        level: 1,
        concentration: false,
        pact: true,
      }),
    );
    expect(err.diagnostics[0]?.code).toBe('slot.none-left');
  });

  it('opts.pact is ignored when useSlot: false (a cantrip) — no slot.spent at all, matching the non-pact cantrip shape', () => {
    expect(
      propose.cast(pactCasterSheet(), eldritchBlast, { level: 0, useSlot: false, concentration: false, pact: true }),
    ).toEqual([{ type: 'spell.cast', v: 1, payload: { spellId: eldritchBlast, level: 0, slotUsed: false } }]);
  });

  it('cross-usability, reverse direction (already true, no code change needed): a REGULAR Spellcasting slot is usable for a Warlock spell — slotEntry has never filtered by which class "owns" a spell', () => {
    // A multiclassed Wizard/Warlock's non-pact block still serves any spellId the caller passes,
    // proving the SRD's "you can use the spell slots you gain from the Spellcasting feature to cast
    // Warlock spells you have prepared" direction needs no new code (see `pactSlotFor`'s comment).
    expect(propose.cast(casterSheet(), eldritchBlast, { level: 1, concentration: false })).toEqual([
      { type: 'spell.cast', v: 1, payload: { spellId: eldritchBlast, level: 1 } },
    ]);
  });

  it('round-trips through the real reducer: facts.pactSlots.used increments, facts.slotsUsed is untouched', () => {
    const proposed = propose.cast(pactCasterSheet(), eldritchBlast, { level: 1, concentration: false, pact: true });
    const final = reduce([created, ...wrapAll(2, proposed)]);
    expect(final.pactSlots).toEqual({ used: 1 });
    expect(final.slotsUsed).toEqual({});
  });
});
