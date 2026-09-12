import { type ClassEntity, parseEntityId } from '@hk/protocol';
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
  /** From `system.tables.spellSlots[effect.slots][classLevel - 1]`, `used` overlaid from `facts.slotsUsed`. */
  slots: { level: number; max: number; used: number }[];
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
 * Derives spellcasting blocks (one per active `spellcasting.define` effect — multiple only with
 * multiclass casters, out of 1b's single-caster scope but handled uniformly anyway) plus the
 * character's active concentration, stripped to just the spell id (`facts.concentration.sinceEventId`
 * is a reducer/event-log concern, not a derived-sheet one).
 *
 * `dc` = `8 + prof + mod(ability)`, `attack` = `prof + mod(ability)` — flat arithmetic, not routed
 * through a `ModifierTable`: the 1b effect catalog has no "spell DC/attack bonus" effect type to
 * stack on top (an `attack.bonus` with `filter.spell: true` is reserved for a future task; see
 * `attacks.ts`'s `matchesFilter`, which already refuses to apply such a filter to a WEAPON row but
 * nothing yet consumes it for a spell row either).
 *
 * `preparedMax`: the class's level-row `extra[preparedSpellsKey(...)]` (the highest row at or below
 * the class's current level that carries the key) WINS over evaluating `preparedCount` when both are
 * present — the row-extra table is the authoritative, level-accurate source; `preparedCount` is only
 * a fallback for a class whose count genuinely is a linear formula of level.
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

  const blocks: SpellcastingBlock[] = [];
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
    const classLevel = comp.classLevels[classId] ?? 0;

    // ---- Slots: `system.tables.spellSlots[progression]`, row = CLASS level (1-indexed -> array
    // index `classLevel - 1`); row[i] = max slots for spell level `i + 1`. `used` overlays from
    // `facts.slotsUsed`, keyed by spell level (single caster in 1b — no cross-class pooling). -------
    const progressionRows = system.tables.spellSlots[eff.slots];
    let slots: SpellcastingBlock['slots'] = [];
    if (progressionRows === undefined) {
      issues.push(
        warning('derive.missingSpellSlotTable', `No spell slot table for progression "${eff.slots}"`, {
          entityId: classId,
        }),
      );
    } else {
      const row = progressionRows[classLevel - 1];
      if (row) {
        slots = row.map((max, i) => ({ level: i + 1, max, used: facts.slotsUsed[i + 1] ?? 0 }));
      }
    }

    // ---- preparedMax: highest row.extra[key] at or below classLevel, else the preparedCount formula ----
    const classSlug = parseEntityId(classId)?.slug ?? eff.class;
    const key = preparedSpellsKey(classSlug);
    let preparedMax: number | undefined;
    let bestLevel = -1;
    for (const row of classEntity.levels) {
      if (row.level > classLevel) continue;
      const raw = row.extra?.[key];
      if (raw === undefined || row.level <= bestLevel) continue;
      bestLevel = row.level;
      preparedMax = resolveValue(raw, evalFormula);
    }
    if (preparedMax === undefined && eff.preparedCount !== undefined) {
      preparedMax = evalFormula(eff.preparedCount);
    }

    blocks.push({
      classId,
      ability: eff.ability,
      dc: { value: 8 + abilities.prof + mod(eff.ability), contributions: [] },
      attack: { value: abilities.prof + mod(eff.ability), contributions: [] },
      slots,
      preparation: eff.preparation,
      preparedMax,
      prepared: facts.preparedSpells[classId] ?? [],
      known: facts.knownSpells[classId] ?? [],
      cantripsKnown: eff.cantripsKnown !== undefined ? evalFormula(eff.cantripsKnown) : undefined,
      ritual: eff.ritual,
    });
  }
  blocks.sort((a, b) => (a.classId < b.classId ? -1 : a.classId > b.classId ? 1 : 0));

  const concentration = facts.concentration ? { spellId: facts.concentration.spellId } : undefined;

  return { blocks, concentration, issues };
}
