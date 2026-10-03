import type { SlotSpent, SpellCast, SpellUnprepared } from '@hk/protocol';
import type { Sheet } from '../derive/sheet.ts';
import { error } from '../diagnostics.ts';
import { ProposeError, type ProposedEvent } from './index.ts';

const mk = (type: string, payload: unknown): ProposedEvent => ({ type, v: 1, payload });

/** The first `SpellcastingBlock.slots` entry at `level`, across every active caster block. */
function slotEntry(sheet: Sheet, level: number): { level: number; max: number; used: number } | undefined {
  for (const block of sheet.spellcasting) {
    const entry = block.slots.find((s) => s.level === level);
    if (entry) return entry;
  }
  return undefined;
}

/**
 * The first active `SpellcastingBlock.pact` lane, across every block (task 3's report:
 * `SpellcastingBlock.slots` is `[]` by construction for a pact block — see `derive/spellcasting.ts`'s
 * `SpellcastingBlock.pact` doc comment — so it can never be found by `slotEntry` above; that was
 * deliberate, deferring the pact lane's own consumer to this task). At most one block ever carries
 * `.pact` per character (a character has at most one Warlock class), but this scans every block
 * rather than assuming that, matching `slotEntry`'s own defensive "search every block" shape.
 */
function pactEntry(sheet: Sheet): { level: number; count: number; used: number } | undefined {
  for (const block of sheet.spellcasting) {
    if (block.pact) return block.pact;
  }
  return undefined;
}

/**
 * Task 11 (phase 4 plan 11) — the sanctioned pact-awareness addition. Ruling 2's cross-usability
 * clause, quoted verbatim from the vendored 2024 SRD (`packages/content/upstream/
 * open5e-srd-2024/Rule.json`, pk `srd-2024_multiclassing_spellcasting`, "Pact Magic" paragraph):
 * "If you have the Pact Magic feature from the Warlock class and the Spellcasting feature, you can
 * use the spell slots you gain from Pact Magic to cast spells you have prepared from classes with
 * the Spellcasting feature, and you can use the spell slots you gain from the Spellcasting feature
 * to cast Warlock spells you have prepared."
 *
 * The REVERSE direction (a regular Spellcasting slot usable for a Warlock spell) needs no code here
 * at all: `slotEntry` above has never filtered by which class "owns" a spell — neither `spendSlot`
 * nor `cast` ever took a class/spell-ownership parameter — so a non-pact slot found by `slotEntry`
 * already serves a Warlock spell exactly like any other caller's spell. Only the pact -> non-pact
 * direction needed new code, since a pact block's `.slots` is deliberately excluded from
 * `slotEntry`'s search (task 3).
 *
 * A pact slot is a valid option for a request at `level` when the pact lane's OWN level is at least
 * `level` — "where level suffices". Per the vendored worked example ("when you're a level 5 Warlock,
 * you have two level 3 spell slots... To cast the level 1 spell Charm Person, you must spend one of
 * those slots, and you cast it as a level 3 spell"), using a pact slot always effectively casts AT
 * the slot's own (single, fixed-per-character-level) level — never at the caller's lower requested
 * level — so a successful lookup returns the pact lane itself (not merely `true`); callers record
 * `pact.level`, not the value they asked for, as the level actually spent.
 */
function pactSlotFor(sheet: Sheet, level: number): { level: number; count: number; used: number } | undefined {
  const pact = pactEntry(sheet);
  if (!pact || pact.level < level || pact.used >= pact.count) return undefined;
  return pact;
}

/**
 * Refuses with `'slot.none-left'` when no slot exists at `level`, or every one is already used.
 *
 * `opts.pact` selects a SEPARATE lane from the default regular-slot search above, not a fallback
 * tried after it fails: the caller states which lane it means to spend from (the same explicit-
 * intent shape `cast`'s own required `concentration` flag already uses in this file), because a
 * pact spend must be recorded with the PACT slot's own level (`pact.level`) — see `pactSlotFor`'s
 * comment — not the caller's requested `level`, and silently substituting one for the other without
 * being asked would surprise a caller who explicitly asked for a specific `level`.
 */
/**
 * Plan 12 task 3 — drafts `spell.unprepared`, refusing (`'spell.always-prepared'`) when the spell is
 * in that class block's `alwaysPrepared` list (a `spell.grant { alwaysPrepared: true }` from the class
 * or its subclass). Always-prepared spells are re-merged at derive time, so the event would be a
 * no-op anyway; the refusal exists so a UI surfaces a reason instead of silently doing nothing.
 */
export function unprepare(sheet: Sheet, classId: string, spellId: string): ProposedEvent[] {
  const block = sheet.spellcasting.find((b) => b.classId === classId);
  if (block?.alwaysPrepared?.includes(spellId)) {
    throw new ProposeError([
      error('spell.always-prepared', `"${spellId}" is always prepared and cannot be unprepared`, {
        entityId: spellId,
      }),
    ]);
  }
  const payload: SpellUnprepared = { spellId, classId };
  return [mk('spell.unprepared', payload)];
}

export function spendSlot(sheet: Sheet, level: number, opts?: { pact?: boolean }): ProposedEvent[] {
  if (opts?.pact) {
    const pact = pactSlotFor(sheet, level);
    if (!pact) {
      throw new ProposeError([error('slot.none-left', `No pact spell slot at or above level ${level} remains`)]);
    }
    return [mk('slot.spent', { level: pact.level, pact: true } satisfies SlotSpent)];
  }
  const entry = slotEntry(sheet, level);
  if (!entry || entry.used >= entry.max) {
    throw new ProposeError([error('slot.none-left', `No level ${level} spell slots remain`)]);
  }
  return [mk('slot.spent', { level } satisfies SlotSpent)];
}

/**
 * Documented deviation from the brief's literal `opts` shape: the brief says `cast` "folds
 * `spell.cast` with concentration flag read from the spell entity" — but `Sheet` (this family's
 * only input besides `spellId`/`opts`) carries no per-spell entity data (`SpellcastingBlock` only
 * lists known/prepared spell IDs, never full entities — see derive/spellcasting.ts), and the
 * brief's own `cast` signature takes no `ContentIndex` either. Reading the spell entity is
 * therefore impossible from inside this function as literally specified. Resolution (same spirit
 * as the controller ruling's `attunementMax`/`currentWasMax` additions, but here a per-CALL value
 * can't be a `Sheet` field): `opts` gains one additive field, `concentration: boolean` — the
 * caller (the only layer that has BOTH the `Sheet` and the `ContentIndex`) supplies it by reading
 * `spellEntity.concentration` itself.
 *
 * Made REQUIRED (not optional) per code review: an omitted flag would silently leave prior
 * concentration untouched with no diagnostic — a caller that forgets to check the spell entity
 * gets a quiet behavioral gap, not a signal anything's missing. Requiring it turns that into a
 * compile error instead. `true` sets `concentration: true` on the payload; `false` omits the key
 * entirely (the reducer's `spell.cast` handler already treats a missing `concentration` exactly
 * like an explicit `false` — "leave any existing concentration untouched", handlers/casting.ts —
 * so the two are wire-equivalent and there's no reason to pad the payload with a redundant `false`).
 *
 * Slot consumption: consumes a slot at `opts.level` unless `opts.useSlot === false` (mirrors the
 * reducer's own default), refusing with `'slot.none-left'` under the same rule as `spendSlot`. A
 * cantrip (level 0) has no slot table entry at all, so the CALLER must pass `useSlot: false` for
 * one — this matches the reducer's own worked example ("slotUsed: false ... e.g. a cantrip").
 *
 * Task 11 (phase 4 plan 11) — `opts.pact` (sanctioned addition): when `true` and a slot is being
 * consumed, spends from the pact lane instead of the regular one (`pactSlotFor`, same validity rule
 * as `spendSlot`'s own pact branch above). `SpellCastV1` carries no `pact` field (out of this
 * task's sanctioned scope — only `propose/casting.ts` and `propose/rest.ts` change; see
 * task-11-brief.md), so the pact spend is NOT folded into the `spell.cast` payload the way a
 * regular slot is (via `slotUsed: true`, handled entirely inside the reducer). Instead this returns
 * a SECOND event, `slot.spent {level: pact.level, pact: true}` — reusing task 3's already-pact-aware
 * `slot.spent@1` handler verbatim, no reducer change needed — the same multi-event transaction
 * shape `propose.rest` already uses (`rest.taken` + one `resource.restored` per resource). The
 * `spell.cast` event's own `slotUsed` is set to `false` in this case (never `true`) specifically so
 * the reducer's `spell.cast@1` handler (which only ever writes to `facts.slotsUsed`, never
 * `facts.pactSlots`) does NOT also bump a regular slot for the same cast, which would double-spend
 * from the wrong pool. Read this transaction's two events TOGETHER, not `spell.cast.slotUsed`
 * alone, to know whether a slot was used at all — exactly the same caveat `propose.rest`'s own
 * `rest.taken`+`resource.restored` transaction already carries.
 */
export function cast(
  sheet: Sheet,
  spellId: string,
  opts: { level: number; useSlot?: boolean; concentration: boolean; pact?: boolean },
): ProposedEvent[] {
  const consumesSlot = opts.useSlot !== false;
  const events: ProposedEvent[] = [];
  let pact: { level: number; count: number; used: number } | undefined;

  if (consumesSlot && opts.pact) {
    pact = pactSlotFor(sheet, opts.level);
    if (!pact) {
      throw new ProposeError([error('slot.none-left', `No pact spell slot at or above level ${opts.level} remains`)]);
    }
  } else if (consumesSlot) {
    const entry = slotEntry(sheet, opts.level);
    if (!entry || entry.used >= entry.max) {
      throw new ProposeError([error('slot.none-left', `No level ${opts.level} spell slots remain`)]);
    }
  }

  const payload: SpellCast = {
    spellId,
    level: opts.level,
    // A pact spend ALWAYS explicitly sets `slotUsed: false` here, regardless of whether the caller
    // passed `opts.useSlot` at all — omitting the key would fall through to the reducer's own
    // "no explicit false -> bump slotsUsed" default (see this function's header comment), which
    // would double-spend a REGULAR slot in addition to the pact one this function already validated
    // and is about to record via the second `slot.spent` event pushed below.
    ...(pact ? { slotUsed: false } : opts.useSlot !== undefined ? { slotUsed: opts.useSlot } : {}),
    ...(opts.concentration ? { concentration: true } : {}),
  };
  events.push(mk('spell.cast', payload));
  if (pact) events.push(mk('slot.spent', { level: pact.level, pact: true } satisfies SlotSpent));
  return events;
}
