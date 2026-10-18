import type { DecisionCleared, DecisionMade, PackPinned, PackUnpinned } from '@hk/protocol';
import { classSkillPick, findChoice } from '../content/choices.ts';
import type { Pins } from '../content/deps.ts';
import type { ContentIndex } from '../content/index.ts';
import { derive } from '../derive/index.ts';
import { validateSelection } from '../derive/validation.ts';
import type { ProposedEvent } from '../propose/index.ts';
import type { Facts, SystemRules } from '../reduce/facts.ts';
import { type SheetChange, diffSheets } from './sheet-diff.ts';

/** A recorded decision the update invalidates and no migration can fix (plan 15 ruling 5). */
export interface InvalidDecision {
  choiceId: string;
  /** The decision's recorded selection, as it is in `facts.decisions`. */
  selection: string[];
  reason: 'choice-missing' | 'selection-missing' | 'selection-deprecated' | 'prerequisite-failed';
}

/** One selected entity id replaced via `deprecated.replacedBy` in the next index. */
export interface Migration {
  choiceId: string;
  from: string;
  to: string;
}

export interface RebasePlan {
  changes: SheetChange[];
  invalid: InvalidDecision[];
  migrations: Migration[];
  /** One transaction, in order: `pack.pinned` → `pack.unpinned` → `decision.made` (migrations) →
   * `decision.cleared` (invalid decisions without a migration). */
  events: ProposedEvent[];
}

type Reason = InvalidDecision['reason'];

/**
 * `validateSelection` codes that mean the update broke a decision, mapped to the report's reason.
 * Every other code is ignored on purpose: e.g. `selection.count` also fires for a formula-count
 * choice whose count grew with level (a re-offer, not an invalidation), and ability-pick grammar
 * codes cannot be caused by a pack version change of the selection itself.
 */
const REASON_BY_CODE: Readonly<Record<string, Reason>> = {
  'selection.unknownChoice': 'choice-missing',
  'selection.unresolved': 'selection-missing',
  'selection.notOffered': 'selection-missing',
  'selection.prerequisiteFailed': 'prerequisite-failed',
};
const REASON_ORDER: readonly Reason[] = ['choice-missing', 'selection-missing', 'prerequisite-failed'];

const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function withoutDecision(facts: Facts, choiceId: string): Facts {
  const decisions = { ...facts.decisions };
  delete decisions[choiceId];
  return { ...facts, decisions };
}

/**
 * Why `selection` for `choiceId` is invalid against `index`, or `undefined` when it is valid. The
 * selection is validated the way it was at pick time — against the character WITHOUT this decision
 * (`validateSelection`'s contract: "before this selection is committed"), so a feat's own bonus can
 * never satisfy its own prerequisite.
 */
function classify(
  facts: Facts,
  index: ContentIndex,
  rules: SystemRules | undefined,
  choiceId: string,
  selection: string[],
): Reason | undefined {
  if (!findChoice(index, choiceId) && !classSkillPick(choiceId, index)) return 'choice-missing';
  const before = withoutDecision(facts, choiceId);
  const sheet = derive(before, index, rules);
  const found = new Set<Reason>();
  for (const d of validateSelection(sheet, before, index, choiceId, selection)) {
    const reason = REASON_BY_CODE[d.code];
    if (reason) found.add(reason);
  }
  return REASON_ORDER.find((r) => found.has(r));
}

/** Follows `deprecated.replacedBy` in `index` (cycle-safe); `undefined` when `id` is not replaced. */
function replacementOf(index: ContentIndex, id: string): string | undefined {
  const seen = new Set([id]);
  let current = id;
  for (;;) {
    const next = index.get(current)?.deprecated?.replacedBy;
    if (next === undefined || seen.has(next)) break;
    seen.add(next);
    current = next;
  }
  return current === id ? undefined : current;
}

/**
 * Plans a rebase of `facts` from the `current` content index (its recorded pins) onto `next`
 * (built from `nextPins`) — doc-04 §Versioning and rebase, ADR-008 :85-92, plan 15 ruling 5.
 *
 * - `migrations`: every selected entity that `next` marks `deprecated.replacedBy` is replaced
 *   (transitively); if the migrated selection then validates, it is a migration, otherwise the
 *   decision is `invalid` with reason `selection-deprecated`.
 * - `invalid`: decisions valid under `current` that `next` breaks (choice gone, selection gone or
 *   no longer offered, prerequisite now failing). A decision that was ALREADY invalid before the
 *   update is not the update's doing and is left alone.
 * - `events`: `pack.pinned` per new/changed pin, `pack.unpinned` per pin dropped from `nextPins`
 *   (never the core), `decision.made` per migrated decision (selection with every `from` replaced
 *   by its `to`, original `context` kept), `decision.cleared` per invalid decision.
 * - `changes`: the value diff between the sheet now and the sheet the committed events produce
 *   (facts with the new pins and the fix-ups applied, derived against `next`).
 *
 * Pure and deterministic: no I/O, inputs untouched, decisions visited in code-unit order.
 */
export function planRebase(
  facts: Facts,
  current: ContentIndex,
  next: ContentIndex,
  nextPins: Pins,
  rules?: SystemRules,
): RebasePlan {
  const beforeSheet = derive(facts, current, rules);
  const corePackId = beforeSheet.corePackId;

  const invalid: InvalidDecision[] = [];
  const migrations: Migration[] = [];
  const migrated = new Map<string, string[]>();

  for (const choiceId of Object.keys(facts.decisions).sort(byCodeUnit)) {
    const selection = facts.decisions[choiceId] ?? [];
    const replaced = selection.map((s) => replacementOf(next, s) ?? s);
    const hasReplacement = replaced.some((r, i) => r !== selection[i]);
    const choiceExists = findChoice(next, choiceId) !== undefined || classSkillPick(choiceId, next) !== undefined;

    let reason: Reason | undefined;
    if (hasReplacement && choiceExists) {
      if (classify(facts, next, rules, choiceId, replaced) === undefined) {
        replaced.forEach((to, i) => {
          if (to !== selection[i]) migrations.push({ choiceId, from: selection[i]!, to });
        });
        migrated.set(choiceId, replaced);
        continue;
      }
      reason = 'selection-deprecated';
    } else {
      reason = classify(facts, next, rules, choiceId, selection);
    }
    if (reason === undefined) continue;
    if (classify(facts, current, rules, choiceId, selection) !== undefined) continue; // pre-existing
    invalid.push({ choiceId, selection: [...selection], reason });
  }

  const events: ProposedEvent[] = [];
  for (const packId of Object.keys(nextPins).sort(byCodeUnit)) {
    const version = nextPins[packId]!;
    const previous = facts.pins[packId];
    if (previous === version) continue;
    const payload: PackPinned = { packId, version, ...(previous !== undefined ? { previous } : {}) };
    events.push({ type: 'pack.pinned', v: 1, payload });
  }
  const unpinned = Object.keys(facts.pins)
    .sort(byCodeUnit)
    .filter((packId) => !Object.hasOwn(nextPins, packId) && packId !== corePackId);
  for (const packId of unpinned) {
    const payload: PackUnpinned = { packId };
    events.push({ type: 'pack.unpinned', v: 1, payload });
  }
  for (const [choiceId, selection] of migrated) {
    const context = facts.decisionContexts[choiceId];
    const payload: DecisionMade = { choiceId, selection, ...(context !== undefined ? { context } : {}) };
    events.push({ type: 'decision.made', v: 1, payload });
  }
  for (const { choiceId } of invalid) {
    const payload: DecisionCleared = { choiceId };
    events.push({ type: 'decision.cleared', v: 1, payload });
  }

  // The facts the committed events produce, rebuilt by hand (mirrors the pack.pinned /
  // pack.unpinned / decision.made / decision.cleared handlers), so `changes` is exactly what
  // Confirm yields. `test/rebase/plan.test.ts` ("replaying facts + plan events against next…")
  // pins this mirror: it reduces log + `events` and checks that derive equals these facts' sheet,
  // so a handler change that this block does not follow fails there. Migrated decisions keep
  // their recorded context (re-emitted above); cleared ones lose it, as `decision.cleared` does.
  const pins = { ...facts.pins, ...nextPins };
  for (const packId of unpinned) delete pins[packId];
  const decisions = { ...facts.decisions };
  const decisionContexts = { ...facts.decisionContexts };
  for (const [choiceId, selection] of migrated) decisions[choiceId] = [...selection];
  for (const { choiceId } of invalid) {
    delete decisions[choiceId];
    delete decisionContexts[choiceId];
  }
  const afterSheet = derive({ ...facts, pins, decisions, decisionContexts }, next, rules);

  return { changes: diffSheets(beforeSheet, afterSheet), invalid, migrations, events };
}
