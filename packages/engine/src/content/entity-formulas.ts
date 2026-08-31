import type { Choice, Entity } from '@hk/protocol';
import type { FormulaSite } from '../effects/validate.ts';
import { collectPredicateFormulas } from '../predicate/evaluate.ts';

const pred = (sites: FormulaSite[], p: Parameters<typeof collectPredicateFormulas>[0], path: string): void => {
  for (const f of collectPredicateFormulas(p, path)) sites.push({ ...f, allowComparison: true });
};

const choiceSites = (sites: FormulaSite[], c: Choice, path: string): void => {
  c.prerequisites.forEach((p, i) => pred(sites, p, `${path}.prerequisites.${i}`));
};

export function collectEntityFormulas(e: Entity): FormulaSite[] {
  const sites: FormulaSite[] = [];
  e.prerequisites.forEach((p, i) => pred(sites, p, `prerequisites.${i}`));
  e.grants.forEach((g, i) => {
    if (g.when) pred(sites, g.when, `grants.${i}.when`);
  });
  e.choices.forEach((c, i) => choiceSites(sites, c, `choices.${i}`));
  if (e.type === 'feature' && e.uses) sites.push({ path: 'uses.count', src: e.uses.count, allowComparison: false });
  if (e.type === 'item' && e.charges) sites.push({ path: 'charges.max', src: e.charges.max, allowComparison: false });
  if (e.type === 'class' || e.type === 'subclass') {
    e.levels.forEach((row, r) => {
      row.choices.forEach((c, i) => choiceSites(sites, c, `levels.${r}.choices.${i}`));
      for (const [key, value] of Object.entries(row.extra ?? {})) {
        if (typeof value === 'string')
          sites.push({ path: `levels.${r}.extra.${key}`, src: value, allowComparison: false });
      }
    });
  }
  return sites;
}
