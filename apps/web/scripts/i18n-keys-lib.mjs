// Pure checks behind scripts/check-i18n-keys.mjs (kept separate so the fixture tests can import them).
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const LANGS = ['en', 'ru', 'uk'];

/** Dotted paths of every string leaf. */
export function flatKeys(tree, prefix = '') {
  return Object.entries(tree).flatMap(([k, v]) =>
    typeof v === 'object' && v ? flatKeys(v, `${prefix}${k}.`) : [`${prefix}${k}`],
  );
}

/** Scope folders under the i18n root (the root files themselves are the '' scope). */
function scopes(root) {
  return [
    ...(existsSync(join(root, 'en.json')) ? [''] : []),
    ...readdirSync(root).filter((d) => statSync(join(root, d)).isDirectory() && d !== 'fit'),
  ];
}

const read = (root, scope, lang) =>
  new Set(flatKeys(JSON.parse(readFileSync(join(root, scope, `${lang}.json`), 'utf8'))));

/** ru/uk keys that en has and they lack (and the reverse): every one is a failure. */
export function parityGaps(root) {
  const gaps = [];
  for (const scope of scopes(root)) {
    const en = read(root, scope, 'en');
    for (const lang of LANGS.slice(1)) {
      const other = read(root, scope, lang);
      for (const k of en)
        if (!other.has(k)) gaps.push(`${scope || '(root)'}/${lang} is missing ${k}`);
      for (const k of other)
        if (!en.has(k)) gaps.push(`${scope || '(root)'}/${lang} has extra ${k}`);
    }
  }
  return gaps;
}

/**
 * en keys no code refers to. A key counts as used when its full dotted path appears in `source`,
 * or when its parent prefix (up to the last "." or "-") does, which is how a key assembled from a
 * prefix and a variant looks. `allow` maps `scope:prefix` to the reason a run-time-built key
 * family stays; dynamic-keys.spec.ts enumerates each family against the real files.
 */
export function unusedKeys(root, source, allow) {
  const out = [];
  for (const scope of scopes(root).filter(Boolean)) {
    for (const k of read(root, scope, 'en')) {
      if (source.includes(k)) continue;
      const cut = Math.max(k.lastIndexOf('.'), k.lastIndexOf('-'));
      if (cut > 0 && source.includes(k.slice(0, cut + 1))) continue;
      if (Object.keys(allow).some((a) => `${scope}:${k}`.startsWith(a))) continue;
      out.push(`${scope}:${k}`);
    }
  }
  return out;
}

/** Concatenated text of every non-spec .ts/.html file under `dir`. */
export function readSource(dir) {
  const walk = (d) =>
    readdirSync(d).flatMap((e) => {
      const p = join(d, e);
      return statSync(p).isDirectory() ? walk(p) : [p];
    });
  return walk(dir)
    .filter((f) => /\.(ts|html)$/.test(f) && !/\.spec\.ts$/.test(f))
    .map((f) => readFileSync(f, 'utf8'))
    .join('\n');
}
