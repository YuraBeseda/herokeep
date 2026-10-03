import {
  DiceSchema,
  ExtraTextSchema,
  type ClassLevelRow,
  type Choice,
  type Entity,
  type Predicate,
} from '@hk/protocol';
import type { FormulaSite } from '../effects/validate.ts';
import { collectPredicateFormulas } from '../predicate/evaluate.ts';

/**
 * T1 carry (phase 4 plan 11, ruling 5): discriminates a `ClassLevelRow.extra` STRING value between a
 * typed literal (skip formula-grammar validation) and a genuine formula-validation candidate.
 * `ExtraValueSchema` (protocol) accepts int/formula (`ValueSchema`), dice notation (`DiceSchema`, e.g.
 * Rage Damage "1d6") or short plain text (`ExtraTextSchema`, e.g. an ordinal column "1st") — but this
 * file previously pushed EVERY string `extra` value into `validateFormula()` unconditionally, which
 * would reject any real dice/text extra as a formula-syntax error the moment content authored one
 * (no fixture did, before this task — see task-1-report.md). The rule: a value that matches
 * `DiceSchema` OR `ExtraTextSchema` (the two narrower, typed shapes `ExtraValueSchema` unions
 * alongside `ValueSchema`) is a typed literal, not a formula candidate — this deliberately checks
 * only those two non-formula member shapes, NOT `ExtraValueSchema`'s own declared union order
 * (`ValueSchema | DiceSchema | ExtraTextSchema`, `enums.ts`, generic formula shape listed first).
 *
 * Caveat (documented, not a bug): a formula string with NO operator/paren/comma/underscore character
 * at all (a bare identifier, e.g. a formula that's literally "level") also happens to satisfy
 * `ExtraTextSchema`'s loose letters/digits/space/'/- charset and would be misclassified as typed text
 * rather than validated as a formula. Every formula this repo actually authors uses at least one
 * operator or a function call, so this is an accepted, narrow edge case, not a real gap in practice.
 */
const isTypedExtraLiteral = (value: string): boolean =>
  DiceSchema.safeParse(value).success || ExtraTextSchema.safeParse(value).success;

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

type SystemEntity = Extract<Entity, { type: 'system' }>;

/** System predicate sites (plan 11 final wave F2): `multiclass.prerequisites`, one per class ref. */
const systemPredicateSites = (e: SystemEntity): PredicateSite[] =>
  Object.entries(e.multiclass?.prerequisites ?? {}).map(([ref, p]) => ({
    path: `multiclass.prerequisites.${ref}`,
    p,
  }));

/** System value-formula sites (plan 11 final wave F2): encumbrance capacities. */
const systemFormulaSites = (e: SystemEntity): FormulaSite[] => {
  const sites: FormulaSite[] = [];
  const enc = e.encumbrance;
  if (enc?.standard)
    sites.push({ path: 'encumbrance.standard.capacity', src: enc.standard.capacity, allowComparison: false });
  if (enc?.variant) {
    sites.push({ path: 'encumbrance.variant.capacity', src: enc.variant.capacity, allowComparison: false });
    enc.variant.thresholds.forEach((t, i) =>
      sites.push({ path: `encumbrance.variant.thresholds.${i}.capacity`, src: t.capacity, allowComparison: false }),
    );
  }
  return sites;
};

/**
 * Every predicate site on an entity, in traversal order: entity-level prerequisites, grants[].when,
 * choices[].prerequisites, then — for class/subclass — each level row's grants[].when followed by
 * its choices[].prerequisites, or — for the system — its multiclass prerequisites. Shared by formula
 * collection (`collectEntityFormulas`) and predicate shape checking (`validatePack`) so the two
 * walkers cannot drift.
 */
export function collectEntityPredicates(e: Entity): PredicateSite[] {
  const sites = entityPredicateSites(e);
  if (e.type === 'class' || e.type === 'subclass') {
    e.levels.forEach((row, r) => sites.push(...rowPredicateSites(row, `levels.${r}`)));
  } else if (e.type === 'system') {
    sites.push(...systemPredicateSites(e));
  }
  return sites;
}

const predicateFormulas = (sites: PredicateSite[]): FormulaSite[] =>
  sites.flatMap((s) => collectPredicateFormulas(s.p, s.path).map((f) => ({ ...f, allowComparison: true })));

/** Formula-string `Choice.count` sites (plan 12 task 2); an int count is not a formula. */
const choiceCountSites = (choices: Choice[], path: string): FormulaSite[] =>
  choices.flatMap((c, i) =>
    typeof c.count === 'string' ? [{ path: `${path}.${i}.count`, src: c.count, allowComparison: false }] : [],
  );

export function collectEntityFormulas(e: Entity): FormulaSite[] {
  const sites: FormulaSite[] = [
    ...predicateFormulas(entityPredicateSites(e)),
    ...choiceCountSites(e.choices, 'choices'),
  ];
  if (e.type === 'feature' && e.uses) sites.push({ path: 'uses.count', src: e.uses.count, allowComparison: false });
  if (e.type === 'item' && e.charges) sites.push({ path: 'charges.max', src: e.charges.max, allowComparison: false });
  if (e.type === 'class' || e.type === 'subclass') {
    e.levels.forEach((row, r) => {
      sites.push(...predicateFormulas(rowPredicateSites(row, `levels.${r}`)));
      sites.push(...choiceCountSites(row.choices, `levels.${r}.choices`));
      for (const [key, value] of Object.entries(row.extra ?? {})) {
        if (typeof value === 'string' && !isTypedExtraLiteral(value))
          sites.push({ path: `levels.${r}.extra.${key}`, src: value, allowComparison: false });
      }
    });
  } else if (e.type === 'system') {
    sites.push(...predicateFormulas(systemPredicateSites(e)), ...systemFormulaSites(e));
  }
  return sites;
}
