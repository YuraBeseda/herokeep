/** Stacking policy for one target's modifiers (doc-05's derivation table, verbatim). */
export type StackPolicy = 'sum-unique-key' | 'max-of-formulas' | 'set-if-higher' | 'cap' | 'union';

export interface Contribution {
  source: string;
  feature?: string;
  kind: string;
  amount?: number;
  formula?: string;
  key?: string;
}

export interface Derived<T> {
  value: T;
  contributions: Contribution[];
}

interface Entry {
  contribution: Contribution;
  policy: StackPolicy;
}

const resolveAmount = (c: Contribution, evalFormula: (f: string) => number): number =>
  c.amount ?? (c.formula !== undefined ? evalFormula(c.formula) : 0);

/**
 * Collects per-target contributions and resolves them per doc-05's stacking table:
 * `sum-unique-key` (same key keeps max, distinct keys sum), `max-of-formulas` (highest formula
 * candidate wins, `base` is always in the running), `set-if-higher` (raises only), `cap` (final
 * clamp), and `union` (set semantics via `resolveSet`, `expertise` beats `proficient`).
 */
export class ModifierTable {
  private readonly byTarget = new Map<string, Entry[]>();

  add(target: string, c: Contribution & { policy: StackPolicy }): void {
    const { policy, ...contribution } = c;
    const list = this.byTarget.get(target);
    if (list) list.push({ contribution, policy });
    else this.byTarget.set(target, [{ contribution, policy }]);
  }

  /**
   * Resolves a numeric target from `base` plus every contribution added for it. `contributions`
   * always lists every contribution considered (winners and shadowed candidates alike), so a
   * caller can show "why" alongside the resolved `value`.
   */
  resolve(target: string, base: number, evalFormula: (f: string) => number): Derived<number> {
    const entries = this.byTarget.get(target) ?? [];
    const contributions = entries.map((e) => e.contribution);
    let value = base;

    const formulaEntries = entries.filter((e) => e.policy === 'max-of-formulas');
    if (formulaEntries.length > 0) {
      let best = base;
      for (const e of formulaEntries) {
        const amount = resolveAmount(e.contribution, evalFormula);
        if (amount > best) best = amount;
      }
      value = best;
    }

    const sumEntries = entries.filter((e) => e.policy === 'sum-unique-key');
    if (sumEntries.length > 0) {
      const maxByKey = new Map<string, number>();
      for (const e of sumEntries) {
        const key = e.contribution.key ?? `${e.contribution.source}#${e.contribution.feature ?? ''}`;
        const amount = resolveAmount(e.contribution, evalFormula);
        const prev = maxByKey.get(key);
        if (prev === undefined || amount > prev) maxByKey.set(key, amount);
      }
      let sum = 0;
      for (const amount of maxByKey.values()) sum += amount;
      value += sum;
    }

    for (const e of entries.filter((x) => x.policy === 'set-if-higher')) {
      const amount = resolveAmount(e.contribution, evalFormula);
      if (amount > value) value = amount;
    }

    for (const e of entries.filter((x) => x.policy === 'cap')) {
      const amount = resolveAmount(e.contribution, evalFormula);
      if (value > amount) value = amount;
    }

    return { value, contributions };
  }

  /**
   * Resolves a `union`-policy target into a set of values with their contributing sources. A
   * value is `contribution.key` when given, else `contribution.kind` (so a per-target proficiency
   * level — encoded in `kind` — can itself be the set member). When both `proficient` and
   * `expertise` appear for the same target, `expertise` wins and absorbs `proficient`'s sources.
   */
  resolveSet(target: string): { values: string[]; sources: Record<string, string[]> } {
    const entries = (this.byTarget.get(target) ?? []).filter((e) => e.policy === 'union');
    const sourcesByValue = new Map<string, Set<string>>();
    for (const e of entries) {
      const value = e.contribution.key ?? e.contribution.kind;
      const set = sourcesByValue.get(value);
      if (set) set.add(e.contribution.source);
      else sourcesByValue.set(value, new Set([e.contribution.source]));
    }
    const proficient = sourcesByValue.get('proficient');
    const expertise = sourcesByValue.get('expertise');
    if (proficient && expertise) {
      for (const s of proficient) expertise.add(s);
      sourcesByValue.delete('proficient');
    }
    const values = [...sourcesByValue.keys()].sort();
    const sources: Record<string, string[]> = {};
    for (const v of values) sources[v] = [...sourcesByValue.get(v)!].sort();
    return { values, sources };
  }
}
