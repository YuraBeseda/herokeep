import { type Effect, EffectSchema } from '@hk/protocol';
import { type Diagnostic, error, warning } from '../diagnostics.ts';
import { validateFormula } from '../formula/validate.ts';
import { collectPredicateFormulas } from '../predicate/evaluate.ts';
import { isKnownEffectType } from './registry.ts';

export { isKnownEffectType } from './registry.ts';

export interface FormulaSite {
  path: string;
  src: string;
  allowComparison: boolean;
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
    return parsed.error.issues.map((i) =>
      error('effect.invalid', i.message, { path: `${path}.${i.path.map(String).join('.')}`, entityId }),
    );
  }
  return collectEffectFormulas(parsed.data, path).flatMap((s) =>
    validateFormula(s.src, { allowComparison: s.allowComparison, path: s.path, entityId }),
  );
}

export function validateEffects(effects: unknown[], path: string, entityId: string): Diagnostic[] {
  return effects.flatMap((e, i) => validateEffect(e, `${path}.${i}`, entityId));
}
