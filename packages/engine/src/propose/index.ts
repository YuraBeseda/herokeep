import type { Diagnostic } from '../diagnostics.ts';
import * as casting from './casting.ts';
import * as items from './items.ts';
import * as notes from './notes.ts';
import * as restFamily from './rest.ts';
import * as vitals from './vitals.ts';

/** An envelope-less payload draft: what a `propose.*` function returns, one per event it drafts. */
export interface ProposedEvent {
  type: string;
  v: 1;
  payload: unknown;
}

/**
 * Thrown by a `propose.*` function that refuses an impossible action (e.g. `slot.spent` with no
 * slots left). Carries the `Diagnostic[]` a UI needs to explain the refusal — same shape every
 * other validation channel in this package uses (`derive/*`'s `issues`, `content/validate.ts`).
 */
export class ProposeError extends Error {
  readonly diagnostics: Diagnostic[];
  constructor(diagnostics: Diagnostic[]) {
    super(diagnostics.map((d) => d.message).join('; ') || 'Proposal refused');
    this.name = 'ProposeError';
    this.diagnostics = diagnostics;
  }
}

/**
 * Bridges a derived `Sheet` back to `propose.*.*@1` event drafts (task-14-brief.md). Every
 * function validates against the `Sheet` and throws a `ProposeError` on an impossible action —
 * the UI catches it and surfaces `error.diagnostics`. None of these touch a `ContentIndex`
 * directly (deliberate, per the brief's literal signatures): everything they need is either
 * already on the derived `Sheet`, or supplied by the caller (`newId` for `addItem`, an explicit
 * `concentration` flag for `cast` — see propose/casting.ts's header comment for why).
 */
export const propose = {
  damage: vitals.damage,
  heal: vitals.heal,
  tempHp: vitals.tempHp,
  spendSlot: casting.spendSlot,
  cast: casting.cast,
  rest: restFamily.rest,
  spendHitDie: vitals.spendHitDie,
  deathSave: vitals.deathSave,
  equip: items.equip,
  attune: items.attune,
  addItem: items.addItem,
  currency: items.currency,
  condition: vitals.condition,
  inspiration: vitals.inspiration,
  note: notes.note,
};
