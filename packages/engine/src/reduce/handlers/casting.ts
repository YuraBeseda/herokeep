import {
  type ResourceRestored,
  type ResourceSpent,
  type RestTaken,
  type SlotRestored,
  type SlotSpent,
  type SpellCast,
  type SpellForgotten,
  type SpellLearned,
  type SpellPrepared,
  type SpellUnprepared,
} from '@hk/protocol';
import { requireCreated } from '../facts.ts';
import type { Handler } from '../reducer.ts';

/**
 * `rest.taken` — binding design (controller ruling R-pf1): the reducer stays content-free, so
 * it never decides WHICH resources a rest restores — that knowledge (which `resource.define`
 * entries reset on which rest kind) lives entirely in the sheet-aware proposer, `propose.rest`
 * (T14). `propose.rest` emits ONE transaction per rest:
 *   - `rest.taken {kind, hitDiceSpent?}`, plus
 *   - one `resource.restored {resourceId}` (the full-restore form — no `count`) per active
 *     resource whose `resource.define reset` matches the rest kind. A long rest also restores
 *     every `shortRest`-reset resource (a long rest includes everything a short one grants).
 *
 * This handler applies ONLY the rule-scalar parts it can compute itself from `ctx.rules`
 * (`SystemRules`, the pinned core pack's `restRules`) — it never touches `resourcesUsed`; that
 * comes entirely from the `resource.restored` events in the same transaction.
 *
 *   - long rest: `hp.temp` drops to 0; death saves reset; `slotsUsed` clears to `{}` when
 *     `restRules.longRest.restoreAllSlots`; every condition entry that carries a `level` has it
 *     reduced by `exhaustionReduce`, and is dropped once its level is <= 0 (matched structurally
 *     by "has a `level`" — the reducer doesn't know which conditionId means "exhaustion"; per
 *     CLAUDE.md rule 1, that's content, not TypeScript. 1b scope has at most one leveled
 *     condition, but this reduces every leveled entry it finds); each class's `hitDiceSpent`
 *     regains `max(hitDiceRegainMin, floor(classLevel / hitDiceRegainDivisor))`, floored at 0
 *     spent; and when `restRules.longRest.hpToMax`, `hp.current` becomes the literal `'max'` —
 *     the sentinel documented on `Facts.hp` in `facts.ts` (full contract there, incl. how
 *     `hp.changed` in `handlers/vitals.ts` reacts to it).
 *   - short rest: marks the payload's `hitDiceSpent` entries as spent, and ONLY when
 *     `restRules.shortRest.allowHitDice` — nothing else. Healing from hit dice arrives
 *     separately as an explicit `hit_dice.spent {healed}` event; resource resets arrive as the
 *     proposer's `resource.restored` events described above.
 *
 * Skips with `'no-system-rules'` when `ctx.rules` is absent — every other calculation above
 * depends on it.
 */
export const HANDLERS: Record<string, Handler> = {
  'slot.spent@1': (f, e) => {
    const p = e.payload as SlotSpent;
    const skip = requireCreated(f);
    if (skip) return skip;
    // `pact` is accepted but ignored in Phase 1 — no pact casters are wired yet; pact and
    // non-pact spends of the same level share one `slotsUsed[level]` counter.
    const used = (f.slotsUsed[p.level] ?? 0) + (p.count ?? 1);
    return { ...f, slotsUsed: { ...f.slotsUsed, [p.level]: used } };
  },

  'slot.restored@1': (f, e) => {
    const p = e.payload as SlotRestored;
    const skip = requireCreated(f);
    if (skip) return skip;
    const used = Math.max(0, (f.slotsUsed[p.level] ?? 0) - (p.count ?? 1));
    return { ...f, slotsUsed: { ...f.slotsUsed, [p.level]: used } };
  },

  'resource.spent@1': (f, e) => {
    const p = e.payload as ResourceSpent;
    const skip = requireCreated(f);
    if (skip) return skip;
    const used = (f.resourcesUsed[p.resourceId] ?? 0) + (p.count ?? 1);
    return { ...f, resourcesUsed: { ...f.resourcesUsed, [p.resourceId]: used } };
  },

  // A missing `count` is the full-restore form (reset to 0 used) — NOT "subtract 1", unlike
  // `slot.restored`. See this file's header comment: `propose.rest` relies on exactly this.
  'resource.restored@1': (f, e) => {
    const p = e.payload as ResourceRestored;
    const skip = requireCreated(f);
    if (skip) return skip;
    const used = p.count === undefined ? 0 : Math.max(0, (f.resourcesUsed[p.resourceId] ?? 0) - p.count);
    return { ...f, resourcesUsed: { ...f.resourcesUsed, [p.resourceId]: used } };
  },

  'spell.prepared@1': (f, e) => {
    const p = e.payload as SpellPrepared;
    const skip = requireCreated(f);
    if (skip) return skip;
    const list = f.preparedSpells[p.classId] ?? [];
    if (list.includes(p.spellId)) return f;
    return { ...f, preparedSpells: { ...f.preparedSpells, [p.classId]: [...list, p.spellId] } };
  },

  'spell.unprepared@1': (f, e) => {
    const p = e.payload as SpellUnprepared;
    const skip = requireCreated(f);
    if (skip) return skip;
    const list = f.preparedSpells[p.classId] ?? [];
    return { ...f, preparedSpells: { ...f.preparedSpells, [p.classId]: list.filter((id) => id !== p.spellId) } };
  },

  'spell.learned@1': (f, e) => {
    const p = e.payload as SpellLearned;
    const skip = requireCreated(f);
    if (skip) return skip;
    const list = f.knownSpells[p.classId] ?? [];
    if (list.includes(p.spellId)) return f;
    return { ...f, knownSpells: { ...f.knownSpells, [p.classId]: [...list, p.spellId] } };
  },

  'spell.forgotten@1': (f, e) => {
    const p = e.payload as SpellForgotten;
    const skip = requireCreated(f);
    if (skip) return skip;
    const list = f.knownSpells[p.classId] ?? [];
    return { ...f, knownSpells: { ...f.knownSpells, [p.classId]: list.filter((id) => id !== p.spellId) } };
  },

  // Folds a cast into its resource cost rather than requiring a separate slot.spent event:
  // consumes a slot at the cast level unless the payload says otherwise (slotUsed: false, e.g.
  // a cantrip or a feature that casts free), and starts concentration only when the payload
  // says so — concentration omitted/false leaves any existing concentration untouched (ending
  // the PREVIOUS spell's concentration on a new cast is the proposer's concern, same as
  // `concentration.started` in handlers/vitals.ts).
  'spell.cast@1': (f, e) => {
    const p = e.payload as SpellCast;
    const skip = requireCreated(f);
    if (skip) return skip;
    const slotsUsed =
      p.slotUsed !== false ? { ...f.slotsUsed, [p.level]: (f.slotsUsed[p.level] ?? 0) + 1 } : f.slotsUsed;
    return p.concentration === true
      ? { ...f, slotsUsed, concentration: { spellId: p.spellId, sinceEventId: e.id } }
      : { ...f, slotsUsed };
  },

  'rest.taken@1': (f, e, ctx) => {
    const p = e.payload as RestTaken;
    const skip = requireCreated(f);
    if (skip) return skip;
    if (!ctx?.rules) return 'no-system-rules';
    const { restRules } = ctx.rules;

    if (p.kind === 'long') {
      const { longRest } = restRules;

      const conditions = f.conditions
        .map((c) => (c.level === undefined ? c : { ...c, level: c.level - longRest.exhaustionReduce }))
        .filter((c) => c.level === undefined || c.level > 0);

      const hitDiceSpent = { ...f.hitDiceSpent };
      for (const classId of Object.keys(f.hitDiceSpent)) {
        const classLevel = f.classes.find((c) => c.classId === classId)?.level ?? 0;
        const regain = Math.max(longRest.hitDiceRegainMin, Math.floor(classLevel / longRest.hitDiceRegainDivisor));
        hitDiceSpent[classId] = Math.max(0, (hitDiceSpent[classId] ?? 0) - regain);
      }

      return {
        ...f,
        hp: { ...f.hp, temp: 0, current: longRest.hpToMax ? 'max' : f.hp.current },
        deathSaves: { successes: 0, failures: 0 },
        slotsUsed: longRest.restoreAllSlots ? {} : f.slotsUsed,
        conditions,
        hitDiceSpent,
      };
    }

    // short rest: only mark the payload's hit-dice spend, and only when the rules allow it.
    const { shortRest } = restRules;
    if (!shortRest.allowHitDice || p.hitDiceSpent === undefined) return f;
    const hitDiceSpent = { ...f.hitDiceSpent };
    for (const entry of p.hitDiceSpent) {
      hitDiceSpent[entry.classId] = (hitDiceSpent[entry.classId] ?? 0) + entry.count;
    }
    return { ...f, hitDiceSpent };
  },
};
