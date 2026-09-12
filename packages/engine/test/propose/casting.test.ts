import { describe, expect, it } from 'vitest';
import type { Sheet } from '../../src/derive/sheet.ts';
import { propose } from '../../src/propose/index.ts';
import { baseSheet, captureProposeError } from './support.ts';

const wizard = 'core-mini:class/wizard';
const fireball = 'core-mini:spell/fireball';

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
  it('defaults to consuming a slot at the cast level, omitting slotUsed/concentration when not given', () => {
    expect(propose.cast(casterSheet(), fireball, { level: 1 })).toEqual([
      { type: 'spell.cast', v: 1, payload: { spellId: fireball, level: 1 } },
    ]);
  });

  it('useSlot: false skips the slot check entirely (a cantrip) and forwards slotUsed: false', () => {
    expect(propose.cast(casterSheet(), fireball, { level: 0, useSlot: false })).toEqual([
      { type: 'spell.cast', v: 1, payload: { spellId: fireball, level: 0, slotUsed: false } },
    ]);
  });

  it('forwards an explicit concentration flag (the documented opts.concentration deviation)', () => {
    expect(propose.cast(casterSheet(), fireball, { level: 3, useSlot: true, concentration: true })).toEqual([
      { type: 'spell.cast', v: 1, payload: { spellId: fireball, level: 3, slotUsed: true, concentration: true } },
    ]);
  });

  it('refuses with "slot.none-left" when the cast would consume a slot that has none left', () => {
    const err = captureProposeError(() => propose.cast(casterSheet(), fireball, { level: 2 }));
    expect(err.diagnostics[0]?.code).toBe('slot.none-left');
  });
});
