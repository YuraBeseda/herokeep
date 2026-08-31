import type { Predicate } from '@hk/protocol';
import { type Diagnostic, error } from '../diagnostics.ts';

export const PREDICATE_MAX_DEPTH = 16;
export const PREDICATE_MAX_WIDTH = 32;

/**
 * Checks a predicate's shape against the depth and width caps.
 *
 * "Nesting level" is the number of `all`/`any`/`not` wrappers strictly above a node, so the root
 * starts at 0. A node whose nesting level exceeds `PREDICATE_MAX_DEPTH` is flagged once and its
 * subtree is not descended into; an `all`/`any` array longer than `PREDICATE_MAX_WIDTH` is flagged
 * but its children are still walked (each may independently trip the depth cap).
 */
export function checkPredicateShape(p: Predicate, path: string, entityId?: string): Diagnostic[] {
  const out: Diagnostic[] = [];
  const extra = entityId !== undefined ? { entityId } : {};

  const walk = (node: Predicate, nodePath: string, depth: number): void => {
    if (depth > PREDICATE_MAX_DEPTH) {
      out.push(
        error('predicate.tooDeep', `Predicate nesting exceeds ${PREDICATE_MAX_DEPTH}`, { path: nodePath, ...extra }),
      );
      return;
    }
    if ('all' in node || 'any' in node) {
      const key = 'all' in node ? 'all' : 'any';
      const arr = 'all' in node ? node.all : node.any;
      if (arr.length > PREDICATE_MAX_WIDTH) {
        out.push(
          error('predicate.tooWide', `Predicate ${key} has ${arr.length} entries; limit is ${PREDICATE_MAX_WIDTH}`, {
            path: `${nodePath}.${key}`,
            ...extra,
          }),
        );
      }
      arr.forEach((q, i) => walk(q, `${nodePath}.${key}.${i}`, depth + 1));
    } else if ('not' in node) {
      walk(node.not, `${nodePath}.not`, depth + 1);
    }
  };

  walk(p, path, 0);
  return out;
}
