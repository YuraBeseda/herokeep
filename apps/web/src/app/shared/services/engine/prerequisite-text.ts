import type { Comparison, Predicate } from '@hk/protocol';

type TranslateFn = (key: string, params?: Record<string, unknown>) => string;

const GATE = 'characters.wizard.picker.gate';

function comparison(cmp: Comparison, label: string, t: TranslateFn): string | null {
  const ops = (['gte', 'lte', 'eq'] as const).filter((op) => cmp[op] !== undefined);
  // Only a lone gte / lte / eq reads naturally; anything richer takes the generic text.
  if (ops.length !== 1 || Object.keys(cmp).length !== 1) return null;
  return t(`${GATE}.${ops[0]}`, { label, value: cmp[ops[0]] });
}

function render(p: Predicate, t: TranslateFn, name: (id: string) => string): string | null {
  if ('ability' in p || 'classLevel' in p) {
    const entries = Object.entries('ability' in p ? p.ability : p.classLevel);
    if (entries.length !== 1) return null;
    const [[ref, cmp]] = entries;
    const label = 'ability' in p ? name(ref) : t(`${GATE}.classLevel`, { class: name(ref) });
    return comparison(cmp, label, t);
  }
  if ('level' in p) return comparison(p.level, t(`${GATE}.level`), t);
  if ('spellcaster' in p) return p.spellcaster ? t(`${GATE}.spellcaster`) : null;
  if ('any' in p) {
    const parts = p.any.map((q) => render(q, t, name));
    if (parts.some((s) => s === null)) return null;
    return t(`${GATE}.oneOf`, { list: parts.reduce((a, b) => t(`${GATE}.or`, { a, b })) });
  }
  return null;
}

function renderAll(unmet: readonly Predicate[], t: TranslateFn, name: (id: string) => string): string | null {
  const parts = unmet.map((p) => render(p, t, name));
  if (parts.length === 0 || parts.some((s) => s === null)) return null;
  return (parts as string[]).reduce((a, b) => t(`${GATE}.join`, { a, b }));
}

/** The unmet requirement in words ("Strength 13+"); unsupported predicates fall back to the generic text. */
export function prerequisiteText(unmet: readonly Predicate[], t: TranslateFn, name: (id: string) => string): string {
  return renderAll(unmet, t, name) ?? t(`${GATE}.prerequisiteFailed`);
}

/** The gate reason on a card: "Requires Strength 13+", or the generic text. */
export function prerequisiteReason(unmet: readonly Predicate[], t: TranslateFn, name: (id: string) => string): string {
  const what = renderAll(unmet, t, name);
  return what === null ? t(`${GATE}.prerequisiteFailed`) : t(`${GATE}.requires`, { what });
}
