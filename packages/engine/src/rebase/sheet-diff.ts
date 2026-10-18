import type { Sheet } from '../derive/sheet.ts';

/** One changed leaf value of the derived `Sheet` (plan 15 ruling 5). `undefined` on the side where
 * the leaf does not exist (an added or removed array element / record key). */
export interface SheetChange {
  path: string;
  before: unknown;
  after: unknown;
}

/**
 * Keys whose subtrees are left out of the diff wherever they appear: the rebase report lists
 * VALUES, not why a value is what it is. `contributions` is every `Derived<T>`'s provenance,
 * `sources` the granting-entity lists (proficiencies, immunities, resistances), `issues` the
 * derive diagnostics (the report shows invalid decisions separately).
 */
export const SHEET_DIFF_EXCLUDED_KEYS: ReadonlySet<string> = new Set(['contributions', 'sources', 'issues']);

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Flattens `value` into `leaves` keyed by path: object keys dot-joined, array items `[i]` (the
 * goldens' `expect` path style, e.g. `attacks[0].toHit.value`). Empty objects/arrays are leaves. */
function flatten(value: unknown, path: string, leaves: Map<string, unknown>): void {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      leaves.set(path, []);
      return;
    }
    value.forEach((item, i) => flatten(item, `${path}[${i}]`, leaves));
    return;
  }
  if (isRecord(value)) {
    const keys = Object.keys(value).filter((k) => !SHEET_DIFF_EXCLUDED_KEYS.has(k) && value[k] !== undefined);
    if (keys.length === 0) {
      leaves.set(path, {});
      return;
    }
    for (const k of keys) flatten(value[k], path === '' ? k : `${path}.${k}`, leaves);
    return;
  }
  leaves.set(path, value);
}

const sameLeaf = (a: unknown, b: unknown): boolean =>
  a === b ||
  (Array.isArray(a) && Array.isArray(b) && a.length === 0 && b.length === 0) ||
  (isRecord(a) && isRecord(b) && Object.keys(a).length === 0 && Object.keys(b).length === 0);

/**
 * The changed leaf values between two derived sheets, SORTED by path (code-unit order — no locale
 * ops in the engine). Pure: neither input is mutated.
 */
export function diffSheets(before: Sheet, after: Sheet): SheetChange[] {
  const a = new Map<string, unknown>();
  const b = new Map<string, unknown>();
  flatten(before, '', a);
  flatten(after, '', b);
  const paths = [...new Set([...a.keys(), ...b.keys()])].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
  const changes: SheetChange[] = [];
  for (const path of paths) {
    const x = a.get(path);
    const y = b.get(path);
    if (!sameLeaf(x, y)) changes.push({ path, before: x, after: y });
  }
  return changes;
}
