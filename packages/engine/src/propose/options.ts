import type { CharacterOptionsSet } from '@hk/protocol';
import type { Sheet } from '../derive/sheet.ts';
import type { CharacterOptions } from '../reduce/facts.ts';
import type { ProposedEvent } from './index.ts';

/**
 * Plan 14 (phase 4 slice 4) Task 5, design ruling 8 — drafts ONE `character.options.set@1`
 * carrying only the keys of `patch` that actually change the character's stored options
 * (`sheet.options`, absent ≡ every option at its default). A patch that changes nothing returns
 * `[]` (a no-op, not a refusal: there is nothing impossible about re-selecting the current value,
 * so the UI simply commits nothing). An absent stored encumbrance already means `'off'`, so
 * proposing `'off'` for it is also a no-op.
 */
export function setOptions(sheet: Sheet, patch: CharacterOptions): ProposedEvent[] {
  const current = sheet.options ?? {};
  const payload: CharacterOptionsSet = {};
  if (patch.encumbrance !== undefined && patch.encumbrance !== (current.encumbrance ?? 'off')) {
    payload.encumbrance = patch.encumbrance;
  }
  if (Object.keys(payload).length === 0) return [];
  return [{ type: 'character.options.set', v: 1, payload }];
}
