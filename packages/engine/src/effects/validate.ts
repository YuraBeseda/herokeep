import { type Effect, EffectSchema } from '@hk/protocol';
import { type Diagnostic, error, warning } from '../diagnostics.ts';
import { validateFormula } from '../formula/validate.ts';
import { checkPredicateShape } from '../predicate/depth.ts';
import { collectPredicateFormulas } from '../predicate/evaluate.ts';
import { isKnownEffectType } from './registry.ts';

export { isKnownEffectType } from './registry.ts';

export interface FormulaSite {
  path: string;
  src: string;
  allowComparison: boolean;
  /** A choice `count` formula: restricted to the count context's symbols (formula/validate.ts). */
  countContext?: boolean;
}

/** Field names that hold a formula (or an int-or-formula value) per effect type. */
const FORMULA_FIELDS: Record<string, string[]> = {
  'ac.formula': ['formula'],
  'ac.bonus': ['value'],
  'hp.bonus': ['value'],
  'resource.define': ['max'],
  'spellcasting.define': ['cantripsKnown', 'preparedCount', 'spellsKnown'],
  'attack.bonus': ['value'],
  'damage.bonus': ['value'],
  'initiative.bonus': ['value'],
  'save.bonus': ['value'],
  'skill.bonus': ['value'],
  'check.bonus': ['value'],
  'mastery.grant': ['count'],
};

const joinPath = (base: string, segments: readonly PropertyKey[]): string =>
  segments.length ? `${base}.${segments.map(String).join('.')}` : base;

export function collectEffectFormulas(effect: Effect, path: string): FormulaSite[] {
  const sites: FormulaSite[] = [];
  const rec = effect as unknown as Record<string, unknown>;
  for (const field of FORMULA_FIELDS[effect.type] ?? []) {
    const v = rec[field];
    if (typeof v === 'string') sites.push({ path: `${path}.${field}`, src: v, allowComparison: false });
  }
  const uses = rec['uses'] as { count?: unknown } | undefined;
  if (uses && typeof uses.count === 'string')
    sites.push({ path: `${path}.uses.count`, src: uses.count, allowComparison: false });
  if (effect.when) {
    for (const f of collectPredicateFormulas(effect.when, `${path}.when`)) sites.push({ ...f, allowComparison: true });
  }
  return sites;
}

interface SchemaIssue {
  code: string;
  path: PropertyKey[];
  message: string;
  errors?: SchemaIssue[][];
}

/**
 * Plan 13 task 4: a union field's failure arrives as ONE `invalid_union` issue at the field itself,
 * carrying every branch's own issues. When exactly one branch failed with strictly fewer issues than
 * every other, that branch is what the author meant (e.g. `spell.grant.uses {count, per: 'weekly'}`
 * is the inline form with a bad `per`, not a malformed `{resource}`), so its issues are reported at
 * their precise paths instead. A tie keeps the union issue unchanged (e.g. int-or-formula values).
 */
function closestUnionBranch(issue: SchemaIssue): SchemaIssue[] {
  if (issue.code !== 'invalid_union' || !issue.errors?.length) return [issue];
  const sizes = issue.errors.map((branch) => branch.length);
  const fewest = Math.min(...sizes);
  if (fewest === 0 || sizes.filter((s) => s === fewest).length !== 1) return [issue];
  return issue.errors[sizes.indexOf(fewest)]!.flatMap((i) =>
    closestUnionBranch({ ...i, path: [...issue.path, ...i.path] }),
  );
}

export function validateEffect(effect: unknown, path: string, entityId: string): Diagnostic[] {
  const type = (effect as { type?: unknown })?.type;
  if (typeof type !== 'string' || !isKnownEffectType(type)) {
    return [
      warning('effect.unknownType', `Unknown effect type "${String(type)}" (ignored at runtime)`, {
        path: `${path}.type`,
        entityId,
      }),
    ];
  }
  const parsed = EffectSchema.safeParse(effect);
  if (!parsed.success) {
    return (parsed.error.issues as unknown as SchemaIssue[])
      .flatMap((i) => closestUnionBranch(i))
      .map((i) => error('effect.invalid', i.message, { path: joinPath(path, i.path), entityId }));
  }
  return [
    ...(parsed.data.when ? checkPredicateShape(parsed.data.when, `${path}.when`, entityId) : []),
    ...collectEffectFormulas(parsed.data, path).flatMap((s) =>
      validateFormula(s.src, { allowComparison: s.allowComparison, path: s.path, entityId }),
    ),
  ];
}

export function validateEffects(effects: unknown[], path: string, entityId: string): Diagnostic[] {
  return effects.flatMap((e, i) => validateEffect(e, `${path}.${i}`, entityId));
}
