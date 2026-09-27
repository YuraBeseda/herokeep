import { type ClassEntity, type Effect, parseEntityId } from '@hk/protocol';
import type { ContentIndex } from '../content/index.ts';
import { type Diagnostic, warning } from '../diagnostics.ts';
import { type FormulaContext, evalFormulaString } from '../formula/evaluate.ts';
import type { Facts } from '../reduce/facts.ts';
import type { AbilitiesResult } from './abilities.ts';
import type { Composition } from './composition.ts';
import type { Derived } from './modifiers.ts';

export interface SpellcastingBlock {
  classId: string;
  ability: string;
  dc: Derived<number>;
  attack: Derived<number>;
  /**
   * From `system.tables.spellSlots[effect.slots][classLevel - 1]`, `used` overlaid from
   * `facts.slotsUsed`. When `classes.length` has MORE THAN ONE class carrying an active
   * `spellcasting.define` effect whose `slots` progression is `full`/`half`/`third` AND has an
   * entry in `system.tables.multiclassSlots.weights`, this is instead the COMBINED table row at
   * the summed caster level (ruling 2, phase 4 plan 11 task 3 — see `deriveSpellcasting`'s own
   * header comment for the exact SRD-cited condition). Empty for a `slots: 'pact'` block — see
   * `pact` below.
   */
  slots: { level: number; max: number; used: number }[];
  /**
   * Present ONLY for a `slots: 'pact'` effect (Warlock Pact Magic) — tracked separately from
   * `slots`/`facts.slotsUsed` per ruling 2 (`facts.pactSlots`, see `reduce/facts.ts`'s field
   * comment for the SRD citation). `level`/`count` come from `system.tables.spellSlots.pact` at
   * the class's own level (never combined into `multiclassSlots` — Pact Magic is a separate
   * feature from Spellcasting per the vendored SRD text quoted in `deriveSpellcasting` below).
   */
  pact?: { level: number; count: number; used: number };
  preparation: string;
  preparedMax?: number;
  /** From `facts.preparedSpells`/`knownSpells`, keyed by the class's resolved (canonical) entity id — see `classId` below. */
  prepared: string[];
  known: string[];
  cantripsKnown?: number;
  ritual: boolean;
}

/**
 * A class's numeric value for a slug (per `ValueSchema`, used by `ClassLevelRow.extra`) is either a
 * plain int or a formula string — evaluate the latter, pass the former through.
 */
const resolveValue = (v: number | string, evalFormula: (f: string) => number): number =>
  typeof v === 'number' ? v : evalFormula(v);

/**
 * The row-extra key a class's per-level "spells you can have prepared" count lives under.
 *
 * `spellcasting.define` has no dedicated field for this (its `preparedCount` is a linear FORMULA,
 * unsuitable for the SRD 2024 prepared-casters' actual progression, which is a stepped table, not a
 * function of level — see `preparedMax`'s ruling below). The real SRD import (plan-2,
 * `packages/content/src/overlays/wizard.json`) already stores that table as one `ClassLevelRow.extra`
 * entry per level, keyed `"<classSlug>-prepared-spells"` (verified against
 * `packages/content/test/mechanics.test.ts`'s wizard fixture: `extra['wizard-prepared-spells']`) —
 * `ClassLevelRowSchema.extra`'s keys are `SlugSchema` (lowercase-hyphen only), so the literal
 * camelCase `preparedSpells` an earlier plan draft used was never valid pack data (R20). This
 * function mirrors that established convention rather than inventing a second one.
 */
const preparedSpellsKey = (classSlug: string): string => `${classSlug}-prepared-spells`;

/**
 * The row-extra key a class's per-level cantrips-known count lives under (phase 4 plan 11 task 3 —
 * closes the fallback gap task-1-report.md flagged: `cantripsKnown` had no "row wins over formula"
 * precedence even though `preparedMax` already did). Mirrors `preparedSpellsKey`'s naming convention
 * exactly (`"<classSlug>-cantrips-known"`) so T8's real wizard-to-20 stepped cantrip table (3 at 1st,
 * 4 at 4th, 5 at 10th — the plain formula only matches through level 7) can be authored against it.
 */
const cantripsKnownKey = (classSlug: string): string => `${classSlug}-cantrips-known`;

/**
 * The highest `ClassLevelRow.extra[key]` at or below `classLevel`, resolved through `evalFormula`
 * when it's a formula string — shared by `preparedMax` and `cantripsKnown`, both of which need the
 * identical "row-extra wins over a formula fallback" precedence (task-1-report.md's finding #5;
 * task-3-brief.md's "CLOSE IT" instruction for `cantripsKnown`). Exported (phase 4 plan 11 task 6):
 * `derive/attacks.ts`'s `mastery.grant.count` wiring reuses this exact pattern rather than forking
 * it — `<classSlug>-weapon-mastery-count` wins over the effect's flat formula the same way
 * `<classSlug>-cantrips-known` already wins over `cantripsKnown`'s.
 */
export function bestRowExtra(
  classEntity: ClassEntity,
  classLevel: number,
  key: string,
  evalFormula: (f: string) => number,
): number | undefined {
  let best: number | undefined;
  let bestLevel = -1;
  for (const row of classEntity.levels) {
    if (row.level > classLevel) continue;
    const raw = row.extra?.[key];
    if (raw === undefined || row.level <= bestLevel) continue;
    bestLevel = row.level;
    best = resolveValue(raw, evalFormula);
  }
  return best;
}

/** The `spellcasting.define` effect member, narrowed out of the protocol's `Effect` union. */
type SpellcastingDefineEffect = Extract<Effect, { type: 'spellcasting.define' }>;
/** `SlotProgressionSchema`'s inferred type ('full'|'half'|'third'|'pact'|'none') — no exported alias in `@hk/protocol`, so extracted from the effect shape instead of re-declaring the enum literals in TS. */
type SlotProgression = SpellcastingDefineEffect['slots'];
/** `MulticlassProgressionSchema`'s inferred type ('full'|'half'|'third', no 'pact') — extracted from `system.tables.multiclassSlots.weights`'s own key type rather than re-declared. */
type MulticlassProgression = Exclude<SlotProgression, 'pact' | 'none'>;

/** One active `spellcasting.define` effect, resolved against the content index — an intermediate shape shared by both slot-table passes below. */
interface CasterEntry {
  classId: string;
  classEntity: ClassEntity;
  classLevel: number;
  slotsKind: SlotProgression;
  ability: string;
  preparation: string;
  ritual: boolean;
  cantripsKnownFormula?: string;
  preparedCountFormula?: string;
}

/** `system.tables.spellSlots[progression][classLevel - 1]`, or `undefined` with a diagnostic. */
function ownRow(
  progressionRows: number[][] | undefined,
  classLevel: number,
  classId: string,
  slotsKind: string,
  issues: Diagnostic[],
): number[] | undefined {
  if (progressionRows === undefined) {
    issues.push(
      warning('derive.missingSpellSlotTable', `No spell slot table for progression "${slotsKind}"`, {
        entityId: classId,
      }),
    );
    return undefined;
  }
  return progressionRows[classLevel - 1];
}

/**
 * Derives spellcasting blocks (one per active `spellcasting.define` effect) plus the character's
 * active concentration, stripped to just the spell id (`facts.concentration.sinceEventId` is a
 * reducer/event-log concern, not a derived-sheet one).
 *
 * `dc` = `8 + prof + mod(ability)`, `attack` = `prof + mod(ability)` — flat arithmetic, not routed
 * through a `ModifierTable`: the 1b effect catalog has no "spell DC/attack bonus" effect type to
 * stack on top (an `attack.bonus` with `filter.spell: true` is reserved for a future task; see
 * `attacks.ts`'s `matchesFilter`, which already refuses to apply such a filter to a WEAPON row but
 * nothing yet consumes it for a spell row either).
 *
 * **Multiclass combined slot table (ruling 2, phase 4 plan 11 task 3).** Quoted verbatim from the
 * vendored 2024 SRD (`packages/content/upstream/open5e-srd-2024/Rule.json`, pk
 * `srd-2024_multiclassing_spellcasting`): "Your capacity for spellcasting depends partly on your
 * combined levels in all your spellcasting classes and partly on your individual levels in those
 * classes. **Once you have the Spellcasting feature from more than one class, use the rules below.
 * If you multiclass but have the Spellcasting feature from only one class, follow the rules for
 * that class.**" So the gate is NOT `facts.classes.length > 1` — a Fighter 3 / Wizard 5 character
 * has two classes but only ONE Spellcasting feature (Fighter grants none), and per this text must
 * keep using Wizard's own solo table. The gate implemented below is: count the active
 * `spellcasting.define` effects whose `slots` progression has an entry in
 * `system.tables.multiclassSlots.weights` (`full`/`half`/`third` only — `weights` has no `pact` key
 * by schema construction, matching the same SRD passage's separate "Pact Magic" paragraph, which
 * keeps Warlock's slots out of this combination). When that count is `>= 2`, every one of those
 * blocks' `.slots` becomes the SAME combined-level row (a pooled resource, matching how
 * `facts.slotsUsed` is already a single global-by-spell-level counter, not per class) instead of its
 * own per-class table; a single qualifying class (or zero) falls through to the existing per-class
 * lookup, unchanged — this is what keeps every single-class golden byte-identical. The combined
 * caster level is computed PER CLASS THEN SUMMED (task-1-report.md's binding fix-round note): each
 * class's own level is divided by its progression's `weights[...].divisor` and rounded
 * `weights[...].rounding` ('up' -> ceil, 'down' -> floor) INDIVIDUALLY, and only then are those
 * per-class results added together — never `floor`/`ceil` of the pre-summed total.
 *
 * **Pact slots** are tracked and exposed separately — see `SpellcastingBlock.pact`'s own comment.
 *
 * `preparedMax`/`cantripsKnown`: the class's level-row `extra[key(...)]` (the highest row at or
 * below the class's current level that carries the key) WINS over evaluating the effect's own
 * formula when both are present — the row-extra table is the authoritative, level-accurate source;
 * the formula is only a fallback for a class whose count genuinely is linear in level. Both fields
 * share `bestRowExtra` above (phase 4 plan 11 task 3 closes the gap: `cantripsKnown` previously
 * evaluated its formula unconditionally, with no row-wins fallback — see this module's `cantripsKnownKey`).
 */
export function deriveSpellcasting(
  abilities: AbilitiesResult,
  comp: Composition,
  facts: Facts,
  index: ContentIndex,
): { blocks: SpellcastingBlock[]; concentration?: { spellId: string }; issues: Diagnostic[] } {
  const issues: Diagnostic[] = [];
  const system = index.system();
  const mod = (ability: string) => abilities.abilities[ability]?.mod ?? 0;

  const formulaCtx: FormulaContext = {
    level: comp.totalLevel,
    prof: abilities.prof,
    classLevel: (ref) => comp.classLevels[index.resolveClassRef(ref) ?? ref] ?? 0,
    mod,
    score: (ability) => abilities.abilities[ability]?.score.value ?? 0,
    hitDie: (slug) => {
      const classId = index.resolveClassRef(slug) ?? slug;
      const entity = index.get(classId);
      return entity?.type === 'class' ? entity.hitDie : 0;
    },
    resource: () => 0,
  };
  const evalFormula = (f: string) => evalFormulaString(f, formulaCtx);

  // ---- Pass 1: resolve every active spellcasting.define effect into a CasterEntry. -----------
  const casters: CasterEntry[] = [];
  for (const ae of abilities.effects) {
    const eff = ae.effect;
    if (eff.type !== 'spellcasting.define') continue;

    const classId = index.resolveClassRef(eff.class) ?? eff.class;
    const classEntity: ClassEntity | undefined = ((): ClassEntity | undefined => {
      const e = index.get(classId);
      return e?.type === 'class' ? e : undefined;
    })();
    if (!classEntity) {
      issues.push(
        warning('derive.unresolvedEntity', `Unresolved spellcasting class "${eff.class}"`, { entityId: classId }),
      );
      continue;
    }
    casters.push({
      classId,
      classEntity,
      classLevel: comp.classLevels[classId] ?? 0,
      slotsKind: eff.slots,
      ability: eff.ability,
      preparation: eff.preparation,
      ritual: eff.ritual,
      cantripsKnownFormula: eff.cantripsKnown,
      preparedCountFormula: eff.preparedCount,
    });
  }

  // ---- Combined multiclass caster level (only over full/half/third casters with a weight entry) --
  const weights = system.tables.multiclassSlots?.weights;
  const isWeightedCaster = (c: CasterEntry): c is CasterEntry & { slotsKind: MulticlassProgression } =>
    weights !== undefined && c.slotsKind !== 'pact' && c.slotsKind !== 'none' && weights[c.slotsKind] !== undefined;
  const weightedCasters = casters.filter(isWeightedCaster);

  let combinedRow: number[] | undefined;
  const combinedClassIds = new Set<string>();
  if (weights !== undefined && weightedCasters.length >= 2) {
    const combinedLevel = weightedCasters.reduce((sum, c) => {
      const w = weights[c.slotsKind]!;
      const divided = c.classLevel / w.divisor;
      return sum + (w.rounding === 'up' ? Math.ceil(divided) : Math.floor(divided));
    }, 0);
    combinedRow = system.tables.multiclassSlots!.slots[combinedLevel - 1];
    if (combinedRow === undefined) {
      issues.push(
        warning(
          'derive.missingSpellSlotTable',
          `No multiclass slot table row for combined caster level ${combinedLevel}`,
        ),
      );
    }
    for (const c of weightedCasters) combinedClassIds.add(c.classId);
  }

  // ---- Pass 2: build each block. ----------------------------------------------------------------
  const blocks: SpellcastingBlock[] = [];
  for (const c of casters) {
    const { classId, classEntity, classLevel, slotsKind } = c;

    let slots: SpellcastingBlock['slots'] = [];
    let pact: SpellcastingBlock['pact'];

    if (slotsKind === 'pact') {
      const row = ownRow(system.tables.spellSlots.pact, classLevel, classId, 'pact', issues);
      const levelIdx = row?.findIndex((v) => v > 0) ?? -1;
      if (row && levelIdx >= 0) {
        pact = { level: levelIdx + 1, count: row[levelIdx]!, used: facts.pactSlots.used };
      }
    } else if (combinedClassIds.has(classId) && combinedRow) {
      slots = combinedRow.map((max, i) => ({ level: i + 1, max, used: facts.slotsUsed[i + 1] ?? 0 }));
    } else {
      const row = ownRow(system.tables.spellSlots[slotsKind], classLevel, classId, slotsKind, issues);
      if (row) slots = row.map((max, i) => ({ level: i + 1, max, used: facts.slotsUsed[i + 1] ?? 0 }));
    }

    const classSlug = parseEntityId(classId)?.slug ?? classId;

    let preparedMax = bestRowExtra(classEntity, classLevel, preparedSpellsKey(classSlug), evalFormula);
    if (preparedMax === undefined && c.preparedCountFormula !== undefined) {
      preparedMax = evalFormula(c.preparedCountFormula);
    }

    let cantripsKnown = bestRowExtra(classEntity, classLevel, cantripsKnownKey(classSlug), evalFormula);
    if (cantripsKnown === undefined && c.cantripsKnownFormula !== undefined) {
      cantripsKnown = evalFormula(c.cantripsKnownFormula);
    }

    blocks.push({
      classId,
      ability: c.ability,
      dc: { value: 8 + abilities.prof + mod(c.ability), contributions: [] },
      attack: { value: abilities.prof + mod(c.ability), contributions: [] },
      slots,
      ...(pact ? { pact } : {}),
      preparation: c.preparation,
      preparedMax,
      prepared: facts.preparedSpells[classId] ?? [],
      known: facts.knownSpells[classId] ?? [],
      cantripsKnown,
      ritual: c.ritual,
    });
  }
  blocks.sort((a, b) => (a.classId < b.classId ? -1 : a.classId > b.classId ? 1 : 0));

  const concentration = facts.concentration ? { spellId: facts.concentration.spellId } : undefined;

  return { blocks, concentration, issues };
}
