import type { Comparison, Predicate } from '@hk/protocol';
import { evalFormulaString } from '../formula/evaluate.ts';
import type { PredicateContext } from './context.ts';

export function matchesComparison(value: number, cmp: Comparison): boolean {
  if (cmp.gte !== undefined && !(value >= cmp.gte)) return false;
  if (cmp.lte !== undefined && !(value <= cmp.lte)) return false;
  if (cmp.gt !== undefined && !(value > cmp.gt)) return false;
  if (cmp.lt !== undefined && !(value < cmp.lt)) return false;
  if (cmp.eq !== undefined && value !== cmp.eq) return false;
  return true;
}

export function evaluatePredicate(p: Predicate, ctx: PredicateContext): boolean {
  if ('all' in p) return p.all.every((q) => evaluatePredicate(q, ctx));
  if ('any' in p) return p.any.some((q) => evaluatePredicate(q, ctx));
  if ('not' in p) return !evaluatePredicate(p.not, ctx);
  if ('ability' in p) return Object.entries(p.ability).every(([a, cmp]) => matchesComparison(ctx.abilityScore(a), cmp));
  if ('level' in p) return matchesComparison(ctx.level, p.level);
  if ('classLevel' in p)
    return Object.entries(p.classLevel).every(([ref, cmp]) => matchesComparison(ctx.classLevel(ref), cmp));
  if ('hasFeature' in p) return ctx.hasFeature(p.hasFeature);
  if ('hasFeat' in p) return ctx.hasFeat(p.hasFeat);
  if ('hasSpell' in p) return ctx.hasSpell(p.hasSpell);
  if ('tag' in p) return ctx.hasTag(p.tag);
  if ('proficient' in p) return ctx.isProficient(p.proficient.kind, p.proficient.target);
  if ('armor' in p) return (p.armor.category as string[]).includes(ctx.armorCategory());
  if ('shield' in p) return ctx.hasShield() === p.shield;
  if ('species' in p) return ctx.speciesId() === p.species;
  if ('class' in p) return ctx.classIds().includes(p.class);
  if ('subclass' in p) return ctx.subclassIds().includes(p.subclass);
  if ('condition' in p) return ctx.hasCondition(p.condition);
  if ('spellcaster' in p) return ctx.isSpellcaster() === p.spellcaster;
  if ('formula' in p) {
    try {
      return evalFormulaString(p.formula, ctx.formula) !== 0;
    } catch {
      return false; // invalid formulas are reported by validation; at runtime they never grant anything
    }
  }
  return false;
}

export function collectPredicateFormulas(p: Predicate, path: string): { path: string; src: string }[] {
  if ('all' in p) return p.all.flatMap((q, i) => collectPredicateFormulas(q, `${path}.all.${i}`));
  if ('any' in p) return p.any.flatMap((q, i) => collectPredicateFormulas(q, `${path}.any.${i}`));
  if ('not' in p) return collectPredicateFormulas(p.not, `${path}.not`);
  if ('formula' in p) return [{ path: `${path}.formula`, src: p.formula }];
  return [];
}
