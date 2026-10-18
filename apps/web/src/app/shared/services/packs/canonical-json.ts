/**
 * Sorted-key `JSON.stringify` — the web-side twin of `@hk/pack-tools`' `canonicalJson`
 * (`packages/pack-tools/src/canonical.ts`), which the browser cannot import (pack-tools is a
 * node CLI). Two packs with the same content but different key order produce the same string, so
 * the importer's `id@version` conflict check compares content, not formatting. Array order is
 * significant and kept. Keys sort by UTF-16 code unit (`Array#sort` default), never by locale.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, sortKeys(record[key])]),
    );
  }
  return value;
}
