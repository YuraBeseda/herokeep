import type { ItemEntity } from '@hk/protocol';
import type { ContentIndex } from '../content/index.ts';
import { type Diagnostic, warning } from '../diagnostics.ts';
import { type FormulaContext, evalFormulaString } from '../formula/evaluate.ts';
import type { Facts } from '../reduce/facts.ts';
import type { AbilitiesResult } from './abilities.ts';
import type { Composition } from './composition.ts';
import { type Derived, ModifierTable } from './modifiers.ts';

export interface DefenseResult {
  ac: Derived<number>;
  issues: Diagnostic[];
}

/** `{amount}` for a plain int, `{formula}` for a formula string — both legal for `ValueSchema` effects. */
const amountOrFormula = (v: number | string): { amount?: number; formula?: string } =>
  typeof v === 'number' ? { amount: v } : { formula: v };

/**
 * Fixed stacking key for a shield's `ac.bonus`. The shield's own SRD/fixture data models its
 * bonus via the `shield.ac` field, not an authored `ac.bonus` effect (an equipped shield carries
 * no `effects` at all), so this function synthesizes the contribution here — call documented per
 * the controller ruling in task-10's brief: keying it 'shield' (rather than per-item-id) makes ANY
 * two simultaneously-equipped shields cap at the higher one instead of summing, matching 5e's "you
 * benefit from only one shield at a time" ruling regardless of which shield entity is worn.
 */
const SHIELD_AC_BONUS_KEY = 'shield';

/**
 * Derives armor class: `10 + mod(dex)` is always in the running (the `base` argument to
 * `ModifierTable.resolve`), an equipped armor item contributes `armor.ac + min(mod(dex), dexCap)`
 * (`dexCap` absent = uncapped, `0` = no dex at all) and every `ac.formula` effect contributes its
 * evaluated formula — all as `max-of-formulas` candidates for the SAME `'ac'` target; `ac.bonus`
 * effects (and the equipped shield's synthesized bonus) then sum on top via `sum-unique-key` in
 * that same `resolve()` call. Also flags heavy-armor STR shortfalls and stealth disadvantage.
 */
export function deriveDefense(
  abilities: AbilitiesResult,
  comp: Composition,
  facts: Facts,
  index: ContentIndex,
): DefenseResult {
  const issues: Diagnostic[] = [];
  const dexMod = abilities.abilities['dex']?.mod ?? 0;
  const table = new ModifierTable();

  // ---- Equipped armor & shields (first equipped armor piece found wins — mirrors
  // composition.ts's `equippedArmor` policy for an invalid double-equip) --------------------------
  let equippedArmor: ItemEntity | undefined;
  for (const item of facts.inventory) {
    if (!item.equipped || item.itemId === undefined) continue;
    const entity = index.get(item.itemId);
    if (entity?.type !== 'item') continue;
    if (entity.armor && !equippedArmor) equippedArmor = entity;
    if (entity.category === 'shield' && entity.shield) {
      table.add('ac', {
        source: entity.id,
        kind: 'ac.bonus',
        amount: entity.shield.ac,
        key: SHIELD_AC_BONUS_KEY,
        policy: 'sum-unique-key',
      });
    }
  }

  if (equippedArmor?.armor) {
    const armor = equippedArmor.armor;
    const cappedDexMod = armor.dexCap === undefined ? dexMod : Math.min(dexMod, armor.dexCap);
    table.add('ac', {
      source: equippedArmor.id,
      kind: 'armor.ac',
      amount: armor.ac + cappedDexMod,
      policy: 'max-of-formulas',
    });

    const strScore = abilities.abilities['str']?.score.value ?? 0;
    if (armor.strength !== undefined && strScore < armor.strength) {
      issues.push(
        warning(
          'derive.armorStrength',
          `${equippedArmor.name} requires ${armor.strength} Strength (wearer has ${strScore})`,
          { entityId: equippedArmor.id },
        ),
      );
    }
    if (armor.stealthDisadvantage) {
      issues.push(
        warning('derive.stealthDisadvantage', `${equippedArmor.name} imposes disadvantage on Stealth checks`, {
          entityId: equippedArmor.id,
        }),
      );
    }
  }

  // ---- `ac.formula` / `ac.bonus` effects (from the fully resolved, deferred-filtered list) -------
  const formulaCtx: FormulaContext = {
    level: comp.totalLevel,
    prof: abilities.prof,
    classLevel: (ref) => comp.classLevels[index.resolveClassRef(ref) ?? ref] ?? 0,
    mod: (ability) => abilities.abilities[ability]?.mod ?? 0,
    score: (ability) => abilities.abilities[ability]?.score.value ?? 0,
    hitDie: (slug) => {
      const classId = index.resolveClassRef(slug) ?? slug;
      const entity = index.get(classId);
      return entity?.type === 'class' ? entity.hitDie : 0;
    },
    resource: () => 0,
  };
  const evalFormula = (f: string) => evalFormulaString(f, formulaCtx);

  for (const ae of abilities.effects) {
    const eff = ae.effect;
    if (eff.type === 'ac.formula') {
      table.add('ac', {
        source: ae.source,
        feature: ae.feature,
        kind: 'ac.formula',
        formula: eff.formula,
        key: eff.key,
        policy: 'max-of-formulas',
      });
    } else if (eff.type === 'ac.bonus') {
      table.add('ac', {
        source: ae.source,
        feature: ae.feature,
        kind: 'ac.bonus',
        ...amountOrFormula(eff.value),
        key: eff.key,
        policy: 'sum-unique-key',
      });
    }
  }

  const ac = table.resolve('ac', 10 + dexMod, evalFormula);
  return { ac, issues };
}
