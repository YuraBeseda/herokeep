#!/usr/bin/env node
// Wired into `pnpm --filter web lint` (see package.json).
//
// Fails the build when the `en` translation files under `src/assets/i18n` are missing keys that
// templates/components use; only warns (non-blocking) when `ru`/`uk` are missing keys.
//
// Why this script exists instead of a bare `transloco-keys-manager find` call: the keys-manager
// 8.1.1 "detective" (`find`) has no per-language flag — `-l/--langs` only affects the extractor
// (which languages to *generate*), never which existing translation files the detective
// *compares*. `find` always globs every `*.json` file under `--translations-path` and exits 1 if
// ANY of them is missing a key, with no way to distinguish which language failed from the exit
// code alone. To get an en-fails/ru+uk-warns split with the real CLI, this script mirrors only
// the relevant per-scope language file(s) into a scratch directory for each pass and points
// `find -p` at that mirror, so each pass's exit code reflects only the language(s) it mirrored.
// See task-4-report.md for the full investigation.
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const webRoot = dirname(scriptDir);
const i18nRoot = join(webRoot, 'src/assets/i18n');
const cliEntry = join(webRoot, 'node_modules/@jsverse/transloco-keys-manager/index.js');
const configPath = join(webRoot, 'transloco.config.js');

/**
 * Recursively copies every `<...scope>/<lang>.json` file under `srcRoot` whose filename is in
 * `langFileNames` into `destRoot`, preserving the scope sub-path.
 */
function mirrorLangFiles(srcRoot, destRoot, langFileNames) {
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const fullPath = join(dir, entry);
      if (statSync(fullPath).isDirectory()) {
        walk(fullPath);
        continue;
      }
      if (!langFileNames.includes(entry)) continue;
      const dest = join(destRoot, relative(srcRoot, fullPath));
      mkdirSync(dirname(dest), { recursive: true });
      cpSync(fullPath, dest);
    }
  };
  walk(srcRoot);
}

function runFind(translationsPath) {
  const result = spawnSync(
    process.execPath,
    [cliEntry, 'find', '--config', configPath, '--translations-path', translationsPath],
    { cwd: webRoot, encoding: 'utf8' },
  );
  process.stdout.write(result.stdout ?? '');
  process.stderr.write(result.stderr ?? '');
  return result.status ?? 1;
}

const scratchRoot = mkdtempSync(join(tmpdir(), 'hk-i18n-check-'));
try {
  const enMirror = join(scratchRoot, 'en');
  mkdirSync(enMirror, { recursive: true });
  mirrorLangFiles(i18nRoot, enMirror, ['en.json']);
  const enStatus = runFind(enMirror);
  if (enStatus !== 0) {
    console.error('\n[i18n:check] Missing English (en) translation keys — failing.\n');
    process.exit(enStatus);
  }

  const warnMirror = join(scratchRoot, 'warn');
  mkdirSync(warnMirror, { recursive: true });
  mirrorLangFiles(i18nRoot, warnMirror, ['ru.json', 'uk.json']);
  const warnStatus = runFind(warnMirror);
  if (warnStatus !== 0) {
    console.warn(
      '\n[i18n:check] Missing ru/uk translation keys detected (non-blocking warning — see table above).\n',
    );
  }
} finally {
  rmSync(scratchRoot, { recursive: true, force: true });
}
