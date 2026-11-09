import type { ContentIndex } from '@hk/engine';
import { makeEntityId, parseEntityId, type ClassEntity } from '@hk/protocol';

/** A description that is only a bracketed placeholder, e.g. a table-column stand-in. */
const PLACEHOLDER_TEXT = /^\[[^\]]*\]$/;

/** Whether a description is real prose: not empty, not just a bracketed placeholder. */
export function hasProse(text: string): boolean {
  const trimmed = text.trim();
  return trimmed !== '' && !PLACEHOLDER_TEXT.test(trimmed);
}

/**
 * The class table's extra columns: every key of `ClassLevelRow.extra` that names a feature entity
 * of the class's own pack (`<classSlug>-<fact>`). A grant of such a feature is table data, not a
 * feature to read — the library's class entry and the sheet's feature list both leave it out unless
 * it carries prose of its own. Pure pack structure; no class is named.
 */
export function classColumnKeys(entity: ClassEntity, index: ContentIndex): Set<string> {
  const packId = parseEntityId(entity.id)?.packId;
  const keys = new Set<string>();
  if (!packId) return keys;
  for (const row of entity.levels) {
    for (const key of Object.keys(row.extra ?? {})) {
      if (index.has(makeEntityId(packId, 'feature', key))) keys.add(key);
    }
  }
  return keys;
}
