import type { ClassLevelRow, Choice, Entity, Predicate } from '@hk/protocol';
import type { FormulaSite } from '../effects/validate.ts';
import { collectPredicateFormulas } from '../predicate/evaluate.ts';

export interface PredicateSite {
  path: string;
  p: Predicate;
}

const choicePredicateSites = (c: Choice, path: string): PredicateSite[] =>
  c.prerequisites.map((p, i) => ({ path: `${path}.prerequisites.${i}`, p }));

/** Entity-level predicate sites: prerequisites, then grants[].when, then choices[].prerequisites. */
const entityPredicateSites = (e: Entity): PredicateSite[] => [
  ...e.prerequisites.map((p, i) => ({ path: `prerequisites.${i}`, p })),
  ...e.grants.flatMap((g, i) => (g.when ? [{ path: `grants.${i}.when`, p: g.when }] : [])),
  ...e.choices.flatMap((c, i) => choicePredicateSites(c, `choices.${i}`)),
];

/** Class/subclass level-row predicate sites: grants[].when, then choices[].prerequisites. */
const rowPredicateSites = (row: ClassLevelRow, path: string): PredicateSite[] => [
  ...row.grants.flatMap((g, i) => (g.when ? [{ path: `${path}.grants.${i}.when`, p: g.when }] : [])),
  ...row.choices.flatMap((c, i) => choicePredicateSites(c, `${path}.choices.${i}`)),
];

/**
 * Every predicate site on an entity, in traversal order: entity-level prerequisites, grants[].when,
 * choices[].prerequisites, then — for class/subclass — each level row's grants[].when followed by
 * its choices[].prerequisites. Shared by formula collection (`collectEntityFormulas`) and predicate
 * shape checking (`validatePack`) so the two walkers cannot drift.
 */
export function collectEntityPredicates(e: Entity): PredicateSite[] {
  const sites = entityPredicateSites(e);
  if (e.type === 'class' || e.type === 'subclass') {
    e.levels.forEach((row, r) => sites.push(...rowPredicateSites(row, `levels.${r}`)));
  }
  return sites;
}

const predicateFormulas = (sites: PredicateSite[]): FormulaSite[] =>
  sites.flatMap((s) => collectPredicateFormulas(s.p, s.path).map((f) => ({ ...f, allowComparison: true })));

export function collectEntityFormulas(e: Entity): FormulaSite[] {
  const sites: FormulaSite[] = [...predicateFormulas(entityPredicateSites(e))];
  if (e.type === 'feature' && e.uses) sites.push({ path: 'uses.count', src: e.uses.count, allowComparison: false });
  if (e.type === 'item' && e.charges) sites.push({ path: 'charges.max', src: e.charges.max, allowComparison: false });
  if (e.type === 'class' || e.type === 'subclass') {
    e.levels.forEach((row, r) => {
      sites.push(...predicateFormulas(rowPredicateSites(row, `levels.${r}`)));
      for (const [key, value] of Object.entries(row.extra ?? {})) {
        if (typeof value === 'string')
          sites.push({ path: `levels.${r}.extra.${key}`, src: value, allowComparison: false });
      }
    });
  }
  return sites;
}
