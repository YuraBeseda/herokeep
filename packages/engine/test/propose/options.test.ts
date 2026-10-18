import { describe, expect, it } from 'vitest';
import { propose } from '../../src/propose/index.ts';
import { baseSheet } from './support.ts';

/** Plan 14 (phase 4 slice 4) Task 5, design ruling 8 — `propose.setOptions`. */
describe('propose.setOptions', () => {
  it('emits one character.options.set@1 carrying the changed key', () => {
    expect(propose.setOptions(baseSheet(), { encumbrance: 'variant' })).toEqual([
      { type: 'character.options.set', v: 1, payload: { encumbrance: 'variant' } },
    ]);
  });

  it('switching an already-set option emits the new value', () => {
    const sheet = baseSheet({ options: { encumbrance: 'variant' } });
    expect(propose.setOptions(sheet, { encumbrance: 'standard' })).toEqual([
      { type: 'character.options.set', v: 1, payload: { encumbrance: 'standard' } },
    ]);
  });

  it('turning a set option back off records "off" explicitly', () => {
    const sheet = baseSheet({ options: { encumbrance: 'standard' } });
    expect(propose.setOptions(sheet, { encumbrance: 'off' })).toEqual([
      { type: 'character.options.set', v: 1, payload: { encumbrance: 'off' } },
    ]);
  });

  it('no-op (no events) when the patch changes nothing', () => {
    const sheet = baseSheet({ options: { encumbrance: 'variant' } });
    expect(propose.setOptions(sheet, { encumbrance: 'variant' })).toEqual([]);
  });

  it('no-op for "off" when no option was ever stored (absent already means off)', () => {
    expect(propose.setOptions(baseSheet(), { encumbrance: 'off' })).toEqual([]);
  });

  it('no-op for an empty patch', () => {
    expect(propose.setOptions(baseSheet(), {})).toEqual([]);
  });
});
