import type { ContentIndex } from '../content/index.ts';
import { type Diagnostic, warning } from '../diagnostics.ts';
import { type FormulaContext, evalFormulaString } from '../formula/evaluate.ts';
import type { Facts, SystemRules } from '../reduce/facts.ts';
import type { AbilitiesResult } from './abilities.ts';
import type { Composition } from './composition.ts';
import { type Derived, ModifierTable } from './modifiers.ts';

export interface HpResult {
  max: Derived<number>;
  current: number;
  temp: number;
  hitDice: Record<string, { die: number; total: number; spent: number }>;
  deathSaves: { successes: number; failures: number };
  conditions: { conditionId: string; level?: number; source?: string }[];
  /**
   * Not in task-10-brief.md's literal `HpResult` snippet, added here: the controller ruling
   * (R-pf2) requires `deriveHp` to push a `'derive.noSystemRules'` warning when `rules` is
   * omitted (and an unresolved class in `facts.classes` needs somewhere to warn too) — every
   * sibling derive result (`DefenseResult`, `AbilitiesResult`, `Composition`) already exposes
   * `issues`, so this mirrors that rather than inventing a second, inconsistent channel.
   */
  issues: Diagnostic[];
}

type HpRules = SystemRules['hpRules'];

/** `{amount}` for a plain int, `{formula}` for a formula string — both legal for `ValueSchema` effects. */
const amountOrFormula = (v: number | string): { amount?: number; formula?: string } =>
  typeof v === 'number' ? { amount: v } : { formula: v };

/**
 * Average hit-die value for one level: `hitDie/2 + 1`, per doc-05. Every die in the game (d6, d8,
 * d10, d12) is even, so 'up' vs 'down' rounding of the half produces the SAME integer today (e.g.
 * d10 -> 6); the switch is implemented anyway (ceil vs floor of the half) so it does the right
 * thing if an odd hit die is ever added to a pack.
 */
function averageHitDie(hitDie: number, rounding: 'up' | 'down'): number {
  const half = hitDie / 2;
  return (rounding === 'up' ? Math.ceil(half) : Math.floor(half)) + 1;
}

/** Prices one levels->=2 entry: a raw roll clamps to `[1, hitDie]`; `'average'`/missing uses the average. */
function priceRolledLevel(entry: number | 'average' | undefined, hitDie: number, rounding: 'up' | 'down'): number {
  if (entry === undefined || entry === 'average') return averageHitDie(hitDie, rounding);
  return Math.max(1, Math.min(hitDie, entry));
}

/**
 * Derives max/current HP, hit dice, death saves and a display view of conditions.
 *
 * `rules` is OPTIONAL (controller ruling R-pf2): without it, every level (including level 1) is
 * priced as average with 'down' rounding — `facts.hpRolls` is not consulted at all, since we have
 * no `hpRules.averageRounding` to price a raw roll's neighbor levels consistently against — and a
 * `'derive.noSystemRules'` warning is pushed so a caller knows HP max is an approximation.
 */
export function deriveHp(
  abilities: AbilitiesResult,
  comp: Composition,
  facts: Facts,
  index: ContentIndex,
  rules?: SystemRules,
): HpResult {
  const issues: Diagnostic[] = [];
  let hpRules: HpRules;
  const useRolls = rules !== undefined;
  if (rules) {
    hpRules = rules.hpRules;
  } else {
    hpRules = { firstLevelMaxHitDie: false, averageRounding: 'down' };
    issues.push(
      warning('derive.noSystemRules', 'No system rules available; HP max uses average hit-die values for every level'),
    );
  }

  const table = new ModifierTable();
  const hitDice: HpResult['hitDice'] = {};

  for (const classId of Object.keys(comp.classLevels).sort()) {
    const entity = index.get(classId);
    if (entity?.type !== 'class') {
      issues.push(warning('derive.unresolvedEntity', `Unresolved class "${classId}"`, { entityId: classId }));
      continue;
    }
    const hitDie = entity.hitDie;
    const levels = comp.classLevels[classId] ?? 0;
    const rolls = facts.hpRolls[classId] ?? [];
    const conMod = abilities.abilities['con']?.mod ?? 0;

    for (let lvl = 1; lvl <= levels; lvl++) {
      const dieAmount =
        lvl === 1
          ? hpRules.firstLevelMaxHitDie
            ? hitDie
            : averageHitDie(hitDie, hpRules.averageRounding)
          : useRolls
            ? priceRolledLevel(rolls[lvl - 2], hitDie, hpRules.averageRounding)
            : averageHitDie(hitDie, hpRules.averageRounding);

      table.add('hp.max', {
        source: classId,
        kind: 'hp.hitDie',
        amount: dieAmount,
        key: `${classId}@${lvl}:die`,
        policy: 'sum-unique-key',
      });
      table.add('hp.max', {
        source: classId,
        kind: 'hp.conMod',
        amount: conMod,
        key: `${classId}@${lvl}:con`,
        policy: 'sum-unique-key',
      });
    }

    hitDice[classId] = { die: hitDie, total: levels, spent: facts.hitDiceSpent[classId] ?? 0 };
  }

  // ---- `hp.perLevel` (x totalLevel) and `hp.bonus` effects (fully resolved, deferred-filtered) ----
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
    if (eff.type === 'hp.perLevel') {
      table.add('hp.max', {
        source: ae.source,
        feature: ae.feature,
        kind: 'hp.perLevel',
        amount: eff.value * comp.totalLevel,
        key: eff.key,
        policy: 'sum-unique-key',
      });
    } else if (eff.type === 'hp.bonus') {
      table.add('hp.max', {
        source: ae.source,
        feature: ae.feature,
        kind: 'hp.bonus',
        ...amountOrFormula(eff.value),
        key: eff.key,
        policy: 'sum-unique-key',
      });
    }
  }

  const computed = table.resolve('hp.max', 0, evalFormula);
  const max: Derived<number> =
    facts.hp.maxOverride !== undefined
      ? {
          value: facts.hp.maxOverride,
          contributions: [
            ...computed.contributions,
            { source: 'override', kind: 'override', amount: facts.hp.maxOverride },
          ],
        }
      : computed;

  const current = Math.max(0, Math.min(max.value, facts.hp.current === 'max' ? max.value : facts.hp.current));

  const conditions = facts.conditions.map((c) => ({
    conditionId: c.conditionId,
    level: c.level,
    source: c.source,
  }));

  return {
    max,
    current,
    temp: facts.hp.temp,
    hitDice,
    deathSaves: { ...facts.deathSaves },
    conditions,
    issues,
  };
}
