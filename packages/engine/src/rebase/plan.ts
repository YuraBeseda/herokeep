import type { DecisionCleared, DecisionMade, ItemUpdated, PackPinned, PackUnpinned } from '@hk/protocol';
import { classSkillPick, findChoice } from '../content/choices.ts';
import type { Pins } from '../content/deps.ts';
import type { ContentIndex } from '../content/index.ts';
import { derive } from '../derive/index.ts';
import { selectionCountOf, validateSelection } from '../derive/validation.ts';
import type { ProposedEvent } from '../propose/index.ts';
import type { Facts, SystemRules } from '../reduce/facts.ts';
import { type SheetChange, diffSheets } from './sheet-diff.ts';

/**
 * A recorded decision the update invalidates (plan 15 ruling 5). Every reason but `'count-reduced'`
 * is one no migration can fix, and the plan clears it. `'count-reduced'` (plan 16 ruling 8): the
 * choice now allows fewer selections than the decision holds — reported, NOT cleared; the player
 * trims it.
 */
export interface InvalidDecision {
  choiceId: string;
  /** The decision's recorded selection, as it is in `facts.decisions`. */
  selection: string[];
  reason: 'choice-missing' | 'selection-missing' | 'selection-deprecated' | 'prerequisite-failed' | 'count-reduced';
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
   * `item.updated` (inventory item-id migrations, plan 16 ruling 7) → `decision.cleared` (invalid
   * decisions without a migration, except `'count-reduced'` ones). */
  events: ProposedEvent[];
}

type Reason = InvalidDecision['reason'];

/**
 * `validateSelection` codes that mean the update broke a decision, mapped to the report's reason.
 * Every other code is ignored on purpose: e.g. `selection.count` also fires for a formula-count
 * choice whose count grew with level (a re-offer, not an invalidation) — a SHRUNK count is detected
 * on its own (`'count-reduced'`, see `classify`) — and ability-pick grammar codes cannot be caused
 * by a pack version change of the selection itself.
 */
const REASON_BY_CODE: Readonly<Record<string, Reason>> = {
  'selection.unknownChoice': 'choice-missing',
  'selection.unresolved': 'selection-missing',
  'selection.notOffered': 'selection-missing',
  'selection.prerequisiteFailed': 'prerequisite-failed',
};
/** Most severe first: a decision that is also broken otherwise is cleared, not merely trimmed. */
const REASON_ORDER: readonly Reason[] = ['choice-missing', 'selection-missing', 'prerequisite-failed', 'count-reduced'];

/** Plan 16 ruling 8: the one reason the plan reports without clearing the decision. */
const clears = (reason: Reason): boolean => reason !== 'count-reduced';

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
 * never satisfy its own prerequisite. `'count-reduced'` (plan 16 ruling 8): more selections than
 * the choice now allows (`selectionCountOf`, the count `validateSelection` checks against).
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
  const count = selectionCountOf(before, index, choiceId);
  if (count !== undefined && selection.length > count) found.add('count-reduced');
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
 *   no longer offered, prerequisite now failing, or — plan 16 ruling 8 — more selections than the
 *   choice now allows: `'count-reduced'`). A decision that was ALREADY invalid before the update is
 *   not the update's doing and is left alone. A migrated decision whose migrated selection is only
 *   `'count-reduced'` is still migrated, and reported.
 * - `events`: `pack.pinned` per new/changed pin, `pack.unpinned` per pin dropped from `nextPins`
 *   (never the core), `decision.made` per migrated decision (selection with every `from` replaced
 *   by its `to`, original `context` kept), `item.updated {instanceId, itemId}` per inventory entry
 *   whose `itemId` `next` marks `deprecated.replacedBy` (plan 16 ruling 7 — the replacement,
 *   chain-walked like a decision's selection), `decision.cleared` per invalid decision except a
 *   `'count-reduced'` one (never cleared: the player trims it).
 * - `changes`: the value diff between the sheet now and the sheet the committed events produce
 *   (facts with the new pins and the fix-ups applied, derived against `next`).
 *
 * Pure and deterministic: no I/O, inputs untouched, decisions visited in code-unit order, inventory
 * entries in inventory order.
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
      const migratedReason = classify(facts, next, rules, choiceId, replaced);
      const migrates = migratedReason === undefined || !clears(migratedReason);
      if (migrates) {
        replaced.forEach((to, i) => {
          if (to !== selection[i]) migrations.push({ choiceId, from: selection[i]!, to });
        });
        migrated.set(choiceId, replaced);
      }
      reason = migrates ? migratedReason : 'selection-deprecated';
    } else {
      reason = classify(facts, next, rules, choiceId, selection);
    }
    if (reason === undefined) continue;
    if (classify(facts, current, rules, choiceId, selection) !== undefined) continue; // pre-existing
    invalid.push({ choiceId, selection: [...selection], reason });
  }

  // Plan 16 ruling 7: every inventory entry whose pack item `next` replaces moves to the replacement.
  const itemMigrations: ItemUpdated[] = [];
  for (const entry of facts.inventory) {
    const to = entry.itemId !== undefined ? replacementOf(next, entry.itemId) : undefined;
    if (to !== undefined) itemMigrations.push({ instanceId: entry.instanceId, itemId: to });
  }
  const cleared = invalid.filter((i) => clears(i.reason));

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
  for (const payload of itemMigrations) events.push({ type: 'item.updated', v: 1, payload });
  for (const { choiceId } of cleared) {
    const payload: DecisionCleared = { choiceId };
    events.push({ type: 'decision.cleared', v: 1, payload });
  }

  // The facts the committed events produce, rebuilt by hand (mirrors the pack.pinned /
  // pack.unpinned / decision.made / item.updated / decision.cleared handlers), so `changes` is
  // exactly what Confirm yields. `test/rebase/plan.test.ts` ("replaying facts + plan events…")
  // pins this mirror: it reduces log + `events` and checks that derive equals these facts' sheet,
  // so a handler change that this block does not follow fails there. Migrated decisions keep
  // their recorded context (re-emitted above); cleared ones lose it, as `decision.cleared` does;
  // a `'count-reduced'` decision is kept as recorded. A migrated inventory entry keeps every field
  // but its `itemId`, as `item.updated` with only an `itemId` does.
  const pins = { ...facts.pins, ...nextPins };
  for (const packId of unpinned) delete pins[packId];
  const decisions = { ...facts.decisions };
  const decisionContexts = { ...facts.decisionContexts };
  for (const [choiceId, selection] of migrated) decisions[choiceId] = [...selection];
  for (const { choiceId } of cleared) {
    delete decisions[choiceId];
    delete decisionContexts[choiceId];
  }
  const movedTo = new Map(itemMigrations.map((m) => [m.instanceId, m.itemId]));
  const inventory = facts.inventory.map((entry) => {
    const itemId = movedTo.get(entry.instanceId);
    return itemId !== undefined ? { ...entry, itemId } : entry;
  });
  const afterSheet = derive({ ...facts, pins, decisions, decisionContexts, inventory }, next, rules);

  return { changes: diffSheets(beforeSheet, afterSheet), invalid, migrations, events };
}
