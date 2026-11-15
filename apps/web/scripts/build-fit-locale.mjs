// Writes `.fit-locale/**`: per i18n file, per key, the LONGEST of the en/ru/uk strings. The text-fit
// harness (`e2e/textfit`) serves these in place of the `en` files, so one run checks the worst case of
// every string. Never shipped: it lives outside `src/assets`, and is gitignored.
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'src/assets/i18n');
const out = join(root, '.fit-locale');

function* enFiles(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* enFiles(path);
    else if (name === 'en.json') yield path;
  }
}

function longest(en, others) {
  if (typeof en === 'string') {
    return [en, ...others]
      .filter((v) => typeof v === 'string')
      .reduce((a, b) => (b.length > a.length ? b : a));
  }
  if (en && typeof en === 'object') {
    return Object.fromEntries(
      Object.entries(en).map(([k, v]) => [
        k,
        longest(
          v,
          others.map((o) => o?.[k]),
        ),
      ]),
    );
  }
  return en;
}

for (const enPath of enFiles(src)) {
  const read = (lang) =>
    JSON.parse(readFileSync(enPath.replace(/en\.json$/, `${lang}.json`), 'utf8'));
  const merged = longest(read('en'), [read('ru'), read('uk')]);
  const target = join(out, relative(src, enPath));
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, JSON.stringify(merged));
}
